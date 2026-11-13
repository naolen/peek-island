// 用户配置：分组、显示模式、配色等。存成 userData 目录下的 config.json。
const fs = require('fs');
const path = require('path');

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

module.exports = { ConfigStore, DEFAULTS, sanitize, MAX_PER_GROUP };
