const test = require('node:test');
const assert = require('node:assert');
const { sessionOf } = require('../src/session');
const { parseKline, parseBook, parseMinute, toSecids, fromMarket, marketOf } = require('../src/quotes');

// 北京时间 → Date
const bj = (s) => new Date(s + '+08:00');
const ny = (s) => new Date(s + '-05:00'); // 11 月是美东标准时间

test('A 股交易时段', () => {
  const day = '2026-11-13T'; // 周五
  const q = bj(day + '10:00:00').getTime();
  assert.strictEqual(sessionOf('a', bj(day + '09:00:00'), q).state, 'notyet');
  assert.deepStrictEqual(sessionOf('a', bj(day + '09:20:00'), q), { state: 'auction', label: '竞价', active: true });
  assert.strictEqual(sessionOf('a', bj(day + '09:27:00'), q).state, 'preopen');
  assert.deepStrictEqual(sessionOf('a', bj(day + '10:30:00'), q), { state: 'trading', label: '', active: true });
  assert.deepStrictEqual(sessionOf('a', bj(day + '12:00:00'), q), { state: 'lunch', label: '午休', active: false });
  assert.strictEqual(sessionOf('a', bj(day + '14:59:00'), q).state, 'trading');
  assert.deepStrictEqual(sessionOf('a', bj(day + '15:30:00'), q), { state: 'closed', label: '收盘', active: false });
});

test('周末与节假日：显示最后一次行情的日期', () => {
  const lastQuote = bj('2026-11-13T15:00:00').getTime();
  assert.deepStrictEqual(sessionOf('a', bj('2026-11-14T10:00:00'), lastQuote), { state: 'holiday', label: '11/13', active: false });
  // 工作日但行情还停在前一天，开盘 30 分钟后判定为休市
  const oct1 = bj('2026-10-01T10:30:00');
  assert.strictEqual(sessionOf('a', oct1, bj('2026-09-30T15:00:00').getTime()).state, 'holiday');
  // 刚开盘 5 分钟还没数据：不误判
  assert.strictEqual(sessionOf('a', bj('2026-10-02T09:35:00'), bj('2026-10-01T15:00:00').getTime()).state, 'trading');
});

test('港股、美股盘前盘后', () => {
  const q = bj('2026-11-13T10:00:00').getTime();
  assert.strictEqual(sessionOf('hk', bj('2026-11-13T09:15:00'), q).state, 'auction');
  assert.strictEqual(sessionOf('hk', bj('2026-11-13T12:30:00'), q).state, 'lunch');
  assert.strictEqual(sessionOf('hk', bj('2026-11-13T16:05:00'), q).state, 'auction');
  const nq = ny('2026-11-13T09:00:00').getTime();
  assert.deepStrictEqual(sessionOf('us', ny('2026-11-13T08:00:00'), nq), { state: 'pre', label: '盘前', active: true });
  assert.strictEqual(sessionOf('us', ny('2026-11-13T11:00:00'), nq).state, 'trading');
  assert.deepStrictEqual(sessionOf('us', ny('2026-11-13T17:00:00'), nq), { state: 'post', label: '盘后', active: true });
  assert.strictEqual(sessionOf('us', ny('2026-11-13T21:00:00'), nq).state, 'closed');
});

test('指数和外汇代码', () => {
  assert.deepStrictEqual(toSecids('giHSI'), ['100.HSI']);
  assert.deepStrictEqual(toSecids('fxUSDCNH'), ['133.USDCNH']);
  assert.strictEqual(fromMarket(100, 'NDX'), 'giNDX');
  assert.strictEqual(fromMarket(133, 'HKDCNH'), 'fxHKDCNH');
  assert.strictEqual(marketOf('giHSI'), 'hk');
  assert.strictEqual(marketOf('giNDX'), 'us');
  assert.strictEqual(marketOf('sh000001'), 'a');
});

test('parseKline / parseBook / 五日分时', () => {
  const k = parseKline({ data: { klines: ['2026-11-12,1660.00,1668.50,1675.00,1655.00,30000,5.0e9', '2026-11-13,1670.00,1682.50,1690.00,1660.00,31000,5.2e9', 'bad'] } });
  assert.strictEqual(k.length, 2);
  assert.deepStrictEqual(k[1], { d: '2026-11-13', open: 1670, close: 1682.5, high: 1690, low: 1660, vol: 31000, amount: 5.2e9 });
  assert.strictEqual(parseKline({ data: { klines: [] } }), null);

  const book = parseBook({ data: { f39: 1682.6, f40: 12, f37: 1682.7, f38: 3, f35: 1682.8, f36: 5, f33: 1682.9, f34: 8, f31: 1683, f32: 20,
    f19: 1682.5, f20: 30, f17: 1682.4, f18: 6, f15: 1682.3, f16: 9, f13: 1682.2, f14: 1, f11: 1682.1, f12: 4 } });
  assert.deepStrictEqual(book.asks.map((x) => [x.level, x.price]), [[5, 1683], [4, 1682.9], [3, 1682.8], [2, 1682.7], [1, 1682.6]]);
  assert.deepStrictEqual(book.bids.map((x) => [x.level, x.price, x.vol]), [[1, 1682.5, 30], [2, 1682.4, 6], [3, 1682.3, 9], [4, 1682.2, 1], [5, 1682.1, 4]]);
  assert.strictEqual(parseBook({ data: {} }), null);

  const m = parseMinute({ data: { preClose: 100, trends: ['2026-11-12 09:30,100,100,100,100,10,1000,100', '2026-11-12 15:00,101,101,101,101,10,1010,100.5', '2026-11-13 09:30,102,102,102,102,10,1020,'] } });
  assert.deepStrictEqual(m.days, ['2026-11-12', '2026-11-13']);
  assert.strictEqual(m.points[2].d, '2026-11-13');
  assert.strictEqual(m.points[2].avg, 102); // 新的一天重新算均价
});

const { sanitize, inStealthSchedule, exportGroups, parseImport } = require('../src/config');

test('配置：预警、持仓、低调模式清洗', () => {
  const c = sanitize({
    alerts: { sh600519: { upOn: true, up: 1700 }, sz000001: { upOn: false }, bad: { upOn: true, up: 1 } },
    holdings: { hk00700: { qty: '200', cost: '452.5' }, sh600036: { qty: 0 }, usNVDA: { qty: 10 } },
    stealthStart: '25:00', stealthDays: [1, 1, 9, 'x', 5], pnlShow: 'zz', indexes: ['sh000001', 'giHSI', 'evil()']
  });
  assert.deepStrictEqual(Object.keys(c.alerts), ['sh600519']);
  assert.deepStrictEqual(c.holdings, { hk00700: { qty: 200, cost: 452.5 }, usNVDA: { qty: 10, cost: 0 } });
  assert.strictEqual(c.stealthStart, '09:00');
  assert.deepStrictEqual(c.stealthDays, [1, 5]);
  assert.strictEqual(c.pnlShow, 'amount');
  assert.deepStrictEqual(c.indexes, ['sh000001', 'giHSI']);
});

test('低调模式时间表（含跨午夜）', () => {
  const at = (s) => new Date(s);
  const cfg = sanitize({ stealthSchedule: true, stealthStart: '09:00', stealthEnd: '18:00' });
  assert.strictEqual(inStealthSchedule(cfg, at('2026-11-13T10:00:00')), true);  // 周五
  assert.strictEqual(inStealthSchedule(cfg, at('2026-11-13T18:30:00')), false);
  assert.strictEqual(inStealthSchedule(cfg, at('2026-11-14T10:00:00')), false); // 周六
  const night = sanitize({ stealthSchedule: true, stealthStart: '22:00', stealthEnd: '06:00', stealthDays: [5] });
  assert.strictEqual(inStealthSchedule(night, at('2026-11-13T23:00:00')), true);
  assert.strictEqual(inStealthSchedule(night, at('2026-11-14T05:00:00')), true);  // 周五晚上延续到周六早上
  assert.strictEqual(inStealthSchedule(night, at('2026-11-14T23:00:00')), false);
});

test('分组导出 / 导入', () => {
  const c = sanitize({ holdings: { sh600519: { qty: 100, cost: 1500 } } });
  const back = parseImport(exportGroups(c));
  assert.deepStrictEqual(back.groups, c.groups);
  assert.deepStrictEqual(back.holdings, c.holdings);
  assert.deepStrictEqual(parseImport('[{"name":"A","codes":["sh600519"]}]').groups, [{ name: 'A', codes: ['sh600519'] }]);
  assert.throws(() => parseImport('nope'), /JSON/);
  assert.throws(() => parseImport('{"x":1}'), /分组/);
});

const { tencentUrl, parseTencent } = require('../src/quotes');
test('腾讯备用行情解析', () => {
  assert.strictEqual(tencentUrl(['sh600519', 'usnvda', 'giHSI']), 'https://qt.gtimg.cn/q=sh600519,usNVDA');
  const f = new Array(50).fill('');
  f[1] = '贵州茅台'; f[2] = '600519'; f[3] = '1701.00'; f[4] = '1668.50'; f[5] = '1670.00'; f[6] = '25000';
  f[30] = '20261113150003'; f[31] = '32.50'; f[32] = '1.95'; f[33] = '1710.00'; f[34] = '1665.00'; f[37] = '420000';
  const g = f.slice(); g[1] = '英伟达'; g[30] = '2026-11-13 16:00:01';
  const q = parseTencent(`v_sh600519="${f.join('~')}";\nv_usNVDA.OQ="${g.join('~')}";`);
  assert.strictEqual(q.sh600519.price, 1701);
  assert.strictEqual(q.sh600519.pct, 1.95);
  assert.strictEqual(q.sh600519.amount, 4.2e9);
  assert.strictEqual(q.sh600519.time, Date.parse('2026-11-13T15:00:03+08:00'));
  assert.ok(q.usNVDA);
  assert.strictEqual(q.usNVDA.time, Date.parse('2026-11-13T16:00:01-05:00'));
});
