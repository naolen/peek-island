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

/** 代码所属市场：a = 沪深京，hk = 港股，us = 美股 */
function marketOf(code) {
  if (/^(sh|sz|bj)/.test(code)) return 'a';
  if (/^hk/.test(code)) return 'hk';
  if (/^us/.test(code)) return 'us';
  return 'a';
}

/** 一个交易日的分钟数（含首尾两个点），用于把分时图铺满横轴 */
const SESSION_POINTS = { a: 241, hk: 331, us: 391 };

function bare(code) { return code.replace(/^(sh|sz|bj|hk|us)/, ''); }

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
  return null;
}

const QUOTE_FIELDS = 'f2,f3,f4,f12,f13,f14,f15,f16,f17,f18,f124';

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
 * 字段：f2 现价，f3 涨跌幅%，f4 涨跌额，f12 代码，f13 市场，f14 名称，f15 最高，f16 最低，f17 今开，f18 昨收，f124 更新时间（秒）
 * 返回 { [code]: { code, name, symbol, market, price, prevClose, open, high, low, change, pct, time } }
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
      time: r.f124 ? Number(r.f124) * 1000 : 0
    };
  }
  return out;
}

/** 分时接口地址；secid 用报价里拿到的「市场.代码」最准 */
function minuteUrl(code, symbol) {
  const secid = symbol && /^\d+\./.test(symbol) ? symbol : toSecids(code)[0];
  return 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?ndays=1&iscr=0&iscca=0&ut=' + UT +
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
    let pv = 0, vs = 0;
    for (const row of d.trends) {
      const f = String(row).split(',');
      if (f.length < 3) continue;
      const price = num(f[2]);
      if (price === null) continue;
      const vol = Math.max(0, num(f[5]) || 0);
      let avg = num(f[7]);
      pv += price * (vol || 1);
      vs += vol || 1;
      if (avg === null || avg <= 0) avg = pv / vs;
      const time = (f[0].split(' ')[1] || f[0]).slice(0, 5);
      points.push({ t: time, price, vol, avg });
    }
    if (!points.length) return null;
    const date = String(d.trends[0]).split(' ')[0] || '';
    return { date, prevClose: prevClose || points[0].price, points };
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

module.exports = { marketOf, toSecids, fromMarket, quotesUrl, parseQuotes, minuteUrl, parseMinute, searchUrl, parseSearch, SESSION_POINTS };
