// 行情数据：东方财富公开接口的地址拼接与解析（纯函数，不做网络请求，便于单元测试）。
//   实时报价  https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.600519,116.00700,105.NVDA&fields=...
//   分时      https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=1.600519&ndays=1&fields1=...&fields2=...
//   搜索      https://searchapi.eastmoney.com/api/suggest/get?input=gzmt&type=14
//
// 配置里的代码沿用 sh600519 / sz300750 / bj430047 / hk00700 / usNVDA 的写法，
// 请求时转换成东方财富的 secid：「市场编号.代码」。
//   沪市 1，深市 / 北交所 0，港股 116，美股 105（纳斯达克）/ 106（纽交所）/ 107（美国交易所）

const UT = 'fa5fd1943c7b386f172d6893dbfba10b';
const SEARCH_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const US_MARKETS = [105, 106, 107];

// 另外两种只在程序内部用的代码：
//   gi + 代码 = 海外指数（东方财富市场 100），例如 giHSI 恒生指数、giNDX 纳斯达克
//   fx + 代码 = 外汇（东方财富市场 133），例如 fxUSDCNH，用来把港股 / 美股持仓折成人民币
const HK_INDEX = /^gi(HSI|HSCEI|HSTECH|HSCCI)$/;

/** 代码所属市场：a = 沪深京，hk = 港股，us = 美股 */
function marketOf(code) {
  if (/^(sh|sz|bj)/.test(code)) return 'a';
  if (/^hk/.test(code) || HK_INDEX.test(code)) return 'hk';
  if (/^(us|gi)/.test(code)) return 'us';
  return 'a';
}

/** 一个交易日的分钟数（含首尾两个点），用于把分时图铺满横轴 */
const SESSION_POINTS = { a: 241, hk: 331, us: 391 };

function bare(code) { return code.replace(/^(sh|sz|bj|hk|us|gi|fx)/, ''); }

/**
 * 代码 → 东方财富 secid 候选列表。
 * 美股不知道在哪个交易所时，三个都给，哪个有数据用哪个；usMarket 是已知的交易所编号。
 */
function toSecids(code, usMarket) {
  const c = bare(code);
  if (/^sh/.test(code)) return ['1.' + c];
  if (/^(sz|bj)/.test(code)) return ['0.' + c];
  if (/^hk/.test(code)) return ['116.' + c];
  if (/^us/.test(code)) return usMarket ? [usMarket + '.' + c.toUpperCase()] : US_MARKETS.map((m) => m + '.' + c.toUpperCase());
  if (/^gi/.test(code)) return ['100.' + c];
  if (/^fx/.test(code)) return ['133.' + c];
  return ['1.' + c];
}

/** 东方财富返回的「市场编号 + 代码」→ 配置里的代码写法 */
function fromMarket(market, code) {
  market = Number(market);
  code = String(code);
  if (market === 1) return 'sh' + code;
  if (market === 0) return (/^(4|8|92)/.test(code) ? 'bj' : 'sz') + code;
  if (market === 116 || market === 128) return 'hk' + code;
  if (US_MARKETS.includes(market)) return 'us' + code.toUpperCase();
  if (market === 100) return 'gi' + code;
  if (market === 133) return 'fx' + code;
  return null;
}

// f5 成交量，f6 成交额，f8 换手率，f10 量比，f20 总市值
const QUOTE_FIELDS = 'f2,f3,f4,f5,f6,f8,f10,f12,f13,f14,f15,f16,f17,f18,f20,f124';

function quotesUrl(secids) {
  return 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&np=1&ut=' + UT +
    '&fields=' + QUOTE_FIELDS + '&secids=' + secids.map(encodeURIComponent).join(',');
}

function num(v) {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析 ulist.np 的返回。data.diff 可能是数组，也可能是 {"0":{...},"1":{...}}。
 * 字段：f2 现价，f3 涨跌幅%，f4 涨跌额，f5 成交量，f6 成交额，f8 换手率%，f10 量比，f12 代码，f13 市场，f14 名称，
 *       f15 最高，f16 最低，f17 今开，f18 昨收，f20 总市值，f124 更新时间（秒）
 * 返回 { [code]: { code, name, symbol, market, price, prevClose, open, high, low, change, pct, volume, amount, turnover, volRatio, mktCap, time } }
 */
function parseQuotes(json) {
  const out = {};
  let obj = json;
  if (typeof json === 'string') { try { obj = JSON.parse(json); } catch (e) { return out; } }
  const diff = obj && obj.data && obj.data.diff;
  if (!diff) return out;
  const rows = Array.isArray(diff) ? diff : Object.values(diff);
  for (const r of rows) {
    if (!r || r.f12 === undefined || r.f13 === undefined) continue;
    const code = fromMarket(r.f13, r.f12);
    if (!code) continue;
    const prevClose = num(r.f18);
    let price = num(r.f2);
    if (prevClose === null && price === null) continue;
    // 停牌或未开盘时现价是“-”，按昨收显示
    if (price === null || price === 0) price = prevClose;
    const change = num(r.f4) !== null ? num(r.f4) : price - prevClose;
    const pct = num(r.f3) !== null ? num(r.f3) : (prevClose ? (price - prevClose) / prevClose * 100 : 0);
    out[code] = {
      code,
      name: String(r.f14 || bare(code)),
      symbol: r.f13 + '.' + r.f12,
      market: Number(r.f13),
      price,
      prevClose: prevClose === null ? price : prevClose,
      open: num(r.f17),
      high: num(r.f15),
      low: num(r.f16),
      change,
      pct,
      volume: num(r.f5),
      amount: num(r.f6),
      turnover: num(r.f8),
      volRatio: num(r.f10),
      mktCap: num(r.f20),
      time: r.f124 ? Number(r.f124) * 1000 : 0
    };
  }
  return out;
}

/** 分时接口地址；secid 用报价里拿到的「市场.代码」最准 */
function secidOf(code, symbol) {
  return symbol && /^\d+\./.test(symbol) ? symbol : toSecids(code)[0];
}

/** 分时接口地址；ndays = 1 是当日分时，5 是五日分时 */
function minuteUrl(code, symbol, ndays = 1) {
  const secid = secidOf(code, symbol);
  return 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?ndays=' + ndays + '&iscr=0&iscca=0&ut=' + UT +
    '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58&secid=' + encodeURIComponent(secid);
}

/**
 * 解析 trends2：data.trends = ["2026-11-13 09:30,开,收,高,低,成交量,成交额,均价", ...]
 * 成交量是这一分钟的量（不是累计）。
 * 返回 { date, prevClose, points: [{ t:'09:30', price, vol, avg }] }，失败返回 null
 */
function parseMinute(json, prevCloseHint) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const d = obj && obj.data;
    if (!d || !Array.isArray(d.trends) || !d.trends.length) return null;
    const prevClose = num(d.preClose) || num(d.prePrice) || prevCloseHint || null;
    const points = [];
    const days = [];
    let pv = 0, vs = 0, lastDay = null;
    for (const row of d.trends) {
      const f = String(row).split(',');
      if (f.length < 3) continue;
      const price = num(f[2]);
      if (price === null) continue;
      const [day, hm] = f[0].includes(' ') ? f[0].split(' ') : ['', f[0]];
      // 五日分时：每天重新算均价
      if (day !== lastDay) { days.push(day); lastDay = day; pv = 0; vs = 0; }
      const vol = Math.max(0, num(f[5]) || 0);
      let avg = num(f[7]);
      pv += price * (vol || 1);
      vs += vol || 1;
      if (avg === null || avg <= 0) avg = pv / vs;
      points.push({ t: (hm || '').slice(0, 5), d: day, price, vol, avg });
    }
    if (!points.length) return null;
    return { date: days[days.length - 1] || '', days, prevClose: prevClose || points[0].price, points };
  } catch (e) {
    return null;
  }
}

/** K 线：klt 101 = 日K，102 = 周K；前复权；取最近 lmt 根 */
function klineUrl(code, symbol, klt = 101, lmt = 60) {
  return 'https://push2his.eastmoney.com/api/qt/stock/kline/get?fqt=1&end=20500101&ut=' + UT +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57' +
    '&klt=' + klt + '&lmt=' + lmt + '&secid=' + encodeURIComponent(secidOf(code, symbol));
}

/**
 * 解析 K 线：data.klines = ["2026-11-13,开,收,高,低,成交量,成交额", ...]
 * 返回 [{ d, open, close, high, low, vol, amount }]，失败返回 null
 */
function parseKline(json) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const rows = obj && obj.data && obj.data.klines;
    if (!Array.isArray(rows) || !rows.length) return null;
    const out = [];
    for (const row of rows) {
      const f = String(row).split(',');
      const open = num(f[1]), close = num(f[2]), high = num(f[3]), low = num(f[4]);
      if ([open, close, high, low].some((x) => x === null)) continue;
      out.push({ d: f[0], open, close, high, low, vol: num(f[5]) || 0, amount: num(f[6]) || 0 });
    }
    return out.length ? out : null;
  } catch (e) {
    return null;
  }
}

/** 五档盘口（A 股）。字段：f11~f20 买五~买一（价、量），f31~f40 卖五~卖一（价、量） */
function bookUrl(code, symbol) {
  return 'https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&ut=' + UT +
    '&fields=f11,f12,f13,f14,f15,f16,f17,f18,f19,f20,f31,f32,f33,f34,f35,f36,f37,f38,f39,f40' +
    '&secid=' + encodeURIComponent(secidOf(code, symbol));
}

/** 返回 { asks: [{ level:5..1, price, vol }], bids: [{ level:1..5, price, vol }] }，量的单位是“手” */
function parseBook(json) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const d = obj && obj.data;
    if (!d) return null;
    const asks = [5, 4, 3, 2, 1].map((lv) => ({ level: lv, price: num(d['f' + (31 + (5 - lv) * 2)]), vol: num(d['f' + (32 + (5 - lv) * 2)]) }));
    const bids = [1, 2, 3, 4, 5].map((lv) => ({ level: lv, price: num(d['f' + (19 - (lv - 1) * 2)]), vol: num(d['f' + (20 - (lv - 1) * 2)]) }));
    if ([...asks, ...bids].every((x) => x.price === null)) return null;
    return { asks, bids };
  } catch (e) {
    return null;
  }
}

function searchUrl(q) {
  return 'https://searchapi.eastmoney.com/api/suggest/get?type=14&count=12&token=' + SEARCH_TOKEN + '&input=' + encodeURIComponent(q);
}

const CLASSIFY_NAMES = { AStock: 'A股', HK: '港股', UsStock: '美股', Index: '指数', Fund: '基金', BJStock: '北交所', '23': 'A股' };

/**
 * 解析搜索结果：QuotationCodeTable.Data = [{ Code, Name, PinYin, MktNum, QuoteID, SecurityTypeName, Classify }]
 * 返回 [{ code, name, pinyin, type, market }]，只保留沪深京、港股、美股
 */
function parseSearch(json) {
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const rows = obj && obj.QuotationCodeTable && obj.QuotationCodeTable.Data;
    if (!Array.isArray(rows)) return [];
    const out = [];
    const seen = new Set();
    for (const r of rows) {
      let market = r.MktNum, codeRaw = r.Code;
      if (r.QuoteID && /^\d+\./.test(r.QuoteID)) [market, codeRaw] = r.QuoteID.split('.');
      const code = fromMarket(market, codeRaw);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({ code, name: String(r.Name || codeRaw), pinyin: r.PinYin || '', type: r.SecurityTypeName || CLASSIFY_NAMES[r.Classify] || '', market: marketOf(code) });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---------- 备用数据源：腾讯行情（东方财富连不上时用，只有报价） ----------
//   https://qt.gtimg.cn/q=sh600519,hk00700,usNVDA  返回 GBK 文本：v_sh600519="1~贵州茅台~600519~现价~昨收~今开~成交量~...";
function tencentUrl(codes) {
  const list = codes.filter((c) => /^(sh|sz|bj|hk|us)/.test(c)).map((c) => (/^us/.test(c) ? 'us' + bare(c).toUpperCase() : c));
  return list.length ? 'https://qt.gtimg.cn/q=' + list.join(',') : null;
}

function parseTencent(text) {
  const out = {};
  const re = /v_([a-z]{2}[A-Za-z0-9.]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const f = m[2].split('~');
    if (f.length < 35) continue;
    let code = m[1];
    if (/^us/.test(code)) code = 'us' + code.slice(2).replace(/\..*$/, '').toUpperCase();
    const prevClose = num(f[4]);
    let price = num(f[3]);
    if (prevClose === null && price === null) continue;
    if (!price) price = prevClose;
    const a = /^(sh|sz|bj)/.test(code);
    // 时间：A 股 20261113150003；港股 2026/11/13 16:08:13；美股 2026-11-13 16:00:01
    const ts = String(f[30] || '').replace(/[^0-9]/g, '');
    let time = 0;
    if (ts.length >= 12) {
      const iso = ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8) + 'T' + ts.slice(8, 10) + ':' + ts.slice(10, 12) + ':' + (ts.slice(12, 14) || '00');
      const off = /^us/.test(code) ? '-05:00' : '+08:00';
      time = Date.parse(iso + off) || 0;
    }
    out[code] = {
      code,
      name: f[1] || bare(code),
      symbol: null,
      market: null,
      price,
      prevClose: prevClose === null ? price : prevClose,
      open: num(f[5]),
      high: num(f[33]),
      low: num(f[34]),
      change: num(f[31]) !== null ? num(f[31]) : price - prevClose,
      pct: num(f[32]) !== null ? num(f[32]) : (prevClose ? (price - prevClose) / prevClose * 100 : 0),
      volume: num(f[6]),
      amount: a && num(f[37]) !== null ? num(f[37]) * 10000 : num(f[37]),
      turnover: num(f[38]),
      volRatio: null,
      mktCap: null,
      time,
      source: 'tencent'
    };
  }
  return out;
}

module.exports = { tencentUrl, parseTencent, secidOf, marketOf, toSecids, fromMarket, quotesUrl, parseQuotes, minuteUrl, parseMinute, klineUrl, parseKline, bookUrl, parseBook, searchUrl, parseSearch, SESSION_POINTS };
