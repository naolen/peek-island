// 网络请求：拉取实时报价、分时、搜索（东方财富公开接口）。在主进程里运行，避免渲染进程的跨域限制。
const { getText } = require('./http');
const { toSecids, quotesUrl, parseQuotes, minuteUrl, parseMinute, klineUrl, parseKline, bookUrl, parseBook, searchUrl, parseSearch, tencentUrl, parseTencent } = require('./quotes');

// Referer 只能写成“协议 + 域名 + /”，带路径会被 Chromium 的来源策略拦掉（见 http.js）
const HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
};

// 美股代码实际在哪个交易所（105 / 106 / 107），第一次查到后记住，之后只请求一个
const usMarket = {};

/** 请求一个行情接口。走系统代理、不用缓存（见 http.js） */
function get(url, opts) {
  return getText(url, Object.assign({ headers: HEADERS }, opts));
}

// 当前用的数据源：eastmoney / tencent。东方财富连续失败时切到腾讯，之后每 5 分钟试一次切回来
let source = 'eastmoney';
let fallbackAt = 0;

/** 批量拉报价，东方财富失败时自动用腾讯；两边都拿不到数据时抛错（上层显示“连接中断”） */
async function fetchQuotes(codes) {
  if (!codes.length) return {};
  const needsStock = codes.some((c) => !/^(gi|fx)/.test(c));
  if (source === 'tencent' && Date.now() - fallbackAt < 5 * 60 * 1000) {
    try {
      const out = await fetchTencent(codes);
      if (Object.keys(out).length || !needsStock) return Object.assign(out, await fetchEastmoneyOnly(codes.filter((c) => /^gi/.test(c)), true));
    } catch (e) { /* 腾讯也不行了，回头再试东方财富 */ }
    source = 'eastmoney';
  }
  let firstError = null;
  try {
    const out = await fetchEastmoney(codes);
    if (Object.keys(out).length || !needsStock) { source = 'eastmoney'; return out; }
    firstError = new Error('东方财富没有返回数据');
  } catch (e) { firstError = e; }
  const out = await fetchTencent(codes); // 也失败就把错误抛给上层
  if (!Object.keys(out).length && needsStock) throw firstError;
  source = 'tencent';
  fallbackAt = Date.now();
  return out;
}

async function fetchTencent(codes) {
  const url = tencentUrl(codes);
  if (!url) return {};
  return parseTencent(await get(url, { encoding: 'gbk', headers: Object.assign({}, HEADERS, { Referer: 'https://gu.qq.com/' }) }));
}

async function fetchEastmoneyOnly(codes, quiet) {
  if (!codes.length) return {};
  try { return await fetchEastmoney(codes); } catch (e) { if (quiet) return {}; throw e; }
}

function currentSource() { return source; }

/** 东方财富批量报价，codes 例如 ['sh600519','hk00700','usNVDA'] */
async function fetchEastmoney(codes) {
  if (!codes.length) return {};
  const secids = [];
  for (const c of codes) secids.push(...toSecids(c, usMarket[c]));
  const out = {};
  // 一次最多 80 个 secid，避免 URL 过长
  for (let i = 0; i < secids.length; i += 80) {
    const text = await get(quotesUrl(secids.slice(i, i + 80)));
    Object.assign(out, parseQuotes(text));
  }
  for (const [code, q] of Object.entries(out)) {
    if (/^us/.test(code) && q.market) usMarket[code] = q.market;
  }
  return out;
}

async function fetchMinute(code, symbol, prevClose, ndays = 1) {
  const text = await get(minuteUrl(code, symbol, ndays));
  return parseMinute(text, prevClose);
}

// K 线一天只变一次（盘中只有最后一根在变），缓存 60 秒
const klineCache = new Map();
async function fetchKline(code, symbol, klt = 101) {
  const key = code + ':' + klt;
  const hit = klineCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const data = parseKline(await get(klineUrl(code, symbol, klt, 80)));
  if (data) klineCache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchBook(code, symbol) {
  return parseBook(await get(bookUrl(code, symbol)));
}

/** 汇率：港币、美元兑人民币（离岸）。拿不到返回 null，用配置里的手动汇率 */
async function fetchFx() {
  try {
    const q = parseQuotes(await get(quotesUrl(['133.USDCNH', '133.HKDCNH'])));
    const usd = q.fxUSDCNH && q.fxUSDCNH.price;
    const hkd = q.fxHKDCNH && q.fxHKDCNH.price;
    if (usd > 1 && usd < 20 && hkd > 0.1 && hkd < 3) return { USD: usd, HKD: hkd, at: Date.now() };
  } catch (e) { /* 用手动汇率 */ }
  return null;
}

async function search(q) {
  q = String(q || '').trim();
  if (!q) return [];
  const text = await get(searchUrl(q));
  return parseSearch(text).slice(0, 12);
}

module.exports = { currentSource, fetchQuotes, fetchMinute, fetchKline, fetchBook, fetchFx, search };
