// 仅用于本地截图自测：用假数据代替主进程
const { contextBridge } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { ClipStore } = require('../src/clipstore');
const { TodoStore, dayKey, dayLabel } = require('../src/todostore');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peek-mock-'));
const clips = new ClipStore(path.join(tmp, 'clip'), { limit: 200 });
const now = Date.now();
clips.addText('https://github.com/naolen/peek-island', now - 3 * 3600e3);
clips.addText('下午三点的评审改到四点了，记得带上上周的数据表和竞品分析', now - 50 * 60e3);
const fav = clips.addText('收货地址：示例市示例区示例路 1 号', now - 20 * 60e3);
clips.update(fav.id, { fav: true, note: '常用地址' });
clips.addText('SELECT code, name, pct FROM quotes WHERE pct > 3 ORDER BY pct DESC;', now - 5 * 60e3);
clips.addText('600519', now - 20e3);
const todos = new TodoStore(path.join(tmp, 'todo.json'));
const yesterday = dayKey(new Date(now - 86400e3));
todos.ensureToday(yesterday);
todos.add(yesterday, '整理周报数据');
const y2 = todos.add(yesterday, '回复产品群的需求文档');
todos.toggle(yesterday, y2.id);
todos.setNote(yesterday, '昨天的笔记');
const today = todos.ensureToday(dayKey());
const t1 = todos.add(today, '下午 4 点需求评审');
todos.add(today, '把分时图的均价线再调一下');
todos.toggle(today, t1.id);
todos.setNote(today, '今天先把剪贴板和待办做完，明天接东方财富。');
const clipView = (it) => Object.assign({}, it, { thumb: '', length: (it.text || '').length });
const listeners = { clip: [], todo: [], page: [] };
const fire = (k) => listeners[k].forEach((f) => f());
const { sanitize } = require('../src/config');
const cfg = sanitize({
  mode: 'auto', redUp: true, refreshMs: 3000, rotateMs: 3000, collapseDelayMs: 1200, breatheAbove: 3, bossKey: 'Control+Alt+S', activeGroup: 0,
  groups: [
    { name: '自选', codes: ['sh600519', 'sz300750', 'sz002594', 'sh688981', 'sh600036'] },
    { name: '持仓', codes: ['hk00700', 'hk03690', 'sh601318'] },
    { name: '美股', codes: ['usNVDA', 'usAAPL'] }
  ]
});
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
  clipList: async (q) => clips.query(q || {}).map(clipView),
  clipCopy: async () => true,
  clipUpdate: async (id, p) => { const r = clips.update(id, p); fire('clip'); return r; },
  clipRemove: async (id) => { clips.remove(id); fire('clip'); return true; },
  clipClear: async () => { clips.clear(); fire('clip'); return true; },
  onClipChanged: (cb) => listeners.clip.push(cb),
  todoGet: async (key) => { const k = key || today; return { today, key: k, label: dayLabel(k), isToday: k === today, day: todos.day(k), archive: todos.archive() }; },
  todoAdd: async (t) => { todos.add(today, t); fire('todo'); },
  todoToggle: async (k, id) => { todos.toggle(k, id); fire('todo'); },
  todoEdit: async (k, id, t) => { todos.edit(k, id, t); fire('todo'); },
  todoRemove: async (k, id) => { todos.remove(k, id); fire('todo'); },
  todoMove: async (k, id, d) => { todos.move(k, id, d); fire('todo'); },
  todoNote: async (n) => todos.setNote(today, n),
  todoExport: async () => null,
  onTodoChanged: (cb) => listeners.todo.push(cb),
  setFocus: () => {},
  onPageOpen: (cb) => { window.__openPage = cb; },
  getShortcuts: async () => ({}),
  onShortcuts: () => {},
  onMedia: () => {},
  onLevel: (cb) => { let t = 0; setInterval(() => { t += 1; cb(0.35 + 0.3 * Math.abs(Math.sin(t / 3)) + 0.2 * Math.abs(Math.sin(t * 1.7))); }, 60); }
});
