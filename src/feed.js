// 网络请求：拉取实时报价、分时、搜索（东方财富公开接口）。在主进程里运行，避免渲染进程的跨域限制。
const { toSecids, quotesUrl, parseQuotes, minuteUrl, parseMinute, searchUrl, parseSearch } = require('./quotes');

const HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
};

// 美股代码实际在哪个交易所（105 / 106 / 107），第一次查到后记住，之后只请求一个
const usMarket = {};

async function get(url, { timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** 批量拉报价，codes 例如 ['sh600519','hk00700','usNVDA'] */
async function fetchQuotes(codes) {
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

async function fetchMinute(code, symbol, prevClose) {
  const text = await get(minuteUrl(code, symbol));
  return parseMinute(text, prevClose);
}

async function search(q) {
  q = String(q || '').trim();
  if (!q) return [];
  const text = await get(searchUrl(q));
  return parseSearch(text).slice(0, 12);
}

module.exports = { fetchQuotes, fetchMinute, search };
