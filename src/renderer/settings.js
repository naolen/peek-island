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
        return `<div class="stock-row" draggable="true" data-i="${i}">
          <span class="grip" aria-hidden="true" title="拖动排序">⋮⋮</span>
          <span class="name">${esc(q.name || shortCode(c))}${cfg.holdings[c] ? '<i class="tag">持仓</i>' : ''}${cfg.alerts[c] ? '<i class="tag amber">预警</i>' : ''}</span>
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
    renderStockExtras();
    renderAlerts();
    renderHoldings();
    renderStealth();
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

  // ---------- 邮箱 ----------
  let presets = [];
  let mail = { accounts: [], status: {}, encryption: true };
  let editingMail = null; // 正在编辑的账户 id；null = 新增
  const STATE_TEXT = { ok: '已连接', connecting: '连接中…', stopped: '已暂停', idle: '' };

  function renderMail() {
    const list = $('mailList');
    if (!mail.accounts.length) {
      list.innerHTML = '<span class="hint">还没有添加邮箱</span>';
    } else {
      list.innerHTML = mail.accounts.map((a) => {
        const s = mail.status[a.id] || { state: a.enabled ? 'connecting' : 'stopped' };
        const text = s.state === 'error' ? s.error : STATE_TEXT[s.state] || '';
        return `<div class="mail-row" data-id="${esc(a.id)}">
          <span class="name">${esc(a.label)}</span><span class="addr">${esc(a.email)}</span>
          <span class="state ${esc(s.state)}" title="${esc(text)}">${esc(text)}</span>
          ${s.state === 'error' ? '<button type="button" class="mini-btn" data-op="retry">重试</button>' : ''}
          <button type="button" class="mini-btn" data-op="edit">修改</button>
          <button type="button" class="mini-btn" data-op="toggle">${a.enabled ? '暂停' : '启用'}</button>
          <button type="button" class="mini-btn danger" data-op="remove">删除</button>
        </div>`;
      }).join('');
    }
    if (!mail.encryption) $('mailMsg').textContent = '当前系统不支持加密保存，无法记住授权码';
  }

  function presetOf(id) { return presets.find((p) => p.id === id) || presets[presets.length - 1]; }
  function syncPresetUi() {
    const p = presetOf($('mailPreset').value);
    $('mailForm').classList.toggle('custom', p && p.id === 'custom');
    $('mailHelp').textContent = p ? p.help : '';
  }

  function openMailForm(acc) {
    editingMail = acc ? acc.id : null;
    $('mailPreset').value = acc ? acc.preset : 'qq';
    $('mailEmail').value = acc ? acc.email : '';
    $('mailPass').value = '';
    $('mailPass').placeholder = acc ? '不修改就留空' : '不是登录密码';
    $('mailHost').value = acc ? acc.host : '';
    $('mailPort').value = acc ? acc.port : 993;
    $('mailLabel').value = acc ? acc.label : '';
    $('mailMsg').textContent = '';
    syncPresetUi();
    $('mailForm').classList.add('show');
    $('mailAdd').style.display = 'none';
    $('mailEmail').focus();
  }
  function closeMailForm() {
    $('mailForm').classList.remove('show');
    $('mailAdd').style.display = '';
    $('mailPass').value = '';
    editingMail = null;
  }

  $('mailAdd').addEventListener('click', () => openMailForm(null));
  $('mailCancel').addEventListener('click', closeMailForm);
  $('mailPreset').addEventListener('change', syncPresetUi);
  $('mailEmail').addEventListener('change', () => {
    // 按邮箱后缀自动选类型：填了 xxx@163.com 就切到 163
    const domain = ($('mailEmail').value.split('@')[1] || '').toLowerCase();
    const p = presets.find((x) => x.domains.includes(domain));
    if (p && !editingMail) { $('mailPreset').value = p.id; syncPresetUi(); }
  });
  $('mailSave').addEventListener('click', async () => {
    const btn = $('mailSave');
    btn.disabled = true;
    $('mailMsg').textContent = '正在连接邮箱服务器…';
    const input = {
      id: editingMail || undefined,
      preset: $('mailPreset').value,
      email: $('mailEmail').value.trim(),
      host: $('mailHost').value.trim(),
      port: Number($('mailPort').value),
      label: $('mailLabel').value.trim()
    };
    const r = await api.mailSave(input, $('mailPass').value);
    btn.disabled = false;
    if (r.ok) {
      $('mailMsg').textContent = '';
      closeMailForm();
      loadMail();
    } else {
      $('mailMsg').textContent = r.error || '保存失败';
    }
  });
  $('mailList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const id = b.closest('.mail-row').dataset.id;
    const acc = mail.accounts.find((a) => a.id === id);
    if (!acc) return;
    if (b.dataset.op === 'edit') openMailForm(acc);
    else if (b.dataset.op === 'toggle') await api.mailToggle(id, !acc.enabled);
    else if (b.dataset.op === 'retry') await api.mailRetry(id);
    else if (b.dataset.op === 'remove') {
      if (b.dataset.armed) { await api.mailRemove(id); }
      else { b.dataset.armed = '1'; b.textContent = '确认删除'; setTimeout(() => { delete b.dataset.armed; b.textContent = '删除'; }, 3000); return; }
    }
    loadMail();
  });

  async function loadMail() {
    mail = await api.mailAccounts();
    renderMail();
  }
  if (api.mailPresets) {
    api.mailPresets().then((p) => {
      presets = p || [];
      $('mailPreset').innerHTML = presets.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
      syncPresetUi();
    });
    loadMail();
    api.onMailStatus((s) => { mail.status = s || {}; renderMail(); });
    api.onConfig(() => loadMail());
  }

  // 快捷键是否注册成功（可能被别的软件占用）
  let shortcuts = {};
  const KEY_TEXT = { busy: '被其他软件占用', invalid: '格式不对，例如 Control+Alt+V', off: '未设置' };
  function renderShortcutStatus() {
    for (const k of ['bossKey', 'clipKey', 'todoKey', 'stealthKey']) {
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


  // ---------- 行情：显示、指数、导入导出、拖动排序 ----------
  const INDEX_CHOICES = [
    ['sh000001', '上证指数'], ['sz399001', '深证成指'], ['sz399006', '创业板指'], ['sh000300', '沪深300'], ['sh000688', '科创50'],
    ['giHSI', '恒生指数'], ['giHSCEI', '国企指数'], ['giNDX', '纳斯达克100'], ['giDJIA', '道琼斯'], ['giSPX', '标普500']
  ];
  function renderStockExtras() {
    $('groupDisplay').value = cfg.groupDisplay;
    if (document.activeElement !== $('idleRefresh')) $('idleRefresh').value = cfg.idleRefreshMs / 60000;
    $('indexPick').innerHTML = INDEX_CHOICES.map(([c, n]) => {
      const on = cfg.indexes.includes(c);
      const full = !on && cfg.indexes.length >= 6;
      return `<label class="pick${on ? ' on' : ''}${full ? ' off' : ''}"><input type="checkbox" data-c="${c}"${on ? ' checked' : ''}${full ? ' disabled' : ''}>${esc(n)}</label>`;
    }).join('');
  }
  $('groupDisplay').addEventListener('change', () => save({ groupDisplay: $('groupDisplay').value }));
  $('idleRefresh').addEventListener('change', () => save({ idleRefreshMs: Math.round(Number($('idleRefresh').value) * 60000) }));
  $('indexPick').addEventListener('change', (e) => {
    const c = e.target.dataset.c;
    if (!c) return;
    const list = cfg.indexes.filter((x) => x !== c);
    if (e.target.checked) {
      // 按候选列表的顺序排
      list.push(c);
      list.sort((a, b) => INDEX_CHOICES.findIndex((x) => x[0] === a) - INDEX_CHOICES.findIndex((x) => x[0] === b));
    }
    save({ indexes: list });
  });
  const ioHint = (t, warn) => { $('ioHint').textContent = t; $('ioHint').classList.toggle('warn', !!warn); };
  $('exportGroups').addEventListener('click', async () => {
    const r = await api.exportGroups();
    if (r && r.ok) ioHint('已导出（含持仓和预警）');
    else if (r && r.error) ioHint('导出失败：' + r.error, true);
  });
  $('importGroups').addEventListener('click', async () => {
    const r = await api.importGroups('merge');
    if (r && r.ok) ioHint(`已导入 ${r.groups} 个分组`);
    else if (r && r.error) ioHint('导入失败：' + r.error, true);
  });

  // 股票列表拖动排序（按住左边的把手）
  let dragFrom = -1;
  $('stockList').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.stock-row');
    if (!row) return;
    dragFrom = Number(row.dataset.i);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) { /* ignore */ }
  });
  $('stockList').addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const row = e.target.closest('.stock-row');
    document.querySelectorAll('.stock-row.drop-before, .stock-row.drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    if (!row) return;
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  $('stockList').addEventListener('drop', (e) => {
    e.preventDefault();
    const row = e.target.closest('.stock-row');
    if (!row || dragFrom < 0) return;
    const r = row.getBoundingClientRect();
    let to = Number(row.dataset.i) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    const groups = groupsCopy();
    const codes = groups[sel].codes;
    const [moved] = codes.splice(dragFrom, 1);
    if (to > dragFrom) to -= 1;
    codes.splice(to, 0, moved);
    dragFrom = -1;
    save({ groups });
  });
  $('stockList').addEventListener('dragend', () => {
    dragFrom = -1;
    document.querySelectorAll('.stock-row.dragging, .stock-row.drop-before, .stock-row.drop-after').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
  });

  // ---------- 预警 ----------
  const nameOf = (c) => (quotes[c] && quotes[c].name) || shortCode(c);
  const NOTIFY_TEXT = { card: '弹出卡片', strip: '只闪光带' };
  const REPEAT_TEXT = { once: '提醒一次', daily: '每天一次', every: '每次' };
  function describeRule(r) {
    const parts = [];
    if (r.upOn) parts.push('涨到 ' + fmtP(r.up));
    if (r.downOn) parts.push('跌到 ' + fmtP(r.down));
    if (r.pctOn) parts.push('涨跌幅超 ±' + r.pct + '%');
    if (r.fastOn) parts.push('5 分钟急拉跳水 ' + r.fast + '%');
    if (r.limitOn) parts.push('涨跌停 / 开板');
    return parts.join(' · ') || '已全部触发过（提醒一次的规则触发后会自动关掉）';
  }
  function renderAlerts() {
    const codes = Object.keys(cfg.alerts);
    $('alertList').innerHTML = codes.length ? codes.map((c) => {
      const r = cfg.alerts[c];
      const q = quotes[c] || {};
      const any = r.upOn || r.downOn || r.pctOn || r.fastOn || r.limitOn;
      return `<div class="alert-row${any ? '' : ' idle'}">
        <span class="a-name">${esc(nameOf(c))}<span class="hint num">${esc(shortCode(c))} · ${fmtP(q.price)}</span></span>
        <span class="a-desc">${esc(describeRule(r))}<span class="hint">${NOTIFY_TEXT[r.notify] || ''} · ${REPEAT_TEXT[r.repeat] || ''}</span></span>
        <button type="button" class="mini-btn danger" data-del="${esc(c)}">删除</button>
      </div>`;
    }).join('') : '<div class="empty-list">还没有预警。在岛上展开面板，点股票旁边的「预警」来设置</div>';
    if (document.activeElement !== $('alertCard')) $('alertCard').value = cfg.alertCardMs / 1000;
  }
  $('alertList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const next = Object.assign({}, cfg.alerts);
    delete next[b.dataset.del];
    save({ alerts: next });
  });
  $('alertCard').addEventListener('change', () => save({ alertCardMs: Math.round(Number($('alertCard').value) * 1000) }));

  // ---------- 持仓 ----------
  let pnlState = null;
  const fmtMoney = (v) => {
    if (v == null) return '--';
    const a = Math.abs(v);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  const moneyColor = (v) => v == null || v === 0 ? '#C4C8CE' : (v > 0) === cfg.redUp ? '#FF5B5B' : '#2FD27A';
  function renderHoldings() {
    const codes = Object.keys(cfg.holdings);
    const items = (pnlState && pnlState.items) || {};
    const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#holdList');
    if (!editing) {
      $('holdList').innerHTML = codes.length ? codes.map((c) => {
        const h = cfg.holdings[c];
        const it = items[c];
        const q = quotes[c] || {};
        return `<div class="hold-row" data-c="${esc(c)}">
          <span>${esc(nameOf(c))}</span><span class="hint num">${esc(shortCode(c))}</span>
          <input class="input num r" data-k="qty" value="${h.qty}" inputmode="decimal" aria-label="股数">
          <input class="input num r" data-k="cost" value="${h.cost || ''}" placeholder="可不填" inputmode="decimal" aria-label="成本价">
          <span class="num r">${fmtP(q.price)}</span>
          <span class="num r" style="color:${moneyColor(it && it.todayCny)}">${it ? fmtMoney(it.todayCny) : '--'}</span>
          <span class="num r" style="color:${moneyColor(it && it.totalCny)}">${it && it.totalCny !== null ? fmtMoney(it.totalCny) + ' <small>' + fmtPct(it.totalPct) + '</small>' : '--'}</span>
          <button type="button" class="mini-btn danger" data-del="${esc(c)}">清除</button>
        </div>`;
      }).join('') : '<div class="empty-list">还没有持仓。在下面选一只，或者在岛上右键股票 →「编辑持仓」</div>';
    }
    // 汇总
    let today = 0, total = 0, any = false;
    for (const c of codes) { const it = items[c]; if (it) { any = true; today += it.todayCny; if (it.totalCny !== null) total += it.totalCny; } }
    $('holdTotal').innerHTML = any ? `今日 <b style="color:${moneyColor(today)}">${fmtMoney(today)}</b> · 持仓 <b style="color:${moneyColor(total)}">${fmtMoney(total)}</b>（人民币）` : '';
    // 添加下拉
    const all = Array.from(new Set(cfg.groups.flatMap((g) => g.codes))).filter((c) => !cfg.holdings[c]);
    $('holdAdd').innerHTML = '<option value="">＋ 从分组里添加一只…</option>' + all.map((c) => `<option value="${esc(c)}">${esc(nameOf(c))}  ${esc(shortCode(c))}</option>`).join('');
    $('pnlOnIsland').value = cfg.pnlOnIsland ? '1' : '0';
    $('pnlShow').value = cfg.pnlShow;
    $('fxAuto').value = cfg.fxAuto ? '1' : '0';
    if (document.activeElement !== $('fxHKD')) $('fxHKD').value = cfg.fxHKD;
    if (document.activeElement !== $('fxUSD')) $('fxUSD').value = cfg.fxUSD;
    const fx = pnlState && pnlState.fx;
    $('fxNow').textContent = fx ? `现在用的：1 港币 = ${fx.HKD.toFixed(4)}，1 美元 = ${fx.USD.toFixed(4)}${fx.auto ? '（自动）' : '（手动）'}` : '';
  }
  $('holdList').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-k]');
    if (!inp) return;
    const c = inp.closest('.hold-row').dataset.c;
    const h = Object.assign({}, cfg.holdings[c]);
    const n = parseFloat(inp.value);
    h[inp.dataset.k] = Number.isFinite(n) && n > 0 ? n : 0;
    const next = Object.assign({}, cfg.holdings, { [c]: h });
    if (!(h.qty > 0)) delete next[c];
    inp.blur();
    save({ holdings: next });
  });
  $('holdList').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
  $('holdList').addEventListener('focusout', (e) => { if (e.target.matches('input')) setTimeout(() => { if (!document.activeElement.closest('#holdList')) renderHoldings(); }, 0); });
  $('holdList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const next = Object.assign({}, cfg.holdings);
    delete next[b.dataset.del];
    save({ holdings: next });
  });
  $('holdAdd').addEventListener('change', () => {
    const c = $('holdAdd').value;
    if (!c) return;
    save({ holdings: Object.assign({}, cfg.holdings, { [c]: { qty: 100, cost: 0 } }) }).then(() => {
      const inp = document.querySelector(`#holdList .hold-row[data-c="${c}"] input[data-k="qty"]`);
      if (inp) { inp.focus(); inp.select(); }
    });
  });
  $('pnlOnIsland').addEventListener('change', () => save({ pnlOnIsland: $('pnlOnIsland').value === '1' }));
  $('pnlShow').addEventListener('change', () => save({ pnlShow: $('pnlShow').value }));
  $('fxAuto').addEventListener('change', () => save({ fxAuto: $('fxAuto').value === '1' }));
  $('fxHKD').addEventListener('change', () => save({ fxHKD: Number($('fxHKD').value) }));
  $('fxUSD').addEventListener('change', () => save({ fxUSD: Number($('fxUSD').value) }));
  if (api.getPnl) {
    api.getPnl().then((p) => { pnlState = p; if (cfg) renderHoldings(); });
    api.onPnl((p) => { pnlState = p; if (cfg) renderHoldings(); });
  }

  // ---------- 低调模式 ----------
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  let stealthOn = false;
  function renderStealth() {
    $('stealth').value = cfg.stealth ? '1' : '0';
    if (document.activeElement !== $('stealthKey')) $('stealthKey').value = cfg.stealthKey;
    $('stealthOpacity').value = cfg.stealthOpacity;
    $('stealthOpacityVal').textContent = Math.round(cfg.stealthOpacity * 100) + '%';
    $('stealthSchedule').value = cfg.stealthSchedule ? '1' : '0';
    if (document.activeElement !== $('stealthStart')) $('stealthStart').value = cfg.stealthStart;
    if (document.activeElement !== $('stealthEnd')) $('stealthEnd').value = cfg.stealthEnd;
    $('stealthDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="day" data-d="${d}" aria-pressed="${cfg.stealthDays.includes(d)}">${WEEK[d]}</button>`).join('');
    $('hideInCapture').value = cfg.hideInCapture ? '1' : '0';
    $('lowMemory').value = cfg.lowMemory ? '1' : '0';
    $('hideOnFullscreen').value = cfg.hideOnFullscreen ? '1' : '0';
    renderDisplays();
    $('stealthNow').textContent = '现在：' + (stealthOn ? '已开启' : '未开启');
  }
  $('stealth').addEventListener('change', () => save({ stealth: $('stealth').value === '1' }));
  $('stealthKey').addEventListener('change', () => save({ stealthKey: $('stealthKey').value.trim() }));
  $('stealthOpacity').addEventListener('input', () => save({ stealthOpacity: Number($('stealthOpacity').value) }));
  $('stealthSchedule').addEventListener('change', () => save({ stealthSchedule: $('stealthSchedule').value === '1' }));
  $('stealthStart').addEventListener('change', () => save({ stealthStart: $('stealthStart').value }));
  $('stealthEnd').addEventListener('change', () => save({ stealthEnd: $('stealthEnd').value }));
  $('stealthDays').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const d = Number(b.dataset.d);
    const days = cfg.stealthDays.includes(d) ? cfg.stealthDays.filter((x) => x !== d) : cfg.stealthDays.concat([d]);
    save({ stealthDays: days });
  });
  $('hideInCapture').addEventListener('change', () => save({ hideInCapture: $('hideInCapture').value === '1' }));
  $('lowMemory').addEventListener('change', () => save({ lowMemory: $('lowMemory').value === '1' }));
  $('hideOnFullscreen').addEventListener('change', () => save({ hideOnFullscreen: $('hideOnFullscreen').value === '1' }));
  // 显示器：只有一块屏幕时不显示这一项
  let displays = [];
  function renderDisplays() {
    $('displayRow').style.display = displays.length > 1 ? '' : 'none';
    $('display').innerHTML = '<option value="primary">跟随主屏幕</option>' + displays.map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
    $('display').value = displays.some((d) => d.id === cfg.display) ? cfg.display : 'primary';
  }
  $('display').addEventListener('change', () => save({ display: $('display').value }));
  if (api.getDisplays) {
    const loadDisplays = () => api.getDisplays().then((d) => { displays = d || []; if (cfg) renderDisplays(); });
    loadDisplays();
    window.addEventListener('focus', loadDisplays);
  }
  if (api.getStealth) {
    api.getStealth().then((on) => { stealthOn = !!on; if (cfg) renderStealth(); });
    api.onStealth((on) => { stealthOn = !!on; if (cfg) renderStealth(); });
  }

  // ---------- 关于：内存 ----------
  async function renderMemory() {
    if (!api.memory || !document.querySelector('.page[data-section="about"].active')) return;
    const m = await api.memory();
    if (m) $('memNow').textContent = `${m.totalMB} MB（${m.processes} 个进程${m.gpu ? '，含 GPU 进程 ' + m.gpu + ' MB' : ''}${m.native ? '，原生小助手 ' + m.native + ' MB' : ''}）`;
  }
  setInterval(renderMemory, 3000);

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
  // ---------- 左侧菜单 ----------
  const SECTIONS = ['general', 'stock', 'alerts', 'holdings', 'stealth', 'look', 'music', 'notify', 'mail', 'clip', 'todo', 'about'];
  function showSection(name) {
    if (!SECTIONS.includes(name)) name = 'general';
    document.querySelectorAll('#navList button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.section === name)));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.dataset.section === name));
    $('results').classList.remove('show');
    try { localStorage.setItem('peek.settings.section', name); } catch (e) { /* ignore */ }
    if (name === 'about') setTimeout(renderMemory, 0);
    document.querySelector('.main').scrollTop = 0;
  }
  $('navList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-section]');
    if (b) showSection(b.dataset.section);
  });
  // 上下方向键在菜单里切换
  $('navList').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = Array.from(document.querySelectorAll('#navList button'));
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const next = btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length];
    next.focus();
    showSection(next.dataset.section);
    e.preventDefault();
  });

  // 需要用户处理的地方，在菜单上加个红点
  function renderNavDots() {
    const need = {
      notify: !!(cfg && cfg.notify && notifyStatus && ['denied', 'unspecified'].includes(notifyStatus.status)),
      mail: Object.values(mail.status || {}).some((s) => s && s.state === 'error'),
      general: shortcuts.bossKey && shortcuts.bossKey !== 'ok',
      clip: shortcuts.clipKey && shortcuts.clipKey !== 'ok',
      todo: shortcuts.todoKey && shortcuts.todoKey !== 'ok',
      stealth: shortcuts.stealthKey && shortcuts.stealthKey !== 'ok'
    };
    document.querySelectorAll('#navList button').forEach((b) => {
      let dot = b.querySelector('.dot');
      const on = !!need[b.dataset.section];
      if (on && !dot) { dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-label', '需要处理'); b.appendChild(dot); }
      if (!on && dot) dot.remove();
    });
  }
  setInterval(renderNavDots, 1000);

  // 开机自启、版本号、打开仓库
  if (api.getLoginItem) {
    api.getLoginItem().then((on) => { $('loginItem').value = on ? '1' : '0'; });
    $('loginItem').addEventListener('change', async () => {
      const on = await api.setLoginItem($('loginItem').value === '1');
      $('loginItem').value = on ? '1' : '0';
    });
  }
  if (api.appInfo) api.appInfo().then((info) => { $('appVersion').textContent = info.version; });
  $('openRepo').addEventListener('click', () => api.openLink('https://github.com/naolen/peek-island'));
  // 检查更新
  let updateUrl = null;
  $('checkUpdate').addEventListener('click', async () => {
    const btn = $('checkUpdate');
    if (updateUrl) { api.openLink(updateUrl); return; }
    btn.disabled = true;
    $('updateHint').textContent = '正在检查…';
    const r = await api.checkUpdate().catch(() => null);
    btn.disabled = false;
    if (!r || !r.ok) $('updateHint').textContent = '检查失败：' + ((r && r.error) || '连不上 GitHub') + '。可以直接打开仓库的 Releases 页面看';
    else if (r.newer) { $('updateHint').textContent = `有新版本 ${r.latest}（当前 ${r.current}）`; btn.textContent = '去下载'; btn.classList.add('primary'); updateUrl = r.url; }
    else $('updateHint').textContent = `已经是最新版本（${r.current}）`;
  });
  $('openLog').addEventListener('click', () => api.openFolder('log'));
  $('openData').addEventListener('click', () => api.openFolder('data'));
  // 恢复默认：要点两次
  let resetArmed = null;
  $('resetConfig').addEventListener('click', async () => {
    const btn = $('resetConfig');
    if (!resetArmed) {
      btn.textContent = '再点一次确认';
      btn.classList.add('danger');
      resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = '恢复默认'; btn.classList.remove('danger'); }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    btn.classList.remove('danger');
    await api.resetConfig();
    btn.textContent = '已恢复';
    setTimeout(() => { btn.textContent = '恢复默认'; }, 2000);
  });
  if (api.onSettingsSection) api.onSettingsSection((s) => showSection(s));

  let initial = 'general';
  try { initial = localStorage.getItem('peek.settings.section') || 'general'; } catch (e) { /* ignore */ }
  showSection(initial);

  init();
})();
