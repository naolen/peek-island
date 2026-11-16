// 主进程：顶部透明置顶窗口、托盘、老板键、行情轮询。
const { app, powerMonitor, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { ConfigStore, DEFAULTS, inStealthSchedule, exportGroups, parseImport } = require('./config');
const update = require('./update');
const alerts = require('./alerts');
const pnl = require('./pnl');
const { sessionOf, partsIn } = require('./session');
const { marketOf } = require('./quotes');
const feed = require('./feed');
const { NativeHelper } = require('./native');
const { ClipStore } = require('./clipstore');
const { ClipWatcher } = require('./clipwatch');
const { TodoStore, dayKey, dayLabel } = require('./todostore');
const { Inbox, isAllowed } = require('./inbox');
const { MailAccount, testAccount } = require('./mail');
const { PRESETS, normalizeAccount } = require('./mailpresets');
const { Secrets } = require('./secrets');
const fs = require('fs');

// 岛窗口的尺寸要能装下最大的展开面板；没有内容的透明区域会把点击穿透给下面的软件
// 按最大缩放 1.2 倍、最大顶部偏移 40px 留足空间
const ISLAND_W = 760;
const ISLAND_H = 900;

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
const inbox = new Inbox(60);
let notifyStatus = { status: 'unknown', message: '' };
// 当前媒体状态；封面只在换歌时由小助手发送，这里缓存起来
let media = { active: false, available: false };

// 简单的日志：写到 %APPDATA%/peek-island/logs/main.log，排查问题时用
let logFile = null;
function log(...args) {
  const line = new Date().toISOString() + ' ' + args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  try {
    if (!logFile) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'main.log');
      // 超过 1MB 就从头写
      try { if (fs.statSync(logFile).size > 1024 * 1024) fs.writeFileSync(logFile, ''); } catch (e) { /* 文件还不存在 */ }
    }
    fs.appendFileSync(logFile, line + '\n');
  } catch (e) { /* ignore */ }
}
process.on('uncaughtException', (e) => log('[uncaught]', e));
process.on('unhandledRejection', (e) => log('[unhandled]', e));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// 配置在 ready 之前就要读：省内存模式要在 ready 之前关掉 GPU 加速
store = new ConfigStore(app.getPath('userData'));
if (store.recovered) log('[config] 配置文件损坏，已从备份恢复');
if (store.get().lowMemory) {
  app.disableHardwareAcceleration();
}
// 用不到的 Chromium 功能关掉，少占一点内存
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,BackForwardCache,MediaRouter,Translate');

app.on('second-instance', () => openSettings());

/** 岛显示在哪块屏幕：设置里选的那块，找不到（拔掉了）就用主屏幕 */
function islandDisplay() {
  const want = store.get().display;
  const primary = screen.getPrimaryDisplay();
  if (want === 'primary') return primary;
  return screen.getAllDisplays().find((d) => String(d.id) === want) || primary;
}

function placeIsland() {
  if (!islandWin) return;
  const b = islandDisplay().bounds;
  // 窗口不能比屏幕还高，否则 Windows 会把它挪位置或裁掉
  const h = Math.min(ISLAND_H, b.height);
  islandWin.setBounds({ x: Math.round(b.x + (b.width - ISLAND_W) / 2), y: b.y, width: ISLAND_W, height: h });
}

// 前台有全屏窗口（看视频、打游戏、放幻灯片）时把岛藏起来
let fsHidden = false;
function onFullscreen(m) {
  const cfg = store.get();
  const islandOnPrimary = islandDisplay().id === screen.getPrimaryDisplay().id;
  const want = !!(cfg.hideOnFullscreen && m && m.on && !!m.primary === islandOnPrimary);
  lastFullscreen = m || null;
  if (want === fsHidden) return;
  fsHidden = want;
  log('[fullscreen]', fsHidden ? '前台全屏，隐藏岛' : '退出全屏，恢复显示');
  applyVisibility();
}
let lastFullscreen = null;

/** 岛该不该显示：用户手动隐藏、或者前台全屏时不显示 */
function applyVisibility() {
  if (!islandWin || islandWin.isDestroyed()) return;
  const show = !hidden && !fsHidden;
  if (show && !islandWin.isVisible()) { placeIsland(); islandWin.showInactive(); islandWin.setAlwaysOnTop(true, 'screen-saver'); }
  else if (!show && islandWin.isVisible()) islandWin.hide();
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
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  islandWin.setAlwaysOnTop(true, 'screen-saver');
  islandWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  islandWin.setIgnoreMouseEvents(true, { forward: true });
  // 共享屏幕、截图、录屏时看不到岛（Windows 10 2004 及以上）
  if (store.get().hideInCapture) setCapture(true);
  placeIsland();
  watchRenderer(islandWin, 'island');
  islandWin.loadFile(path.join(__dirname, 'renderer', 'island.html'));
  islandWin.once('ready-to-show', () => applyVisibility());
  islandWin.on('closed', () => { islandWin = null; });
}

/** 共享屏幕 / 截图时隐藏岛 */
function setCapture(on) {
  try {
    islandWin.setContentProtection(!!on);
    log('[capture] content protection', on, islandWin.isContentProtected ? islandWin.isContentProtected() : '');
  } catch (e) { log('[capture] 设置失败', e); }
}

/** 界面里的报错也写进日志，方便排查（界面本身看不到控制台） */
function watchRenderer(win, name) {
  const wc = win.webContents;
  wc.on('console-message', (e) => {
    const lv = e.level !== undefined ? e.level : 0;
    if (lv === 'error' || lv === 'warning' || lv >= 2) log(`[${name}]`, e.message, e.sourceId ? String(e.sourceId).split('/').pop() + ':' + e.lineNumber : '');
  });
  wc.on('render-process-gone', (_e, d) => log(`[${name}] 渲染进程退出`, d && d.reason, d && d.exitCode));
  wc.on('preload-error', (_e, p, err) => log(`[${name}] preload 出错`, err));
  wc.on('did-fail-load', (_e, code, desc) => log(`[${name}] 加载失败`, code, desc));
}

const SETTINGS_SECTIONS = ['general', 'stock', 'alerts', 'holdings', 'stealth', 'look', 'music', 'notify', 'mail', 'clip', 'todo', 'about'];

/** 打开设置窗口；section 指定直接打开哪一页（比如从岛上的消息页点设置 → 消息通知） */
function openSettings(section) {
  const sec = SETTINGS_SECTIONS.includes(section) ? section : null;
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    if (sec) settingsWin.webContents.send('settings:section', sec);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    title: '余光 · 设置',
    backgroundColor: '#15171C',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'tray@2x.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  watchRenderer(settingsWin, 'settings');
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  if (sec) settingsWin.webContents.once('did-finish-load', () => settingsWin && settingsWin.webContents.send('settings:section', sec));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function broadcast(channel, payload) {
  for (const w of [islandWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function allCodes() {
  const set = new Set();
  const cfg = store.get();
  for (const g of cfg.groups) for (const c of g.codes) set.add(c);
  for (const c of cfg.indexes) set.add(c);
  for (const c of Object.keys(cfg.alerts)) set.add(c);
  for (const c of Object.keys(cfg.holdings)) set.add(c);
  return Array.from(set);
}

// 每个市场现在处于什么时段（a / hk / us），随报价一起发给岛
let sessions = {};
function computeSessions() {
  const now = new Date();
  const latest = {};
  for (const q of Object.values(lastQuotes)) {
    if (!q || !q.time || /^fx/.test(q.code)) continue;
    const m = marketOf(q.code);
    if (!latest[m] || q.time > latest[m]) latest[m] = q.time;
  }
  const out = {};
  const used = new Set(allCodes().map(marketOf));
  for (const m of ['a', 'hk', 'us']) {
    if (!used.has(m)) continue;
    out[m] = sessionOf(m, now, latest[m] || 0);
  }
  sessions = out;
  return out;
}

// ---------- 预警 ----------
const alertState = {}; // code -> 运行时状态
let lastAlertPrune = 0;
function runAlerts(quotes) {
  const cfg = store.get();
  const now = Date.now();
  const today = partsIn('Asia/Shanghai', new Date(now)).ymd;
  const disable = {};
  for (const [code, raw] of Object.entries(cfg.alerts)) {
    const q = quotes[code];
    if (!q) continue;
    // 只在这只股票的市场在交易时判断，避免收盘后的报价“触发”
    const ses = sessions[marketOf(code)];
    if (ses && !ses.active) continue;
    const rule = alerts.cleanRule(raw);
    const st = alertState[code] || (alertState[code] = {});
    const r = alerts.evaluate(rule, st, q, now, today);
    for (const ev of r.events) fireAlert(ev, cfg);
    if (r.disable.length) disable[code] = r.disable;
  }
  if (Object.keys(disable).length) {
    const next = JSON.parse(JSON.stringify(store.get().alerts));
    for (const [code, keys] of Object.entries(disable)) {
      if (!next[code]) continue;
      for (const k of keys) next[code][k + 'On'] = false;
      next[code].keep = true; // 规则都关了也留在列表里，方便再打开
    }
    applyConfig({ alerts: next });
  }
  if (now - lastAlertPrune > 3600000) {
    lastAlertPrune = now;
    for (const c of Object.keys(alertState)) if (!cfg.alerts[c]) delete alertState[c];
  }
}

function fireAlert(ev, cfg) {
  log('[alert]', ev.code, ev.kind, ev.title);
  const item = inbox.add({ kind: 'alert', id: ev.code + ':' + ev.kind + ':' + ev.time, app: '预警', code: ev.code, alertKind: ev.kind, title: ev.title, body: ev.body, time: ev.time });
  if (item) broadcast('inbox:changed', { unread: inbox.unread() });
  broadcast('alert', Object.assign({}, ev, { cardMs: cfg.alertCardMs }));
}

// ---------- 汇率 ----------
let fx = null; // { USD, HKD, at, auto }
let fxFetchedAt = 0;
function currentFx() {
  const cfg = store.get();
  if (cfg.fxAuto && fx) return { USD: fx.USD, HKD: fx.HKD, auto: true, at: fx.at };
  return { USD: cfg.fxUSD, HKD: cfg.fxHKD, auto: false, at: 0 };
}
async function refreshFx(force) {
  const cfg = store.get();
  if (!cfg.fxAuto) return;
  const needs = Object.keys(cfg.holdings).some((c) => marketOf(c) !== 'a');
  if (!needs && !force) return;
  if (!force && Date.now() - fxFetchedAt < 10 * 60 * 1000) return;
  fxFetchedAt = Date.now();
  const r = await feed.fetchFx();
  if (r) { fx = r; broadcast('fx', currentFx()); broadcastPnl(); }
}

/** 每个分组的持仓盈亏（人民币），没有持仓的分组是 null */
function pnlState() {
  const cfg = store.get();
  const rates = currentFx();
  return {
    fx: rates,
    groups: cfg.groups.map((g) => pnl.group(g.codes, lastQuotes, cfg.holdings, rates)),
    items: Object.fromEntries(Object.keys(cfg.holdings).map((c) => [c, pnl.one(c, lastQuotes[c], cfg.holdings[c], rates)]))
  };
}
function broadcastPnl() { broadcast('pnl', pnlState()); }

// ---------- 低调模式 ----------
// stealthOverride：快捷键 / 托盘手动切换后，覆盖时间表，直到时间表本身的状态变化
let stealthOverride = null;
let lastScheduleState = null;
let stealthOn = false;
function updateStealth() {
  const cfg = store.get();
  const sched = inStealthSchedule(cfg);
  if (lastScheduleState !== null && sched !== lastScheduleState) stealthOverride = null;
  lastScheduleState = sched;
  const on = stealthOverride !== null ? stealthOverride : (cfg.stealth || sched);
  if (on !== stealthOn) {
    stealthOn = on;
    broadcast('stealth', stealthOn);
    buildTray();
  }
  return stealthOn;
}
function toggleStealth() {
  stealthOverride = !stealthOn;
  updateStealth();
}

async function poll() {
  clearTimeout(pollTimer);
  const cfg = store.get();
  let q = null;
  try {
    q = await feed.fetchQuotes(allCodes());
  } catch (e) {
    if (online) { online = false; log('[quotes] 连接中断', e && e.message); broadcast('status', { online, error: String(e.message || e) }); }
  }
  if (q) {
    lastQuotes = Object.assign(lastQuotes, q);
    if (!online) { online = true; log('[quotes] 恢复'); broadcast('status', { online }); }
    // 下面这些出错不等于断线，各自记日志
    try {
      computeSessions();
      broadcast('quotes', lastQuotes);
      broadcast('session', { sessions, source: feed.currentSource() });
    } catch (e) { log('[quotes] 广播出错', e); }
    try { broadcastPnl(); } catch (e) { log('[pnl] 出错', e); }
    try { runAlerts(q); } catch (e) { log('[alert] 出错', e); }
  }
  refreshFx().catch(() => {});
  // 所有市场都不在交易时段时，慢下来；断线时按正常间隔重试
  const active = !online || !Object.keys(sessions).length || Object.values(sessions).some((x) => x.active);
  pollTimer = setTimeout(poll, active ? cfg.refreshMs : cfg.idleRefreshMs);
}

// 时段可能在两次慢速刷新之间变化（例如 9:15 开始竞价），每分钟检查一次，变化时立即刷新
let lastActive = null;
function sessionWatch() {
  computeSessions();
  const active = Object.values(sessions).some((s) => s.active);
  if (lastActive !== null && active !== lastActive) poll();
  lastActive = active;
  broadcast('session', { sessions, source: feed.currentSource() });
  updateStealth();
}

function setHidden(h) {
  hidden = h;
  // 用户手动要求显示时，全屏隐藏也先让一让（直到下一次进入全屏）
  if (!hidden) fsHidden = false;
  applyVisibility();
  buildTray();
}

// 快捷键注册结果，设置窗口里会提示哪个没注册上
let shortcutStatus = {};

/** 唤出岛并直接打开某一页（剪贴板 / 待办），同时让窗口能接收键盘输入 */
function summon(page) {
  if (!islandWin) return;
  if (hidden || fsHidden) setHidden(false);
  setIslandFocus(true);
  islandWin.webContents.send('page:open', page);
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const cfg = store.get();
  const entries = [
    ['bossKey', cfg.bossKey, () => setHidden(!hidden)],
    ['clipKey', cfg.clipKey, () => summon('clip')],
    ['todoKey', cfg.todoKey, () => summon('todo')],
    ['stealthKey', cfg.stealthKey, toggleStealth]
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
    // Windows 上 setFocusable(true) 会顺带让窗口出现在任务栏，这里再藏回去
    islandWin.setSkipTaskbar(true);
    islandWin.focus();
  } else if (islandWin.isFocusable()) {
    // 用户点了别的软件时焦点已经过去了，这时不要再动焦点
    if (islandWin.isFocused()) islandWin.blur();
    islandWin.setFocusable(false);
    islandWin.setSkipTaskbar(true);
  }
}

function applyConfig(patch) {
  const before = store.get();
  const cfg = store.set(patch);
  broadcast('config', cfg);
  if (['bossKey', 'clipKey', 'todoKey', 'stealthKey'].some((k) => before[k] !== cfg[k])) registerShortcuts();
  if (clips && before.clipLimit !== cfg.clipLimit) { clips.setLimit(cfg.clipLimit); broadcast('clip:changed'); }
  if (native && before.notify !== cfg.notify) native.send({ cmd: 'notify', on: cfg.notify });
  if (['stealth', 'stealthSchedule', 'stealthStart', 'stealthEnd'].some((k) => JSON.stringify(before[k]) !== JSON.stringify(cfg[k])) ||
      JSON.stringify(before.stealthDays) !== JSON.stringify(cfg.stealthDays)) {
    stealthOverride = null;
    updateStealth();
  }
  if (islandWin && before.hideInCapture !== cfg.hideInCapture) setCapture(cfg.hideInCapture);
  if (before.display !== cfg.display) placeIsland();
  if (before.hideOnFullscreen !== cfg.hideOnFullscreen || before.display !== cfg.display) onFullscreen(lastFullscreen);
  if (before.fxAuto !== cfg.fxAuto || before.fxUSD !== cfg.fxUSD || before.fxHKD !== cfg.fxHKD) {
    broadcast('fx', currentFx());
    if (cfg.fxAuto) refreshFx(true).catch(() => {});
  }
  if (JSON.stringify(before.holdings) !== JSON.stringify(cfg.holdings) || JSON.stringify(before.groups) !== JSON.stringify(cfg.groups) ||
      before.fxUSD !== cfg.fxUSD || before.fxHKD !== cfg.fxHKD || before.fxAuto !== cfg.fxAuto) broadcastPnl();
  buildTray();
  const codesChanged = JSON.stringify(allCodesOf(before)) !== JSON.stringify(allCodesOf(cfg));
  if (codesChanged || before.refreshMs !== cfg.refreshMs) poll();
  return cfg;
}

function allCodesOf(cfg) {
  return [cfg.groups.map((g) => g.codes), cfg.indexes, Object.keys(cfg.alerts), Object.keys(cfg.holdings)];
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
    { label: '低调模式（' + cfg.stealthKey + '）', type: 'checkbox', checked: stealthOn, click: () => toggleStealth() },
    { label: '红涨绿跌', type: 'checkbox', checked: cfg.redUp, click: (it) => applyConfig({ redUp: it.checked }) },
    { label: '剪贴板历史（' + cfg.clipKey + '）', click: () => summon('clip') },
    { label: '待办与笔记（' + cfg.todoKey + '）', click: () => summon('todo') },
    { label: '设置…', click: () => openSettings() },
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
    // 小助手（重新）启动后，按配置开启通知读取
    native.send({ cmd: 'notify', on: store.get().notify });
  });
  native.on('notify-status', (s) => {
    notifyStatus = { status: s.status, message: s.message || '' };
    broadcast('notify:status', notifyStatus);
  });
  native.on('notification', (n) => {
    const app = n.app || '未知应用';
    if (inbox.seeApp(app)) {
      const known = store.get().notifyKnownApps;
      if (!known.includes(app)) store.set({ notifyKnownApps: known.concat([app]) });
      broadcast('notify:apps', inbox.appList());
    }
    const cfg = store.get();
    if (!cfg.notify || !isAllowed(app, cfg)) return;
    // 只有标题、没有正文的通知（比如“正在后台运行”），一般没意义，跳过
    if (!n.title && !n.body) return;
    const item = inbox.add({ kind: 'notify', id: n.id, app, title: n.title || app, body: n.body || '', time: n.time || Date.now() });
    if (item) broadcast('inbox:new', { item, unread: inbox.unread(), popup: cfg.notifyPopup });
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
  // 小助手发现剪贴板变了（Windows 剪贴板序号变化）
  native.on('clipboard', () => { if (clipWatcher) clipWatcher.poke(); });
  native.on('fullscreen', onFullscreen);
  native.on('level', (l) => {
    if (islandWin && !islandWin.isDestroyed()) islandWin.webContents.send('level', l.peak);
  });
  native.on('error', (e) => log('[native]', e.message));
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
    let t = thumbCache.get(it.id);
    if (t === undefined) {
      try { t = 'data:image/png;base64,' + fs.readFileSync(clips.thumbPath(it)).toString('base64'); }
      catch (e) { t = ''; }
    } else {
      thumbCache.delete(it.id); // 重新插入，保持“最近用过的在最后”
    }
    thumbCache.set(it.id, t);
    // 缩略图缓存最多留 60 张，多了丢掉最久没用的（需要时再从磁盘读）
    while (thumbCache.size > 60) thumbCache.delete(thumbCache.keys().next().value);
    v.thumb = t;
  }
  return v;
}

function setupClips() {
  clips = new ClipStore(path.join(app.getPath('userData'), 'clipboard'), { limit: store.get().clipLimit });
  clipWatcher = new ClipWatcher(clips, {
    onChange: () => broadcast('clip:changed'),
    getOptions: () => ({ enabled: store.get().clipEnabled, images: store.get().clipImages }),
    log
  });
  clipWatcher.start();
  ipcMain.handle('clip:list', (_e, q) => clips.query(q || {}).map(clipView));
  ipcMain.handle('clip:copy', async (_e, id) => {
    const it = clips.get(id);
    const ok = !!it && await clipWatcher.copy(it);
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

// ---------- 消息（通知 / 邮件） ----------
function setupInbox() {
  ipcMain.handle('inbox:list', (_e, kind) => ({ items: inbox.list(kind), unread: inbox.unread() }));
  ipcMain.handle('inbox:read-all', () => { inbox.markAllRead(); broadcast('inbox:changed', { unread: 0 }); return true; });
  ipcMain.handle('inbox:remove', (_e, key) => { inbox.remove(key); broadcast('inbox:changed', { unread: inbox.unread() }); return true; });
  ipcMain.handle('inbox:clear', (_e, kind) => { inbox.clear(kind); broadcast('inbox:changed', { unread: inbox.unread() }); return true; });
  ipcMain.handle('notify:status', () => notifyStatus);
  ipcMain.handle('notify:apps', () => {
    // 合并：这次运行见过的 + 以前见过的（配置里记着）
    const seen = new Map(inbox.appList().map((a) => [a.name, a]));
    for (const name of store.get().notifyKnownApps) if (!seen.has(name)) seen.set(name, { name, count: 0, last: 0 });
    return Array.from(seen.values());
  });
  ipcMain.on('notify:open-settings', () => shell.openExternal('ms-settings:privacy-notifications'));
}

// ---------- 邮箱 ----------
let secrets = null;
const mailboxes = new Map(); // id -> MailAccount
const mailStatus = {};       // id -> { state, error }

function startMailbox(acc) {
  stopMailbox(acc.id);
  if (!acc.enabled) { mailStatus[acc.id] = { state: 'stopped', error: '' }; return; }
  const pass = secrets.get(acc.id);
  if (!pass) { mailStatus[acc.id] = { state: 'error', error: '没有找到保存的授权码，请重新填写' }; broadcast('mail:status', mailStatus); return; }
  const box = new MailAccount(acc, pass);
  box.on('status', (s) => { mailStatus[s.id] = { state: s.state, error: s.error }; broadcast('mail:status', mailStatus); });
  box.on('mail', (m) => {
    const item = inbox.add(Object.assign({}, m, { read: !m.alert }));
    if (!item) return;
    if (m.alert) broadcast('inbox:new', { item, unread: inbox.unread(), popup: store.get().notifyPopup });
    else broadcast('inbox:changed', { unread: inbox.unread() });
  });
  mailboxes.set(acc.id, box);
  box.start();
}

function stopMailbox(id) {
  const box = mailboxes.get(id);
  if (box) { box.removeAllListeners('mail'); box.stop(); mailboxes.delete(id); }
}

function setupMail() {
  secrets = new Secrets(app.getPath('userData'));
  for (const acc of store.get().mailAccounts) startMailbox(acc);

  ipcMain.handle('mail:presets', () => PRESETS.map((p) => ({ id: p.id, name: p.name, host: p.host, port: p.port, help: p.help, domains: p.domains })));
  ipcMain.handle('mail:accounts', () => ({ accounts: store.get().mailAccounts, status: mailStatus, encryption: secrets.available() }));
  // 保存前先试着登录一次，登不上就不保存
  ipcMain.handle('mail:save', async (_e, input, password) => {
    let acc;
    try { acc = normalizeAccount(input || {}); } catch (e) { return { ok: false, error: e.message }; }
    const list = store.get().mailAccounts;
    const existing = list.find((a) => a.id === acc.id);
    const pass = password || (existing ? secrets.get(acc.id) : null);
    if (!pass) return { ok: false, error: '请填写授权码' };
    const r = await testAccount(acc, pass);
    if (!r.ok) return r;
    try { secrets.set(acc.id, pass); } catch (e) { return { ok: false, error: e.message }; }
    const next = existing ? list.map((a) => (a.id === acc.id ? acc : a)) : list.concat([acc]);
    applyConfig({ mailAccounts: next });
    startMailbox(acc);
    return { ok: true, total: r.total, account: acc };
  });
  ipcMain.handle('mail:remove', (_e, id) => {
    stopMailbox(id);
    secrets.remove(id);
    delete mailStatus[id];
    inbox.items = inbox.items.filter((x) => x.accountId !== id);
    applyConfig({ mailAccounts: store.get().mailAccounts.filter((a) => a.id !== id) });
    broadcast('inbox:changed', { unread: inbox.unread() });
    broadcast('mail:status', mailStatus);
    return true;
  });
  ipcMain.handle('mail:toggle', (_e, id, enabled) => {
    const next = store.get().mailAccounts.map((a) => (a.id === id ? Object.assign({}, a, { enabled: !!enabled }) : a));
    applyConfig({ mailAccounts: next });
    const acc = next.find((a) => a.id === id);
    if (acc) startMailbox(acc);
    return true;
  });
  ipcMain.handle('mail:retry', (_e, id) => {
    const acc = store.get().mailAccounts.find((a) => a.id === id);
    if (acc) startMailbox(acc);
    return true;
  });
  ipcMain.handle('mail:body', async (_e, accountId, uid) => {
    const box = mailboxes.get(accountId);
    if (!box) return { error: '这个邮箱没有在运行' };
    try { return await box.body(uid); } catch (e) { return { error: e.message }; }
  });
}

function setupIpc() {
  ipcMain.handle('config:get', () => store.get());
  ipcMain.handle('config:set', (_e, patch) => applyConfig(patch || {}));
  ipcMain.handle('quotes:get', () => lastQuotes);
  ipcMain.handle('minute:get', async (_e, code, ndays) => {
    if (typeof code !== 'string') return null;
    const q = lastQuotes[code] || {};
    try { return await feed.fetchMinute(code, q.symbol, q.prevClose, ndays === 5 ? 5 : 1); } catch (e) { return null; }
  });
  ipcMain.handle('kline:get', async (_e, code, klt) => {
    if (typeof code !== 'string') return null;
    const q = lastQuotes[code] || {};
    try { return await feed.fetchKline(code, q.symbol, klt === 102 ? 102 : 101); } catch (e) { return null; }
  });
  ipcMain.handle('book:get', async (_e, code) => {
    if (typeof code !== 'string' || marketOf(code) !== 'a') return null;
    const q = lastQuotes[code] || {};
    try { return await feed.fetchBook(code, q.symbol); } catch (e) { return null; }
  });
  ipcMain.handle('session:get', () => ({ sessions, source: feed.currentSource() }));
  ipcMain.handle('stealth:get', () => stealthOn);
  ipcMain.on('stealth:toggle', () => toggleStealth());
  ipcMain.handle('fx:get', () => currentFx());
  ipcMain.handle('pnl:get', () => pnlState());
  // 复制股票代码等短文本；不记进剪贴板历史
  ipcMain.handle('text:copy', async (_e, text) => {
    if (typeof text !== 'string' || !text || text.length > 200) return false;
    return clipWatcher ? clipWatcher.copy({ type: 'text', text }) : false;
  });
  ipcMain.handle('alert:describe', (_e, rule) => alerts.describe(rule));
  ipcMain.handle('groups:export', async (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(w, {
      title: '导出分组',
      defaultPath: path.join(app.getPath('documents'), '余光-分组.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false };
    try { fs.writeFileSync(r.filePath, exportGroups(store.get()), 'utf8'); return { ok: true, path: r.filePath }; }
    catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('groups:import', async (e, mode) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(w, { title: '导入分组', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    try {
      const data = parseImport(fs.readFileSync(r.filePaths[0], 'utf8'));
      const cfg = store.get();
      const patch = {};
      if (mode === 'merge') {
        // 合并：同名分组合并代码，其他追加
        const groups = JSON.parse(JSON.stringify(cfg.groups));
        for (const g of data.groups) {
          const hit = groups.find((x) => x.name === g.name);
          if (hit) hit.codes = Array.from(new Set(hit.codes.concat(g.codes)));
          else groups.push(g);
        }
        patch.groups = groups;
        if (data.holdings) patch.holdings = Object.assign({}, cfg.holdings, data.holdings);
        if (data.alerts) patch.alerts = Object.assign({}, cfg.alerts, data.alerts);
      } else {
        patch.groups = data.groups;
        patch.activeGroup = 0;
        if (data.holdings) patch.holdings = data.holdings;
        if (data.alerts) patch.alerts = data.alerts;
      }
      applyConfig(patch);
      return { ok: true, groups: data.groups.length };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
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
  ipcMain.on('settings:open', (_e, section) => openSettings(section));
  ipcMain.handle('login:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('login:set', (_e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on });
    buildTray();
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('displays:get', () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id), primary: d.id === primary,
      label: `屏幕 ${i + 1}${d.id === primary ? '（主屏幕）' : ''} · ${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}`
    }));
  });
  // 关于页显示的内存占用：所有 Electron 进程的工作集 + 原生小助手
  ipcMain.handle('app:memory', async () => {
    const metrics = app.getAppMetrics();
    let total = 0, gpu = 0;
    for (const m of metrics) {
      const kb = (m.memory && m.memory.workingSetSize) || 0;
      total += kb;
      if (m.type === 'GPU') gpu += kb;
    }
    const nativeKb = native && native.memoryKb ? await native.memoryKb().catch(() => 0) : 0;
    const mb = (kb) => Math.round(kb / 1024);
    return { totalMB: mb(total + nativeKb), processes: metrics.length + (nativeKb ? 1 : 0), gpu: mb(gpu), native: mb(nativeKb) };
  });
  // 界面写诊断日志（限速：每分钟最多 30 行）
  let logCount = 0, logWindow = 0;
  ipcMain.on('log:write', (e, text) => {
    const now = Date.now();
    if (now - logWindow > 60000) { logWindow = now; logCount = 0; }
    if (++logCount > 30 || typeof text !== 'string') return;
    log(text.slice(0, 300));
  });
  ipcMain.on('focus:set', (e, on) => {
    if (BrowserWindow.fromWebContents(e.sender) === islandWin) setIslandFocus(!!on);
  });
  ipcMain.handle('shortcuts:get', () => shortcutStatus);
  ipcMain.handle('update:check', () => update.check(app.getVersion()));
  // 打开数据文件夹 / 在文件夹里选中日志文件
  ipcMain.on('folder:open', (_e, kind) => {
    const file = path.join(app.getPath('userData'), 'logs', 'main.log');
    if (kind === 'log' && fs.existsSync(file)) shell.showItemInFolder(file);
    else shell.openPath(app.getPath('userData'));
  });
  // 恢复默认设置：外观、行为、快捷键回到默认；分组、持仓、预警、邮箱、通知名单保留
  ipcMain.handle('config:reset', () => {
    const KEEP = ['groups', 'activeGroup', 'holdings', 'alerts', 'indexes', 'mailAccounts', 'notifyAllowed', 'notifyMuted', 'notifyKnownApps', 'welcomed'];
    const patch = {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (!KEEP.includes(k)) patch[k] = JSON.parse(JSON.stringify(v));
    log('[config] 恢复默认设置');
    return applyConfig(patch);
  });
  ipcMain.on('link:open', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.naolen.peekisland');
  setupIpc();
  setupClips();
  setupTodos();
  setupInbox();
  setupMail();
  createIsland();
  buildTray();
  registerShortcuts();
  updateStealth();
  poll();
  setInterval(sessionWatch, 60000);
  // 排查内存用：设置环境变量 PEEK_DEBUG_MEM=1 后每 10 秒把各进程内存写进日志
  if (process.env.PEEK_DEBUG_MEM) {
    setInterval(() => log('[mem]', app.getAppMetrics().map((m) => m.type + ':' + Math.round(m.memory.workingSetSize / 1024) + 'MB').join(' ')), 10000);
  }
  setupNative();
  // 电脑从睡眠中醒来：马上刷新一次，并把岛放回原位（睡眠期间屏幕可能变了）
  powerMonitor.on('resume', () => { log('[power] 唤醒'); placeIsland(); applyVisibility(); poll(); });
  screen.on('display-metrics-changed', placeIsland);
  screen.on('display-added', placeIsland);
  screen.on('display-removed', placeIsland);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (native) native.stop();
  if (clipWatcher) clipWatcher.stop();
  for (const id of Array.from(mailboxes.keys())) stopMailbox(id);
});
// 关掉设置窗口不退出，常驻托盘
app.on('window-all-closed', () => {});
