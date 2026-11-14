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
  const W = 564, VH = 30;
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
    lastPlayingAt: 0,
    selCode: null,      // 面板里选中的指数（null = 看分组里的股票）
    view: 'min1',       // 图表：min1 分时 / min5 五日 / day 日K / week 周K
    dview: 'data',      // 图表下面：data 数据 / book 五档 / hold 本组持仓
    charts: {},         // 五日分时、K 线缓存
    book: {},           // 五档缓存
    sessions: {},       // 各市场交易时段
    source: 'eastmoney',
    stealth: false,
    pnl: { groups: [], items: {}, fx: null },
    flags: new Set(),   // “只闪光带”的预警触发后，还没看过的股票
    hitXs: null         // 当前图上每个点的横坐标，十字光标用
  };
  const VIZ_BARS = 36;
  const levels = new Array(VIZ_BARS).fill(0);
  // 暂停超过这么久就不再在岛上显示音乐
  const PAUSE_HIDE_MS = 5 * 60 * 1000;
  let hoverTimer = null, leaveTimer = null, rotateTimer = null, resetTimer = null, minuteTimer = null;
  let lastWheel = 0;

  // ---------- 工具 ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HK_INDEX = /^gi(HSI|HSCEI|HSTECH|HSCCI)$/;
  const marketOf = (code) => /^hk/.test(code) || HK_INDEX.test(code) ? 'hk' : /^(us|gi)/.test(code) ? 'us' : 'a';
  const bare = (code) => String(code).replace(/^(sh|sz|bj|hk|us|gi|fx)/, '');
  // 低调模式：名称换成代码
  const dispName = (s) => st.stealth ? bare(s.code).toUpperCase() : s.name;
  const fmtP = (n) => n == null ? '--' : n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 });
  const fmtPct = (n) => n == null ? '--' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  // 低调模式不用红绿：涨用浅灰，跌用深一点的灰
  const upColor = () => st.stealth ? '#D2D4D8' : st.cfg.redUp ? '#FF5B5B' : '#2FD27A';
  const downColor = () => st.stealth ? '#8C9198' : st.cfg.redUp ? '#2FD27A' : '#FF5B5B';
  const colorOf = (pct) => pct == null ? '#9A9AA2' : pct >= 0 ? upColor() : downColor();
  const tintOf = (pct) => {
    if (st.stealth || pct == null) return 'rgba(255,255,255,.08)';
    const c = colorOf(pct);
    return c === '#FF5B5B' ? 'rgba(255,91,91,.16)' : 'rgba(47,210,122,.16)';
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

  let lastForm = 'strip', formChangedAt = 0, lastArea = 0;
  // 支持苹果连续圆角时，半径放大 1.4 倍画 superellipse(1.6)，看起来和普通 30px 圆角一样大
  const CORNER_K = window.CSS && CSS.supports && CSS.supports('corner-shape', 'superellipse(1.6)') ? 1.4 : 1;
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
    // 变大用带回弹的展开曲线，变小用不回弹的收起曲线
    const area = w * h;
    if (area !== lastArea) { morph.dataset.dir = area < lastArea ? 'close' : 'open'; lastArea = area; }
    morph.style.width = w + 'px';
    morph.style.height = h + 'px';
    const rr = Math.round(r * CORNER_K * 10) / 10;
    morph.style.borderRadius = (Number(st.cfg.topOffset) || 0) > 0 ? `${rr}px` : `0 0 ${rr}px ${rr}px`;
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
      el.classList.toggle('breathe', !st.stealth && m >= st.cfg.breatheAbove);
      el.classList.toggle('flag', st.flags.has(s.code));
      el.setAttribute('aria-label', `${dispName(s)} ${fmtPct(s.pct)}${st.flags.has(s.code) ? '，有预警' : ''}`);
    });
  }

  // ---------- 岛：竖向轮播 / 汇总 / 固定 ----------
  /** 岛上要轮播的行：rotate = 每只一行；pin = 只有第一只；summary = 一行汇总 */
  function tickRows() {
    const list = stocks();
    if (!list.length) return [];
    const how = st.cfg.groupDisplay;
    if (how === 'pin') return [list[0]];
    if (how === 'summary') {
      const ok = list.filter((x) => x.pct != null);
      const up = ok.filter((x) => x.pct > 0).length, down = ok.filter((x) => x.pct < 0).length;
      const avg = ok.length ? ok.reduce((t, x) => t + x.pct, 0) / ok.length : null;
      return [{ summary: true, code: '', name: group().name, up, down, pct: avg }];
    }
    return list;
  }
  function tickRowHtml(s) {
    if (s.summary) {
      return `<span class="tick-row"><span class="tick-name">${esc(st.stealth ? 'G' + (st.cfg.activeGroup + 1) : s.name)}</span>` +
        `<span class="num tick-price"><span style="color:${upColor()}">▲${s.up}</span> <span style="color:${downColor()}">▼${s.down}</span></span>` +
        `<span class="num tick-pct" style="color:${colorOf(s.pct)}">均 ${fmtPct(s.pct)}</span></span>`;
    }
    const flag = st.flags.has(s.code) ? '<i class="tick-flag" aria-label="有预警"></i>' : '';
    return `<span class="tick-row"><span class="tick-name">${esc(dispName(s))}</span>${flag}<span class="num tick-price">${fmtP(s.price)}</span><span class="num tick-pct" style="color:${colorOf(s.pct)}">${fmtPct(s.pct)}</span></span>`;
  }
  function renderTicker() {
    const list = tickRows();
    if (!list.length) {
      tickerEl.innerHTML = '<span class="tick-row"><span class="tick-name" style="color:#A9AEB6">这个分组还没有股票</span></span>';
      $('tickDot').style.background = '#9A9AA2';
    } else {
      if (st.tIdx >= list.length) st.tIdx = 0;
      const rows = list.length > 1 ? list.concat([list[0]]) : list;
      tickerEl.innerHTML = rows.map(tickRowHtml).join('');
      const curRow = list[st.tIdx % list.length];
      $('tickDot').style.background = st.flags.size ? '#FFC26B' : colorOf(curRow.pct);
    }
    tickerEl.style.transform = `translateY(-${st.tIdx * 28}px)`;
    // 右边的小标签：有持仓时显示今日盈亏，否则显示分组名
    const tag = $('islandGroup');
    const g = st.pnl.groups && st.pnl.groups[st.cfg.activeGroup];
    if (g && st.cfg.pnlOnIsland && !st.stealth) {
      const how = st.cfg.pnlShow;
      tag.textContent = how === 'dir' ? (g.today > 0 ? '▲' : g.today < 0 ? '▼' : '—') : how === 'pct' ? fmtPct(g.todayPct) : fmtMoney(g.today);
      tag.style.color = colorOf(g.today);
      tag.classList.add('num');
      tag.title = '本组今日盈亏';
    } else {
      tag.textContent = st.stealth ? 'G' + (st.cfg.activeGroup + 1) : group().name;
      tag.style.color = '';
      tag.classList.remove('num');
      tag.title = '';
    }
  }

  function startRotation() {
    clearInterval(rotateTimer);
    rotateTimer = setInterval(() => {
      const rows = tickRows();
      const n = rows.length;
      if (n < 2 || st.open || st.hot === 'ticker') return;
      st.tIdx += 1;
      tickerEl.classList.add('anim');
      tickerEl.style.transform = `translateY(-${st.tIdx * 28}px)`;
      $('tickDot').style.background = st.flags.size ? '#FFC26B' : colorOf(rows[st.tIdx % n].pct);
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
      const list = tickRows();
      s = list.length ? list[st.tIdx % list.length] : null;
      if (s && s.summary) s = null;
      const tz = $('tickerZone');
      x = tz.offsetLeft + tz.offsetWidth / 2;
      top = 44;
    }
    if (!s) { bubble.classList.remove('show'); return; }
    bubble.style.left = x + 'px';
    bubble.style.top = top + 'px';
    $('bName').textContent = dispName(s);
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
    const rows = tickRows();
    const s = f === 'strip' && typeof st.hot === 'number' ? list[st.hot] : f === 'island' && st.hot === 'ticker' ? rows[st.tIdx % rows.length] : null;
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
    $('pageTitle').textContent = { stock: '行情', music: '音乐', clip: '剪贴板', todo: '待办', msg: '消息' }[page];
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

  // ---------- 行情页 ----------
  const IDX_NAMES = { sh000001: '上证', sz399001: '深成', sz399006: '创业板', sh000300: '沪深300', sh000688: '科创50', giHSI: '恒生', giHSTECH: '恒生科技', giNDX: '纳指100', giDJIA: '道指', giSPX: '标普500' };
  const SES_TEXT = { trading: '交易中', auction: '集合竞价', preopen: '待开盘', lunch: '午休', closed: '已收盘', notyet: '未开盘', pre: '盘前', post: '盘后', holiday: '休市' };
  const MK_NAME = { a: 'A 股', hk: '港股', us: '美股' };
  const fmtVol = (v) => v == null ? '--' : v >= 1e8 ? (v / 1e8).toFixed(2) + '亿' : v >= 1e4 ? (v / 1e4).toFixed(1) + '万' : String(Math.round(v));
  const fmtMoney = (v) => {
    if (v == null) return '--';
    const a = Math.abs(v);
    const s = a >= 1e8 ? (a / 1e8).toFixed(2) + '亿' : a >= 1e5 ? (a / 1e4).toFixed(1) + '万' : a.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return (v > 0 ? '+' : v < 0 ? '−' : '') + s;
  };
  const isIndex = (code) => /^gi/.test(code) || /^(sh000|sz399|bj899)/.test(code);

  /** 面板上当前看的那一只：选中的指数，或分组里选中的股票 */
  function cur() {
    if (st.selCode) {
      const q = st.quotes[st.selCode];
      return q || { code: st.selCode, name: IDX_NAMES[st.selCode] || bare(st.selCode), price: null, pct: null, prevClose: null };
    }
    return stocks()[st.sel];
  }

  function renderPanel() {
    const cfg = st.cfg;
    $('groupTabs').innerHTML = cfg.groups.map((g, i) => `<button type="button" class="tab" role="tab" data-g="${i}" aria-selected="${i === cfg.activeGroup}">${esc(g.name)}<span class="cnt num">${g.codes.length}</span></button>`).join('');
    const modes = ['strip', 'auto', 'pinned'];
    const mi = Math.max(0, modes.indexOf(cfg.mode));
    document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === cfg.mode)));
    document.querySelector('.seg-thumb').style.left = (3 + mi * 46) + 'px';

    renderIndexes();
    const list = stocks();
    if (!st.selCode && st.sel >= list.length) st.sel = Math.max(0, list.length - 1);
    $('chips').innerHTML = list.map((s, i) => {
      const flag = st.flags.has(s.code);
      const al = cfg.alerts[s.code] && hasRule(cfg.alerts[s.code]);
      return `<button type="button" class="chip${flag ? ' flagged' : ''}" data-i="${i}" aria-pressed="${!st.selCode && i === st.sel}">` +
        `<span class="n">${esc(dispName(s))}</span><span class="p num" style="color:${colorOf(s.pct)}">${fmtPct(s.pct)}</span>` +
        `${al || flag ? '<i class="chip-dot" aria-hidden="true"></i>' : ''}</button>`;
    }).join('');
    const s = cur();
    if (!s) {
      $('curName').textContent = '这个分组还没有股票';
      $('curSub').textContent = '点右上角 ≡ 打开设置添加';
      $('curPrice').textContent = '';
      $('curPct').textContent = '';
      $('curPct').style.background = 'transparent';
      $('btnAlert').hidden = true;
      $('holdLine').textContent = '';
      $('chartSvg').innerHTML = ''; $('volSvg').innerHTML = ''; $('timeAxis').innerHTML = '';
      $('chartEmpty').textContent = '';
      ['axHi', 'axMid', 'axLo', 'axHiP', 'axLoP'].forEach((id) => { $(id).textContent = ''; });
      renderSession(null);
      renderData();
    } else {
      // 看到了就不再闪
      if (st.flags.has(s.code)) { st.flags.delete(s.code); renderSegments(); }
      renderSession(s);
      renderAlertBtn(s);
      renderHoldLine(s);
      renderChart();
      renderData();
    }
    document.querySelectorAll('#chartTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === st.view)));
    renderFoot();
    fitPanel();
  }

  function renderIndexes() {
    const codes = st.cfg.indexes || [];
    const row = $('idxRow');
    row.style.display = codes.length ? '' : 'none';
    row.style.gridTemplateColumns = `repeat(${Math.max(1, codes.length)}, minmax(0, 1fr))`;
    row.innerHTML = codes.map((c) => {
      const q = st.quotes[c];
      const name = st.stealth ? bare(c) : (IDX_NAMES[c] || (q && q.name) || bare(c));
      // 第一行：名称 + 涨跌幅；第二行：点数
      return `<button type="button" class="idx" role="listitem" data-code="${esc(c)}" aria-pressed="${st.selCode === c}">` +
        `<span class="idx-n"><span>${esc(name)}</span><b class="num" style="color:${colorOf(q && q.pct)}">${q ? fmtPct(q.pct) : ''}</b></span>` +
        `<span class="idx-v num">${q ? fmtP(q.price) : '--'}</span></button>`;
    }).join('');
  }

  function renderSession(s) {
    const chip = $('sessionChip');
    const ses = s && st.sessions[marketOf(s.code)];
    if (!ses) { chip.textContent = ''; chip.className = 'session-chip'; return; }
    const text = ses.state === 'holiday' ? '休市' + (ses.label && ses.label !== '休市' ? ' · ' + ses.label : '') : (SES_TEXT[ses.state] || ses.label || '');
    chip.className = 'session-chip ' + (ses.state === 'trading' ? 'live' : ses.active ? 'soon' : 'off');
    chip.innerHTML = `<i aria-hidden="true"></i>${esc(MK_NAME[marketOf(s.code)])} ${esc(text)}`;
  }

  function hasRule(r) { return !!(r && (r.upOn || r.downOn || r.pctOn || r.fastOn || r.limitOn)); }
  function ruleCount(r) { return r ? ['upOn', 'downOn', 'pctOn', 'fastOn', 'limitOn'].filter((k) => r[k]).length : 0; }

  function renderAlertBtn(s) {
    const b = $('btnAlert');
    b.hidden = isIndex(s.code);
    const n = ruleCount(st.cfg.alerts[s.code]);
    b.classList.toggle('on', n > 0);
    $('alertCnt').textContent = n ? '预警 ' + n : '预警';
    b.setAttribute('aria-label', n ? `预警（已设置 ${n} 个）` : '设置预警');
  }

  function holdingText(it, how) {
    if (!it) return '';
    if (how === 'dir') return it.today > 0 ? '▲' : it.today < 0 ? '▼' : '—';
    if (how === 'pct') return fmtPct(it.todayPct);
    return fmtMoney(it.todayCny);
  }

  function renderHoldLine(s) {
    const el = $('holdLine');
    const it = st.pnl.items && st.pnl.items[s.code];
    if (!it || st.stealth) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    const unit = it.currency === '元' ? '' : ' ' + it.currency;
    const parts = [`持有 ${it.qty.toLocaleString('en-US')} 股`];
    if (it.cost) parts.push(`成本 ${fmtP(it.cost)}`);
    parts.push(`今日 <b style="color:${colorOf(it.today)}">${fmtMoney(it.today)}${unit}</b>`);
    if (it.total !== null) parts.push(`持仓 <b style="color:${colorOf(it.total)}">${fmtMoney(it.total)}${unit}（${fmtPct(it.totalPct)}）</b>`);
    el.innerHTML = parts.join('<span class="sep">·</span>') + `<button type="button" class="link-btn" data-act="edit-hold">编辑</button>`;
  }

  // ---------- 图表：分时 / 五日 / 日K / 周K ----------
  const CH = 170;
  function viewKey(s) {
    return st.view === 'day' ? 'k101:' + s.code : st.view === 'week' ? 'k102:' + s.code : st.view === 'min5' ? 'm5:' + s.code : 'm1:' + s.code;
  }
  function viewData(s) {
    if (st.view === 'min1') return st.minute[s.code] && st.minute[s.code].data;
    const c = st.charts[viewKey(s)];
    return c && c.data;
  }
  function viewLoading(s) {
    if (st.view === 'min1') return !st.minute[s.code] || !!st.minute[s.code].loading;
    const c = st.charts[viewKey(s)];
    return !c || !!c.loading;
  }

  async function loadView(s, force) {
    if (st.view === 'min1') return loadMinute(s.code, force);
    const key = viewKey(s);
    const c = st.charts[key];
    const ttl = st.view === 'min5' ? 30000 : 60000;
    if (!force && c && Date.now() - c.at < ttl) return c.data;
    if (c && c.loading) return c.loading;
    const p = (st.view === 'min5' ? api.getMinute(s.code, 5) : api.getKline(s.code, st.view === 'week' ? 102 : 101))
      .then((data) => {
        st.charts[key] = { at: Date.now(), data };
        // 面板开着时最多留 12 份
        const keys = Object.keys(st.charts);
        if (keys.length > 12) for (const k of keys.slice(0, keys.length - 12)) if (k !== key) delete st.charts[k];
        return data;
      })
      .catch(() => { st.charts[key] = { at: Date.now(), data: null }; return null; });
    st.charts[key] = Object.assign({}, c || { at: 0, data: null }, { loading: p });
    return p;
  }

  function clearChart(msgText) {
    $('chartSvg').innerHTML = ''; $('volSvg').innerHTML = ''; $('timeAxis').innerHTML = '';
    $('chartEmpty').textContent = msgText;
    $('legend').innerHTML = '';
    $('chart').classList.remove('crossing');
    ['axHi', 'axMid', 'axLo', 'axHiP', 'axLoP'].forEach((id) => { $(id).textContent = ''; });
  }

  function renderChart() {
    const s = cur();
    if (!s) return;
    $('curName').textContent = dispName(s);
    const mk = marketOf(s.code);
    const codeText = bare(s.code).toUpperCase();
    const data = viewData(s);
    st.hitXs = null;
    if (!data) {
      $('curSub').textContent = st.stealth ? '' : codeText + ' · ' + (isIndex(s.code) ? '指数' : MK_NAME[mk]);
      clearChart(viewLoading(s) ? '加载中…' : st.view === 'min1' ? '暂无分时数据（可能还没开盘）' : '暂无数据');
      setHeadline(s.price, s.pct);
      return;
    }
    $('chartEmpty').textContent = '';
    if (st.view === 'day' || st.view === 'week') drawKline(s, data, codeText);
    else drawMinute(s, data, codeText, mk);
  }

  function drawMinute(s, data, codeText, mk) {
    const five = st.view === 'min5';
    const days = five ? data.days : [data.date];
    const k = Math.max(1, days.length);
    const per = SESSION_POINTS[mk];
    const dayIdx = {};
    days.forEach((d, i) => { dayIdx[d] = i; });
    const counter = {};
    const xs = data.points.map((p) => {
      const di = five ? (dayIdx[p.d] || 0) : 0;
      const j = counter[di] = (counter[di] === undefined ? 0 : counter[di] + 1);
      return (di + Math.min(1, j / (per - 1))) / k * W;
    });
    st.hitXs = xs;
    const pc = data.prevClose;
    const pctOf = (v) => (v - pc) / pc * 100;
    let yOf, hiV, loV;
    if (!five) {
      const range = Math.max(0.6, ...data.points.map((p) => Math.abs(pctOf(p.price)))) * 1.12;
      hiV = pc * (1 + range / 100); loV = pc * (1 - range / 100);
      $('axHiP').textContent = '+' + range.toFixed(2) + '%'; $('axHiP').style.color = upColor();
      $('axLoP').textContent = '-' + range.toFixed(2) + '%'; $('axLoP').style.color = downColor();
      $('axMid').textContent = fmtP(pc);
    } else {
      const prices = data.points.map((p) => p.price);
      const pad = (Math.max(...prices) - Math.min(...prices)) * 0.08 || pc * 0.005;
      hiV = Math.max(...prices) + pad; loV = Math.min(...prices) - pad;
      $('axHiP').textContent = ''; $('axLoP').textContent = ''; $('axMid').textContent = '';
    }
    yOf = (v) => 4 + (hiV - v) / (hiV - loV) * (CH - 8);
    const pts = data.points;
    const line = pts.map((p, i) => `${xs[i].toFixed(1)},${yOf(p.price).toFixed(1)}`).join(' ');
    const avg = pts.map((p, i) => `${xs[i].toFixed(1)},${yOf(p.avg).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const c = colorOf(five ? last.price - pts[0].price : pctOf(last.price));
    const midY = Math.max(0, Math.min(CH, yOf(pc)));
    let grid = `<line x1="0" y1="${CH / 4}" x2="${W}" y2="${CH / 4}" stroke="rgba(255,255,255,.06)"/>` +
      `<line x1="0" y1="${CH * 3 / 4}" x2="${W}" y2="${CH * 3 / 4}" stroke="rgba(255,255,255,.06)"/>`;
    if (five) for (let i = 1; i < k; i++) grid += `<line x1="${(i / k * W).toFixed(1)}" y1="0" x2="${(i / k * W).toFixed(1)}" y2="${CH}" stroke="rgba(255,255,255,.1)"/>`;
    else grid += `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${CH}" stroke="rgba(255,255,255,.08)"/>` +
      `<line x1="0" y1="${midY}" x2="${W}" y2="${midY}" stroke="rgba(255,255,255,.3)" stroke-dasharray="4 4"/>`;
    const base = five ? CH : midY;
    $('chartSvg').innerHTML = grid +
      `<polygon points="${xs[0].toFixed(1)},${base} ${line} ${xs[xs.length - 1].toFixed(1)},${base}" fill="${c}" fill-opacity=".14"/>` +
      (five ? '' : `<polyline points="${avg}" fill="none" stroke="#FFC26B" stroke-width="1.2" stroke-opacity="${st.stealth ? 0.4 : 0.9}"/>`) +
      `<polyline points="${line}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`;
    $('axHi').textContent = fmtP(hiV); $('axHi').style.color = five ? '' : upColor();
    $('axLo').textContent = fmtP(loV); $('axLo').style.color = five ? '' : downColor();
    $('timeAxis').innerHTML = five
      ? days.map((d, i) => `<span class="mid" style="left:${((i + 0.5) / k * 100).toFixed(2)}%">${esc(String(d).slice(5))}</span>`).join('')
      : SESSION_TICKS[mk].map(([p, t]) => `<span style="left:${(p * 100).toFixed(2)}%">${t}</span>`).join('');

    // 成交量：合并成柱子
    const buckets = five ? 100 : 60;
    const vols = new Array(buckets).fill(0), dirs = new Array(buckets).fill(0);
    pts.forEach((p, i) => {
      const b = Math.min(buckets - 1, Math.floor(xs[i] / W * buckets));
      vols[b] += p.vol;
      dirs[b] += p.price - (i ? pts[i - 1].price : pc);
    });
    drawVolBars(vols, dirs);

    const ci = st.cross;
    if (ci >= 0 && ci < pts.length) {
      const p = pts[ci];
      showCross(xs[ci], yOf(p.price), c);
      setHeadline(p.price, pctOf(p.price));
      $('curSub').textContent = (st.stealth ? '' : codeText + ' · ') + (five ? String(p.d).slice(5) + ' ' : '') + p.t;
      $('legend').innerHTML = `均价 ${fmtP(p.avg)} · 量 ${fmtVol(p.vol)}`;
    } else {
      $('chart').classList.remove('crossing');
      setHeadline(s.price, s.pct);
      $('curSub').textContent = st.stealth ? '' : codeText + ' · ' + (isIndex(s.code) ? '指数' : MK_NAME[mk]);
      $('legend').innerHTML = five ? '五日分时' : '<i class="lg" style="background:#FFC26B"></i>均价';
    }
  }

  function ma(closes, n, i) {
    if (i < n - 1) return null;
    let t = 0;
    for (let j = i - n + 1; j <= i; j++) t += closes[j];
    return t / n;
  }

  function drawKline(s, all, codeText) {
    const SHOW = 60;
    const off = Math.max(0, all.length - SHOW);
    const bars = all.slice(off);
    const closes = all.map((b) => b.close);
    const n = bars.length;
    const bw = W / Math.max(n, 30);
    let hi = Math.max(...bars.map((b) => b.high)), lo = Math.min(...bars.map((b) => b.low));
    const ma5 = bars.map((_, i) => ma(closes, 5, i + off)), ma20 = bars.map((_, i) => ma(closes, 20, i + off));
    for (const v of ma5.concat(ma20)) if (v !== null) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    const pad = (hi - lo) * 0.06 || hi * 0.01;
    hi += pad; lo -= pad;
    const yOf = (v) => 4 + (hi - v) / (hi - lo) * (CH - 8);
    const xs = bars.map((_, i) => (i + 0.5) * bw);
    st.hitXs = xs;
    let svg = `<line x1="0" y1="${CH / 4}" x2="${W}" y2="${CH / 4}" stroke="rgba(255,255,255,.06)"/>` +
      `<line x1="0" y1="${CH / 2}" x2="${W}" y2="${CH / 2}" stroke="rgba(255,255,255,.06)"/>` +
      `<line x1="0" y1="${CH * 3 / 4}" x2="${W}" y2="${CH * 3 / 4}" stroke="rgba(255,255,255,.06)"/>`;
    const body = Math.max(1, bw * 0.62);
    bars.forEach((b, i) => {
      const up = b.close >= b.open;
      const col = up ? upColor() : downColor();
      const x = xs[i];
      const top = yOf(Math.max(b.open, b.close)), bot = yOf(Math.min(b.open, b.close));
      svg += `<line x1="${x.toFixed(1)}" y1="${yOf(b.high).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yOf(b.low).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
      svg += `<rect x="${(x - body / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${body.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}" fill="${col}"${up && !st.stealth ? ` fill-opacity=".9"` : ''}/>`;
    });
    const path = (arr) => arr.map((v, i) => v === null ? null : `${xs[i].toFixed(1)},${yOf(v).toFixed(1)}`).filter(Boolean).join(' ');
    svg += `<polyline points="${path(ma5)}" fill="none" stroke="#FFC26B" stroke-width="1.1" stroke-opacity=".85"/>`;
    svg += `<polyline points="${path(ma20)}" fill="none" stroke="#8AB4FF" stroke-width="1.1" stroke-opacity=".85"/>`;
    $('chartSvg').innerHTML = svg;
    $('axHi').textContent = fmtP(hi); $('axHi').style.color = '';
    $('axLo').textContent = fmtP(lo); $('axLo').style.color = '';
    $('axMid').textContent = ''; $('axHiP').textContent = ''; $('axLoP').textContent = '';
    // 时间轴：4 个日期
    const ticks = [0, Math.floor(n / 3), Math.floor(n * 2 / 3), n - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    $('timeAxis').innerHTML = ticks.map((i) => `<span class="mid" style="left:${(xs[i] / W * 100).toFixed(2)}%">${esc(String(bars[i].d).slice(st.view === 'week' ? 2 : 5))}</span>`).join('');
    drawVolBars(bars.map((b) => b.vol), bars.map((b) => b.close - b.open), xs, body);

    const ci = st.cross;
    const show = (i) => {
      const b = bars[i];
      const prev = i + off > 0 ? all[i + off - 1].close : b.open;
      return { b, pct: prev ? (b.close - prev) / prev * 100 : 0 };
    };
    if (ci >= 0 && ci < n) {
      const { b, pct } = show(ci);
      showCross(xs[ci], yOf(b.close), colorOf(pct));
      setHeadline(b.close, pct);
      $('curSub').textContent = (st.stealth ? '' : codeText + ' · ') + b.d;
      $('legend').innerHTML = `开 ${fmtP(b.open)} 高 ${fmtP(b.high)} 低 ${fmtP(b.low)}` +
        (ma5[ci] !== null ? ` · <span style="color:#FFC26B">MA5 ${fmtP(ma5[ci])}</span>` : '') +
        (ma20[ci] !== null ? ` <span style="color:#8AB4FF">MA20 ${fmtP(ma20[ci])}</span>` : '');
    } else {
      $('chart').classList.remove('crossing');
      setHeadline(s.price, s.pct);
      $('curSub').textContent = (st.stealth ? '' : codeText + ' · ') + (st.view === 'week' ? '周K' : '日K') + ' · 前复权';
      const li = n - 1;
      $('legend').innerHTML = (ma5[li] !== null ? `<span style="color:#FFC26B">MA5 ${fmtP(ma5[li])}</span>` : '') +
        (ma20[li] !== null ? ` <span style="color:#8AB4FF">MA20 ${fmtP(ma20[li])}</span>` : '');
    }
  }

  function drawVolBars(vols, dirs, xs, bodyW) {
    const n = vols.length;
    const vMax = Math.max(1, ...vols);
    const bw = W / n;
    $('volSvg').innerHTML = vols.map((v, b) => {
      if (!v) return '';
      const h = Math.max(1, v / vMax * (VH - 2));
      const w = bodyW || bw - 2;
      const x = xs ? xs[b] - w / 2 : b * bw + 1;
      return `<rect x="${x.toFixed(1)}" y="${(VH - h).toFixed(1)}" width="${Math.max(1, w).toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${dirs[b] >= 0 ? upColor() : downColor()}" fill-opacity=".5"/>`;
    }).join('');
  }

  function showCross(x, y, c) {
    const chart = $('chart');
    chart.classList.add('crossing');
    $('crossLine').style.left = (x / W * 100) + '%';
    $('crossDot').style.left = (x / W * 100) + '%';
    $('crossDot').style.top = (y / CH * 100) + '%';
    $('crossDot').style.background = c;
  }

  function setHeadline(price, pct) {
    $('curPrice').textContent = fmtP(price);
    $('curPrice').style.color = colorOf(pct);
    $('curPct').textContent = fmtPct(pct);
    $('curPct').style.color = colorOf(pct);
    $('curPct').style.background = tintOf(pct);
  }

  async function refreshSelectedMinute(force) {
    const s = cur();
    if (!s) return;
    renderChart();
    const view = st.view;
    await loadView(s, force);
    const now = cur();
    if (st.open && now && now.code === s.code && st.view === view) { renderChart(); fitPanel(); }
  }

  // ---------- 数据 / 五档 / 本组持仓 ----------
  function renderData() {
    const s = cur();
    const v = $('dataView');
    const isA = s && marketOf(s.code) === 'a' && !isIndex(s.code);
    const bookBtn = document.querySelector('#dataTabs [data-d="book"]');
    bookBtn.hidden = !isA;
    if (st.dview === 'book' && !isA) st.dview = 'data';
    const holdBtn = document.querySelector('#dataTabs [data-d="hold"]');
    holdBtn.hidden = st.stealth;
    if (st.dview === 'hold' && st.stealth) st.dview = 'data';
    document.querySelectorAll('#dataTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.d === st.dview)));
    if (!s) { v.innerHTML = ''; return; }
    if (st.dview === 'book') { v.innerHTML = bookHtml(s); return; }
    if (st.dview === 'hold') { v.innerHTML = holdHtml(); return; }
    const pc = s.prevClose;
    const cell = (k, val, c) => `<div class="kv"><span>${k}</span><span class="num"${c ? ` style="color:${c}"` : ''}>${val}</span></div>`;
    const cmp = (x) => x == null || pc == null ? '' : colorOf(x - pc);
    const amp = s.high != null && s.low != null && pc ? ((s.high - s.low) / pc * 100).toFixed(2) + '%' : '--';
    v.innerHTML = '<div class="kv-grid">' +
      cell('今开', fmtP(s.open), cmp(s.open)) + cell('最高', fmtP(s.high), cmp(s.high)) + cell('最低', fmtP(s.low), cmp(s.low)) + cell('昨收', fmtP(pc)) +
      cell('成交量', fmtVol(s.volume)) + cell('成交额', fmtVol(s.amount)) +
      (isIndex(s.code) ? cell('振幅', amp) + cell('涨跌', s.change == null ? '--' : (s.change >= 0 ? '+' : '') + fmtP(s.change), colorOf(s.change))
        : cell('换手', s.turnover == null ? '--' : s.turnover.toFixed(2) + '%') + cell(s.volRatio != null ? '量比' : '振幅', s.volRatio != null ? s.volRatio.toFixed(2) : amp)) +
      '</div>';
  }

  function bookHtml(s) {
    const b = st.book[s.code] && st.book[s.code].data;
    if (!b) { loadBook(s.code); return '<div class="data-empty">加载中…</div>'; }
    const pc = s.prevClose;
    const row = (k, x) => `<div class="bk num"><span>${k}</span><span style="color:${x.price == null ? '' : colorOf(x.price - pc)}">${x.price == null ? '--' : fmtP(x.price)}</span><span>${x.vol == null ? '' : fmtVol(x.vol)}</span></div>`;
    const lv = ['一', '二', '三', '四', '五'];
    return '<div class="book"><div class="book-col">' + b.asks.map((x) => row('卖' + lv[x.level - 1], x)).join('') +
      '</div><div class="book-col">' + b.bids.map((x) => row('买' + lv[x.level - 1], x)).join('') + '</div></div>';
  }

  let bookTimer = null;
  async function loadBook(code, force) {
    const c = st.book[code];
    if (!force && c && (c.loading || Date.now() - c.at < 2500)) return;
    st.book[code] = Object.assign({}, c || { at: 0, data: null }, { loading: true });
    const data = await api.getBook(code).catch(() => null);
    st.book[code] = { at: Date.now(), data: data || (c && c.data) || null };
    const s = cur();
    if (st.open && st.dview === 'book' && s && s.code === code) { $('dataView').innerHTML = bookHtml(s); fitPanel(); }
  }

  function holdHtml() {
    const g = st.pnl.groups && st.pnl.groups[st.cfg.activeGroup];
    if (!g) return '<div class="data-empty">这个分组还没有填持仓 · 右键下面的股票 →「编辑持仓」</div>';
    const how = st.cfg.pnlShow;
    const money = (v) => v === null ? '--' : fmtMoney(v);
    const head = `<div class="hold-sum num"><span>市值 <b>${fmtMoney(g.mv).replace(/^\+/, '')}</b></span>` +
      `<span>今日 <b style="color:${colorOf(g.today)}">${how === 'pct' ? fmtPct(g.todayPct) : money(g.today)}</b></span>` +
      (g.total !== null ? `<span>持仓 <b style="color:${colorOf(g.total)}">${how === 'pct' ? fmtPct(g.totalPct) : money(g.total) + '（' + fmtPct(g.totalPct) + '）'}</b></span>` : '') +
      `<span class="fx">${st.pnl.fx && (st.pnl.fx.USD || st.pnl.fx.HKD) && g.items.some((x) => x.fx !== 1) ? `港币 ${st.pnl.fx.HKD.toFixed(3)} · 美元 ${st.pnl.fx.USD.toFixed(3)}${st.pnl.fx.auto ? '' : '（手动）'}` : '人民币'}</span></div>`;
    const rows = g.items.map((x) => {
      const q = st.quotes[x.code] || {};
      return `<div class="hold-row num" data-code="${esc(x.code)}"><span class="hn">${esc(q.name || bare(x.code))}</span>` +
        `<span>${x.qty.toLocaleString('en-US')}</span>` +
        `<span style="color:${colorOf(x.today)}">${how === 'pct' ? fmtPct(x.todayPct) : fmtMoney(x.todayCny)}</span>` +
        `<span style="color:${colorOf(x.total)}">${x.totalCny === null ? '--' : how === 'pct' ? fmtPct(x.totalPct) : fmtMoney(x.totalCny)}</span>` +
        `<span class="w">${x.weight.toFixed(0)}%</span></div>`;
    }).join('');
    return head + `<div class="hold-row hold-th"><span>名称</span><span>股数</span><span>今日</span><span>持仓</span><span class="w">占比</span></div>` + rows;
  }

  const keyName = (k) => String(k || '').replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');
  function renderFoot() {
    const cfg = st.cfg;
    const foot = $('foot');
    const offline = st.page === 'stock' && !st.online;
    foot.classList.toggle('offline', offline);
    const boss = `${keyName(cfg.bossKey)} 一键隐藏`;
    foot.textContent = offline ? '行情连接中断，正在重试…'
      : st.page === 'stock' ? `${st.source === 'tencent' ? '东方财富暂时连不上，正在用腾讯行情' : '数据来自东方财富，可能有延迟'} · ${boss} · ${keyName(cfg.stealthKey)} 低调模式`
      : st.page === 'music' ? `支持所有接入系统媒体控制的播放器 · ${boss}`
      : st.page === 'clip' ? `${keyName(cfg.clipKey)} 随时唤出 · 点一条即复制，回车复制第一条 · Esc 收起`
      : st.page === 'msg' ? '消息只保存在内存里，退出余光后清空'
      : `${keyName(cfg.todoKey)} 随时唤出 · 点文字可修改 · Esc 收起`;
  }

  // ---------- 交互 ----------
  function openPanel(sel, page) {
    st.open = true;
    st.enteredPanel = st.inside;
    st.hot = null;
    st.cross = -1;
    if (typeof sel === 'number') { st.sel = sel; st.selCode = null; }
    closeSheets();
    setPage(page || 'stock');
    renderPanel();
    applyForm();
    syncFocus();
    refreshSelectedMinute(false);
    clearInterval(minuteTimer);
    minuteTimer = setInterval(() => { if (st.open) refreshSelectedMinute(true); }, 30000);
  }
  /** 面板收起后丢掉用不到的图表数据：K 线、五日、五档全清，分时只留当前分组的 */
  function pruneCaches() {
    st.charts = {};
    st.book = {};
    const keep = new Set(group().codes);
    for (const c of Object.keys(st.minute)) if (!keep.has(c) && !st.minute[c].loading) delete st.minute[c];
  }
  function closePanel() {
    st.open = false;
    closeSheets();
    pruneCaches();
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
      if (st.selCode && !(st.cfg.indexes || []).includes(st.selCode)) st.selCode = null;
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
  // 鼠标按住时（比如在面板里拖选文字后移出去）先不收，松开再判断
  let mouseHeld = false, leavePending = false;
  document.addEventListener('mousedown', () => { mouseHeld = true; }, true);
  document.addEventListener('mouseup', () => {
    mouseHeld = false;
    if (leavePending && !st.inside) { leavePending = false; onLeave(); }
  }, true);
  function onLeave() {
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (st.open) {
        // 正在打字、弹出了预警 / 持仓小窗时，鼠标移开不收起（按 Esc 或点别处才收）
        if (isTyping() || sheet.kind) return;
        // 用快捷键打开、鼠标从没进过面板：不按“移开就收”处理
        if (!st.enteredPanel) return;
        if (mouseHeld) { leavePending = true; return; }
      }
      st.hover = false;
      st.hot = null;
      if (st.open) closePanel(); else applyForm();
    }, st.cfg.collapseDelayMs);
  }

  // 鼠标是否在岛上：在岛上时接收点击，不在时把点击穿透给下面的软件
  function trackPointer(target) {
    const inside = !!(target && target.closest && target.closest('.interactive'));
    if (inside && st.open) st.enteredPanel = true;
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
    if (!el) return;
    const sc = stocks()[Number(el.dataset.i)];
    if (sc && st.flags.has(sc.code)) { st.flags.delete(sc.code); renderSegments(); renderTicker(); }
    if (!stripBubbles()) return;
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
  tz.addEventListener('click', () => {
    const rows = tickRows();
    const r = rows.length ? rows[st.tIdx % rows.length] : null;
    const i = r && !r.summary ? stocks().findIndex((x) => x.code === r.code) : 0;
    openPanel(Math.max(0, i));
  });

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
    if (e.key === 'Escape' && st.open) {
      e.preventDefault();
      if (sheet.kind || $('ctxMenu').classList.contains('show')) { closeSheets(); fitPanel(); } else closePanel();
    }
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
    st.selCode = null;
    st.cross = -1;
    renderPanel();
    refreshSelectedMinute(false);
  });
  $('chips').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    e.preventDefault();
    const s = stocks()[Number(b.dataset.i)];
    if (s) openCtx(e, s.code, Number(b.dataset.i));
  });
  $('idxRow').addEventListener('click', (e) => {
    const b = e.target.closest('.idx');
    if (!b) return;
    // 再点一次回到股票
    st.selCode = st.selCode === b.dataset.code ? null : b.dataset.code;
    st.cross = -1;
    renderPanel();
    refreshSelectedMinute(false);
  });
  $('chartTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b || b.dataset.view === st.view) return;
    st.view = b.dataset.view;
    st.cross = -1;
    renderPanel();
    refreshSelectedMinute(false);
  });
  $('dataTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    st.dview = b.dataset.d;
    renderData();
    fitPanel();
  });
  $('dataView').addEventListener('click', (e) => {
    const r = e.target.closest('.hold-row[data-code]');
    if (!r) return;
    const i = stocks().findIndex((x) => x.code === r.dataset.code);
    if (i >= 0) { st.sel = i; st.selCode = null; st.cross = -1; renderPanel(); refreshSelectedMinute(false); }
  });
  $('holdLine').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="edit-hold"]')) { const s = cur(); if (s) openHoldSheet(s.code); }
  });
  $('btnAlert').addEventListener('click', () => { const s = cur(); if (s) openAlertSheet(s.code); });
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
    const xs = st.hitXs;
    if (!xs || !xs.length) return;
    const r = hit.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * W;
    // 二分找最近的点
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m; else hi = m; }
    const ci = Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
    // 分时还没走到的部分不显示
    if (x > xs[xs.length - 1] + 8 && st.view === 'min1') { if (st.cross !== -1) { st.cross = -1; renderChart(); } return; }
    if (ci !== st.cross) { st.cross = ci; renderChart(); }
  });
  hit.addEventListener('mouseleave', () => { st.cross = -1; renderChart(); });

  // ---------- 预警设置 / 持仓编辑 / 右键菜单 ----------
  const sheet = { kind: null, code: null, rule: null };
  function closeSheets() {
    sheet.kind = null;
    $('alertSheet').classList.remove('show');
    $('holdSheet').classList.remove('show');
    closeCtx();
    panel.classList.remove('sheet-open');
  }
  function quoteOf(code) {
    return st.quotes[code] || { code, name: bare(code), price: null, pct: null };
  }
  const RULES = [
    { key: 'up', label: '价格涨到', hint: '向上突破时提醒', unit: '', step: 0.01 },
    { key: 'down', label: '价格跌到', hint: '向下跌破时提醒', unit: '', step: 0.01 },
    { key: 'pct', label: '今日涨跌幅超过', hint: '涨或跌超过这个幅度', unit: '%', step: 0.1 },
    { key: 'fast', label: '急拉 / 跳水', hint: '5 分钟内涨或跌超过', unit: '%', step: 0.1 },
    { key: 'limit', label: '涨停 / 跌停 / 开板', hint: '封板、开板时提醒（A 股）', unit: null }
  ];
  function defaultRule(q) {
    const p = q.price || 0;
    const round = (v) => Math.round(v * 100) / 100;
    return { upOn: false, up: p ? round(p * 1.03) : null, downOn: false, down: p ? round(p * 0.97) : null, pctOn: false, pct: 3, fastOn: false, fast: 2, limitOn: false, notify: 'card', repeat: 'once' };
  }
  function openAlertSheet(code) {
    closeSheets();
    const q = quoteOf(code);
    const saved = st.cfg.alerts[code];
    sheet.kind = 'alert';
    sheet.code = code;
    sheet.rule = Object.assign(defaultRule(q), saved || {});
    if (sheet.rule.up == null && q.price) sheet.rule.up = Math.round(q.price * 103) / 100;
    if (sheet.rule.down == null && q.price) sheet.rule.down = Math.round(q.price * 97) / 100;
    $('asTitle').textContent = dispName(q) + ' · 预警';
    $('asDelete').hidden = !saved;
    renderAlertSheet();
    $('alertSheet').classList.add('show');
    panel.classList.add('sheet-open');
    fitPanel();
  }
  function ruleHint(r, q) {
    if (!q.price) return r.hint;
    const rule = sheet.rule;
    if (r.key === 'up' || r.key === 'down') {
      const v = Number(rule[r.key]);
      if (!(v > 0)) return r.hint;
      const d = (v - q.price) / q.price * 100;
      return '距现价 ' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2) + '%';
    }
    if (r.key === 'pct') return '现在 ' + fmtPct(q.pct);
    if (r.key === 'limit' && marketOf(q.code) !== 'a') return '只对 A 股有效';
    return r.hint;
  }
  function renderAlertSheet() {
    const q = quoteOf(sheet.code);
    const rule = sheet.rule;
    $('asNow').textContent = q.price ? '现价 ' + fmtP(q.price) + '  ' + fmtPct(q.pct) : '';
    $('asRules').innerHTML = RULES.map((r) => {
      const on = !!rule[r.key + 'On'];
      const disabled = r.key === 'limit' && marketOf(sheet.code) !== 'a';
      return `<label class="rule${on ? ' on' : ''}${disabled ? ' disabled' : ''}" data-k="${r.key}">` +
        `<input type="checkbox" class="sw" data-k="${r.key}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>` +
        `<span class="rule-main"><span class="rule-label">${r.label}</span><span class="rule-hint num">${esc(ruleHint(r, q))}</span></span>` +
        (r.unit === null ? '' : `<span class="rule-val"><input class="field-input num" data-v="${r.key}" inputmode="decimal" value="${rule[r.key] == null ? '' : rule[r.key]}">${r.unit ? `<i>${r.unit}</i>` : ''}</span>`) +
        `</label>`;
    }).join('');
    document.querySelectorAll('#asNotify button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === rule.notify)));
    document.querySelectorAll('#asRepeat button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === rule.repeat)));
  }
  $('asRules').addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('input.sw')) { sheet.rule[t.dataset.k + 'On'] = t.checked; t.closest('.rule').classList.toggle('on', t.checked); }
  });
  $('asRules').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.matches('input[data-v]')) return;
    const n = parseFloat(t.value);
    sheet.rule[t.dataset.v] = Number.isFinite(n) ? n : null;
    // 填了数字就顺手打开这条
    if (Number.isFinite(n) && n > 0 && !sheet.rule[t.dataset.v + 'On']) {
      sheet.rule[t.dataset.v + 'On'] = true;
      const row = t.closest('.rule');
      row.classList.add('on');
      row.querySelector('input.sw').checked = true;
    }
    const r = RULES.find((x) => x.key === t.dataset.v);
    t.closest('.rule').querySelector('.rule-hint').textContent = ruleHint(r, quoteOf(sheet.code));
  });
  $('asNotify').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { sheet.rule.notify = b.dataset.v; renderAlertSheet(); } });
  $('asRepeat').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { sheet.rule.repeat = b.dataset.v; renderAlertSheet(); } });
  $('asSave').addEventListener('click', () => {
    const next = Object.assign({}, st.cfg.alerts);
    const r = Object.assign({}, sheet.rule);
    delete r.keep;
    if (hasRule(r)) next[sheet.code] = r; else delete next[sheet.code];
    api.setConfig({ alerts: next });
    closeSheets();
    fitPanel();
  });
  $('asDelete').addEventListener('click', () => {
    const next = Object.assign({}, st.cfg.alerts);
    delete next[sheet.code];
    api.setConfig({ alerts: next });
    closeSheets();
    fitPanel();
  });
  $('asCancel').addEventListener('click', () => { closeSheets(); fitPanel(); });
  $('asClose').addEventListener('click', () => { closeSheets(); fitPanel(); });

  function openHoldSheet(code) {
    closeSheets();
    const q = quoteOf(code);
    const h = st.cfg.holdings[code];
    sheet.kind = 'hold';
    sheet.code = code;
    $('hsTitle').textContent = dispName(q) + ' · 持仓';
    $('hsCur').textContent = marketOf(code) === 'hk' ? '港币' : marketOf(code) === 'us' ? '美元' : '元';
    $('hsQty').value = h ? h.qty : '';
    $('hsCost').value = h && h.cost ? h.cost : '';
    $('hsDelete').hidden = !h;
    renderHoldPreview();
    $('holdSheet').classList.add('show');
    panel.classList.add('sheet-open');
    fitPanel();
    setTimeout(() => $('hsQty').focus(), 60);
  }
  function renderHoldPreview() {
    const q = quoteOf(sheet.code);
    const qty = parseFloat($('hsQty').value), cost = parseFloat($('hsCost').value);
    const el = $('hsPreview');
    if (!(qty > 0) || !q.price) { el.textContent = '只保存在这台电脑上，用来算盈亏'; el.style.color = ''; return; }
    const prev = q.prevClose || q.price;
    const today = (q.price - prev) * qty;
    let t = `市值 ${fmtMoney(q.price * qty).replace(/^\+/, '')} · 今日 ${fmtMoney(today)}`;
    if (cost > 0) t += ` · 持仓 ${fmtMoney((q.price - cost) * qty)}（${fmtPct((q.price - cost) / cost * 100)}）`;
    el.textContent = t;
  }
  $('hsQty').addEventListener('input', renderHoldPreview);
  $('hsCost').addEventListener('input', renderHoldPreview);
  const saveHold = () => {
    const qty = parseFloat($('hsQty').value), cost = parseFloat($('hsCost').value);
    const next = Object.assign({}, st.cfg.holdings);
    if (qty > 0) next[sheet.code] = { qty, cost: cost > 0 ? cost : 0 }; else delete next[sheet.code];
    api.setConfig({ holdings: next });
    closeSheets();
    fitPanel();
  };
  $('hsSave').addEventListener('click', saveHold);
  $('holdSheet').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) saveHold(); });
  $('hsDelete').addEventListener('click', () => {
    const next = Object.assign({}, st.cfg.holdings);
    delete next[sheet.code];
    api.setConfig({ holdings: next });
    closeSheets();
    fitPanel();
  });
  $('hsCancel').addEventListener('click', () => { closeSheets(); fitPanel(); });
  $('hsClose').addEventListener('click', () => { closeSheets(); fitPanel(); });

  // 右键菜单
  const ctx = { code: null, i: -1 };
  function openCtx(e, code, i) {
    ctx.code = code; ctx.i = i;
    const m = $('ctxMenu');
    const hasAlert = st.cfg.alerts[code] && hasRule(st.cfg.alerts[code]);
    const hasHold = !!st.cfg.holdings[code];
    const items = [
      ['alert', hasAlert ? '修改预警…' : '设预警…'],
      ['hold', hasHold ? '修改持仓…' : '编辑持仓…'],
      ['-'],
      ['top', '移到最前', i === 0],
      ['copy', '复制代码'],
      ['-'],
      ['remove', '移出分组', false, true]
    ];
    m.innerHTML = items.map(([act, label, disabled, danger]) => act === '-' ? '<i class="ctx-sep"></i>'
      : `<button type="button" role="menuitem" data-act="${act}"${disabled ? ' disabled' : ''}${danger ? ' class="danger"' : ''}>${label}</button>`).join('');
    const pr = panel.getBoundingClientRect();
    const scale = pr.width / panel.offsetWidth || 1;
    let x = (e.clientX - pr.left) / scale, y = (e.clientY - pr.top) / scale;
    m.classList.add('show');
    x = Math.min(x, panel.offsetWidth - m.offsetWidth - 8);
    if (y + m.offsetHeight > panel.offsetHeight - 8) y = y - m.offsetHeight;
    m.style.left = Math.max(8, x) + 'px';
    m.style.top = Math.max(8, y) + 'px';
  }
  function closeCtx() { $('ctxMenu').classList.remove('show'); }
  $('ctxMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const code = ctx.code;
    closeCtx();
    const cfg = st.cfg;
    const gi = cfg.activeGroup;
    if (b.dataset.act === 'alert') openAlertSheet(code);
    else if (b.dataset.act === 'hold') openHoldSheet(code);
    else if (b.dataset.act === 'copy') api.copyText(bare(code).toUpperCase());
    else if (b.dataset.act === 'top' || b.dataset.act === 'remove') {
      const groups = JSON.parse(JSON.stringify(cfg.groups));
      const codes = groups[gi].codes.filter((c) => c !== code);
      if (b.dataset.act === 'top') codes.unshift(code);
      groups[gi].codes = codes;
      st.sel = b.dataset.act === 'top' ? 0 : Math.min(st.sel, Math.max(0, codes.length - 1));
      api.setConfig({ groups });
    }
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxMenu')) closeCtx(); }, true);
  // 面板里其他地方不弹浏览器的右键菜单（输入框除外）
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

  // ---------- 预警触发 ----------
  function onAlertEvent(ev) {
    const name = st.stealth ? bare(ev.code).toUpperCase() : ev.name;
    const title = st.stealth ? ev.title.replace(ev.name, name) : ev.title;
    if (ev.notify === 'strip' || st.open) {
      // 只闪光带：那一段变成琥珀色，直到看过为止
      st.flags.add(ev.code);
      renderSegments();
      renderTicker();
      if (st.open) renderPanel();
      return;
    }
    showAlert({ kind: 'alert', app: '预警', code: ev.code, alertKind: ev.kind, title, body: ev.body, time: ev.time }, ev.cardMs);
  }

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

  const ALERT_ICON = {
    up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/></svg>',
    down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7l6 6 4-4 6 7"/><path d="M15 16h5v-5"/></svg>',
    bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'
  };
  function alertLook(kind) {
    const up = /up$/.test(kind || ''), down = /down$/.test(kind || '');
    const c = up ? upColor() : down ? downColor() : '#FFC26B';
    return { icon: up ? ALERT_ICON.up : down ? ALERT_ICON.down : ALERT_ICON.bell, color: c };
  }
  function showAlert(item, ms) {
    const a = $('alertAvatar');
    if (item.kind === 'alert') {
      const look = alertLook(item.alertKind);
      a.className = 'avatar alert-ico';
      a.style.background = 'rgba(255,255,255,.08)';
      a.style.color = look.color;
      a.innerHTML = look.icon;
    } else {
      const av = avatarOf(item.app);
      a.className = 'avatar';
      a.style.background = av.color;
      a.style.color = '';
      a.textContent = av.text;
    }
    $('alertApp').textContent = item.kind === 'mail' ? (item.account || '邮件') : item.app;
    $('alertTime').textContent = ago(item.time);
    $('alertTitle').textContent = item.title;
    $('alertBody').textContent = (item.body || '').replace(/\s+/g, ' ');
    msg.alert = item;
    msg.alertMs = ms || 5000;
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
    }, msg.alertMs || 5000);
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
        const isAlert = it.kind === 'alert';
        const look = isAlert ? alertLook(it.alertKind) : null;
        const act = it.kind === 'mail' ? 'data-act="open" tabindex="0" title="查看正文"' : isAlert ? 'data-act="stock" tabindex="0" title="查看行情"' : '';
        const title = isAlert && st.stealth ? it.title.replace(/^\S+/, bare(it.code).toUpperCase()) : it.title;
        return `<div class="msg-row${it.read ? '' : ' unread'}${it.kind === 'mail' || isAlert ? ' is-mail' : ''}" role="listitem" data-key="${esc(it.key)}" ${act}>
          ${isAlert ? `<span class="avatar alert-ico" style="background:rgba(255,255,255,.08);color:${look.color}">${look.icon}</span>` : `<span class="avatar" style="background:${av.color}">${esc(av.text)}</span>`}
          <span class="msg-main">
            <span class="msg-top"><span>${esc(it.kind === 'mail' ? (it.account || '邮件') : it.app)}</span><span class="num">${ago(it.time)}</span></span>
            <span class="msg-title">${esc(title)}</span>
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
    if (b.dataset.act === 'stock') {
      const it = msg.items.find((x) => x.key === row.dataset.key);
      if (it) { st.selCode = null; openOnCode(it.code); }
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
    const it = msg.alert;
    msg.alert = null;
    if (it && it.kind === 'alert') { openOnCode(it.code); return; }
    openPanel(undefined, 'msg');
  });
  /** 打开面板并定位到某只股票（不在当前分组时切到它所在的分组） */
  function openOnCode(code) {
    let gi = st.cfg.activeGroup;
    let i = group().codes.indexOf(code);
    if (i < 0) {
      gi = st.cfg.groups.findIndex((g) => g.codes.includes(code));
      if (gi >= 0) {
        st.cfg.activeGroup = gi;
        api.setConfig({ activeGroup: gi });
        st.segKey = '';
        renderSegments();
        renderTicker();
        i = st.cfg.groups[gi].codes.indexOf(code);
      }
    }
    st.flags.delete(code);
    openPanel(Math.max(0, i), 'stock');
  }

  // ---------- 数据 ----------
  function applyAppearance() {
    const c = st.cfg;
    const root = document.documentElement.style;
    root.setProperty('--scale', String(Number(c.scale) || 1));
    // 透明度只作用在岛的底色上，文字保持清晰；低调模式整体再淡一些
    root.setProperty('--fill-alpha', String(Number(c.opacity) || 1));
    root.setProperty('--opacity', String(st.stealth ? (Number(c.stealthOpacity) || 0.7) : 1));
    document.body.classList.toggle('stealth', st.stealth);
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
    if (!sheet.kind) renderPanel(); else if (sheet.kind === 'alert') renderAlertSheet();
    renderMusic();
    applyForm();
  }

  async function init() {
    st.cfg = await api.getConfig();
    st.quotes = await api.getQuotes();
    if (api.getSession) {
      const ses = await api.getSession();
      st.sessions = ses.sessions || {}; st.source = ses.source;
      st.stealth = !!(await api.getStealth());
      st.pnl = (await api.getPnl()) || st.pnl;
    }
    setPage('stock');
    renderAll();
    startRotation();
    api.onQuotes((q) => {
      st.quotes = q;
      renderSegments();
      renderTicker();
      // 弹窗打开时只更新它自己，不重画整个面板（避免输入框被重建）
      if (st.open && st.page === 'stock') {
        if (sheet.kind === 'alert') { $('asNow').textContent = (() => { const x = quoteOf(sheet.code); return x.price ? '现价 ' + fmtP(x.price) + '  ' + fmtPct(x.pct) : ''; })(); }
        else if (!sheet.kind) renderPanel();
        const s = cur();
        if (st.dview === 'book' && s) loadBook(s.code, true);
      }
      renderBubble();
    });
    if (api.onSession) {
      api.onSession((x) => {
        st.sessions = x.sessions || {};
        st.source = x.source;
        if (st.open && st.page === 'stock' && !sheet.kind) { const s = cur(); renderSession(s); renderFoot(); }
      });
      api.onStealth((on) => {
        st.stealth = !!on;
        renderAll();
      });
      api.onPnl((p) => {
        st.pnl = p || st.pnl;
        renderTicker();
        if (st.open && st.page === 'stock' && !sheet.kind) { const s = cur(); if (s) renderHoldLine(s); if (st.dview === 'hold') renderData(); fitPanel(); }
      });
      api.onAlert(onAlertEvent);
    }
    api.onConfig((cfg) => {
      const groupsChanged = JSON.stringify(cfg.groups) !== JSON.stringify(st.cfg.groups);
      const rotateChanged = cfg.rotateMs !== st.cfg.rotateMs || cfg.groupDisplay !== st.cfg.groupDisplay;
      st.cfg = cfg;
      if (rotateChanged) { st.tIdx = 0; tickerEl.classList.remove('anim'); }
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
