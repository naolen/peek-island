// 持仓盈亏计算（纯函数）。
//   今日盈亏 = (现价 − 昨收) × 股数
//   持仓盈亏 = (现价 − 成本) × 股数
// 港股、美股按汇率折成人民币后再汇总。
const { marketOf } = require('./quotes');

function rateOf(code, rates) {
  const m = marketOf(code);
  if (m === 'hk') return rates && rates.HKD > 0 ? rates.HKD : 0.92;
  if (m === 'us') return rates && rates.USD > 0 ? rates.USD : 7.2;
  return 1;
}

function currencyOf(code) {
  const m = marketOf(code);
  return m === 'hk' ? '港币' : m === 'us' ? '美元' : '元';
}

/** 一只股票。返回原币和人民币两套数字；没有持仓或没有行情返回 null */
function one(code, q, h, rates) {
  if (!q || !h || !(h.qty > 0) || !(q.price > 0)) return null;
  const fx = rateOf(code, rates);
  const prev = q.prevClose > 0 ? q.prevClose : q.price;
  const cost = h.cost > 0 ? h.cost : null;
  const r = {
    code,
    qty: h.qty,
    cost,
    currency: currencyOf(code),
    fx,
    mv: q.price * h.qty,                                   // 原币市值
    today: (q.price - prev) * h.qty,                       // 原币今日盈亏
    total: cost === null ? null : (q.price - cost) * h.qty // 原币持仓盈亏
  };
  r.todayPct = prev ? (q.price - prev) / prev * 100 : 0;
  r.totalPct = cost ? (q.price - cost) / cost * 100 : null;
  r.mvCny = r.mv * fx;
  r.todayCny = r.today * fx;
  r.totalCny = r.total === null ? null : r.total * fx;
  return r;
}

/** 一组股票汇总（人民币） */
function group(codes, quotes, holdings, rates) {
  const items = [];
  for (const code of codes) {
    const r = one(code, quotes[code], holdings && holdings[code], rates);
    if (r) items.push(r);
  }
  if (!items.length) return null;
  const mv = items.reduce((t, x) => t + x.mvCny, 0);
  const today = items.reduce((t, x) => t + x.todayCny, 0);
  const prevMv = mv - today;
  const withCost = items.filter((x) => x.totalCny !== null);
  const total = withCost.reduce((t, x) => t + x.totalCny, 0);
  const costMv = withCost.reduce((t, x) => t + x.cost * x.qty * x.fx, 0);
  for (const x of items) x.weight = mv ? x.mvCny / mv * 100 : 0;
  return {
    items,
    mv,
    today,
    todayPct: prevMv ? today / prevMv * 100 : 0,
    total: withCost.length ? total : null,
    totalPct: costMv ? total / costMv * 100 : null
  };
}

module.exports = { one, group, rateOf, currencyOf };
