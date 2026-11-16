// 发网络请求用哪个 fetch：
//   在 Electron 主进程里用 net.fetch —— 走 Chromium 的网络栈，会自动使用 Windows 的系统代理 / PAC。
//   公司网络常常要走代理才能上网，Node 自带的 fetch 不认系统代理，会直接连不上。
//   其他情况（单元测试、app 还没 ready）退回 Node 自带的 fetch。
function pick() {
  // 测试里把 global.fetch 换成了假的服务器（scripts/fake-market.js），优先用它
  if (typeof global.fetch === 'function' && global.fetch.isTestDouble) return global.fetch;
  try {
    const { net, app } = require('electron');
    if (net && typeof net.fetch === 'function' && app && app.isReady()) return (url, init) => net.fetch(url, init);
  } catch (e) { /* 不在 Electron 里 */ }
  return global.fetch;
}

/**
 * GET 一个地址，返回文本。行情数据不能用缓存，也不需要带 Cookie。
 * @param {string} url
 * @param {{ timeoutMs?: number, encoding?: string, headers?: object }} [opts] encoding 例如 'gbk'
 */
async function getText(url, { timeoutMs = 6000, encoding, headers } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const request = (h) => pick()(url, {
    headers: Object.assign({ 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, h),
    signal: ctrl.signal,
    cache: 'no-store',
    credentials: 'omit'
  });
  try {
    let res;
    try {
      res = await request(headers);
    } catch (e) {
      // Chromium 会拦掉不符合来源策略的 Referer（只允许“协议 + 域名 + /”这种写法，且不能从 https 带到 http）。
      // 万一被拦，去掉 Referer 再试一次
      const hasReferer = headers && Object.keys(headers).some((k) => k.toLowerCase() === 'referer');
      if (!hasReferer || !/ERR_BLOCKED_BY_CLIENT/.test(String(e && e.message))) throw e;
      res = await request(Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'referer')));
    }
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    if (encoding) return new TextDecoder(encoding).decode(await res.arrayBuffer());
    return await res.text();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { getText };
