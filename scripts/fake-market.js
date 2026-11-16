// 假的行情服务器：按东方财富 / 腾讯接口的真实返回格式应答，给端到端测试用（scripts/e2e.js）。
// 用法：global.fetch = require('./fake-market').makeFetch(state)
//   state.mode 可以随时改：
//     normal     交易中，数据齐全
//     preopen    还没开盘：现价是 "-"，分时为空
//     sparse     数据残缺：很多字段是 "-"，分时只有 1 个点，K 线只有 2 根，五档全空
//     garbage    返回的不是 JSON
//     down       东方财富全部 500（应该自动切到腾讯）
//     offline    全部连不上

const STOCKS = {
  '1.600519': ['贵州茅台', 1701.2, 1668.5], '0.300750': ['宁德时代', 262.4, 258.1], '0.002594': ['比亚迪', 318.6, 322.0],
  '1.688981': ['中芯国际', 98.76, 95.2], '1.600036': ['招商银行', 41.85, 41.6], '1.601318': ['中国平安', 56.72, 56.42],
  '116.00700': ['腾讯控股', 512.0, 505.0], '116.03690': ['美团-W', 152.3, 155.0], '116.09988': ['阿里巴巴-W', 118.4, 117.0],
  '105.NVDA': ['英伟达', 186.42, 182.98], '105.AAPL': ['苹果', 232.1, 231.5], '105.TSLA': ['特斯拉', 348.2, 355.0], '105.MSFT': ['微软', 441.0, 438.2],
  '106.BABA': ['阿里巴巴', 118.3, 116.9], '105.PDD': ['拼多多', 122.5, 124.0],
  '1.000001': ['上证指数', 3412.56, 3397.2], '0.399001': ['深证成指', 10988.2, 10899.0], '0.399006': ['创业板指', 2286.4, 2255.7],
  '100.HSI': ['恒生指数', 26120.3, 26220.0], '100.NDX': ['纳斯达克100', 21530.8, 21336.0],
  '133.USDCNH': ['美元兑离岸人民币', 7.1834, 7.18], '133.HKDCNH': ['港元兑离岸人民币', 0.9213, 0.921]
};

function rng(seed) { let x = seed; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; }
const seedOf = (s) => Array.from(s).reduce((t, c) => t * 31 + c.charCodeAt(0) & 0xffff, 7);

function quoteRow(secid, mode, state) {
  const s = STOCKS[secid];
  if (!s) return null;
  const [market, code] = secid.split('.');
  const [name, , prev] = s;
  const price = state.prices && state.prices[secid] || s[1];
  const isIndex = market === '100' || /^(000|399)/.test(code) && (secid === '1.000001' || market === '0' && /^399/.test(code));
  const row = {
    f2: price, f3: +((price - prev) / prev * 100).toFixed(2), f4: +(price - prev).toFixed(2), f5: 256000, f6: 4410000000.0,
    f8: isIndex ? '-' : 0.21, f10: isIndex ? '-' : 1.12, f12: code, f13: Number(market), f14: name,
    f15: +(Math.max(price, prev) * 1.006).toFixed(2), f16: +(Math.min(price, prev) * 0.994).toFixed(2), f17: +(prev * 1.002).toFixed(2), f18: prev,
    f20: isIndex ? '-' : 2137000000000, f124: Math.floor(Date.now() / 1000)
  };
  if (mode === 'preopen') Object.assign(row, { f2: '-', f3: '-', f4: '-', f5: '-', f6: '-', f8: '-', f10: '-', f15: '-', f16: '-', f17: '-', f124: Math.floor(Date.now() / 1000) - 16 * 3600 });
  if (mode === 'sparse') Object.assign(row, { f5: '-', f6: '-', f8: '-', f10: '-', f15: '-', f16: '-', f17: '-', f20: '-', f124: 0 });
  return row;
}

function trends(secid, ndays, mode) {
  const s = STOCKS[secid];
  if (!s || mode === 'preopen') return null;
  const [, price, prev] = s;
  const r = rng(seedOf(secid));
  const market = secid.split('.')[0];
  // 每个交易日的分钟（A 股 9:30-11:30、13:00-15:00）
  const mins = [];
  if (market === '116') { for (let m = 570; m <= 720; m++) mins.push(m); for (let m = 780; m <= 960; m++) mins.push(m); }
  else if (market === '105' || market === '106' || market === '100' && secid !== '100.HSI') { for (let m = 570; m <= 960; m++) mins.push(m); }
  else { for (let m = 570; m <= 690; m++) mins.push(m); for (let m = 780; m <= 900; m++) mins.push(m); }
  const days = [];
  const base = new Date('2026-11-09T00:00:00Z');
  for (let i = 5 - ndays; i < 5; i++) days.push(new Date(base.getTime() + i * 86400e3).toISOString().slice(0, 10));
  const out = [];
  let p = prev;
  days.forEach((day, di) => {
    const last = di === days.length - 1;
    const n = last ? Math.floor(mins.length * 0.7) : mins.length;
    for (let i = 0; i < n; i++) {
      const target = last ? prev + (price - prev) * (i / (n - 1 || 1)) : p;
      p = target + (r() - 0.5) * prev * 0.003;
      if (last && i === n - 1) p = price;
      const m = mins[i];
      const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const vol = Math.round(200 + r() * 900 + (i < 15 ? 3000 : 0));
      out.push(`${day} ${t},${p.toFixed(2)},${p.toFixed(2)},${(p * 1.0005).toFixed(2)},${(p * 0.9995).toFixed(2)},${vol},${(vol * p * 100).toFixed(2)},${(prev + (p - prev) * 0.6).toFixed(3)}`);
    }
  });
  if (mode === 'sparse') return { preClose: prev, trends: out.slice(0, 1) };
  return { code: secid.split('.')[1], market: Number(market), name: s[0], decimal: 2, preClose: prev, prePrice: prev, trendsTotal: out.length, trends: out };
}

function klines(secid, klt, lmt, mode) {
  const s = STOCKS[secid];
  if (!s) return null;
  const r = rng(seedOf(secid) + klt);
  const n = mode === 'sparse' ? 2 : lmt;
  let p = s[1] * 0.85;
  const out = [];
  for (let i = 0; i < n; i++) {
    const open = p, close = i === n - 1 ? s[1] : p * (1 + (r() - 0.47) * 0.04);
    const high = Math.max(open, close) * (1 + r() * 0.01), low = Math.min(open, close) * (1 - r() * 0.01);
    const d = new Date(Date.UTC(2026, 10, 13) - (n - 1 - i) * 86400e3 * (klt === 102 ? 7 : 1.45)).toISOString().slice(0, 10);
    out.push(`${d},${open.toFixed(2)},${close.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${Math.round(1e5 + r() * 3e5)},${(4e9 * r()).toFixed(2)}`);
    p = close;
  }
  return { code: secid.split('.')[1], klines: out };
}

function book(secid, mode) {
  const s = STOCKS[secid];
  if (!s) return null;
  const d = {};
  const step = s[1] > 500 ? 0.1 : 0.01;
  // f31~f40 卖五~卖一（价、量），f19/f20 买一 … f11/f12 买五
  for (let lv = 1; lv <= 5; lv++) {
    d['f' + (39 - (lv - 1) * 2)] = mode === 'sparse' ? '-' : +(s[1] + lv * step).toFixed(2);
    d['f' + (40 - (lv - 1) * 2)] = mode === 'sparse' ? '-' : 20 + lv * 13;
    d['f' + (19 - (lv - 1) * 2)] = mode === 'sparse' ? '-' : +(s[1] - (lv - 1) * step).toFixed(2);
    d['f' + (20 - (lv - 1) * 2)] = mode === 'sparse' ? '-' : 31 + lv * 9;
  }
  return d;
}

function tencent(codes) {
  // v_sh600519="1~贵州茅台~600519~现价~昨收~今开~成交量~...";
  return codes.map((c) => {
    const m = /^(sh|sz|bj|hk|us)(.+)$/.exec(c);
    if (!m) return '';
    const secid = Object.keys(STOCKS).find((k) => k.split('.')[1].toUpperCase() === m[2].toUpperCase().replace(/\..*$/, '') && !/^(100|133)\./.test(k));
    if (!secid) return `v_pv_none_match="1";`;
    const [name, price, prev] = STOCKS[secid];
    const f = new Array(60).fill('');
    void name; // 名称用 ASCII：真实接口是 GBK，这里不模拟编码
    f[0] = '1'; f[1] = 'N' + m[2]; f[2] = m[2]; f[3] = price.toFixed(2); f[4] = prev.toFixed(2); f[5] = (prev * 1.002).toFixed(2); f[6] = '25600';
    const d = new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    f[30] = d; f[31] = (price - prev).toFixed(2); f[32] = ((price - prev) / prev * 100).toFixed(2);
    f[33] = (Math.max(price, prev) * 1.006).toFixed(2); f[34] = (Math.min(price, prev) * 0.994).toFixed(2); f[37] = '441000'; f[38] = '0.21';
    return `v_${c}="${f.join('~')}";`;
  }).join('\n');
}

function makeFetch(state) {
  const respond = (body, status = 200, binary) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => { const b = Buffer.from(binary || body, 'utf8'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  });
  const fakeFetch = async function (url) {
    const u = new URL(String(url));
    state.hits = (state.hits || 0) + 1;
    state.log = state.log || [];
    state.log.push(u.hostname + u.pathname);
    const mode = state.mode || 'normal';
    if (mode === 'offline') throw new TypeError('fetch failed');
    const em = /eastmoney\.com$/.test(u.hostname);
    if (em && mode === 'down') return respond('Internal Server Error', 500);
    if (em && mode === 'garbage') return respond('<html><body>403 Forbidden</body></html>');
    const wrap = (data) => respond(JSON.stringify({ rc: 0, rt: 4, svr: 181669437, lt: 1, full: 1, dlmkts: '', data }));
    if (u.pathname.endsWith('/ulist.np/get')) {
      const rows = u.searchParams.get('secids').split(',').map((s) => quoteRow(s, mode, state)).filter(Boolean);
      // 真实接口有时返回数组，有时返回 {"0":{},"1":{}}
      const diff = state.diffAsObject ? Object.fromEntries(rows.map((r, i) => [i, r])) : rows;
      return wrap(rows.length ? { total: rows.length, diff } : null);
    }
    if (u.pathname.endsWith('/trends2/get')) return wrap(trends(u.searchParams.get('secid'), Number(u.searchParams.get('ndays')) || 1, mode));
    if (u.pathname.endsWith('/kline/get')) return wrap(klines(u.searchParams.get('secid'), Number(u.searchParams.get('klt')), Number(u.searchParams.get('lmt')) || 60, mode));
    if (u.pathname.endsWith('/stock/get')) return wrap(book(u.searchParams.get('secid'), mode));
    if (u.hostname === 'searchapi.eastmoney.com') {
      return respond(JSON.stringify({ QuotationCodeTable: { Data: [
        { Code: '600519', Name: '贵州茅台', PinYin: 'GZMT', MktNum: '1', QuoteID: '1.600519', SecurityTypeName: '沪A', Classify: 'AStock' },
        { Code: '00700', Name: '腾讯控股', PinYin: 'TXKG', MktNum: '116', QuoteID: '116.00700', SecurityTypeName: '港股', Classify: 'HK' },
        { Code: 'NVDA', Name: '英伟达', PinYin: 'YWD', MktNum: '105', QuoteID: '105.NVDA', SecurityTypeName: '美股', Classify: 'UsStock' }
      ], Status: 0, Message: '成功', TotalPage: 1, TotalCount: 3 } }));
    }
    // 腾讯的地址是 /q=sh600519,hk00700 这种写法，不是查询参数
    if (u.hostname === 'api.github.com') return state.latest ? respond(JSON.stringify({ tag_name: state.latest, html_url: 'https://github.com/naolen/peek-island/releases/tag/' + state.latest })) : respond('{"message":"Not Found"}', 404);
    if (u.hostname === 'qt.gtimg.cn') return respond(tencent(decodeURIComponent(u.pathname).replace(/^\/q=/, '').split(',')));
    return respond('not found', 404);
  };
  // 告诉 src/http.js：这是测试用的假服务器，不要绕过它去用 Electron 的 net.fetch
  fakeFetch.isTestDouble = true;
  return fakeFetch;
}

module.exports = { makeFetch, STOCKS };
