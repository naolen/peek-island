// 行情数据解析（纯函数，不做网络请求，便于单元测试）。
// 数据源：腾讯行情公开接口。
//   实时报价  https://qt.gtimg.cn/q=sh600519,hk00700,usNVDA      （GBK 编码）
//   分时      https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600519
//             港股 hkMinute/query?code=hk00700，美股 UsMinute/query?code=usNVDA.OQ
//   搜索      https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=gzmt

/** 代码所属市场：a = 沪深京，hk = 港股，us = 美股 */
function marketOf(code) {
  if (/^(sh|sz|bj)/.test(code)) return 'a';
  if (/^hk/.test(code)) return 'hk';
  if (/^us/.test(code)) return 'us';
  return 'a';
}

/** 一个交易日的分钟数（含首尾两个点），用于把分时图铺满横轴 */
const SESSION_POINTS = { a: 241, hk: 331, us: 391 };

/** 横轴刻度：[位置(0..1), 文本] */
const SESSION_TICKS = {
  a: [[0, '09:30'], [0.25, '10:30'], [0.5, '11:30/13:00'], [0.75, '14:00'], [1, '15:00']],
  hk: [[0, '09:30'], [150 / 330, '12:00/13:00'], [270 / 330, '15:00'], [1, '16:00']],
  us: [[0, '09:30'], [150 / 390, '12:00'], [270 / 390, '14:00'], [1, '16:00']]
};

function num(s) {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析 qt.gtimg.cn 的返回文本（已解码成字符串）。
 * 每行形如  v_sh600519="1~贵州茅台~600519~1682.50~1668.50~1670.00~...";
 * 返回 { [code]: { code, name, symbol, price, prevClose, open, high, low, change, pct, time } }
 */
function parseQuotes(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  const re = /v_([A-Za-z0-9.]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const code = m[1];
    const f = m[2].split('~');
    if (f.length < 6 || !f[1]) continue;
    const price = num(f[3]);
    const prevClose = num(f[4]);
    if (price === null || prevClose === null) continue;
    // 停牌或未开盘时现价可能为 0，此时按昨收显示
    const shown = price > 0 ? price : prevClose;
    const change = shown - prevClose;
    const pct = prevClose ? (change / prevClose) * 100 : 0;
    out[code] = {
      code,
      name: f[1],
      symbol: f[2],
      price: shown,
      prevClose,
      open: num(f[5]),
      high: num(f[33]),
      low: num(f[34]),
      change,
      pct,
      time: f[30] || ''
    };
  }
  return out;
}

/** 分时接口的地址 */
function minuteUrl(code, symbol) {
  const mk = marketOf(code);
  if (mk === 'hk') return 'https://web.ifzq.gtimg.cn/appstock/app/hkMinute/query?code=' + encodeURIComponent(code);
  if (mk === 'us') {
    // 美股需要带交易所后缀，例如 usNVDA.OQ；后缀来自实时报价里的 symbol 字段
    const full = symbol && symbol.includes('.') ? 'us' + symbol : code;
    return 'https://web.ifzq.gtimg.cn/appstock/app/UsMinute/query?code=' + encodeURIComponent(full);
  }
  return 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + encodeURIComponent(code);
}

/**
 * 解析分时接口 JSON。
 * data.data.<code>.data.data = ["0930 1682.00 2334 334005400.00", ...]
 *   字段：时间 HHMM、价格、累计成交量、累计成交额
 * 返回 { date, prevClose, points: [{ t:'09:30', price, vol, avg }] }，失败返回 null
 */
function parseMinute(json, prevCloseHint) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const data = obj && obj.data;
    if (!data || typeof data !== 'object') return null;
    const key = Object.keys(data)[0];
    const node = data[key];
    const rows = node && node.data && node.data.data;
    if (!Array.isArray(rows) || !rows.length) return null;
    let prevClose = prevCloseHint || null;
    const qt = node.qt && node.qt[key];
    if (Array.isArray(qt) && num(qt[4])) prevClose = num(qt[4]);
    let lastVol = 0;
    const points = [];
    for (const row of rows) {
      const p = String(row).trim().split(/\s+/);
      if (p.length < 2) continue;
      const hhmm = p[0];
      const price = num(p[1]);
      if (price === null) continue;
      const cumVol = num(p[2]) || 0;
      const cumAmt = num(p[3]) || 0;
      const vol = Math.max(0, cumVol - lastVol);
      lastVol = cumVol;
      let avg = null;
      if (cumVol > 0 && cumAmt > 0) {
        avg = cumAmt / cumVol;
        // A 股成交量单位是“手”（100 股），均价要再除以 100
        if (avg / price > 20) avg = avg / 100;
      }
      points.push({ t: hhmm.slice(0, 2) + ':' + hhmm.slice(2, 4), price, vol, avg });
    }
    if (!points.length) return null;
    // 有的数据源缺累计成交额：用成交量加权的价格补一条均价线
    if (points.every(pt => pt.avg === null)) {
      let pv = 0, vs = 0;
      for (const pt of points) { const w = pt.vol || 1; pv += pt.price * w; vs += w; pt.avg = pv / vs; }
    } else {
      let last = points[0].price;
      for (const pt of points) { if (pt.avg === null) pt.avg = last; last = pt.avg; }
    }
    if (!prevClose) prevClose = points[0].price;
    return { date: node.data.date || '', prevClose, points };
  } catch (e) {
    return null;
  }
}

function decodeUnicodeEscapes(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const SEARCH_TYPES = /^(GP|ZS|ETF|LOF|KJ|QDII|JJ)/;

/**
 * 解析 smartbox 搜索结果：
 *   v_hint="sh~600519~贵州茅台~gzmt~GP-A^hk~00700~腾讯控股~txkg~GP"
 * 返回 [{ code:'sh600519', name, pinyin, type, market }]
 */
function parseHint(text) {
  if (typeof text !== 'string') return [];
  const m = text.match(/v_hint="([^"]*)"/);
  if (!m || !m[1] || m[1] === 'N') return [];
  const out = [];
  for (const item of m[1].split('^')) {
    const f = item.split('~');
    if (f.length < 5) continue;
    const mk = f[0];
    let code;
    if (['sh', 'sz', 'bj', 'hk'].includes(mk)) code = mk + f[1];
    else if (mk === 'us') code = 'us' + f[1].split('.')[0].toUpperCase();
    else continue;
    if (!SEARCH_TYPES.test(f[4])) continue;
    out.push({ code, name: decodeUnicodeEscapes(f[2]), pinyin: f[3], type: f[4], market: marketOf(code) });
  }
  return out;
}

module.exports = { marketOf, parseQuotes, parseMinute, parseHint, minuteUrl, SESSION_POINTS, SESSION_TICKS };
