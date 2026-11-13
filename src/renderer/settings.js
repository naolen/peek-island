// 设置窗口：分组增删改、搜索添加股票、显示与快捷键。所有修改即时保存。
(() => {
  'use strict';
  const api = window.peek;
  const $ = (id) => document.getElementById(id);
  const MAX_PER_GROUP = 8;
  const TYPE_NAMES = { 'GP-A': 'A股', 'GP-A-KCB': '科创板', 'GP-A-CYB': '创业板', GP: '股票', ZS: '指数', ETF: 'ETF', LOF: 'LOF' };

  let cfg = null;
  let quotes = {};
  let sel = 0;
  let results = [];
  let activeResult = -1;
  let searchSeq = 0;
  let searchTimer = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtP = (n) => n == null ? '--' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 });
  const fmtPct = (n) => n == null ? '--' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const colorOf = (pct) => pct == null ? '#9AA0A8' : (pct >= 0) === cfg.redUp ? '#FF5B5B' : '#2FD27A';
  const shortCode = (c) => c.replace(/^(sh|sz|bj|hk|us)/, '').toUpperCase();
  const marketName = (c) => /^hk/.test(c) ? '港股' : /^us/.test(c) ? '美股' : /^bj/.test(c) ? '北交所' : /^sh/.test(c) ? '沪市' : '深市';

  async function save(patch) {
    cfg = await api.setConfig(patch);
    sel = Math.min(sel, cfg.groups.length - 1);
    render();
    const h = $('saveHint');
    h.textContent = '已保存';
    clearTimeout(save.t);
    save.t = setTimeout(() => { h.textContent = '修改后自动保存'; }, 1200);
  }
  const groupsCopy = () => cfg.groups.map((g) => ({ name: g.name, codes: g.codes.slice() }));

  function render() {
    // 分组列表
    $('groupList').innerHTML = cfg.groups.map((g, i) =>
      `<button type="button" class="group-item" role="option" data-i="${i}" aria-selected="${i === sel}"><span>${esc(g.name)}</span><span class="cnt num">${g.codes.length}</span></button>`
    ).join('');
    const g = cfg.groups[sel];
    if (document.activeElement !== $('groupName')) $('groupName').value = g.name;
    $('moveUp').disabled = sel === 0;
    $('moveDown').disabled = sel === cfg.groups.length - 1;
    $('delGroup').disabled = cfg.groups.length <= 1;
    $('limitHint').textContent = `${g.codes.length} / ${MAX_PER_GROUP} 只 · 一只股票可以同时放进多个分组`;

    // 股票列表
    if (!g.codes.length) {
      $('stockList').innerHTML = '<div class="empty-list">还没有股票，在右上角搜索框输入代码或拼音添加</div>';
    } else {
      $('stockList').innerHTML = g.codes.map((c, i) => {
        const q = quotes[c] || {};
        return `<div class="stock-row">
          <span class="name">${esc(q.name || shortCode(c))}</span>
          <span class="code num">${esc(shortCode(c))} · ${marketName(c)}</span>
          <span class="num r">${fmtP(q.price)}</span>
          <span class="num r" style="color:${colorOf(q.pct)}">${fmtPct(q.pct)}</span>
          <span class="ops">
            <button type="button" class="mini-btn" data-op="up" data-i="${i}" aria-label="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="mini-btn" data-op="down" data-i="${i}" aria-label="下移" ${i === g.codes.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="mini-btn danger" data-op="del" data-i="${i}">移出</button>
          </span>
        </div>`;
      }).join('');
    }

    // 通用设置
    $('mode').value = cfg.mode;
    $('redUp').value = cfg.redUp ? '1' : '0';
    if (document.activeElement !== $('refresh')) $('refresh').value = cfg.refreshMs / 1000;
    if (document.activeElement !== $('rotate')) $('rotate').value = cfg.rotateMs / 1000;
    if (document.activeElement !== $('collapse')) $('collapse').value = cfg.collapseDelayMs / 1000;
    if (document.activeElement !== $('bossKey')) $('bossKey').value = cfg.bossKey;
    $('style').value = cfg.style;
    $('music').value = cfg.music ? '1' : '0';
    $('clipEnabled').value = cfg.clipEnabled ? '1' : '0';
    $('clipImages').value = cfg.clipImages ? '1' : '0';
    $('todoRollover').value = cfg.todoRollover ? '1' : '0';
    if (document.activeElement !== $('clipLimit')) $('clipLimit').value = cfg.clipLimit;
    if (document.activeElement !== $('clipKey')) $('clipKey').value = cfg.clipKey;
    if (document.activeElement !== $('todoKey')) $('todoKey').value = cfg.todoKey;
    renderShortcutStatus();
    renderNotify();
    $('opacity').value = cfg.opacity; $('opacityVal').textContent = Math.round(cfg.opacity * 100) + '%';
    $('scale').value = cfg.scale; $('scaleVal').textContent = Math.round(cfg.scale * 100) + '%';
    $('topOffset').value = cfg.topOffset; $('topVal').textContent = cfg.topOffset ? cfg.topOffset + 'px' : '贴边';
    renderResults();
  }

  function renderResults() {
    const box = $('results');
    const q = $('search').value.trim();
    if (!q) { box.classList.remove('show'); return; }
    const g = cfg.groups[sel];
    if (!results.length) {
      box.innerHTML = '<div class="empty">没有找到，换个关键词试试</div>';
    } else {
      box.innerHTML = results.map((r, i) => {
        const added = g.codes.includes(r.code);
        return `<button type="button" class="result ${i === activeResult ? 'active' : ''} ${added ? 'added' : ''}" data-i="${i}" ${added ? 'aria-disabled="true"' : ''}>
          <span>${esc(r.name)}</span><span class="code num">${esc(shortCode(r.code))}</span>
          <span class="type">${added ? '已在分组中' : esc(TYPE_NAMES[r.type] || r.type || marketName(r.code))}</span></button>`;
      }).join('');
    }
    box.classList.add('show');
  }

  function addCode(code) {
    const groups = groupsCopy();
    const g = groups[sel];
    if (g.codes.includes(code)) return;
    if (g.codes.length >= MAX_PER_GROUP) { $('limitHint').textContent = `每个分组最多 ${MAX_PER_GROUP} 只，先移出一些吧`; return; }
    g.codes.push(code);
    $('search').value = '';
    results = [];
    save({ groups });
  }

  // ---------- 事件 ----------
  $('groupList').addEventListener('click', (e) => {
    const b = e.target.closest('.group-item');
    if (!b) return;
    sel = Number(b.dataset.i);
    $('groupName').value = cfg.groups[sel].name;
    render();
  });
  $('addGroup').addEventListener('click', () => {
    const groups = groupsCopy();
    groups.push({ name: '新分组' + (groups.length + 1), codes: [] });
    sel = groups.length - 1;
    save({ groups }).then(() => { $('groupName').focus(); $('groupName').select(); });
  });
  $('groupName').addEventListener('change', () => {
    const groups = groupsCopy();
    groups[sel].name = $('groupName').value.trim() || groups[sel].name;
    save({ groups });
  });
  $('moveUp').addEventListener('click', () => moveGroup(-1));
  $('moveDown').addEventListener('click', () => moveGroup(1));
  function moveGroup(d) {
    const groups = groupsCopy();
    const j = sel + d;
    if (j < 0 || j >= groups.length) return;
    [groups[sel], groups[j]] = [groups[j], groups[sel]];
    let active = cfg.activeGroup;
    if (active === sel) active = j; else if (active === j) active = sel;
    sel = j;
    save({ groups, activeGroup: active });
  }
  $('delGroup').addEventListener('click', () => {
    if (cfg.groups.length <= 1) return;
    const groups = groupsCopy();
    groups.splice(sel, 1);
    let active = cfg.activeGroup;
    if (active >= groups.length) active = groups.length - 1;
    sel = Math.max(0, sel - 1);
    save({ groups, activeGroup: active });
  });

  $('stockList').addEventListener('click', (e) => {
    const b = e.target.closest('.mini-btn');
    if (!b || b.disabled) return;
    const i = Number(b.dataset.i);
    const groups = groupsCopy();
    const codes = groups[sel].codes;
    if (b.dataset.op === 'del') codes.splice(i, 1);
    else if (b.dataset.op === 'up' && i > 0) [codes[i - 1], codes[i]] = [codes[i], codes[i - 1]];
    else if (b.dataset.op === 'down' && i < codes.length - 1) [codes[i + 1], codes[i]] = [codes[i], codes[i + 1]];
    save({ groups });
  });

  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = $('search').value.trim();
    if (!q) { results = []; renderResults(); return; }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const r = await api.search(q);
      if (seq !== searchSeq) return;
      results = r;
      activeResult = r.length ? 0 : -1;
      renderResults();
    }, 220);
  });
  $('search').addEventListener('keydown', (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') { activeResult = (activeResult + 1) % results.length; renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeResult = (activeResult - 1 + results.length) % results.length; renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter' && activeResult >= 0) { addCode(results[activeResult].code); e.preventDefault(); }
    else if (e.key === 'Escape') { $('search').value = ''; results = []; renderResults(); }
  });
  $('results').addEventListener('mousedown', (e) => {
    const b = e.target.closest('.result');
    if (!b || b.classList.contains('added')) return;
    e.preventDefault();
    addCode(results[Number(b.dataset.i)].code);
  });
  $('search').addEventListener('blur', () => setTimeout(() => $('results').classList.remove('show'), 150));
  $('search').addEventListener('focus', renderResults);

  $('mode').addEventListener('change', () => save({ mode: $('mode').value }));
  $('redUp').addEventListener('change', () => save({ redUp: $('redUp').value === '1' }));
  $('refresh').addEventListener('change', () => save({ refreshMs: Math.round(Number($('refresh').value) * 1000) }));
  $('rotate').addEventListener('change', () => save({ rotateMs: Math.round(Number($('rotate').value) * 1000) }));
  $('collapse').addEventListener('change', () => save({ collapseDelayMs: Math.round(Number($('collapse').value) * 1000) }));
  $('bossKey').addEventListener('change', () => save({ bossKey: $('bossKey').value.trim() }));
  $('style').addEventListener('change', () => save({ style: $('style').value }));
  $('music').addEventListener('change', () => save({ music: $('music').value === '1' }));
  $('clipEnabled').addEventListener('change', () => save({ clipEnabled: $('clipEnabled').value === '1' }));
  $('clipImages').addEventListener('change', () => save({ clipImages: $('clipImages').value === '1' }));
  $('todoRollover').addEventListener('change', () => save({ todoRollover: $('todoRollover').value === '1' }));
  $('clipLimit').addEventListener('change', () => save({ clipLimit: Number($('clipLimit').value) }));
  $('clipKey').addEventListener('change', () => save({ clipKey: $('clipKey').value.trim() }));
  $('todoKey').addEventListener('change', () => save({ todoKey: $('todoKey').value.trim() }));

  // ---------- 系统通知 ----------
  const PRESET = /飞书|feishu|lark|qq|钉钉|dingtalk|企业微信|wecom|wxwork|outlook|teams|邮件|mail|foxmail|网易邮箱/i;
  let notifyApps = [];
  let notifyStatus = null;
  function allowed(app) {
    if (cfg.notifyAll) return !cfg.notifyMuted.includes(app);
    if (cfg.notifyAllowed.includes(app)) return true;
    return PRESET.test(app) && !cfg.notifyMuted.includes(app);
  }
  function renderNotify() {
    if (!cfg) return;
    $('notify').value = cfg.notify ? '1' : '0';
    $('notifyPopup').value = cfg.notifyPopup ? '1' : '0';
    $('notifyAll').value = cfg.notifyAll ? '1' : '0';
    const s = notifyStatus && notifyStatus.status;
    const el = $('notifyStatus');
    el.innerHTML = !cfg.notify ? '' : s === 'allowed' ? '· 已获得读取权限'
      : s === 'denied' || s === 'unspecified' ? '· 还没有读取权限，<span class="link" id="openNotify">打开系统设置</span>'
      : s === 'unsupported' ? '· 当前系统不支持（需要 Windows 10 1809 及以上）' : '';
    const box = $('notifyApps');
    box.innerHTML = notifyApps.length
      ? notifyApps.map((a) => `<label class="app-chip"><input type="checkbox" data-app="${esc(a.name)}" ${allowed(a.name) ? 'checked' : ''}>${esc(a.name)}${PRESET.test(a.name) ? '<span class="preset">常用</span>' : ''}</label>`).join('')
      : '<span class="hint">还没有收到过通知</span>';
  }
  $('notify').addEventListener('change', () => save({ notify: $('notify').value === '1' }));
  $('notifyPopup').addEventListener('change', () => save({ notifyPopup: $('notifyPopup').value === '1' }));
  $('notifyAll').addEventListener('change', () => save({ notifyAll: $('notifyAll').value === '1' }));
  $('notifyApps').addEventListener('change', (e) => {
    const app = e.target.dataset.app;
    if (!app) return;
    const on = e.target.checked;
    const allowedList = cfg.notifyAllowed.filter((x) => x !== app);
    const muted = cfg.notifyMuted.filter((x) => x !== app);
    if (on) allowedList.push(app); else muted.push(app);
    save({ notifyAllowed: allowedList, notifyMuted: muted });
  });
  $('notifyStatus').addEventListener('click', (e) => { if (e.target.id === 'openNotify') api.openNotifySettings(); });
  if (api.notifyApps) {
    api.notifyApps().then((a) => { notifyApps = a || []; renderNotify(); });
    api.notifyStatus().then((s) => { notifyStatus = s; renderNotify(); });
    api.onNotifyApps(() => api.notifyApps().then((a) => { notifyApps = a || []; renderNotify(); }));
    api.onNotifyStatus((s) => { notifyStatus = s; renderNotify(); });
  }

  // 快捷键是否注册成功（可能被别的软件占用）
  let shortcuts = {};
  const KEY_TEXT = { busy: '被其他软件占用', invalid: '格式不对，例如 Control+Alt+V', off: '未设置' };
  function renderShortcutStatus() {
    for (const k of ['bossKey', 'clipKey', 'todoKey']) {
      const el = $(k + 'Status');
      if (!el) continue;
      const s = shortcuts[k];
      el.textContent = s && s !== 'ok' ? '· ' + KEY_TEXT[s] : '';
    }
  }
  if (api.getShortcuts) {
    api.getShortcuts().then((s) => { shortcuts = s || {}; renderShortcutStatus(); });
    api.onShortcuts((s) => { shortcuts = s || {}; renderShortcutStatus(); });
  }
  // 拖动滑块时实时生效
  [['opacity', 'opacity'], ['scale', 'scale'], ['topOffset', 'topOffset']].forEach(([id, key]) => {
    $(id).addEventListener('input', () => save({ [key]: Number($(id).value) }));
  });

  async function init() {
    cfg = await api.getConfig();
    quotes = await api.getQuotes();
    sel = cfg.activeGroup;
    render();
    api.onConfig((c) => { cfg = c; sel = Math.min(sel, cfg.groups.length - 1); render(); });
    api.onQuotes((q) => { quotes = q; if (document.activeElement !== $('search')) render(); else renderStocksOnly(); });
  }
  function renderStocksOnly() {
    const keepResults = $('results').innerHTML;
    render();
    $('results').innerHTML = keepResults;
  }
  init();
})();
