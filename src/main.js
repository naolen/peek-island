// 主进程：顶部透明置顶窗口、托盘、老板键、行情轮询。
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage, shell } = require('electron');
const path = require('path');
const { ConfigStore } = require('./config');
const feed = require('./feed');
const { NativeHelper } = require('./native');

// 岛窗口的尺寸要能装下最大的展开面板；没有内容的透明区域会把点击穿透给下面的软件
// 按最大缩放 1.2 倍、最大顶部偏移 40px 留足空间
const ISLAND_W = 760;
const ISLAND_H = 720;

let store;
let islandWin = null;
let settingsWin = null;
let tray = null;
let hidden = false;
let pollTimer = null;
let lastQuotes = {};
let online = true;
let native = null;
// 当前媒体状态；封面只在换歌时由小助手发送，这里缓存起来
let media = { active: false, available: false };

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => openSettings());

function placeIsland() {
  if (!islandWin) return;
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  islandWin.setBounds({ x: Math.round(b.x + (b.width - ISLAND_W) / 2), y: b.y, width: ISLAND_W, height: ISLAND_H });
}

function createIsland() {
  islandWin = new BrowserWindow({
    width: ISLAND_W,
    height: ISLAND_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 不抢键盘焦点，正在打字的窗口不受影响
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  islandWin.setAlwaysOnTop(true, 'screen-saver');
  islandWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  islandWin.setIgnoreMouseEvents(true, { forward: true });
  placeIsland();
  islandWin.loadFile(path.join(__dirname, 'renderer', 'island.html'));
  islandWin.once('ready-to-show', () => { if (!hidden) islandWin.showInactive(); });
  islandWin.on('closed', () => { islandWin = null; });
}

function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    title: '余光 · 设置',
    backgroundColor: '#15171C',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'tray@2x.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function broadcast(channel, payload) {
  for (const w of [islandWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function allCodes() {
  const set = new Set();
  for (const g of store.get().groups) for (const c of g.codes) set.add(c);
  return Array.from(set);
}

async function poll() {
  clearTimeout(pollTimer);
  try {
    const q = await feed.fetchQuotes(allCodes());
    lastQuotes = Object.assign(lastQuotes, q);
    if (!online) { online = true; broadcast('status', { online }); }
    broadcast('quotes', lastQuotes);
  } catch (e) {
    if (online) { online = false; broadcast('status', { online, error: String(e.message || e) }); }
  }
  pollTimer = setTimeout(poll, store.get().refreshMs);
}

function setHidden(h) {
  hidden = h;
  if (!islandWin) return;
  if (hidden) islandWin.hide();
  else { placeIsland(); islandWin.showInactive(); }
  buildTray();
}

function registerBossKey() {
  globalShortcut.unregisterAll();
  const key = store.get().bossKey;
  try {
    const ok = globalShortcut.register(key, () => setHidden(!hidden));
    if (!ok) console.warn('[bosskey] 注册失败，可能被其他软件占用：', key);
  } catch (e) {
    console.warn('[bosskey] 快捷键格式不正确：', key);
  }
}

function applyConfig(patch) {
  const cfg = store.set(patch);
  broadcast('config', cfg);
  registerBossKey();
  buildTray();
  poll();
  return cfg;
}

function buildTray() {
  const cfg = store.get();
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  if (!tray) {
    tray = new Tray(icon);
    tray.setToolTip('余光');
    tray.on('click', () => setHidden(!hidden));
  }
  const modeItem = (label, mode) => ({ label, type: 'radio', checked: cfg.mode === mode, click: () => applyConfig({ mode }) });
  const login = app.getLoginItemSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: hidden ? '显示（' + cfg.bossKey + '）' : '隐藏（' + cfg.bossKey + '）', click: () => setHidden(!hidden) },
    { type: 'separator' },
    { label: '平时显示为', enabled: false },
    modeItem('光带：只有一条细光', 'strip'),
    modeItem('自动：靠近时变成岛', 'auto'),
    modeItem('常驻：一直显示岛', 'pinned'),
    { type: 'separator' },
    { label: '红涨绿跌', type: 'checkbox', checked: cfg.redUp, click: (it) => applyConfig({ redUp: it.checked }) },
    { label: '分组与设置…', click: openSettings },
    { label: '开机自动启动', type: 'checkbox', checked: login.openAtLogin, click: (it) => { app.setLoginItemSettings({ openAtLogin: it.checked }); buildTray(); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
}

function setupNative() {
  native = new NativeHelper({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
  native.on('ready', () => {
    media.available = true;
    broadcast('media', media);
  });
  native.on('unavailable', (reason) => {
    media = { active: false, available: false, reason };
    broadcast('media', media);
  });
  native.on('media', (m) => {
    const thumb = m.thumb === null || m.thumb === undefined ? media.thumb : m.thumb;
    media = Object.assign({}, m, { thumb, available: true, receivedAt: Date.now() });
    broadcast('media', media);
    // 只有在放歌时才让小助手推送音量峰值
    native.send({ cmd: 'level', on: media.active && media.status === 'playing' });
  });
  native.on('level', (l) => {
    if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('level', l.peak);
  });
  native.on('error', (e) => console.warn('[native]', e.message));
  native.start();
}

function setupIpc() {
  ipcMain.handle('config:get', () => store.get());
  ipcMain.handle('config:set', (_e, patch) => applyConfig(patch || {}));
  ipcMain.handle('quotes:get', () => lastQuotes);
  ipcMain.handle('minute:get', async (_e, code) => {
    if (typeof code !== 'string') return null;
    const q = lastQuotes[code] || {};
    try { return await feed.fetchMinute(code, q.symbol, q.prevClose); } catch (e) { return null; }
  });
  ipcMain.handle('search', async (_e, q) => {
    try { return await feed.search(q); } catch (e) { return []; }
  });
  ipcMain.on('mouse:ignore', (e, ignore) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w === islandWin) w.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.handle('media:get', () => media);
  ipcMain.on('media:cmd', (_e, cmd) => {
    if (native && ['toggle', 'play', 'pause', 'next', 'prev'].includes(cmd)) native.send({ cmd });
  });
  ipcMain.on('settings:open', () => openSettings());
  ipcMain.on('link:open', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.naolen.peekisland');
  store = new ConfigStore(app.getPath('userData'));
  setupIpc();
  createIsland();
  buildTray();
  registerBossKey();
  poll();
  setupNative();
  screen.on('display-metrics-changed', placeIsland);
  screen.on('display-added', placeIsland);
  screen.on('display-removed', placeIsland);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (native) native.stop();
});
// 关掉设置窗口不退出，常驻托盘
app.on('window-all-closed', () => {});
