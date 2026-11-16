// 检查更新：只在用户点「检查更新」时访问 GitHub，看最新发布的版本号。
const { getText } = require('./http');
const RELEASES_API = 'https://api.github.com/repos/naolen/peek-island/releases/latest';
const RELEASES_PAGE = 'https://github.com/naolen/peek-island/releases';

/** 'v0.3.1' / '0.3.1-beta.1' → [0, 3, 1]；看不懂返回 null */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a 是否比 b 新 */
function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** 解析 GitHub 的返回，current 是当前版本 */
function parseRelease(json, current) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  const tag = obj && obj.tag_name;
  if (!parseVersion(tag)) throw new Error('没有找到发布的版本');
  const url = typeof obj.html_url === 'string' && obj.html_url.startsWith('https://github.com/') ? obj.html_url : RELEASES_PAGE;
  return { ok: true, current, latest: String(tag).replace(/^v/, ''), newer: isNewer(tag, current), url };
}

async function check(current, { timeoutMs = 8000 } = {}) {
  try {
    const text = await getText(RELEASES_API, { timeoutMs, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'peek-island' } });
    return parseRelease(text, current);
  } catch (e) {
    // 还没有发布过任何版本
    if (e && e.status === 404) return { ok: true, current, latest: current, newer: false, url: RELEASES_PAGE };
    return { ok: false, current, url: RELEASES_PAGE, error: String((e && e.message) || e) };
  }
}

module.exports = { check, isNewer, parseVersion, parseRelease, RELEASES_PAGE };
