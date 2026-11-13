// 网络请求：拉取实时报价、分时、搜索。在主进程里运行，避免渲染进程的跨域限制。
const iconv = require('iconv-lite');
const { parseQuotes, parseMinute, parseHint, minuteUrl } = require('./quotes');

const HEADERS = {
  Referer: 'https://gu.qq.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
};

async function get(url, { gbk = false, timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return gbk ? iconv.decode(buf, 'gbk') : buf.toString('utf8');
  } finally {
    clearTimeout(t);
  }
}

/** 批量拉报价，codes 例如 ['sh600519','hk00700','usNVDA'] */
async function fetchQuotes(codes) {
  if (!codes.length) return {};
  const out = {};
  // 一次最多 60 个，避免 URL 过长
  for (let i = 0; i < codes.length; i += 60) {
    const part = codes.slice(i, i + 60);
    const text = await get('https://qt.gtimg.cn/q=' + part.join(','), { gbk: true });
    Object.assign(out, parseQuotes(text));
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
  const text = await get('https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=' + encodeURIComponent(q), { gbk: true });
  return parseHint(text).slice(0, 12);
}

module.exports = { fetchQuotes, fetchMinute, search };
