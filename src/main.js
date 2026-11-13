// 主进程：顶部透明置顶窗口、托盘、老板键、行情轮询。
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { ConfigStore } = require('./config');
const feed = require('./feed');
const { NativeHelper } = require('./native');
const { ClipStore } = require('./clipstore');
const { ClipWatcher } = require('./clipwatch');
const { TodoStore, dayKey, dayLabel } = require('./todostore');
const fs = require('fs');

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
let clips = null;
let clipWatcher = null;
let todos = null;
let todayKey = null;
const thumbCache = new Map(); // 剪贴板图片缩略图：id -> data URL
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

// 快捷键注册结果，设置窗口里会提示哪个没注册上
let shortcutStatus = {};

/** 唤出岛并直接打开某一页（剪贴板 / 待办），同时让窗口能接收键盘输入 */
function summon(page) {
  if (!islandWin) return;
  if (hidden) setHidden(false);
  setIslandFocus(true);
  islandWin.webContents.send('page:open', page);
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const cfg = store.get();
  const entries = [
    ['bossKey', cfg.bossKey, () => setHidden(!hidden)],
    ['clipKey', cfg.clipKey, () => summon('clip')],
    ['todoKey', cfg.todoKey, () => summon('todo')]
  ];
  shortcutStatus = {};
  for (const [name, key, fn] of entries) {
    if (!key) { shortcutStatus[name] = 'off'; continue; }
    try {
      shortcutStatus[name] = globalShortcut.register(key, fn) ? 'ok' : 'busy';
    } catch (e) {
      shortcutStatus[name] = 'invalid';
    }
    if (shortcutStatus[name] !== 'ok') console.warn('[shortcut]', name, key, shortcutStatus[name]);
  }
  broadcast('shortcuts', shortcutStatus);
}

/** 岛窗口平时不抢焦点；在剪贴板 / 待办页需要打字时临时允许 */
function setIslandFocus(on) {
  if (!islandWin || islandWin.isDestroyed()) return;
  if (on) {
    islandWin.setFocusable(true);
    islandWin.focus();
  } else if (islandWin.isFocusable()) {
    islandWin.blur();
    islandWin.setFocusable(false);
  }
}

function applyConfig(patch) {
  const before = store.get();
  const cfg = store.set(patch);
  broadcast('config', cfg);
  if (['bossKey', 'clipKey', 'todoKey'].some((k) => before[k] !== cfg[k])) registerShortcuts();
  if (clips && before.clipLimit !== cfg.clipLimit) { clips.setLimit(cfg.clipLimit); broadcast('clip:changed'); }
  buildTray();
  if (JSON.stringify(before.groups) !== JSON.stringify(cfg.groups) || before.refreshMs !== cfg.refreshMs) poll();
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
    { label: '剪贴板历史（' + cfg.clipKey + '）', click: () => summon('clip') },
    { label: '待办与笔记（' + cfg.todoKey + '）', click: () => summon('todo') },
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

// ---------- 剪贴板 ----------
function clipView(it) {
  const v = { id: it.id, type: it.type, at: it.at, fav: !!it.fav, note: it.note || '' };
  if (it.type === 'text') {
    v.text = it.text.length > 600 ? it.text.slice(0, 600) + '…' : it.text;
    v.length = it.text.length;
  } else {
    v.width = it.width; v.height = it.height;
    if (!thumbCache.has(it.id)) {
      try { thumbCache.set(it.id, 'data:image/png;base64,' + fs.readFileSync(clips.thumbPath(it)).toString('base64')); }
      catch (e) { thumbCache.set(it.id, ''); }
    }
    v.thumb = thumbCache.get(it.id);
  }
  return v;
}

function setupClips() {
  clips = new ClipStore(path.join(app.getPath('userData'), 'clipboard'), { limit: store.get().clipLimit });
  clipWatcher = new ClipWatcher(clips, {
    onChange: () => broadcast('clip:changed'),
    getOptions: () => ({ enabled: store.get().clipEnabled, images: store.get().clipImages })
  });
  clipWatcher.start();
  ipcMain.handle('clip:list', (_e, q) => clips.query(q || {}).map(clipView));
  ipcMain.handle('clip:copy', (_e, id) => {
    const it = clips.get(id);
    const ok = !!it && clipWatcher.copy(it);
    if (ok) broadcast('clip:changed');
    return ok;
  });
  ipcMain.handle('clip:update', (_e, id, patch) => {
    const it = clips.update(id, patch || {});
    broadcast('clip:changed');
    return it ? clipView(it) : null;
  });
  ipcMain.handle('clip:remove', (_e, id) => { thumbCache.delete(id); const ok = clips.remove(id); broadcast('clip:changed'); return ok; });
  ipcMain.handle('clip:clear', () => { thumbCache.clear(); clips.clear(); broadcast('clip:changed'); return true; });
}

// ---------- 待办 ----------
function todoState(key) {
  const k = key || todayKey;
  return { today: todayKey, key: k, label: dayLabel(k), isToday: k === todayKey, day: todos.day(k), archive: todos.archive() };
}

function setupTodos() {
  todos = new TodoStore(path.join(app.getPath('userData'), 'todo.json'));
  todayKey = todos.ensureToday(dayKey(), store.get().todoRollover);
  // 过了零点自动换到新的一天
  setInterval(() => {
    const k = dayKey();
    if (k !== todayKey) {
      todayKey = todos.ensureToday(k, store.get().todoRollover);
      broadcast('todo:changed');
    }
  }, 60 * 1000);
  const changed = (r) => { broadcast('todo:changed'); return r; };
  ipcMain.handle('todo:get', (_e, key) => todoState(key));
  ipcMain.handle('todo:add', (_e, text) => changed(todos.add(todayKey, text)));
  ipcMain.handle('todo:toggle', (_e, key, id) => changed(todos.toggle(key || todayKey, id)));
  ipcMain.handle('todo:edit', (_e, key, id, text) => changed(todos.edit(key || todayKey, id, text)));
  ipcMain.handle('todo:remove', (_e, key, id) => changed(todos.remove(key || todayKey, id)));
  ipcMain.handle('todo:move', (_e, key, id, d) => changed(todos.move(key || todayKey, id, d)));
  ipcMain.handle('todo:note', (_e, note) => { todos.setNote(todayKey, note); return true; });
  ipcMain.handle('todo:export', async (_e, which) => {
    const all = which === 'all';
    const name = all ? '余光-待办与笔记.md' : `余光-${which || todayKey}.md`;
    const parent = islandWin && !islandWin.isDestroyed() ? islandWin : undefined;
    const r = await dialog.showSaveDialog(parent, {
      title: '导出为 Markdown',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, all ? todos.allToMarkdown() : todos.toMarkdown(which || todayKey), 'utf8');
    return r.filePath;
  });
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
  ipcMain.on('focus:set', (e, on) => {
    if (BrowserWindow.fromWebContents(e.sender) === islandWin) setIslandFocus(!!on);
  });
  ipcMain.handle('shortcuts:get', () => shortcutStatus);
  ipcMain.on('link:open', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.naolen.peekisland');
  store = new ConfigStore(app.getPath('userData'));
  setupIpc();
  setupClips();
  setupTodos();
  createIsland();
  buildTray();
  registerShortcuts();
  poll();
  setupNative();
  screen.on('display-metrics-changed', placeIsland);
  screen.on('display-added', placeIsland);
  screen.on('display-removed', placeIsland);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (native) native.stop();
  if (clipWatcher) clipWatcher.stop();
});
// 关掉设置窗口不退出，常驻托盘
app.on('window-all-closed', () => {});
