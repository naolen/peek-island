// 仅用于本地截图自测：用假数据代替主进程
const { contextBridge } = require('electron');
const cfg = {
  mode: 'auto', redUp: true, refreshMs: 3000, rotateMs: 3000, collapseDelayMs: 1200, breatheAbove: 3, bossKey: 'Control+Alt+S', activeGroup: 0,
  groups: [
    { name: '自选', codes: ['sh600519', 'sz300750', 'sz002594', 'sh688981', 'sh600036'] },
    { name: '持仓', codes: ['hk00700', 'hk03690', 'sh601318'] },
    { name: '美股', codes: ['usNVDA', 'usAAPL'] }
  ]
};
const base = { sh600519: ['贵州茅台', 1682.5, 0.84], sz300750: ['宁德时代', 251.36, 2.15], sz002594: ['比亚迪', 318.2, -1.02], sh688981: ['中芯国际', 96.48, 3.67], sh600036: ['招商银行', 42.15, -0.31], hk00700: ['腾讯控股', 512, 1.24], hk03690: ['美团-W', 148.3, -2.4], sh601318: ['中国平安', 56.72, 0.53], usNVDA: ['英伟达', 186.42, 1.88], usAAPL: ['苹果', 241.1, -0.46] };
const quotes = {};
for (const [c, [name, price, pct]] of Object.entries(base)) quotes[c] = { code: c, name, symbol: c.slice(2), price, prevClose: price / (1 + pct / 100), pct, change: 0 };
function minute(code) {
  const q = quotes[code]; let x = code.length * 977 + code.charCodeAt(2) * 31, v = 0; const raw = [0];
  for (let i = 1; i < 180; i++) { x = (x * 9301 + 49297) % 233280; v += (x / 233280 - 0.5) * 0.24; raw.push(v); }
  const d = q.pct - raw[raw.length - 1];
  let pv = 0, vs = 0;
  const points = raw.map((r, i) => { const p = q.prevClose * (1 + (r + d * i / (raw.length - 1)) / 100); const vol = 50 + ((i * 37) % 90) + (i < 20 ? 200 : 0); pv += p * vol; vs += vol; const m = 570 + i; return { t: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'), price: p, vol, avg: pv / vs }; });
  return { prevClose: q.prevClose, points };
}
contextBridge.exposeInMainWorld('peek', {
  getConfig: async () => cfg, setConfig: async (p) => Object.assign(cfg, p), getQuotes: async () => quotes,
  getMinute: async (c) => minute(c), search: async () => [], setIgnoreMouse: () => {}, openSettings: () => {},
  onQuotes: () => {}, onConfig: () => {}, onStatus: () => {},
  getMedia: async () => ({ active: true, available: true, app: 'QQMusic.exe', title: '夜航（示例）', artist: '示例歌手', album: '示例专辑', status: 'playing', position: 52, duration: 214, updatedAt: Date.now(), receivedAt: Date.now(), canPrev: true, canNext: true, thumb: '' }),
  mediaCmd: () => {},
  onMedia: () => {},
  onLevel: (cb) => { let t = 0; setInterval(() => { t += 1; cb(0.35 + 0.3 * Math.abs(Math.sin(t / 3)) + 0.2 * Math.abs(Math.sin(t * 1.7))); }, 60); }
});
