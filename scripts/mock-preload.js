// 仅用于本地截图自测：用假数据代替主进程
const { contextBridge } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ClipStore } = require('../src/clipstore');
const { TodoStore, dayKey, dayLabel } = require('../src/todostore');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peek-mock-'));
const clips = new ClipStore(path.join(tmp, 'clip'), { limit: 200 });
const now = Date.now();
clips.addText('https://github.com/naolen/peek-island', now - 3 * 3600e3);
clips.addText('下午三点的评审改到四点了，记得带上上周的数据表和竞品分析', now - 50 * 60e3);
const fav = clips.addText('收货地址：示例市示例区示例路 1 号', now - 20 * 60e3);
clips.update(fav.id, { fav: true, note: '常用地址' });
clips.addText('SELECT code, name, pct FROM quotes WHERE pct > 3 ORDER BY pct DESC;', now - 5 * 60e3);
clips.addText('600519', now - 20e3);
const todos = new TodoStore(path.join(tmp, 'todo.json'));
const yesterday = dayKey(new Date(now - 86400e3));
todos.ensureToday(yesterday);
todos.add(yesterday, '整理周报数据');
const y2 = todos.add(yesterday, '回复产品群的需求文档');
todos.toggle(yesterday, y2.id);
todos.setNote(yesterday, '昨天的笔记');
const today = todos.ensureToday(dayKey());
const t1 = todos.add(today, '下午 4 点需求评审');
todos.add(today, '把分时图的均价线再调一下');
todos.toggle(today, t1.id);
todos.setNote(today, '今天先把剪贴板和待办做完，明天接东方财富。');
const clipView = (it) => Object.assign({}, it, { thumb: '', length: (it.text || '').length });
const listeners = { clip: [], todo: [], page: [], inbox: [], inboxChanged: [] };
const { Inbox } = require('../src/inbox');
const inbox = new Inbox(60);
inbox.add({ kind: 'notify', id: 1, app: '飞书', title: '王经理', body: '下午的评审改到 4 点，记得带上数据', time: now - 6 * 60e3 });
inbox.add({ kind: 'notify', id: 2, app: 'QQ', title: '产品群', body: '@你 需求文档 v3 已更新，请过目', time: now - 25 * 60e3 });
inbox.add({ kind: 'mail', id: 3, app: 'QQ 邮箱', account: 'QQ 邮箱', title: '本周数据周报', body: '附件为本周各渠道数据汇总，请查收。', time: now - 2 * 3600e3 });
inbox.items[2].read = true;
const fire = (k) => listeners[k].forEach((f) => f());
const { sanitize } = require('../src/config');
const cfg = sanitize({
  mode: 'auto', redUp: true, refreshMs: 3000, rotateMs: 3000, collapseDelayMs: 1200, breatheAbove: 3, bossKey: 'Control+Alt+S', activeGroup: 0,
  groups: [
    { name: '自选', codes: ['sh600519', 'sz300750', 'sz002594', 'sh688981', 'sh600036'] },
    { name: '持仓', codes: ['hk00700', 'hk03690', 'sh601318'] },
    { name: '美股', codes: ['usNVDA', 'usAAPL'] }
  ]
});
const base = { sh600519: ['贵州茅台', 1682.5, 0.84], sz300750: ['宁德时代', 251.36, 2.15], sz002594: ['比亚迪', 318.2, -1.02], sh688981: ['中芯国际', 96.48, 3.67], sh600036: ['招商银行', 42.15, -0.31], hk00700: ['腾讯控股', 512, 1.24], hk03690: ['美团-W', 148.3, -2.4], sh601318: ['中国平安', 56.72, 0.53], usNVDA: ['英伟达', 186.42, 1.88], usAAPL: ['苹果', 241.1, -0.46] };
const quotes = {};
for (const [c, [name, price, pct]] of Object.entries(base)) {
  const prevClose = price / (1 + pct / 100);
  quotes[c] = { code: c, name, symbol: c.slice(2), price, prevClose, pct, change: price - prevClose, open: prevClose * 1.002, high: Math.max(price, prevClose) * 1.006, low: Math.min(price, prevClose) * 0.994, volume: 2.6e5, amount: 4.4e9, turnover: 0.21, volRatio: 1.12, time: Date.now() };
}
const idx = { sh000001: ['上证指数', 3412.56, 0.45], sz399001: ['深证成指', 10988.2, 0.82], sz399006: ['创业板指', 2286.4, 1.36], giHSI: ['恒生指数', 26120.3, -0.38], giNDX: ['纳斯达克100', 21530.8, 0.91] };
for (const [c, [name, price, pct]] of Object.entries(idx)) quotes[c] = { code: c, name, price, prevClose: price / (1 + pct / 100), pct, change: 0, open: price, high: price * 1.004, low: price * 0.993, volume: 3.2e8, amount: 4.1e11, time: Date.now() };
cfg.welcomed = true;
cfg.holdings = sanitize({ holdings: { hk00700: { qty: 200, cost: 452 }, sh601318: { qty: 1000, cost: 48.2 }, sh600519: { qty: 100, cost: 1550 }, hk03690: { qty: 300, cost: 160 } } }).holdings;
cfg.alerts = sanitize({ alerts: { sh600519: { upOn: true, up: 1700, downOn: true, down: 1650 }, sh688981: { fastOn: true, fast: 2 } } }).alerts;
const pnl = require('../src/pnl');
const pnlState = () => ({ fx: { USD: 7.18, HKD: 0.921, auto: true }, groups: cfg.groups.map((g) => pnl.group(g.codes, quotes, cfg.holdings, { USD: 7.18, HKD: 0.921 })), items: Object.fromEntries(Object.keys(cfg.holdings).map((c) => [c, pnl.one(c, quotes[c], cfg.holdings[c], { USD: 7.18, HKD: 0.921 })])) });
function kline(code, klt) {
  const q = quotes[code]; let x = code.charCodeAt(3) * 131 + klt, p = q.price * 0.86; const out = [];
  for (let i = 0; i < 80; i++) {
    x = (x * 9301 + 49297) % 233280; const r = x / 233280 - 0.48;
    const open = p, close = p * (1 + r * (klt === 102 ? 0.07 : 0.035));
    const high = Math.max(open, close) * (1 + (x % 7) / 400), low = Math.min(open, close) * (1 - (x % 5) / 400);
    const d = new Date(Date.now() - (79 - i) * 86400e3 * (klt === 102 ? 7 : 1.4));
    out.push({ d: d.toISOString().slice(0, 10), open, close, high, low, vol: 1e5 + (x % 1000) * 300, amount: 0 }); p = close;
  }
  const last = out[out.length - 1]; const k = q.price / last.close; for (const b of out.slice(-1)) { b.close *= k; b.high = Math.max(b.high * k, b.close); b.low = Math.min(b.low * k, b.close); }
  return out;
}
function book(code) {
  const q = quotes[code]; const t = q.price < 50 ? 0.01 : q.price < 500 ? 0.01 : 0.01;
  return { asks: [5, 4, 3, 2, 1].map((lv) => ({ level: lv, price: q.price + lv * t * (q.price > 500 ? 10 : 1), vol: 20 + lv * 13 })), bids: [1, 2, 3, 4, 5].map((lv) => ({ level: lv, price: q.price - lv * t * (q.price > 500 ? 10 : 1) + t, vol: 31 + lv * 9 })) };
}
const lis = { stealth: [], alert: [], pnl: [], session: [] };
function minute(code, ndays) {
  const q = quotes[code]; let x = code.length * 977 + code.charCodeAt(2) * 31, v = 0;
  const days = ndays === 5 ? ['2026-11-07', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'] : ['2026-11-13'];
  const points = [];
  days.forEach((day, di) => {
    const n = di === days.length - 1 ? 180 : 241;
    let pv = 0, vs = 0;
    for (let i = 0; i < n; i++) {
      x = (x * 9301 + 49297) % 233280; v += (x / 233280 - 0.5) * 0.24;
      const p = q.prevClose * (1 + (v + (ndays === 5 ? 0 : q.pct * i / 180) - (ndays === 5 ? 0 : 0)) / 100);
      const vol = 50 + ((i * 37) % 90) + (i < 20 ? 200 : 0); pv += p * vol; vs += vol;
      const m = 570 + (i > 120 ? i + 90 : i);
      points.push({ t: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'), d: day, price: p, vol, avg: pv / vs });
    }
  });
  return { date: days[days.length - 1], days, prevClose: q.prevClose, points };
}
contextBridge.exposeInMainWorld('peek', {
  getConfig: async () => cfg, setConfig: async (p) => Object.assign(cfg, p), getQuotes: async () => quotes,
  getMinute: async (c, n) => minute(c, n), search: async () => [],
  getKline: async (c, klt) => kline(c, klt), getBook: async (c) => book(c),
  getSession: async () => ({ sessions: { a: { state: 'trading', label: '', active: true }, hk: { state: 'lunch', label: '午休', active: false }, us: { state: 'closed', label: '收盘', active: false } }, source: 'eastmoney' }),
  onSession: (cb) => lis.session.push(cb),
  getStealth: async () => false, toggleStealth: () => {}, onStealth: (cb) => lis.stealth.push(cb),
  getFx: async () => ({ USD: 7.18, HKD: 0.921, auto: true }), onFx: () => {},
  getPnl: async () => pnlState(), onPnl: (cb) => lis.pnl.push(cb),
  log: () => {}, checkUpdate: async () => ({ ok: true, current: '0.3.0', latest: '0.3.0', newer: false }), openFolder: () => {}, resetConfig: async () => cfg, getDisplays: async () => [{ id: '1', primary: true, label: '屏幕 1（主屏幕） · 2560×1440' }, { id: '2', primary: false, label: '屏幕 2 · 1920×1080' }],
  onAlert: (cb) => lis.alert.push(cb), describeAlert: async () => '', copyText: async () => true,
  exportGroups: async () => ({ ok: false }), importGroups: async () => ({ ok: false }),
  memory: async () => ({ totalMB: 214, processes: 5, gpu: 48, native: 22 }),
  __mockStealth: (on) => lis.stealth.forEach((f) => f(on)),
  __mockAlert: (ev) => lis.alert.forEach((f) => f(ev)), setIgnoreMouse: () => {}, openSettings: () => {},
  onQuotes: () => {}, onConfig: () => {}, onStatus: () => {},
  getMedia: async () => ({ active: true, available: true, app: 'QQMusic.exe', title: '夜航（示例）', artist: '示例歌手', album: '示例专辑', status: 'playing', position: 52, duration: 214, updatedAt: Date.now(), receivedAt: Date.now(), canPrev: true, canNext: true, thumb: '' }),
  mediaCmd: () => {},
  clipList: async (q) => clips.query(q || {}).map(clipView),
  clipCopy: async () => true,
  clipUpdate: async (id, p) => { const r = clips.update(id, p); fire('clip'); return r; },
  clipRemove: async (id) => { clips.remove(id); fire('clip'); return true; },
  clipClear: async () => { clips.clear(); fire('clip'); return true; },
  onClipChanged: (cb) => listeners.clip.push(cb),
  todoGet: async (key) => { const k = key || today; return { today, key: k, label: dayLabel(k), isToday: k === today, day: todos.day(k), archive: todos.archive() }; },
  todoAdd: async (t) => { todos.add(today, t); fire('todo'); },
  todoToggle: async (k, id) => { todos.toggle(k, id); fire('todo'); },
  todoEdit: async (k, id, t) => { todos.edit(k, id, t); fire('todo'); },
  todoRemove: async (k, id) => { todos.remove(k, id); fire('todo'); },
  todoMove: async (k, id, d) => { todos.move(k, id, d); fire('todo'); },
  todoNote: async (n) => todos.setNote(today, n),
  todoExport: async () => null,
  onTodoChanged: (cb) => listeners.todo.push(cb),
  inboxList: async (kind) => ({ items: inbox.list(kind), unread: inbox.unread() }),
  inboxReadAll: async () => { inbox.markAllRead(); listeners.inboxChanged.forEach((f) => f({ unread: 0 })); return true; },
  inboxRemove: async (k) => { inbox.remove(k); listeners.inboxChanged.forEach((f) => f({ unread: inbox.unread() })); return true; },
  inboxClear: async (kind) => { inbox.clear(kind); listeners.inboxChanged.forEach((f) => f({ unread: inbox.unread() })); return true; },
  onInboxNew: (cb) => listeners.inbox.push(cb),
  onInboxChanged: (cb) => listeners.inboxChanged.push(cb),
  notifyStatus: async () => ({ status: 'denied' }),
  notifyApps: async () => [{ name: '飞书' }, { name: 'QQ' }, { name: 'Steam' }],
  openNotifySettings: () => {},
  onNotifyStatus: () => {},
  onNotifyApps: () => {},
  __mockNotify: () => {
    const item = inbox.add({ kind: 'notify', id: Date.now(), app: '飞书', title: '张总', body: '方案我看过了，挺好，下班前发我终版', time: Date.now() });
    listeners.inbox.forEach((f) => f({ item, unread: inbox.unread(), popup: true }));
  },
  mailPresets: async () => require('../src/mailpresets').PRESETS,
  mailAccounts: async () => ({
    accounts: [
      { id: 'm1', preset: 'qq', email: 'demo@qq.com', label: 'QQ 邮箱', host: 'imap.qq.com', port: 993, enabled: true },
      { id: 'm2', preset: 'gmail', email: 'demo@gmail.com', label: 'Gmail', host: 'imap.gmail.com', port: 993, enabled: true }
    ],
    status: { m1: { state: 'ok', error: '' }, m2: { state: 'error', error: '账号或授权码不对（注意要填授权码 / 应用专用密码，不是登录密码）' } },
    encryption: true
  }),
  mailSave: async () => ({ ok: false, error: '演示模式' }),
  mailRemove: async () => true, mailToggle: async () => true, mailRetry: async () => true,
  mailBody: async () => ({ subject: '本周数据周报', from: '数据组 <data@example.com>', date: Date.now() - 2 * 3600e3, text: '大家好：\n\n附件为本周各渠道数据汇总，请查收。\n\n数据组', attachments: ['周报.xlsx'] }),
  onMailStatus: () => {},
  getLoginItem: async () => true,
  setLoginItem: async (on) => on,
  appInfo: async () => ({ version: require('../package.json').version }),
  openLink: () => {},
  onSettingsSection: () => {},
  setFocus: () => {},
  onPageOpen: (cb) => { window.__openPage = cb; },
  getShortcuts: async () => ({}),
  onShortcuts: () => {},
  onMedia: () => {},
  onLevel: (cb) => { let t = 0; setInterval(() => { t += 1; cb(0.35 + 0.3 * Math.abs(Math.sin(t / 3)) + 0.2 * Math.abs(Math.sin(t * 1.7))); }, 60); }
});
