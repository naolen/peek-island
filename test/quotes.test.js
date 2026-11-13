const test = require('node:test');
const assert = require('node:assert');
const { parseQuotes, parseMinute, parseHint, minuteUrl, marketOf } = require('../src/quotes');
const { sanitize } = require('../src/config');

function qtLine(code, fields) {
  const f = new Array(50).fill('');
  Object.entries(fields).forEach(([i, v]) => { f[i] = v; });
  return `v_${code}="${f.join('~')}";\n`;
}

test('parseQuotes：A 股 / 港股 / 美股', () => {
  const text =
    qtLine('sh600519', { 0: '1', 1: '贵州茅台', 2: '600519', 3: '1682.50', 4: '1668.50', 5: '1670.00', 30: '20261113150003', 33: '1690.00', 34: '1660.00' }) +
    qtLine('hk00700', { 0: '100', 1: '腾讯控股', 2: '00700', 3: '512.000', 4: '506.000', 5: '507.000' }) +
    qtLine('usNVDA', { 0: '200', 1: '英伟达', 2: 'NVDA.OQ', 3: '186.42', 4: '182.98', 5: '183.00' });
  const q = parseQuotes(text);
  assert.strictEqual(q.sh600519.name, '贵州茅台');
  assert.strictEqual(q.sh600519.price, 1682.5);
  assert.ok(Math.abs(q.sh600519.pct - 0.8391) < 0.001);
  assert.strictEqual(q.sh600519.high, 1690);
  assert.ok(Math.abs(q.hk00700.pct - 1.1858) < 0.001);
  assert.strictEqual(q.usNVDA.symbol, 'NVDA.OQ');
});

test('parseQuotes：停牌时现价为 0，按昨收显示', () => {
  const q = parseQuotes(qtLine('sz000001', { 0: '51', 1: '平安银行', 2: '000001', 3: '0.00', 4: '11.20', 5: '0.00' }));
  assert.strictEqual(q.sz000001.price, 11.2);
  assert.strictEqual(q.sz000001.pct, 0);
});

test('parseQuotes：无效输入', () => {
  assert.deepStrictEqual(parseQuotes('v_pv_none_match="1";'), {});
  assert.deepStrictEqual(parseQuotes(null), {});
});

test('parseMinute：A 股成交量单位为手，均价自动换算', () => {
  const json = {
    code: 0,
    data: {
      sh600519: {
        data: { date: '20261113', data: ['0930 1670.00 100 16700000.00', '0931 1672.00 300 50140000.00', '0932 1675.00 450 75265000.00'] },
        qt: { sh600519: ['1', '贵州茅台', '600519', '1675.00', '1668.50'] }
      }
    }
  };
  const m = parseMinute(json);
  assert.strictEqual(m.prevClose, 1668.5);
  assert.strictEqual(m.points.length, 3);
  assert.deepStrictEqual(m.points.map(p => p.t), ['09:30', '09:31', '09:32']);
  assert.deepStrictEqual(m.points.map(p => p.vol), [100, 200, 150]);
  assert.ok(Math.abs(m.points[2].avg - 1672.56) < 0.1, 'avg=' + m.points[2].avg);
});

test('parseMinute：缺成交额时用成交量加权补均价', () => {
  const m = parseMinute(JSON.stringify({ data: { usNVDA: { data: { data: ['0930 180.00 10', '0931 182.00 30'] } } } }), 179);
  assert.strictEqual(m.prevClose, 179);
  assert.ok(Math.abs(m.points[1].avg - (180 * 10 + 182 * 20) / 30) < 1e-9);
});

test('parseMinute：异常数据返回 null', () => {
  assert.strictEqual(parseMinute('not json'), null);
  assert.strictEqual(parseMinute({ data: {} }), null);
  assert.strictEqual(parseMinute({ data: { x: { data: { data: [] } } } }), null);
});

test('parseHint：搜索结果', () => {
  const text = 'v_hint="sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A^hk~00700~\\u817e\\u8baf\\u63a7\\u80a1~txkg~GP^us~nvda.oq~\\u82f1\\u4f1f\\u8fbe~yd~GP^sz~159915~xx~cyb~ETF^jj~000001~x~x~JJ"';
  const r = parseHint(text);
  assert.deepStrictEqual(r.map(x => x.code), ['sh600519', 'hk00700', 'usNVDA', 'sz159915']);
  assert.strictEqual(r[0].name, '贵州茅台');
  assert.deepStrictEqual(parseHint('v_hint="N"'), []);
});

test('minuteUrl 与 marketOf', () => {
  assert.strictEqual(marketOf('bj430047'), 'a');
  assert.ok(minuteUrl('sh600519').includes('/minute/query?code=sh600519'));
  assert.ok(minuteUrl('hk00700').includes('/hkMinute/query?code=hk00700'));
  assert.ok(minuteUrl('usNVDA', 'NVDA.OQ').includes('/UsMinute/query?code=usNVDA.OQ'));
});

test('sanitize：非法配置回退到默认值', () => {
  const c = sanitize({ mode: 'xx', refreshMs: 10, groups: [{ name: ' 测试 ', codes: ['sh600519', 'sh600519', 'bad', 'usNVDA'] }], activeGroup: 9 });
  assert.strictEqual(c.mode, 'auto');
  assert.strictEqual(c.refreshMs, 1500);
  assert.deepStrictEqual(c.groups, [{ name: '测试', codes: ['sh600519', 'usNVDA'] }]);
  assert.strictEqual(c.activeGroup, 0);
});
