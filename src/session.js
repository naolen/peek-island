// 交易时段：按各市场自己的时区判断现在是竞价、交易中、午休、收盘、休市，还是美股盘前 / 盘后。
// 纯函数，便于测试。节假日没有内置日历：交易时间内如果行情的更新日期不是今天，就认为今天休市。
const { marketOf } = require('./quotes');

const TZ = { a: 'Asia/Shanghai', hk: 'Asia/Hong_Kong', us: 'America/New_York' };
const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmtCache = {};
function partsIn(tz, date) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }));
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const h = Number(p.hour) % 24;
  return { wd: WEEK[p.weekday], mins: h * 60 + Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}`, md: `${p.month}/${p.day}` };
}

// 每个市场的时间表：[开始分钟, 结束分钟, 状态]（左闭右开）
const SCHEDULE = {
  a: [[555, 565, 'auction'], [565, 570, 'preopen'], [570, 690, 'trading'], [690, 780, 'lunch'], [780, 900, 'trading']],
  hk: [[540, 570, 'auction'], [570, 720, 'trading'], [720, 780, 'lunch'], [780, 960, 'trading'], [960, 970, 'auction']],
  us: [[240, 570, 'pre'], [570, 960, 'trading'], [960, 1200, 'post']]
};
const OPEN_MIN = { a: 555, hk: 540, us: 240 };

const LABEL = { auction: '竞价', preopen: '待开盘', trading: '', lunch: '午休', closed: '收盘', notyet: '未开盘', pre: '盘前', post: '盘后' };
// 这些状态下价格会变，需要按设定的间隔刷新
const ACTIVE = new Set(['auction', 'preopen', 'trading', 'pre', 'post']);

/**
 * @param {string} market a / hk / us
 * @param {Date} now
 * @param {number} quoteTime 行情的更新时间（毫秒），用来识别节假日；没有就传 0
 * @returns {{ state, label, active }}
 *   state: auction / preopen / trading / lunch / closed / notyet / pre / post / holiday
 */
function sessionOf(market, now = new Date(), quoteTime = 0) {
  const tz = TZ[market] || TZ.a;
  const n = partsIn(tz, now);
  const q = quoteTime ? partsIn(tz, new Date(quoteTime)) : null;
  const holidayLabel = q ? q.md : '休市';

  if (n.wd === 0 || n.wd === 6) return { state: 'holiday', label: holidayLabel, active: false };

  let state = null;
  for (const [s, e, st] of SCHEDULE[market] || SCHEDULE.a) {
    if (n.mins >= s && n.mins < e) { state = st; break; }
  }
  if (!state) state = n.mins < OPEN_MIN[market] ? 'notyet' : 'closed';

  // 工作日但今天没有行情：节假日。开盘 30 分钟后还没有今天的数据才这么判断，避免刚开盘时误判
  const sinceOpen = n.mins - (market === 'us' ? 570 : OPEN_MIN[market]);
  if (q && q.ymd !== n.ymd && (state === 'closed' || (ACTIVE.has(state) && sinceOpen > 30) || state === 'lunch')) {
    return { state: 'holiday', label: holidayLabel, active: false };
  }
  return { state, label: LABEL[state], active: ACTIVE.has(state) };
}

/** 按代码判断 */
function sessionOfCode(code, now, quoteTime) {
  return sessionOf(marketOf(code), now, quoteTime);
}

module.exports = { sessionOf, sessionOfCode, partsIn };
