// 岛的界面逻辑：光带 ⇄ 岛 ⇄ 展开，三种形态是同一个元素在变形。
(() => {
  'use strict';

  const api = window.peek;
  const $ = (id) => document.getElementById(id);
  const hot = $('hot'), morph = $('morph'), segsEl = $('segs'), tickerEl = $('ticker'), panel = $('panel');
  const bubble = $('bubble');

  const SESSION_POINTS = { a: 241, hk: 331, us: 391 };
  const SESSION_TICKS = {
    a: [[0, '09:30'], [0.25, '10:30'], [0.5, '11:30/13:00'], [0.75, '14:00'], [1, '15:00']],
    hk: [[0, '09:30'], [150 / 330, '12:00/13:00'], [270 / 330, '15:00'], [1, '16:00']],
    us: [[0, '09:30'], [150 / 390, '12:00'], [270 / 390, '14:00'], [1, '16:00']]
  };
  const W = 564, H = 190, VH = 36;
  const SIZES = { strip: [400, 4, 4], island: [340, 36, 18] };

  const st = {
    cfg: null,
    quotes: {},
    online: true,
    hover: false,
    open: false,
    sel: 0,
    tIdx: 0,
    hot: null,          // 悬停中的光带段序号，或 'ticker'
    cross: -1,
    inside: false,
    segKey: '',
    minute: {},         // code -> { at, data }
    page: 'stock',      // 展开面板当前页：stock / music
    media: { active: false, available: false },
    level: 0,
    lastPlayingAt: 0
  };
  const VIZ_BARS = 36;
  const levels = new Array(VIZ_BARS).fill(0);
  // 暂停超过这么久就不再在岛上显示音乐
  const PAUSE_HIDE_MS = 5 * 60 * 1000;
  let hoverTimer = null, leaveTimer = null, rotateTimer = null, resetTimer = null, minuteTimer = null;
  let lastWheel = 0;

  // ---------- 工具 ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const marketOf = (code) => /^hk/.test(code) ? 'hk' : /^us/.test(code) ? 'us' : 'a';
  const fmtP = (n) => n == null ? '--' : n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 });
  const fmtPct = (n) => n == null ? '--' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const upColor = () => st.cfg.redUp ? '#FF5B5B' : '#2FD27A';
  const downColor = () => st.cfg.redUp ? '#2FD27A' : '#FF5B5B';
  const colorOf = (pct) => pct == null ? '#9A9AA2' : pct >= 0 ? upColor() : downColor();
  const tintOf = (pct) => {
    const c = colorOf(pct);
    return c === '#FF5B5B' ? 'rgba(255,91,91,.16)' : c === '#2FD27A' ? 'rgba(47,210,122,.16)' : 'rgba(255,255,255,.08)';
  };

  function group() { return st.cfg.groups[st.cfg.activeGroup] || st.cfg.groups[0]; }
  function stocks() {
    return group().codes.map((code) => {
      const q = st.quotes[code];
      return q ? q : { code, name: code.replace(/^(sh|sz|bj|hk|us)/, ''), price: null, pct: null, prevClose: null };
    });
  }

  // ---------- 形态 ----------
  function form() {
    if (st.open) return 'panel';
    if (msg.alert) return 'alert';
    if (st.cfg.mode === 'pinned') return 'island';
    if (st.cfg.mode === 'auto' && st.hover) return 'island';
    return 'strip';
  }

  function islandWidth() { return SIZES.island[0] + (musicActive() ? 76 : 0) + (msg.unread > 0 ? 48 : 0); }

  let lastForm = 'strip', formChangedAt = 0;
  function applyForm() {
    const f = form();
    if (f !== lastForm) { lastForm = f; formChangedAt = Date.now(); }
    morph.dataset.form = f;
    hot.classList.toggle('has-body', f !== 'strip');
    let w, h, r;
    if (f === 'panel') { w = 600; h = panel.offsetHeight; r = 30; }
    else if (f === 'alert') { w = 420; h = 64; r = 32; }
    else if (f === 'island') { [, h, r] = SIZES.island; w = islandWidth(); }
    else [w, h, r] = SIZES[f];
    morph.style.width = w + 'px';
    morph.style.height = h + 'px';
    morph.style.borderRadius = (Number(st.cfg.topOffset) || 0) > 0 ? `${r}px` : `0 0 ${r}px ${r}px`;
    if (f !== 'strip' && (typeof st.hot === 'number' || st.hot === 'musicSeg')) st.hot = null;
    if (f === 'panel') st.hot = null;
    renderBubble();
    for (const el of segsEl.children) el.classList.toggle('hot', f === 'strip' && st.hot === Number(el.dataset.i));
    $('musicSeg').classList.toggle('hot', f === 'strip' && st.hot === 'musicSeg');
  }

  // ---------- 光带 ----------
  function renderSegments() {
    const list = stocks();
    const key = st.cfg.activeGroup + ':' + list.map((s) => s.code).join(',');
    if (key !== st.segKey) {
      st.segKey = key;
      segsEl.innerHTML = list.map((s, i) => `<button type="button" class="seg-item" data-i="${i}" aria-label="${esc(s.name)}"><span class="light"></span></button>`).join('');
    }
    list.forEach((s, i) => {
      const el = segsEl.children[i];
      if (!el) return;
      const m = Math.abs(s.pct || 0);
      el.style.setProperty('--c', colorOf(s.pct));
      el.style.setProperty('--o', (0.35 + Math.min(m, 5) / 5 * 0.65).toFixed(2));
      el.classList.toggle('breathe', m >= st.cfg.breatheAbove);
      el.setAttribute('aria-label', `${s.name} ${fmtPct(s.pct)}`);
    });
  }

  // ---------- 岛：竖向轮播 ----------
  function renderTicker() {
    const list = stocks();
    if (!list.length) {
      tickerEl.innerHTML = '<span class="tick-row"><span class="tick-name" style="color:#A9AEB6">这个分组还没有股票</span></span>';
      $('tickDot').style.background = '#9A9AA2';
    } else {
      const rows = list.concat([list[0]]);
      tickerEl.innerHTML = rows.map((s) => `<span class="tick-row"><span class="tick-name">${esc(s.name)}</span><span class="num tick-price">${fmtP(s.price)}</span><span class="num tick-pct" style="color:${colorOf(s.pct)}">${fmtPct(s.pct)}</span></span>`).join('');
      $('tickDot').style.background = colorOf(list[st.tIdx % list.length].pct);
    }
    tickerEl.style.transform = `translateY(-${st.tIdx * 28}px)`;
    $('islandGroup').textContent = group().name;
  }

  function startRotation() {
    clearInterval(rotateTimer);
    rotateTimer = setInterval(() => {
      const n = stocks().length;
      if (n < 2 || st.open || st.hot === 'ticker') return;
      st.tIdx += 1;
      tickerEl.classList.add('anim');
      tickerEl.style.transform = `translateY(-${st.tIdx * 28}px)`;
      $('tickDot').style.background = colorOf(stocks()[st.tIdx % n].pct);
      if (st.tIdx >= n) {
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          tickerEl.classList.remove('anim');
          st.tIdx = 0;
          tickerEl.style.transform = 'translateY(0)';
        }, 580);
      }
    }, st.cfg.rotateMs);
  }

  // ---------- 气泡 ----------
  function renderBubble() {
    renderMusicBubble();
    const f = form();
    let s = null, x = 0, top = 22;
    if (f === 'strip' && typeof st.hot === 'number') {
      s = stocks()[st.hot];
      const el = segsEl.children[st.hot];
      if (el) x = el.offsetLeft + el.offsetWidth / 2;
    } else if (f === 'island' && st.hot === 'ticker') {
      const list = stocks();
      s = list.length ? list[st.tIdx % list.length] : null;
      const tz = $('tickerZone');
      x = tz.offsetLeft + tz.offsetWidth / 2;
      top = 44;
    }
    if (!s) { bubble.classList.remove('show'); return; }
    bubble.style.left = x + 'px';
    bubble.style.top = top + 'px';
    $('bName').textContent = s.name;
    $('bPrice').textContent = fmtP(s.price);
    $('bPct').textContent = (s.pct >= 0 ? '▲ ' : '▼ ') + fmtPct(s.pct);
    $('bPct').style.color = colorOf(s.pct);
    drawMini(s);
    bubble.classList.add('show');
  }

  function drawMini(s) {
    const svg = $('bMini');
    const data = st.minute[s.code] && st.minute[s.code].data;
    if (!data) {
      svg.innerHTML = '<line x1="0" y1="17" x2="170" y2="17" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/>';
      loadMinute(s.code).then(() => { if (bubble.classList.contains('show')) drawMiniIfSame(s.code); });
      return;
    }
    const n = SESSION_POINTS[marketOf(s.code)];
    const pc = data.prevClose;
    const range = Math.max(0.6, ...data.points.map((p) => Math.abs((p.price - pc) / pc * 100))) * 1.1;
    const pts = data.points.map((p, i) => `${(i / (n - 1) * 170).toFixed(1)},${(17 - ((p.price - pc) / pc * 100) / range * 15).toFixed(1)}`).join(' ');
    svg.innerHTML = `<line x1="0" y1="17" x2="170" y2="17" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/><polyline points="${pts}" fill="none" stroke="${colorOf(s.pct)}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  function drawMiniIfSame(code) {
    const f = form();
    const list = stocks();
    const s = f === 'strip' && typeof st.hot === 'number' ? list[st.hot] : f === 'island' && st.hot === 'ticker' ? list[st.tIdx % list.length] : null;
    if (s && s.code === code) drawMini(s);
  }

  async function loadMinute(code, force) {
    const c = st.minute[code];
    if (!force && c && Date.now() - c.at < 30000) return c.data;
    if (c && c.loading) return c.loading;
    const p = api.getMinute(code).then((data) => {
      st.minute[code] = { at: Date.now(), data };
      return data;
    }).catch(() => { st.minute[code] = { at: Date.now(), data: null }; return null; });
    st.minute[code] = Object.assign({}, c || { at: 0, data: null }, { loading: p });
    return p;
  }

  // ---------- 音乐 ----------
  const APP_NAMES = [
    [/qqmusic/i, 'QQ 音乐'], [/cloudmusic|netease/i, '网易云音乐'], [/spotify/i, 'Spotify'], [/kugou/i, '酷狗音乐'],
    [/kwmusic|kuwo/i, '酷我音乐'], [/applemusic|apple\.music/i, 'Apple Music'], [/msedge/i, 'Edge 浏览器'],
    [/chrome/i, 'Chrome 浏览器'], [/firefox/i, 'Firefox 浏览器'], [/zunemusic|music\.ui|mediaplayer/i, '媒体播放器'],
    [/potplayer/i, 'PotPlayer'], [/foobar/i, 'foobar2000'], [/bilibili/i, '哔哩哔哩']
  ];
  const NOTE_SVG = '<svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const PLAY_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  const PAUSE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  function appName(id) {
    if (!id) return '';
    for (const [re, name] of APP_NAMES) if (re.test(id)) return name;
    return id.replace(/\.exe$/i, '').replace(/^.*[\\/!]/, '');
  }
  const isPlaying = () => st.media.active && st.media.status === 'playing';
  function musicActive() {
    const m = st.media;
    if (!st.cfg || st.cfg.music === false || !m.active || !(m.title || m.artist)) return false;
    if (m.status === 'playing') return true;
    return m.status === 'paused' && Date.now() - st.lastPlayingAt < PAUSE_HIDE_MS;
  }
  function setCover(el, thumb) {
    const url = thumb && /^data:image\//.test(thumb) ? thumb : '';
    if (el.dataset.src === url) return;
    el.dataset.src = url;
    el.style.backgroundImage = url ? `url("${url}")` : '';
    el.innerHTML = url ? '' : NOTE_SVG;
  }
  function fmtTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function mediaPosition() {
    const m = st.media;
    let pos = m.position || 0;
    if (m.status === 'playing') {
      // 用系统给的“进度更新时间”往后推算；有的播放器这个时间不准，就用收到消息的时间
      const base = m.updatedAt && Math.abs(Date.now() - m.updatedAt) < 6 * 3600 * 1000 ? m.updatedAt : m.receivedAt;
      if (base) pos += (Date.now() - base) / 1000;
    }
    return m.duration > 0 ? Math.min(pos, m.duration) : pos;
  }

  function renderMusic() {
    const m = st.media;
    const active = musicActive();
    const wasActive = document.body.classList.contains('has-music');
    document.body.classList.toggle('has-music', active);
    const playing = isPlaying();

    // 光带上的音乐段 / 岛上的音乐区
    $('musicSeg').setAttribute('aria-label', active ? `正在播放：${m.title} ${m.artist || ''}` : '音乐');
    setCover($('mzThumb'), m.thumb);
    $('mzThumb').classList.toggle('spin', playing);
    if (!playing) setLevel(0);

    // 音乐页
    const page = $('musicPage');
    page.classList.toggle('empty', !m.active || !(m.title || m.artist));
    if (m.active) {
      setCover($('mCover'), m.thumb);
      $('mTitle').textContent = m.title || '未知曲目';
      $('mArtist').textContent = [m.artist, m.album].filter(Boolean).join(' · ') || ' ';
      $('mApp').textContent = '来自 ' + appName(m.app);
      $('mPrev').disabled = m.canPrev === false;
      $('mNext').disabled = m.canNext === false;
      $('mToggle').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
      $('mToggle').setAttribute('aria-label', playing ? '暂停' : '播放');
    }
    renderProgress();
    if (wasActive !== active) applyForm();
    else if (form() === 'panel') morph.style.height = panel.offsetHeight + 'px';
    renderMusicBubble();
  }

  function renderProgress() {
    const m = st.media;
    const pos = mediaPosition();
    $('mPos').textContent = fmtTime(pos);
    $('mDur').textContent = m.duration > 0 ? fmtTime(m.duration) : '--:--';
    $('mBar').style.width = m.duration > 0 ? (pos / m.duration * 100).toFixed(2) + '%' : '0%';
  }

  // 音量峰值 → 岛上的 4 根音律条、光带音乐段的亮度、音乐页的波形
  const EQ_SHAPE = [0.62, 1, 0.78, 0.9];
  function setLevel(peak) {
    st.level = peak;
    const t = Date.now() / 160;
    $('mzEq').querySelectorAll('i').forEach((el, i) => {
      const wobble = 0.75 + 0.25 * Math.sin(t + i * 1.7);
      el.style.transform = `scaleY(${Math.max(0.18, Math.min(1, peak * 1.6 * EQ_SHAPE[i] * wobble)).toFixed(3)})`;
    });
    const seg = $('musicSeg');
    seg.style.setProperty('--o', (0.3 + Math.min(1, peak * 1.4) * 0.7).toFixed(2));
    levels.push(peak);
    levels.shift();
    if (form() === 'panel' && st.page === 'music') {
      const viz = $('mViz');
      if (viz.children.length !== VIZ_BARS) viz.innerHTML = '<i></i>'.repeat(VIZ_BARS);
      for (let i = 0; i < VIZ_BARS; i++) {
        viz.children[i].style.transform = `scaleY(${Math.max(0.06, Math.min(1, levels[i] * 1.5)).toFixed(3)})`;
      }
    }
  }

  function renderMusicBubble() {
    const mb = $('mBubble');
    const f = form();
    const show = musicActive() && ((f === 'strip' && st.hot === 'musicSeg') || (f === 'island' && st.hot === 'musicZone'));
    if (!show) { mb.classList.remove('show'); return; }
    const el = f === 'strip' ? $('musicSeg') : $('musicZone');
    // 音乐区贴在右侧：按“离右边多远”来算，岛还在变宽变窄时位置也是对的
    const parentW = el.offsetParent ? el.offsetParent.offsetWidth : 0;
    const fromRight = parentW - (el.offsetLeft + el.offsetWidth / 2);
    const targetW = f === 'strip' ? SIZES.strip[0] : islandWidth();
    mb.style.left = (targetW - fromRight) + 'px';
    mb.style.top = (f === 'strip' ? 22 : 44) + 'px';
    setCover($('mbThumb'), st.media.thumb);
    $('mbTitle').textContent = st.media.title || '未知曲目';
    $('mbArtist').textContent = (st.media.artist ? st.media.artist + ' · ' : '') + appName(st.media.app) + (isPlaying() ? '' : ' · 已暂停');
    mb.classList.add('show');
  }

  function onMedia(m) {
    st.media = m || { active: false };
    if (isPlaying()) st.lastPlayingAt = Date.now();
    renderMusic();
  }

  // ---------- 展开面板 ----------
  const PAGES = ['stock', 'music', 'clip', 'todo', 'msg'];
  const INPUT_PAGES = ['clip', 'todo'];
  function setPage(page) {
    if (!PAGES.includes(page)) page = 'stock';
    st.page = page;
    panel.dataset.page = page;
    document.querySelectorAll('#pageTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === page)));
    document.querySelector('.pages-thumb').style.left = (3 + PAGES.indexOf(page) * 64) + 'px';
    if (page === 'music') renderMusic();
    if (page === 'clip') loadClips();
    if (page === 'todo') loadTodo();
    if (page === 'msg') loadMsgs(true);
    syncFocus();
    if (st.cfg) renderFoot();
    fitPanel();
  }
  /** 面板内容变化后，让岛的高度跟着变 */
  function fitPanel() {
    if (form() === 'panel') morph.style.height = panel.offsetHeight + 'px';
  }
  /**
   * 面板展开时让窗口拿到焦点：这样点到任何别的地方（其他软件、桌面）窗口会失去焦点，面板随之收起；
   * 剪贴板 / 待办页也需要焦点才能打字。面板收起后立刻还回焦点，平时完全不抢焦点。
   */
  let focusOn = false;
  function syncFocus() {
    const want = st.open;
    if (want === focusOn) return;
    focusOn = want;
    api.setFocus(want);
  }
  function isTyping() {
    const a = document.activeElement;
    return !!(a && panel.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
  }

  function renderPanel() {
    const cfg = st.cfg;
    $('groupTabs').innerHTML = cfg.groups.map((g, i) => `<button type="button" class="tab" role="tab" data-g="${i}" aria-selected="${i === cfg.activeGroup}">${esc(g.name)}<span class="cnt num">${g.codes.length}</span></button>`).join('');
    const modes = ['strip', 'auto', 'pinned'];
    const mi = Math.max(0, modes.indexOf(cfg.mode));
    document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === cfg.mode)));
    document.querySelector('.seg-thumb').style.left = (3 + mi * 46) + 'px';

    const list = stocks();
    if (!list.length) {
      $('curName').textContent = '这个分组还没有股票';
      $('curSub').textContent = '点右上角 ≡ 打开设置添加';
      $('curPrice').textContent = '';
      $('curPct').textContent = '';
      $('curPct').style.background = 'transparent';
      $('chips').innerHTML = '';
      $('chartSvg').innerHTML = ''; $('volSvg').innerHTML = ''; $('timeAxis').innerHTML = '';
      $('chartEmpty').textContent = '';
      ['axHi', 'axMid', 'axLo', 'axHiP', 'axLoP'].forEach((id) => { $(id).textContent = ''; });
    } else {
      st.sel = Math.min(st.sel, list.length - 1);
      $('chips').innerHTML = list.map((s, i) => `<button type="button" class="chip" data-i="${i}" aria-pressed="${i === st.sel}"><span class="n">${esc(s.name)}</span><span class="p num" style="color:${colorOf(s.pct)}">${fmtPct(s.pct)}</span></button>`).join('');
      renderChart();
    }
    renderFoot();
    if (form() === 'panel') morph.style.height = panel.offsetHeight + 'px';
  }

  const keyName = (k) => String(k || '').replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');
  function renderFoot() {
    const cfg = st.cfg;
    const foot = $('foot');
    const offline = st.page === 'stock' && !st.online;
    foot.classList.toggle('offline', offline);
    const boss = `${keyName(cfg.bossKey)} 一键隐藏`;
    foot.textContent = offline ? '行情连接中断，正在重试…'
      : st.page === 'stock' ? `数据来自东方财富，可能有延迟 · ${boss}`
      : st.page === 'music' ? `支持所有接入系统媒体控制的播放器 · ${boss}`
      : st.page === 'clip' ? `${keyName(cfg.clipKey)} 随时唤出 · 点一条即复制，回车复制第一条 · Esc 收起`
      : st.page === 'msg' ? '消息只保存在内存里，退出余光后清空'
      : `${keyName(cfg.todoKey)} 随时唤出 · 点文字可修改 · Esc 收起`;
  }

  function renderChart() {
    const s = stocks()[st.sel];
    if (!s) return;
    const data = st.minute[s.code] && st.minute[s.code].data;
    const mk = marketOf(s.code);
    $('timeAxis').innerHTML = SESSION_TICKS[mk].map(([p, t]) => `<span style="left:${(p * 100).toFixed(2)}%">${t}</span>`).join('');
    $('curSub').textContent = s.code.replace(/^(sh|sz|bj|hk|us)/, '').toUpperCase() + ' · ' + (st.cross >= 0 && data ? data.points[st.cross].t : (data ? '最新' : '实时'));
    $('curName').textContent = s.name;

    if (!data) {
      $('chartSvg').innerHTML = ''; $('volSvg').innerHTML = '';
      $('chartEmpty').textContent = st.minute[s.code] && !st.minute[s.code].loading ? '暂无分时数据（可能未开盘）' : '加载中…';
      ['axHi', 'axMid', 'axLo', 'axHiP', 'axLoP'].forEach((id) => { $(id).textContent = ''; });
      setHeadline(s.price, s.pct);
      return;
    }
    $('chartEmpty').textContent = '';
    const n = SESSION_POINTS[mk];
    const pc = data.prevClose;
    const pctOf = (v) => (v - pc) / pc * 100;
    const range = Math.max(0.6, ...data.points.map((p) => Math.abs(pctOf(p.price)))) * 1.12;
    const mid = H / 2;
    const xOf = (i) => i / (n - 1) * W;
    const yOf = (v) => mid - pctOf(v) / range * (mid - 6);
    const line = data.points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.price).toFixed(1)}`).join(' ');
    const lastX = xOf(data.points.length - 1).toFixed(1);
    const avg = data.points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.avg).toFixed(1)}`).join(' ');
    const c = colorOf(pctOf(data.points[data.points.length - 1].price));
    $('chartSvg').innerHTML =
      `<line x1="0" y1="${H / 4}" x2="${W}" y2="${H / 4}" stroke="rgba(255,255,255,.06)"/>` +
      `<line x1="0" y1="${H * 3 / 4}" x2="${W}" y2="${H * 3 / 4}" stroke="rgba(255,255,255,.06)"/>` +
      `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="rgba(255,255,255,.08)"/>` +
      `<line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="rgba(255,255,255,.3)" stroke-dasharray="4 4"/>` +
      `<polygon points="0,${mid} ${line} ${lastX},${mid}" fill="${c}" fill-opacity=".14"/>` +
      `<polyline points="${avg}" fill="none" stroke="#FFC26B" stroke-width="1.2" stroke-opacity=".9"/>` +
      `<polyline points="${line}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`;
    $('axHi').textContent = fmtP(pc * (1 + range / 100)); $('axHi').style.color = upColor();
    $('axMid').textContent = fmtP(pc);
    $('axLo').textContent = fmtP(pc * (1 - range / 100)); $('axLo').style.color = downColor();
    $('axHiP').textContent = '+' + range.toFixed(2) + '%'; $('axHiP').style.color = upColor();
    $('axLoP').textContent = '-' + range.toFixed(2) + '%'; $('axLoP').style.color = downColor();

    // 成交量：把每分钟的量合并成 60 根柱子
    const buckets = 60, per = (n - 1) / buckets;
    const vols = new Array(buckets).fill(0), dirs = new Array(buckets).fill(0);
    data.points.forEach((p, i) => {
      const b = Math.min(buckets - 1, Math.floor(i / per));
      vols[b] += p.vol;
      const prev = i ? data.points[i - 1].price : pc;
      dirs[b] += p.price - prev;
    });
    const vMax = Math.max(1, ...vols);
    const bw = W / buckets;
    $('volSvg').innerHTML = vols.map((v, b) => {
      if (!v) return '';
      const h = Math.max(1, v / vMax * (VH - 2));
      return `<rect x="${(b * bw + 1).toFixed(1)}" y="${(VH - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${dirs[b] >= 0 ? upColor() : downColor()}" fill-opacity=".55"/>`;
    }).join('');

    // 十字光标
    const chart = $('chart');
    if (st.cross >= 0 && st.cross < data.points.length) {
      const p = data.points[st.cross];
      chart.classList.add('crossing');
      $('crossLine').style.left = (st.cross / (n - 1) * 100) + '%';
      $('crossDot').style.left = (st.cross / (n - 1) * 100) + '%';
      $('crossDot').style.top = (yOf(p.price) / H * 100) + '%';
      $('crossDot').style.background = c;
      setHeadline(p.price, pctOf(p.price));
    } else {
      chart.classList.remove('crossing');
      setHeadline(s.price, s.pct);
    }
  }

  function setHeadline(price, pct) {
    $('curPrice').textContent = fmtP(price);
    $('curPrice').style.color = colorOf(pct);
    $('curPct').textContent = fmtPct(pct);
    $('curPct').style.color = colorOf(pct);
    $('curPct').style.background = tintOf(pct);
  }

  async function refreshSelectedMinute(force) {
    const s = stocks()[st.sel];
    if (!s) return;
    renderChart();
    await loadMinute(s.code, force);
    if (st.open && stocks()[st.sel] && stocks()[st.sel].code === s.code) renderChart();
  }

  // ---------- 交互 ----------
  function openPanel(sel, page) {
    st.open = true;
    st.hot = null;
    st.cross = -1;
    if (typeof sel === 'number') st.sel = sel;
    setPage(page || 'stock');
    renderPanel();
    applyForm();
    syncFocus();
    refreshSelectedMinute(false);
    clearInterval(minuteTimer);
    minuteTimer = setInterval(() => { if (st.open) refreshSelectedMinute(true); }, 30000);
  }
  function closePanel() {
    st.open = false;
    clearInterval(minuteTimer);
    if (isTyping()) document.activeElement.blur();
    applyForm();
    syncFocus();
  }

  function switchGroup(i) {
    const n = st.cfg.groups.length;
    i = ((i % n) + n) % n;
    if (i === st.cfg.activeGroup) return;
    const body = $('panelBody');
    body.classList.add('out');
    segsEl.style.opacity = '0.2';
    setTimeout(() => {
      st.cfg.activeGroup = i;
      st.sel = 0; st.tIdx = 0; st.cross = -1;
      tickerEl.classList.remove('anim');
      renderAll();
      if (st.open) refreshSelectedMinute(false);
      body.classList.remove('out');
      segsEl.style.opacity = '';
      api.setConfig({ activeGroup: i });
    }, 160);
  }

  function onEnter() {
    clearTimeout(leaveTimer);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { st.hover = true; applyForm(); }, 150);
  }
  function onLeave() {
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      // 正在面板里打字时，鼠标移开不收起（按 Esc 或点别处才收）
      if (st.open && isTyping()) return;
      st.hover = false;
      st.hot = null;
      if (st.open) closePanel(); else applyForm();
    }, st.cfg.collapseDelayMs);
  }

  // 鼠标是否在岛上：在岛上时接收点击，不在时把点击穿透给下面的软件
  function trackPointer(target) {
    const inside = !!(target && target.closest && target.closest('.interactive'));
    if (inside === st.inside) return;
    st.inside = inside;
    api.setIgnoreMouse(!inside);
    if (inside) onEnter(); else onLeave();
  }
  document.addEventListener('mousemove', (e) => trackPointer(e.target));
  document.addEventListener('mouseleave', () => trackPointer(null));

  // ---------- 悬停意图：鼠标停够一会儿才弹气泡 ----------
  // 光带刚长成岛的那一下，鼠标是“被动”落在岛上的，不算悬停；要再停 0.55 秒才弹出
  const HOVER_DELAY = 550;
  let intentTimer = null;
  function hoverIntent(key, delay) {
    clearTimeout(intentTimer);
    // 已经有气泡在显示时（比如沿光带滑过几只股票），直接切换，不再等
    if (st.hot !== null && st.hot !== key && (typeof st.hot === typeof key)) { st.hot = key; applyForm(); return; }
    intentTimer = setTimeout(function fire() {
      const settle = 600 - (Date.now() - formChangedAt);
      if (settle > 0) { intentTimer = setTimeout(fire, settle); return; }
      st.hot = key;
      applyForm();
    }, delay);
  }
  function hoverOut(key) {
    clearTimeout(intentTimer);
    if (st.hot === key || (key === 'seg' && typeof st.hot === 'number')) { st.hot = null; applyForm(); }
  }
  // 光带上的单只股票气泡只在“光带”模式里出现；“自动”模式下光带会直接长成岛
  const stripBubbles = () => st.cfg && st.cfg.mode === 'strip';

  segsEl.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.seg-item');
    if (!el || !stripBubbles()) return;
    hoverIntent(Number(el.dataset.i), 250);
  });
  segsEl.addEventListener('mouseleave', () => hoverOut('seg'));
  segsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.seg-item');
    if (el) openPanel(Number(el.dataset.i));
  });

  const tz = $('tickerZone');
  tz.addEventListener('mouseenter', () => hoverIntent('ticker', HOVER_DELAY));
  tz.addEventListener('mouseleave', () => hoverOut('ticker'));
  tz.addEventListener('click', () => { const n = stocks().length; openPanel(n ? st.tIdx % n : 0); });

  // 变形结束后再校正一次气泡位置
  morph.addEventListener('transitionend', (e) => {
    if (e.target === morph && e.propertyName === 'width') renderBubble();
  });

  // 音乐：光带上的紫色段、岛上的右半边
  const ms = $('musicSeg');
  ms.addEventListener('mouseenter', () => { if (stripBubbles()) hoverIntent('musicSeg', 250); });
  ms.addEventListener('mouseleave', () => hoverOut('musicSeg'));
  ms.addEventListener('click', () => openPanel(undefined, 'music'));
  const mz = $('musicZone');
  mz.addEventListener('mouseenter', () => hoverIntent('musicZone', HOVER_DELAY));
  mz.addEventListener('mouseleave', () => hoverOut('musicZone'));
  mz.addEventListener('click', () => openPanel(undefined, 'music'));
  $('pageTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b) return;
    setPage(b.dataset.page);
    if (b.dataset.page === 'stock') { renderPanel(); refreshSelectedMinute(false); }
  });
  // Esc 收起；点到别的地方（本窗口失去焦点）时收起
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.open) { e.preventDefault(); closePanel(); }
  });
  let keepOpenOnBlur = false; // 导出文件时会弹出保存对话框，那时不收
  window.addEventListener('blur', () => {
    if (!st.open || keepOpenOnBlur) return;
    st.hover = false;
    clearTimeout(leaveTimer);
    closePanel();
  });
  $('mPrev').addEventListener('click', () => api.mediaCmd('prev'));
  $('mNext').addEventListener('click', () => api.mediaCmd('next'));
  $('mToggle').addEventListener('click', () => {
    // 先在界面上切换，等系统回报再校正，按下去立刻有反馈
    st.media = Object.assign({}, st.media, { status: isPlaying() ? 'paused' : 'playing', position: mediaPosition(), receivedAt: Date.now(), updatedAt: 0 });
    renderMusic();
    api.mediaCmd('toggle');
  });
  setInterval(() => {
    if (form() === 'panel' && st.page === 'music' && isPlaying()) renderProgress();
    // 暂停太久后自动从岛上收起
    if (document.body.classList.contains('has-music') && !musicActive()) renderMusic();
  }, 500);

  hot.addEventListener('wheel', (e) => {
    // 只在光带、岛的行情区、行情页上用滚轮切分组；其他页面滚轮用来滚动列表
    if (st.open && st.page !== 'stock') return;
    if (e.target.closest('#chart') || e.target.closest('#musicZone') || e.target.closest('#musicSeg')) return;
    const now = Date.now();
    if (now - lastWheel < 420) return;
    lastWheel = now;
    switchGroup(st.cfg.activeGroup + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  $('groupTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) switchGroup(Number(b.dataset.g));
  });
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    st.sel = Number(b.dataset.i);
    st.cross = -1;
    renderPanel();
    refreshSelectedMinute(false);
  });
  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) api.setConfig({ mode: b.dataset.mode });
  });
  $('btnClose').addEventListener('click', closePanel);
  // 设置按钮：按当前页面打开对应的设置页
  $('btnSettings').addEventListener('click', () => {
    const map = { stock: 'stock', music: 'music', clip: 'clip', todo: 'todo', msg: msg.kind === 'mail' ? 'mail' : 'notify' };
    const section = map[st.page] || 'general';
    st.hover = false;
    closePanel();
    api.openSettings(section);
  });

  const hit = $('chartHit');
  hit.addEventListener('mousemove', (e) => {
    const s = stocks()[st.sel];
    const data = s && st.minute[s.code] && st.minute[s.code].data;
    if (!data) return;
    const r = hit.getBoundingClientRect();
    const n = SESSION_POINTS[marketOf(s.code)];
    const i = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (n - 1));
    const ci = Math.min(i, data.points.length - 1);
    if (ci !== st.cross) { st.cross = ci; renderChart(); }
  });
  hit.addEventListener('mouseleave', () => { st.cross = -1; renderChart(); });

  // ---------- 剪贴板 ----------
  const clip = { q: '', kind: 'all', items: [], editing: null, clearArmed: 0 };
  const STAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
  const STAR_O = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
  const PEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
  const XMARK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  const UP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>';
  const DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const TICK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0E1013" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  function ago(t) {
    const d = (Date.now() - t) / 1000;
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    const dt = new Date(t), now = new Date();
    const hm = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    if (dt.toDateString() === now.toDateString()) return hm;
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日 ' + hm;
  }

  let clipSeq = 0;
  async function loadClips() {
    if (!api.clipList) return;
    const seq = ++clipSeq;
    const items = await api.clipList({ q: clip.q, kind: clip.kind });
    if (seq !== clipSeq) return;
    clip.items = items || [];
    renderClips();
  }

  function renderClips() {
    document.querySelectorAll('#clipKinds button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === clip.kind)));
    const list = $('clipList');
    list.classList.add('scroll');
    if (st.cfg.clipEnabled === false) {
      list.innerHTML = '<div class="empty-hint">剪贴板记录已关闭<br>可以在设置里打开</div>';
    } else if (!clip.items.length) {
      list.innerHTML = `<div class="empty-hint">${clip.q || clip.kind !== 'all' ? '没有找到' : '还没有记录<br>复制过的文字和图片会出现在这里'}</div>`;
    } else {
      list.innerHTML = clip.items.map((it) => {
        const body = it.type === 'image'
          ? `<span class="clip-img" style="background-image:url('${it.thumb}')"></span><span class="clip-body"><span class="clip-text">图片 ${it.width}×${it.height}</span><span class="clip-meta"><span>${ago(it.at)}</span>${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}</span></span>`
          : `<span class="clip-body"><span class="clip-text">${esc(it.text)}</span><span class="clip-meta"><span>${ago(it.at)}</span>${it.length > 600 ? `<span>${it.length} 字</span>` : ''}${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}</span></span>`;
        const editing = clip.editing === it.id;
        return `<div class="clip-row${it.fav ? ' fav' : ''}" role="listitem" data-id="${it.id}">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column">
            <button type="button" class="clip-main" data-act="copy" title="点击复制">${body}</button>
            ${editing ? `<input class="field-input note-input" data-act="note-input" maxlength="200" placeholder="写个备注，回车保存" value="${esc(it.note)}">` : ''}
          </div>
          <span class="clip-ops">
            <button type="button" class="op-btn${it.fav ? ' on' : ''}" data-act="fav" aria-label="${it.fav ? '取消收藏' : '收藏'}">${it.fav ? STAR : STAR_O}</button>
            <button type="button" class="op-btn" data-act="note" aria-label="备注">${PEN}</button>
            <button type="button" class="op-btn danger" data-act="del" aria-label="删除">${XMARK}</button>
          </span>
        </div>`;
      }).join('');
      const ni = list.querySelector('.note-input');
      if (ni) { ni.focus(); ni.select(); }
    }
    $('clipCount').textContent = clip.items.length ? `${clip.items.length} 条${clip.kind === 'all' && !clip.q ? '' : '（筛选后）'}` : '';
    fitPanel();
  }

  let clipSearchTimer = null;
  $('clipSearch').addEventListener('input', () => {
    clearTimeout(clipSearchTimer);
    clipSearchTimer = setTimeout(() => { clip.q = $('clipSearch').value; loadClips(); }, 150);
  });
  $('clipSearch').addEventListener('keydown', (e) => {
    // 回车直接复制第一条
    if (e.key === 'Enter' && clip.items[0]) { e.preventDefault(); copyClip(clip.items[0].id); }
  });
  $('clipKinds').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (b) { clip.kind = b.dataset.kind; loadClips(); }
  });
  async function copyClip(id) {
    const ok = await api.clipCopy(id);
    const row = $('clipList').querySelector(`.clip-row[data-id="${id}"]`);
    if (ok && row) {
      row.classList.add('copied');
      setTimeout(() => row.classList.remove('copied'), 900);
    }
  }
  $('clipList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.clip-row');
    if (!btn || !row) return;
    const id = row.dataset.id;
    const it = clip.items.find((x) => x.id === id);
    if (!it) return;
    const act = btn.dataset.act;
    if (act === 'copy') copyClip(id);
    else if (act === 'fav') { await api.clipUpdate(id, { fav: !it.fav }); }
    else if (act === 'note') { clip.editing = clip.editing === id ? null : id; renderClips(); }
    else if (act === 'del') { await api.clipRemove(id); }
  });
  $('clipList').addEventListener('keydown', async (e) => {
    if (!e.target.matches('.note-input')) return;
    const id = e.target.closest('.clip-row').dataset.id;
    if (e.key === 'Enter') { e.preventDefault(); clip.editing = null; await api.clipUpdate(id, { note: e.target.value.trim() }); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clip.editing = null; renderClips(); }
  });
  $('clipClear').addEventListener('click', async () => {
    const b = $('clipClear');
    if (Date.now() - clip.clearArmed > 3000) {
      clip.clearArmed = Date.now();
      b.textContent = '再点一次确认清空';
      b.classList.add('warn');
      setTimeout(() => { b.textContent = '清空（保留收藏）'; b.classList.remove('warn'); }, 3000);
      return;
    }
    clip.clearArmed = 0;
    b.textContent = '清空（保留收藏）';
    b.classList.remove('warn');
    await api.clipClear();
  });

  // ---------- 待办 ----------
  const todo = { state: null, view: 'day', key: null, editing: null };
  let noteTimer = null;

  async function loadTodo() {
    if (!api.todoGet) return;
    todo.state = await api.todoGet(todo.view === 'day' ? todo.key : null);
    renderTodo();
  }

  function renderTodo() {
    const s = todo.state;
    if (!s) return;
    const page = $('todoPage');
    page.classList.toggle('history', todo.view === 'history');
    page.classList.toggle('past', todo.view === 'day' && !s.isToday);
    $('todoToday').style.display = todo.view === 'history' || !s.isToday ? '' : 'none';
    $('todoHistory').style.display = todo.view === 'history' ? 'none' : '';

    if (todo.view === 'history') {
      $('todoDate').textContent = '历史';
      $('todoStat').textContent = s.archive.length + ' 天';
      const arch = $('todoArchive');
      arch.classList.add('scroll');
      arch.innerHTML = s.archive.length
        ? s.archive.map((a) => `<button type="button" class="arch-row" role="listitem" data-key="${a.key}"><span>${esc(a.label)}${a.key === s.today ? '（今天）' : ''}</span>${a.hasNote ? '<span class="tag">有笔记</span>' : ''}<span class="cnt num">${a.done}/${a.total}</span><span class="arch-bar"><i style="width:${a.total ? Math.round(a.done / a.total * 100) : 0}%"></i></span></button>`).join('')
        : '<div class="empty-hint">还没有历史记录</div>';
      fitPanel();
      return;
    }

    const tasks = s.day.tasks;
    const own = tasks.filter((x) => !x.rolled);
    $('todoDate').textContent = s.isToday ? '今天 · ' + s.label : s.label;
    $('todoStat').textContent = own.length ? `${own.filter((x) => x.done).length}/${own.length} 完成` : '';
    const list = $('todoList');
    list.classList.add('scroll');
    if (!tasks.length) {
      list.innerHTML = `<div class="empty-hint" style="padding:18px 12px">${s.isToday ? '今天还没有待办' : '这天没有待办'}</div>`;
    } else {
      list.innerHTML = tasks.map((x, i) => {
        const cls = `todo-row${x.done ? ' done' : ''}${x.rolled ? ' rolled' : ''}`;
        const tag = x.rolled ? '<span class="tag">已顺延</span>' : x.from ? `<span class="tag">从 ${esc(x.from.slice(5).replace('-', '/'))} 顺延</span>` : '';
        const text = todo.editing === x.id
          ? `<input class="field-input todo-edit" data-act="edit-input" maxlength="300" value="${esc(x.text)}">`
          : `<span class="todo-text" data-act="edit">${esc(x.text)}${tag}</span>`;
        return `<div class="${cls}" role="listitem" data-id="${x.id}">
          <button type="button" class="check" data-act="toggle" aria-label="${x.done ? '标为未完成' : '标为完成'}" ${x.rolled ? 'disabled' : ''}>${TICK}</button>
          ${text}
          <span class="todo-ops">
            ${s.isToday ? `<button type="button" class="op-btn" data-act="up" aria-label="上移" ${i === 0 ? 'disabled' : ''}>${UP}</button>
            <button type="button" class="op-btn" data-act="down" aria-label="下移" ${i === tasks.length - 1 ? 'disabled' : ''}>${DOWN}</button>` : ''}
            <button type="button" class="op-btn danger" data-act="del" aria-label="删除">${XMARK}</button>
          </span>
        </div>`;
      }).join('');
      const ei = list.querySelector('.todo-edit');
      if (ei) { ei.focus(); ei.setSelectionRange(ei.value.length, ei.value.length); }
    }
    const note = $('todoNote');
    if (document.activeElement !== note) note.value = s.isToday ? s.day.note || '' : '';
    $('todoNoteView').textContent = !s.isToday ? (s.day.note || '这天没有笔记') : '';
    fitPanel();
  }

  $('todoInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return; // 输入法选字时的回车不算
    const v = $('todoInput').value.trim();
    if (!v) return;
    e.preventDefault();
    $('todoInput').value = '';
    await api.todoAdd(v);
  });
  $('todoList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.todo-row');
    if (!btn || !row || btn.disabled) return;
    const id = row.dataset.id, key = todo.state.key;
    const act = btn.dataset.act;
    if (act === 'toggle') await api.todoToggle(key, id);
    else if (act === 'del') await api.todoRemove(key, id);
    else if (act === 'up') await api.todoMove(key, id, -1);
    else if (act === 'down') await api.todoMove(key, id, 1);
    else if (act === 'edit' && todo.state.isToday) { todo.editing = id; renderTodo(); }
  });
  $('todoList').addEventListener('keydown', async (e) => {
    if (!e.target.matches('.todo-edit')) return;
    const id = e.target.closest('.todo-row').dataset.id;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); todo.editing = null; await api.todoEdit(todo.state.key, id, e.target.value); renderTodo(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); todo.editing = null; renderTodo(); }
  });
  $('todoList').addEventListener('focusout', (e) => {
    if (e.target.matches('.todo-edit') && todo.editing) {
      const id = todo.editing;
      todo.editing = null;
      api.todoEdit(todo.state.key, id, e.target.value).then(renderTodo);
    }
  });
  $('todoNote').addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => api.todoNote($('todoNote').value), 500);
  });
  $('todoHistory').addEventListener('click', () => { todo.view = 'history'; loadTodo(); });
  $('todoToday').addEventListener('click', () => { todo.view = 'day'; todo.key = null; loadTodo(); });
  $('todoArchive').addEventListener('click', (e) => {
    const b = e.target.closest('.arch-row');
    if (!b) return;
    todo.view = 'day';
    todo.key = b.dataset.key === todo.state.today ? null : b.dataset.key;
    loadTodo();
  });
  $('todoExport').addEventListener('click', async () => {
    const which = todo.view === 'history' ? 'all' : todo.state.key;
    keepOpenOnBlur = true;
    let file = null;
    try { file = await api.todoExport(which); } finally { keepOpenOnBlur = false; api.setFocus(true); }
    if (file) {
      const b = $('todoExport');
      b.textContent = '已导出';
      setTimeout(() => { b.textContent = '导出 Markdown'; }, 1500);
    }
  });

  // ---------- 消息（系统通知 / 邮件） ----------
  const msg = { unread: 0, items: [], kind: 'all', alert: null, alertTimer: null, status: null };
  const AVATAR_COLORS = ['#3E63C9', '#2F8F7A', '#9B5BC9', '#C9773E', '#C94A6A', '#4A8FC9', '#7A8F2F'];
  function avatarOf(name) {
    let h = 0;
    for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { color: AVATAR_COLORS[h % AVATAR_COLORS.length], text: String(name || '?').trim().slice(0, 1).toUpperCase() };
  }

  function renderMsgIndicators() {
    const has = msg.unread > 0;
    const was = document.body.classList.contains('has-msg');
    document.body.classList.toggle('has-msg', has);
    const n = msg.unread > 99 ? '99+' : String(msg.unread);
    $('msgCount').textContent = n;
    $('tabMsgCount').textContent = n;
    $('msgSeg').setAttribute('aria-label', `${msg.unread} 条新消息`);
    if (was !== has) applyForm();
  }

  function showAlert(item) {
    const av = avatarOf(item.app);
    const a = $('alertAvatar');
    a.style.background = av.color;
    a.textContent = av.text;
    $('alertApp').textContent = item.kind === 'mail' ? (item.account || '邮件') : item.app;
    $('alertTime').textContent = ago(item.time);
    $('alertTitle').textContent = item.title;
    $('alertBody').textContent = (item.body || '').replace(/\s+/g, ' ');
    msg.alert = item;
    applyForm();
    armAlertTimer();
  }
  function armAlertTimer() {
    clearTimeout(msg.alertTimer);
    msg.alertTimer = setTimeout(() => {
      // 鼠标停在卡片上时先不收
      if (st.inside && form() === 'alert') { armAlertTimer(); return; }
      msg.alert = null;
      applyForm();
    }, 5000);
  }

  let msgSeq = 0;
  async function loadMsgs(markRead) {
    if (!api.inboxList) return;
    const seq = ++msgSeq;
    const r = await api.inboxList(msg.kind);
    if (seq !== msgSeq) return;
    msg.items = r.items || [];
    renderMsgs();
    if (markRead && r.unread) api.inboxReadAll();
  }

  function renderBanner() {
    const b = $('notifyBanner');
    const s = msg.status && msg.status.status;
    let html = '';
    if (st.cfg.notify === false) html = '系统通知提醒已关闭，可以在设置里打开';
    else if (s === 'denied' || s === 'unspecified') html = '需要允许余光读取通知，飞书、QQ 等的消息才能显示在这里<button type="button" class="link-btn" data-act="open-notify">打开系统设置</button>';
    else if (s === 'unsupported') html = '当前系统不支持读取通知（需要 Windows 10 1809 及以上）';
    b.innerHTML = html;
    b.classList.toggle('show', !!html);
  }

  function fmtDate(t) {
    if (!t) return '';
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function openMail(item) {
    msg.reading = { item, data: null, error: '' };
    renderMsgs();
    const r = await api.mailBody(item.accountId, item.uid);
    if (!msg.reading || msg.reading.item.key !== item.key) return;
    if (r && r.error) msg.reading.error = r.error; else msg.reading.data = r;
    renderMsgs();
  }

  function renderReader() {
    const { item, data, error } = msg.reading;
    const list = $('msgList');
    const body = error ? `<div class="empty-hint">${esc(error)}</div>`
      : !data ? '<div class="empty-hint">正在读取…</div>'
      : `<div class="mail-text">${esc(data.text)}</div>${data.attachments.length ? `<div class="mail-att">附件（未下载）：${data.attachments.map(esc).join('、')}</div>` : ''}`;
    list.innerHTML = `<div class="mail-reader">
      <button type="button" class="link-btn" data-act="back">‹ 返回列表</button>
      <div class="mail-subject">${esc((data && data.subject) || item.title)}</div>
      <div class="mail-meta">${esc((data && data.from) || item.from || '')} · ${esc(fmtDate((data && data.date) || item.time))} · ${esc(item.account || '')}</div>
      ${body}
    </div>`;
    fitPanel();
  }

  function renderMsgs() {
    document.querySelectorAll('#msgKinds button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === msg.kind)));
    renderBanner();
    const list = $('msgList');
    list.classList.add('scroll');
    if (msg.reading) { renderReader(); return; }
    if (!msg.items.length) {
      list.innerHTML = `<div class="empty-hint">没有新消息<br>飞书、QQ、钉钉、企业微信、Outlook 等发出的通知${msg.kind === 'notify' ? '' : '和邮件'}会出现在这里</div>`;
    } else {
      list.innerHTML = msg.items.map((it) => {
        const av = avatarOf(it.app);
        return `<div class="msg-row${it.read ? '' : ' unread'}${it.kind === 'mail' ? ' is-mail' : ''}" role="listitem" data-key="${esc(it.key)}" ${it.kind === 'mail' ? 'data-act="open" tabindex="0" title="查看正文"' : ''}>
          <span class="avatar" style="background:${av.color}">${esc(av.text)}</span>
          <span class="msg-main">
            <span class="msg-top"><span>${esc(it.kind === 'mail' ? (it.account || '邮件') : it.app)}</span><span class="num">${ago(it.time)}</span></span>
            <span class="msg-title">${esc(it.title)}</span>
            ${it.body ? `<span class="msg-body">${esc(it.body)}</span>` : ''}
          </span>
          <button type="button" class="op-btn danger" data-act="remove" aria-label="删除">${XMARK}</button>
        </div>`;
      }).join('');
    }
    fitPanel();
  }

  $('msgKinds').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (b) { msg.kind = b.dataset.kind; msg.reading = null; loadMsgs(false); }
  });
  $('msgReadAll').addEventListener('click', () => api.inboxReadAll().then(() => loadMsgs(false)));
  $('msgClear').addEventListener('click', () => api.inboxClear(msg.kind === 'all' ? null : msg.kind).then(() => loadMsgs(false)));
  $('msgList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'back') { msg.reading = null; renderMsgs(); return; }
    const row = b.closest('.msg-row');
    if (!row) return;
    if (b.dataset.act === 'remove') { e.stopPropagation(); api.inboxRemove(row.dataset.key).then(() => loadMsgs(false)); return; }
    if (b.dataset.act === 'open') {
      const it = msg.items.find((x) => x.key === row.dataset.key);
      if (it) openMail(it);
    }
  });
  $('msgList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.msg-row.is-mail')) e.target.click();
  });
  $('notifyBanner').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="open-notify"]')) api.openNotifySettings();
  });
  $('msgZone').addEventListener('click', () => openPanel(undefined, 'msg'));
  $('msgSeg').addEventListener('click', () => openPanel(undefined, 'msg'));
  $('alertBtn').addEventListener('click', () => {
    clearTimeout(msg.alertTimer);
    msg.alert = null;
    openPanel(undefined, 'msg');
  });

  // ---------- 数据 ----------
  function applyAppearance() {
    const c = st.cfg;
    const root = document.documentElement.style;
    root.setProperty('--scale', String(Number(c.scale) || 1));
    root.setProperty('--opacity', String(Number(c.opacity) || 1));
    document.body.classList.toggle('glass', c.style === 'glass');
    document.body.classList.toggle('floating', (Number(c.topOffset) || 0) > 0);
    hot.style.top = (Number(c.topOffset) || 0) + 'px';
  }

  function renderAll() {
    applyAppearance();
    document.documentElement.style.setProperty('--up', upColor());
    document.documentElement.style.setProperty('--down', downColor());
    renderSegments();
    renderTicker();
    renderPanel();
    renderMusic();
    applyForm();
  }

  async function init() {
    st.cfg = await api.getConfig();
    st.quotes = await api.getQuotes();
    setPage('stock');
    renderAll();
    startRotation();
    api.onQuotes((q) => {
      st.quotes = q;
      renderSegments();
      renderTicker();
      if (st.open) renderPanel();
      renderBubble();
    });
    api.onConfig((cfg) => {
      const groupsChanged = JSON.stringify(cfg.groups) !== JSON.stringify(st.cfg.groups);
      const rotateChanged = cfg.rotateMs !== st.cfg.rotateMs;
      st.cfg = cfg;
      if (groupsChanged) { st.sel = 0; st.tIdx = 0; st.segKey = ''; tickerEl.classList.remove('anim'); }
      renderAll();
      if (rotateChanged) startRotation();
    });
    api.onStatus((s) => { st.online = s.online; renderPanel(); });
    if (api.onPageOpen) {
      // 全局快捷键唤出：直接打开对应页面，并把光标放进输入框
      api.onPageOpen((page) => {
        st.hover = true;
        openPanel(undefined, page);
        setTimeout(() => {
          const el = page === 'clip' ? $('clipSearch') : page === 'todo' ? $('todoInput') : null;
          if (el) { el.focus(); if (el.select) el.select(); }
        }, 120);
      });
      api.onClipChanged(() => { if (st.open && st.page === 'clip') loadClips(); });
      if (api.inboxList) {
        const r = await api.inboxList('all');
        msg.unread = r.unread || 0;
        renderMsgIndicators();
        msg.status = await api.notifyStatus();
        api.onNotifyStatus((s) => { msg.status = s; if (st.open && st.page === 'msg') renderBanner(); });
        api.onInboxNew(({ item, unread, popup }) => {
          msg.unread = unread;
          renderMsgIndicators();
          if (st.open && st.page === 'msg') { loadMsgs(true); return; }
          if (popup && !st.open) showAlert(item);
        });
        api.onInboxChanged(({ unread }) => {
          msg.unread = unread;
          renderMsgIndicators();
          if (st.open && st.page === 'msg') loadMsgs(false);
        });
      }
      api.onTodoChanged(() => { if (st.open && st.page === 'todo') loadTodo(); });
    }
    if (api.getMedia) {
      onMedia(await api.getMedia());
      api.onMedia(onMedia);
      api.onLevel((p) => { if (isPlaying()) setLevel(Number(p) || 0); });
    }
  }

  init();
})();
