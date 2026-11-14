// 预警判断（纯逻辑，便于测试）。
//
// 每只股票一组规则（存在配置里）：
//   { upOn, up, downOn, down, pctOn, pct, fastOn, fast, limitOn,
//     notify: 'card' | 'strip',            触发时：岛上弹卡片 / 只闪光带
//     repeat: 'once' | 'daily' | 'every' } 触发后：提醒一次就关 / 每天最多一次 / 每次都提醒（离开条件后再次满足才算一次）
//
// 运行时状态（不存盘）：每条规则是否“上膛”、今天是否已经提醒过、最近 6 分钟的价格、是否在涨跌停上。

const RULE_KEYS = ['up', 'down', 'pct', 'fast', 'limit'];
const FAST_WINDOW = 5 * 60 * 1000;

function emptyRule() {
  return { upOn: false, up: null, downOn: false, down: null, pctOn: false, pct: 3, fastOn: false, fast: 2, limitOn: false, notify: 'card', repeat: 'once' };
}

function cleanRule(r) {
  const out = Object.assign(emptyRule(), r || {});
  for (const k of ['up', 'down', 'pct', 'fast']) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) && n > 0 ? n : (k === 'pct' ? 3 : k === 'fast' ? 2 : null);
    out[k + 'On'] = !!out[k + 'On'] && out[k] !== null;
  }
  out.limitOn = !!out.limitOn;
  if (!['card', 'strip'].includes(out.notify)) out.notify = 'card';
  if (!['once', 'daily', 'every'].includes(out.repeat)) out.repeat = 'once';
  return out;
}

function anyOn(r) { return !!r && RULE_KEYS.some((k) => r[k + 'On']); }

/** A 股涨跌幅限制（%）：主板 10，创业板 / 科创板 20，北交所 30，ST 5；其他市场没有 */
function limitPctOf(code, name) {
  if (!/^(sh|sz|bj)/.test(code)) return null;
  if (/^bj/.test(code)) return 30;
  if (/ST/i.test(name || '')) return 5;
  if (/^(sz30|sh688|sh689)/.test(code)) return 20;
  return 10;
}

const round2 = (x) => Math.round(x * 100 + 1e-6) / 100;
const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 });
const signPct = (n) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%';

/**
 * 检查一只股票。
 * @param rule  cleanRule() 之后的规则
 * @param st    这只股票的运行时状态对象（会被修改）
 * @param q     行情 { code, name, price, prevClose, pct }
 * @param now   毫秒
 * @param today 'YYYY-MM-DD'
 * @returns { events: [...], disable: ['up', ...] }  disable = repeat 为 once 时需要关掉的规则
 */
function evaluate(rule, st, q, now, today) {
  const events = [];
  const disable = [];
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return { events, disable };
  const price = q.price;

  // 最近 6 分钟的价格，用来算 5 分钟涨跌
  st.hist = (st.hist || []).filter((h) => now - h[0] <= FAST_WINDOW + 60000);
  st.hist.push([now, price]);

  const fire = (key, cond, rearm, ev) => {
    const s = st[key] || (st[key] = { armed: true, day: null });
    if (!cond) { if (rearm) s.armed = true; return; }
    if (!s.armed) return;
    if (rule.repeat === 'daily' && s.day === today) return;
    s.armed = false;
    s.day = today;
    events.push(Object.assign({ code: q.code, name: q.name, price, pct: q.pct, time: now, notify: rule.notify }, ev));
    if (rule.repeat === 'once') disable.push(key);
  };
  const body = `现价 ${fmt(price)}  ${q.pct >= 0 ? '▲' : '▼'} ${signPct(q.pct)}`;

  if (rule.upOn && rule.up) {
    fire('up', price >= rule.up, price < rule.up * 0.998, { kind: 'price-up', title: `${q.name} 涨到 ${fmt(rule.up)}`, body });
  }
  if (rule.downOn && rule.down) {
    fire('down', price <= rule.down, price > rule.down * 1.002, { kind: 'price-down', title: `${q.name} 跌到 ${fmt(rule.down)}`, body });
  }
  if (rule.pctOn && rule.pct) {
    const a = Math.abs(q.pct);
    fire('pct', a >= rule.pct, a < rule.pct * 0.9, { kind: q.pct >= 0 ? 'pct-up' : 'pct-down', title: `${q.name} 今日${q.pct >= 0 ? '涨' : '跌'}超 ${rule.pct}%`, body });
  }
  if (rule.fastOn && rule.fast) {
    const first = st.hist.find((h) => now - h[0] <= FAST_WINDOW);
    const span = first ? now - first[0] : 0;
    // 至少有 4 分钟的数据才判断，刚启动时不算
    if (first && span >= 4 * 60 * 1000) {
      const chg = (price - first[1]) / first[1] * 100;
      const a = Math.abs(chg);
      fire('fast', a >= rule.fast, a < rule.fast * 0.5, {
        kind: chg >= 0 ? 'fast-up' : 'fast-down',
        title: `${q.name} 5 分钟${chg >= 0 ? '拉升' : '跳水'} ${Math.abs(chg).toFixed(1)}%`,
        body
      });
    }
  }
  if (rule.limitOn) {
    const lp = limitPctOf(q.code, q.name);
    if (lp && q.prevClose > 0) {
      const upLimit = round2(q.prevClose * (1 + lp / 100));
      const downLimit = round2(q.prevClose * (1 - lp / 100));
      const now_ = price >= upLimit - 0.005 ? 'up' : price <= downLimit + 0.005 ? 'down' : null;
      const was = st.limitState === undefined ? null : st.limitState;
      if (now_ !== was) {
        st.limitState = now_;
        const ev = now_ === 'up' ? { kind: 'limit-up', title: `${q.name} 涨停`, body: `${fmt(price)} · 涨停封板` }
          : now_ === 'down' ? { kind: 'limit-down', title: `${q.name} 跌停`, body: `${fmt(price)} · 跌停封板` }
          : { kind: 'limit-open', title: `${q.name} ${was === 'up' ? '涨停' : '跌停'}打开`, body };
        // 涨跌停每次变化都提醒（不受 once 影响，因为一天里可能多次封板、开板）
        events.push(Object.assign({ code: q.code, name: q.name, price, pct: q.pct, time: now, notify: rule.notify }, ev));
      }
    }
  }
  return { events, disable };
}

/** 规则的一句话摘要，设置页列表里用 */
function describe(rule) {
  const r = cleanRule(rule);
  const parts = [];
  if (r.upOn) parts.push('涨到 ' + fmt(r.up));
  if (r.downOn) parts.push('跌到 ' + fmt(r.down));
  if (r.pctOn) parts.push('涨跌幅超 ±' + r.pct + '%');
  if (r.fastOn) parts.push('5 分钟急拉跳水 ' + r.fast + '%');
  if (r.limitOn) parts.push('涨跌停 / 开板');
  return parts.join(' · ') || '（没有开启的规则）';
}

module.exports = { emptyRule, cleanRule, anyOn, evaluate, describe, limitPctOf, RULE_KEYS };
