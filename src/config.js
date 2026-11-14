// 用户配置：分组、显示模式、配色等。存成 userData 目录下的 config.json。
const fs = require('fs');
const path = require('path');
const { cleanRule, anyOn } = require('./alerts');

const DEFAULTS = {
  // strip = 只显示光带；auto = 平时光带，鼠标靠近 / 有异动时变成岛；pinned = 一直显示岛
  mode: 'auto',
  // true：红涨绿跌（A 股习惯）；false：绿涨红跌
  redUp: true,
  // 行情刷新间隔（毫秒）
  refreshMs: 3000,
  // 岛上轮播间隔（毫秒）
  rotateMs: 3000,
  // 鼠标离开后多久缩回光带（毫秒）
  collapseDelayMs: 1200,
  // 涨跌幅超过这个值，光带上那一段会“呼吸”
  breatheAbove: 3,
  bossKey: 'Control+Alt+S',
  // 在岛上显示正在播放的音乐（QQ 音乐、网易云、Spotify、浏览器等）
  music: true,
  // 剪贴板历史
  clipEnabled: true,
  clipImages: true,
  clipLimit: 200,
  clipKey: 'Control+Alt+V',
  // 系统通知：notify 总开关；notifyPopup 来通知时岛自动弹出卡片
  notify: true,
  notifyPopup: true,
  // true = 所有应用都提醒；false = 预设（飞书、QQ、钉钉、企业微信、Outlook、Teams、邮件）+ 手动勾选
  notifyAll: false,
  notifyAllowed: [],
  notifyMuted: [],
  // 见过的发通知的应用，设置里列出来让用户勾选
  notifyKnownApps: [],
  // 邮箱账户（授权码不在这里，加密存在 mail-secrets.json）
  mailAccounts: [],
  // 待办：没做完的事第二天自动顺延
  todoRollover: true,
  todoKey: 'Control+Alt+T',
  // 外观：classic = 经典黑；glass = 液态玻璃（更透）
  style: 'classic',
  // 整体不透明度 0.3 ~ 1，越低越不显眼
  opacity: 1,
  // 整体大小 0.8 ~ 1.2
  scale: 1,
  // 离屏幕顶边的距离（像素），0 = 贴边
  topOffset: 0,
  // 顶部指数条（面板里），点一下可以看指数分时
  indexes: ['sh000001', 'sz399001', 'sz399006', 'giHSI', 'giNDX'],
  // 预警：{ [code]: { upOn, up, downOn, down, pctOn, pct, fastOn, fast, limitOn, notify, repeat } }
  alerts: {},
  // 预警触发后弹出的卡片停留多久（毫秒）
  alertCardMs: 6000,
  // 持仓：{ [code]: { qty, cost } }
  holdings: {},
  // 港币、美元兑人民币；fxAuto = 自动从行情里取，取不到用下面的数
  fxAuto: true,
  fxHKD: 0.92,
  fxUSD: 7.2,
  // 持仓盈亏在岛上怎么显示：amount 金额 / pct 百分比 / dir 只显示方向
  pnlShow: 'amount',
  // 岛上是否显示当前分组的持仓盈亏
  pnlOnIsland: true,
  // 低调模式：不用红绿、名称换成代码、不显示金额、光带变细变灰
  stealth: false,
  stealthKey: 'Control+Alt+H',
  // 按时间自动进入低调模式
  stealthSchedule: false,
  stealthStart: '09:00',
  stealthEnd: '18:00',
  stealthDays: [1, 2, 3, 4, 5],
  // 省内存模式：关掉 GPU 加速（重启后生效）
  lowMemory: false,
  // 共享屏幕、截图、录屏时自动隐藏岛（别人看不到，自己照常看得到）
  hideInCapture: true,
  // 低调模式下的不透明度
  stealthOpacity: 0.7,
  // 分组在岛上的显示方式：rotate 轮播 / summary 汇总（涨跌家数 + 平均涨幅）/ pin 固定第一只
  groupDisplay: 'rotate',
  // 不在交易时段时多久刷新一次（毫秒）
  idleRefreshMs: 300000,
  activeGroup: 0,
  // 代码使用腾讯行情格式：sh / sz / bj 开头为 A 股，hk 为港股，us 为美股
  groups: [
    { name: '自选', codes: ['sh600519', 'sz300750', 'sz002594', 'sh688981', 'sh600036'] },
    { name: '持仓', codes: ['hk00700', 'hk03690', 'sh601318'] },
    { name: '美股', codes: ['usNVDA', 'usAAPL', 'usTSLA', 'usMSFT'] },
    { name: '观察', codes: ['sh601899', 'sh600900'] }
  ]
};

const MAX_PER_GROUP = 8;

function sanitize(cfg) {
  const out = Object.assign({}, DEFAULTS, cfg || {});
  if (!['strip', 'auto', 'pinned'].includes(out.mode)) out.mode = DEFAULTS.mode;
  out.redUp = out.redUp !== false;
  out.music = out.music !== false;
  out.clipEnabled = out.clipEnabled !== false;
  out.clipImages = out.clipImages !== false;
  out.clipLimit = clampInt(out.clipLimit, 20, 2000, DEFAULTS.clipLimit);
  out.todoRollover = out.todoRollover !== false;
  out.notify = out.notify !== false;
  out.notifyPopup = out.notifyPopup !== false;
  out.notifyAll = out.notifyAll === true;
  out.mailAccounts = (Array.isArray(out.mailAccounts) ? out.mailAccounts : [])
    .filter((a) => a && typeof a.id === 'string' && typeof a.email === 'string' && typeof a.host === 'string')
    .map((a) => ({
      id: a.id, preset: String(a.preset || 'custom'), email: a.email, user: String(a.user || a.email),
      host: a.host, port: clampInt(a.port, 1, 65535, 993), secure: a.secure !== false,
      label: String(a.label || a.email).slice(0, 20), enabled: a.enabled !== false
    }))
    .slice(0, 10);
  for (const k of ['notifyAllowed', 'notifyMuted', 'notifyKnownApps']) {
    out[k] = Array.from(new Set((Array.isArray(out[k]) ? out[k] : []).filter((x) => typeof x === 'string' && x).map((x) => x.slice(0, 60)))).slice(0, 100);
  }
  for (const k of ['clipKey', 'todoKey']) {
    if (typeof out[k] !== 'string') out[k] = DEFAULTS[k];
    out[k] = out[k].trim().slice(0, 40);
  }
  out.refreshMs = clampInt(out.refreshMs, 1500, 60000, DEFAULTS.refreshMs);
  out.rotateMs = clampInt(out.rotateMs, 1500, 60000, DEFAULTS.rotateMs);
  out.collapseDelayMs = clampInt(out.collapseDelayMs, 200, 10000, DEFAULTS.collapseDelayMs);
  out.breatheAbove = typeof out.breatheAbove === 'number' && out.breatheAbove > 0 ? out.breatheAbove : DEFAULTS.breatheAbove;
  if (typeof out.bossKey !== 'string' || !out.bossKey) out.bossKey = DEFAULTS.bossKey;
  if (!['classic', 'glass'].includes(out.style)) out.style = DEFAULTS.style;
  out.opacity = clampNum(out.opacity, 0.3, 1, DEFAULTS.opacity);
  out.scale = clampNum(out.scale, 0.8, 1.2, DEFAULTS.scale);
  out.topOffset = clampInt(out.topOffset, 0, 40, DEFAULTS.topOffset);
  out.indexes = Array.from(new Set((Array.isArray(out.indexes) ? out.indexes : DEFAULTS.indexes)
    .filter((c) => typeof c === 'string' && /^(sh|sz|bj|hk|us|gi)[A-Za-z0-9.]+$/.test(c)))).slice(0, 6);
  out.alertCardMs = clampInt(out.alertCardMs, 2000, 30000, DEFAULTS.alertCardMs);
  out.alerts = cleanMap(out.alerts, (r) => {
    const c = cleanRule(r);
    return anyOn(c) || r.keep ? c : null;
  });
  out.holdings = cleanMap(out.holdings, (h) => {
    const qty = Number(h && h.qty);
    const cost = Number(h && h.cost);
    if (!(qty > 0)) return null;
    return { qty: Math.round(qty * 1000) / 1000, cost: cost > 0 ? Math.round(cost * 10000) / 10000 : 0 };
  });
  out.fxAuto = out.fxAuto !== false;
  out.fxHKD = clampNum4(out.fxHKD, 0.1, 3, DEFAULTS.fxHKD);
  out.fxUSD = clampNum4(out.fxUSD, 1, 20, DEFAULTS.fxUSD);
  if (!['amount', 'pct', 'dir'].includes(out.pnlShow)) out.pnlShow = DEFAULTS.pnlShow;
  out.pnlOnIsland = out.pnlOnIsland !== false;
  out.stealth = out.stealth === true;
  out.hideInCapture = out.hideInCapture !== false;
  out.lowMemory = out.lowMemory === true;
  out.stealthSchedule = out.stealthSchedule === true;
  if (typeof out.stealthKey !== 'string') out.stealthKey = DEFAULTS.stealthKey;
  out.stealthKey = out.stealthKey.trim().slice(0, 40);
  for (const k of ['stealthStart', 'stealthEnd']) {
    if (typeof out[k] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(out[k])) out[k] = DEFAULTS[k];
  }
  out.stealthDays = Array.from(new Set((Array.isArray(out.stealthDays) ? out.stealthDays : DEFAULTS.stealthDays)
    .map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort();
  out.stealthOpacity = clampNum(out.stealthOpacity, 0.3, 1, DEFAULTS.stealthOpacity);
  if (!['rotate', 'summary', 'pin'].includes(out.groupDisplay)) out.groupDisplay = DEFAULTS.groupDisplay;
  out.idleRefreshMs = clampInt(out.idleRefreshMs, 30000, 3600000, DEFAULTS.idleRefreshMs);
  let groups = Array.isArray(out.groups) ? out.groups : DEFAULTS.groups;
  groups = groups
    .filter(g => g && typeof g.name === 'string')
    .map(g => ({
      name: g.name.trim().slice(0, 12) || '未命名',
      codes: Array.from(new Set((Array.isArray(g.codes) ? g.codes : []).filter(c => /^(sh|sz|bj|hk|us)[A-Za-z0-9.]+$/.test(c)))).slice(0, MAX_PER_GROUP)
    }));
  if (!groups.length) groups = JSON.parse(JSON.stringify(DEFAULTS.groups));
  out.groups = groups;
  out.activeGroup = clampInt(out.activeGroup, 0, groups.length - 1, 0);
  return out;
}

function clampInt(v, min, max, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function clampNum4(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n * 10000) / 10000));
}

/** 以股票代码为键的对象：去掉非法代码和清洗后为 null 的值，最多 200 个 */
function cleanMap(obj, fn) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  let n = 0;
  for (const [code, v] of Object.entries(obj)) {
    if (n >= 200) break;
    if (!/^(sh|sz|bj|hk|us)[A-Za-z0-9.]+$/.test(code) || !v || typeof v !== 'object') continue;
    const c = fn(v);
    if (c) { out[code] = c; n++; }
  }
  return out;
}

/** 当前时间是否在低调模式的时间表里（支持跨午夜，例如 22:00 ~ 06:00） */
function inStealthSchedule(cfg, now = new Date()) {
  if (!cfg.stealthSchedule) return false;
  const wd = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const a = toMin(cfg.stealthStart), b = toMin(cfg.stealthEnd);
  if (a === b) return cfg.stealthDays.includes(wd);
  if (a < b) return cfg.stealthDays.includes(wd) && mins >= a && mins < b;
  // 跨午夜：前半段算当天，后半段算前一天
  if (mins >= a) return cfg.stealthDays.includes(wd);
  if (mins < b) return cfg.stealthDays.includes((wd + 6) % 7);
  return false;
}

/** 分组导出 / 导入用的 JSON；导入时宽松接受 { groups: [...] } 或直接一个数组 */
function exportGroups(cfg) {
  return JSON.stringify({ app: 'peek-island', version: 1, groups: cfg.groups, holdings: cfg.holdings, alerts: cfg.alerts }, null, 2);
}
function parseImport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('不是有效的 JSON 文件'); }
  const groups = Array.isArray(obj) ? obj : obj && obj.groups;
  if (!Array.isArray(groups) || !groups.length) throw new Error('文件里没有分组');
  const patch = { groups };
  if (obj.holdings && typeof obj.holdings === 'object') patch.holdings = obj.holdings;
  if (obj.alerts && typeof obj.alerts === 'object') patch.alerts = obj.alerts;
  const clean = sanitize(patch);
  return { groups: clean.groups, holdings: patch.holdings ? clean.holdings : undefined, alerts: patch.alerts ? clean.alerts : undefined };
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

class ConfigStore {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = sanitize(this.read());
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { return null; }
  }
  get() { return this.data; }
  set(patch) {
    this.data = sanitize(Object.assign({}, this.data, patch));
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[config] 保存失败', e);
    }
    return this.data;
  }
}

module.exports = { ConfigStore, DEFAULTS, sanitize, MAX_PER_GROUP, inStealthSchedule, exportGroups, parseImport };
