const test = require('node:test');
const assert = require('node:assert');
const { parseQuotes, parseMinute, parseSearch, minuteUrl, quotesUrl, marketOf, toSecids, fromMarket } = require('../src/quotes');
const { sanitize } = require('../src/config');

test('toSecids / fromMarket：代码与东方财富 secid 互转', () => {
  assert.deepStrictEqual(toSecids('sh600519'), ['1.600519']);
  assert.deepStrictEqual(toSecids('sz300750'), ['0.300750']);
  assert.deepStrictEqual(toSecids('bj430047'), ['0.430047']);
  assert.deepStrictEqual(toSecids('hk00700'), ['116.00700']);
  assert.deepStrictEqual(toSecids('usNVDA'), ['105.NVDA', '106.NVDA', '107.NVDA']);
  assert.deepStrictEqual(toSecids('usBABA', 106), ['106.BABA']);
  assert.strictEqual(fromMarket(1, '600519'), 'sh600519');
  assert.strictEqual(fromMarket(0, '300750'), 'sz300750');
  assert.strictEqual(fromMarket(0, '430047'), 'bj430047');
  assert.strictEqual(fromMarket(0, '920001'), 'bj920001');
  assert.strictEqual(fromMarket(116, '00700'), 'hk00700');
  assert.strictEqual(fromMarket(105, 'nvda'), 'usNVDA');
  assert.strictEqual(fromMarket(90, 'BK0001'), null);
  assert.ok(quotesUrl(['1.600519', '116.00700']).includes('secids=1.600519,116.00700'));
});

test('parseQuotes：A 股 / 港股 / 美股，diff 为数组', () => {
  const json = {
    rc: 0,
    data: {
      total: 3,
      diff: [
        { f2: 1682.5, f3: 0.84, f4: 14.0, f12: '600519', f13: 1, f14: '贵州茅台', f15: 1690, f16: 1660, f17: 1670, f18: 1668.5, f124: 1763017203 },
        { f2: 512.0, f3: 1.19, f4: 6.0, f12: '00700', f13: 116, f14: '腾讯控股', f15: 515, f16: 505, f17: 507, f18: 506 },
        { f2: 186.42, f3: 1.88, f4: 3.44, f12: 'NVDA', f13: 105, f14: '英伟达', f15: '-', f16: '-', f17: 183, f18: 182.98 }
      ]
    }
  };
  const q = parseQuotes(json);
  assert.strictEqual(q.sh600519.name, '贵州茅台');
  assert.strictEqual(q.sh600519.price, 1682.5);
  assert.strictEqual(q.sh600519.pct, 0.84);
  assert.strictEqual(q.sh600519.symbol, '1.600519');
  assert.strictEqual(q.sh600519.time, 1763017203000);
  assert.strictEqual(q.hk00700.prevClose, 506);
  assert.strictEqual(q.usNVDA.market, 105);
  assert.strictEqual(q.usNVDA.high, null);
});

test('parseQuotes：diff 为对象；停牌时现价为“-”按昨收显示', () => {
  const text = JSON.stringify({ data: { diff: { 0: { f2: '-', f3: '-', f4: '-', f12: '000001', f13: 0, f14: '平安银行', f18: 11.2 } } } });
  const q = parseQuotes(text);
  assert.strictEqual(q.sz000001.price, 11.2);
  assert.strictEqual(q.sz000001.pct, 0);
  assert.strictEqual(q.sz000001.change, 0);
});

test('parseQuotes：无效输入', () => {
  assert.deepStrictEqual(parseQuotes('not json'), {});
  assert.deepStrictEqual(parseQuotes({ data: null }), {});
  assert.deepStrictEqual(parseQuotes(null), {});
});

test('parseMinute：trends2 分时', () => {
  const json = {
    data: {
      code: '600519', market: 1, preClose: 1668.5,
      trends: [
        '2026-11-13 09:30,1670.00,1670.00,1670.00,1670.00,100,16700000.00,1670.000',
        '2026-11-13 09:31,1670.00,1672.00,1673.00,1669.00,200,33440000.00,1671.333',
        '2026-11-13 09:32,1672.00,1675.00,1676.00,1671.00,150,25125000.00,1672.556'
      ]
    }
  };
  const m = parseMinute(json);
  assert.strictEqual(m.date, '2026-11-13');
  assert.strictEqual(m.prevClose, 1668.5);
  assert.deepStrictEqual(m.points.map((p) => p.t), ['09:30', '09:31', '09:32']);
  assert.deepStrictEqual(m.points.map((p) => p.price), [1670, 1672, 1675]);
  assert.deepStrictEqual(m.points.map((p) => p.vol), [100, 200, 150]);
  assert.strictEqual(m.points[2].avg, 1672.556);
});

test('parseMinute：缺均价时用成交量加权补上', () => {
  const m = parseMinute(JSON.stringify({ data: { trends: ['2026-11-13 09:30,180,180,180,180,10,0,', '2026-11-13 09:31,181,182,182,181,30,0,-'] } }), 179);
  assert.strictEqual(m.prevClose, 179);
  assert.ok(Math.abs(m.points[1].avg - (180 * 10 + 182 * 30) / 40) < 1e-9);
});

test('parseMinute：异常数据返回 null', () => {
  assert.strictEqual(parseMinute('not json'), null);
  assert.strictEqual(parseMinute({ data: null }), null);
  assert.strictEqual(parseMinute({ data: { trends: [] } }), null);
});

test('minuteUrl：优先使用报价里的 secid', () => {
  assert.ok(minuteUrl('sh600519').includes('secid=1.600519'));
  assert.ok(minuteUrl('hk00700').includes('secid=116.00700'));
  assert.ok(minuteUrl('usBABA', '106.BABA').includes('secid=106.BABA'));
  assert.ok(minuteUrl('usNVDA').includes('secid=105.NVDA'));
  assert.strictEqual(marketOf('bj430047'), 'a');
});

test('parseSearch：搜索结果', () => {
  const json = {
    QuotationCodeTable: {
      Data: [
        { Code: '600519', Name: '贵州茅台', PinYin: 'GZMT', MktNum: '1', QuoteID: '1.600519', SecurityTypeName: '沪A', Classify: 'AStock' },
        { Code: '00700', Name: '腾讯控股', PinYin: 'TXKG', MktNum: '116', QuoteID: '116.00700', SecurityTypeName: '港股', Classify: 'HK' },
        { Code: 'NVDA', Name: '英伟达', PinYin: 'YWD', MktNum: '105', QuoteID: '105.NVDA', SecurityTypeName: '美股', Classify: 'UsStock' },
        { Code: 'BK0475', Name: '银行', PinYin: 'YH', MktNum: '90', QuoteID: '90.BK0475', SecurityTypeName: '板块', Classify: 'BK' },
        { Code: '600519', Name: '贵州茅台', MktNum: '1', QuoteID: '1.600519' }
      ]
    }
  };
  const r = parseSearch(json);
  assert.deepStrictEqual(r.map((x) => x.code), ['sh600519', 'hk00700', 'usNVDA']);
  assert.strictEqual(r[0].type, '沪A');
  assert.deepStrictEqual(parseSearch('{"QuotationCodeTable":{"Data":null}}'), []);
});

test('sanitize：非法配置回退到默认值', () => {
  const c = sanitize({ mode: 'xx', refreshMs: 10, groups: [{ name: ' 测试 ', codes: ['sh600519', 'sh600519', 'bad', 'usNVDA'] }], activeGroup: 9 });
  assert.strictEqual(c.mode, 'auto');
  assert.strictEqual(c.refreshMs, 1500);
  assert.deepStrictEqual(c.groups, [{ name: '测试', codes: ['sh600519', 'usNVDA'] }]);
  assert.strictEqual(c.activeGroup, 0);
});

test('sanitize：外观参数夹在允许范围内', () => {
  const c = sanitize({ style: 'neon', opacity: 0.1, scale: 3, topOffset: -5 });
  assert.strictEqual(c.style, 'classic');
  assert.strictEqual(c.opacity, 0.3);
  assert.strictEqual(c.scale, 1.2);
  assert.strictEqual(c.topOffset, 0);
});
