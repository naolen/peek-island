const test = require('node:test');
const assert = require('node:assert');
const { cleanRule, evaluate, describe, limitPctOf, anyOn } = require('../src/alerts');
const pnl = require('../src/pnl');

const q = (price, extra) => Object.assign({ code: 'sh600519', name: '贵州茅台', price, prevClose: 1668.5, pct: (price - 1668.5) / 1668.5 * 100 }, extra);
const T0 = Date.parse('2026-11-13T02:00:00Z');

test('价格上破：提醒一次就关', () => {
  const rule = cleanRule({ upOn: true, up: 1700, repeat: 'once' });
  const st = {};
  assert.strictEqual(evaluate(rule, st, q(1690), T0, 'd1').events.length, 0);
  const r = evaluate(rule, st, q(1701.2), T0 + 3000, 'd1');
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].kind, 'price-up');
  assert.strictEqual(r.events[0].title, '贵州茅台 涨到 1,700.00');
  assert.deepStrictEqual(r.disable, ['up']);
  // 还在上方：不重复提醒
  assert.strictEqual(evaluate(rule, st, q(1705), T0 + 6000, 'd1').events.length, 0);
});

test('每次都提醒：离开条件后再满足才算新的一次（带一点缓冲）', () => {
  const rule = cleanRule({ downOn: true, down: 1650, repeat: 'every' });
  const st = {};
  assert.strictEqual(evaluate(rule, st, q(1649), T0, 'd1').events.length, 1);
  assert.strictEqual(evaluate(rule, st, q(1650.5), T0 + 1, 'd1').events.length, 0); // 还在缓冲区里
  assert.strictEqual(evaluate(rule, st, q(1648), T0 + 2, 'd1').events.length, 0);   // 没离开过，不算
  evaluate(rule, st, q(1660), T0 + 3, 'd1');                                         // 明显回到上方，重新上膛
  assert.strictEqual(evaluate(rule, st, q(1649.5), T0 + 4, 'd1').events.length, 1);
});

test('每天最多一次', () => {
  const rule = cleanRule({ pctOn: true, pct: 1, repeat: 'daily' });
  const st = {};
  assert.strictEqual(evaluate(rule, st, q(1690), T0, 'd1').events[0].kind, 'pct-up');
  evaluate(rule, st, q(1670), T0 + 1, 'd1');
  assert.strictEqual(evaluate(rule, st, q(1690), T0 + 2, 'd1').events.length, 0);
  evaluate(rule, st, q(1670), T0 + 3, 'd2');
  assert.strictEqual(evaluate(rule, st, q(1690), T0 + 4, 'd2').events.length, 1);
});

test('5 分钟急拉：数据不足 4 分钟不判断', () => {
  const rule = cleanRule({ fastOn: true, fast: 2, repeat: 'every' });
  const st = {};
  evaluate(rule, st, q(1660), T0, 'd1');
  assert.strictEqual(evaluate(rule, st, q(1700), T0 + 60000, 'd1').events.length, 0); // 才 1 分钟
  const r = evaluate(rule, st, q(1700), T0 + 270000, 'd1'); // 4.5 分钟，涨 2.4%
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].kind, 'fast-up');
  assert.match(r.events[0].title, /5 分钟拉升 2\.4%/);
});

test('涨跌停：封板、开板各提醒一次', () => {
  assert.strictEqual(limitPctOf('sh600519', '贵州茅台'), 10);
  assert.strictEqual(limitPctOf('sz300750', '宁德时代'), 20);
  assert.strictEqual(limitPctOf('sh688981', '中芯国际'), 20);
  assert.strictEqual(limitPctOf('bj430047', 'x'), 30);
  assert.strictEqual(limitPctOf('sz000001', '*ST 某某'), 5);
  assert.strictEqual(limitPctOf('hk00700', '腾讯'), null);
  const rule = cleanRule({ limitOn: true });
  const st = {};
  const qq = (p) => ({ code: 'sz300750', name: '宁德时代', price: p, prevClose: 200, pct: (p - 200) / 2 });
  assert.strictEqual(evaluate(rule, st, qq(230), T0, 'd1').events.length, 0);
  assert.strictEqual(evaluate(rule, st, qq(240), T0 + 1, 'd1').events[0].kind, 'limit-up');
  assert.strictEqual(evaluate(rule, st, qq(240), T0 + 2, 'd1').events.length, 0);
  assert.strictEqual(evaluate(rule, st, qq(238), T0 + 3, 'd1').events[0].title, '宁德时代 涨停打开');
});

test('规则清洗与摘要', () => {
  const r = cleanRule({ upOn: true, up: 'abc', pctOn: true, notify: 'x', repeat: 'y' });
  assert.strictEqual(r.upOn, false);
  assert.strictEqual(r.pctOn, true);
  assert.strictEqual(r.notify, 'card');
  assert.strictEqual(r.repeat, 'once');
  assert.strictEqual(anyOn(r), true);
  assert.strictEqual(describe({ upOn: true, up: 1700, fastOn: true, fast: 2 }), '涨到 1,700.00 · 5 分钟急拉跳水 2%');
});

test('持仓盈亏：港股折人民币，汇总', () => {
  const quotes = {
    hk00700: { price: 512, prevClose: 505, pct: 1.39 },
    sh601318: { price: 56.72, prevClose: 56.42, pct: 0.53 },
    usNVDA: { price: 186.42, prevClose: 182.98, pct: 1.88 }
  };
  const holdings = { hk00700: { qty: 200, cost: 452 }, sh601318: { qty: 1000, cost: 48.2 }, usNVDA: { qty: 10, cost: 0 } };
  const g = pnl.group(['hk00700', 'sh601318', 'usNVDA', 'sz000001'], quotes, holdings, { HKD: 0.9, USD: 7 });
  assert.strictEqual(g.items.length, 3);
  const tx = g.items[0];
  assert.strictEqual(tx.today, 1400);           // (512-505)*200 港币
  assert.strictEqual(tx.total, 12000);          // (512-452)*200 港币
  assert.strictEqual(tx.todayCny, 1260);        // × 0.9
  assert.strictEqual(g.items[2].total, null);   // 没填成本
  assert.ok(Math.abs(g.today - (1260 + 300 + 3.44 * 10 * 7)) < 1e-6);
  assert.ok(Math.abs(g.total - (10800 + 8520)) < 1e-6);
  assert.ok(Math.abs(g.items.reduce((t, x) => t + x.weight, 0) - 100) < 1e-9);
  assert.strictEqual(pnl.group(['sz000001'], quotes, holdings, {}), null);
});
