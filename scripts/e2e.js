// 端到端自测：真实的主进程 + 真实的界面，只把网络换成假的行情服务器（scripts/fake-market.js）。
// 检查各种数据情况下面板都能打开、界面没有报错。
//   xvfb-run -a npx electron --no-sandbox scripts/e2e.js [截图目录]
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 固定“现在”为周五上午 10:30（北京时间）：A 股、港股交易中，美股已收盘
const RealDate = Date;
const offset = RealDate.parse('2026-11-13T02:30:00Z') - RealDate.now();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
  static now() { return RealDate.now() + offset; }
}
global.Date = FakeDate;

const state = { mode: 'normal' };
global.fetch = require('./fake-market').makeFetch(state);

const shotDir = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.js') && a !== '.');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'peek-e2e-'));
app.setPath('userData', userData);
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  refreshMs: 1500,
  groups: [
    { name: '自选', codes: ['sh600519', 'sz300750', 'sz002594', 'sh688981', 'sh600036'] },
    { name: '港美', codes: ['hk00700', 'hk03690', 'usNVDA', 'usBABA', 'usAAPL'] }
  ],
  holdings: { sh600519: { qty: 100, cost: 1550 }, hk00700: { qty: 200, cost: 452 }, usNVDA: { qty: 10, cost: 0 } },
  welcomed: false
}));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const failures = [];
const info = [];
let passed = 0;

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => {
    const lv = ev.level;
    if (lv === 'error' || lv === 3) errors.push(`[${state.mode}] ${ev.message}`);
  });
  win.webContents.on('render-process-gone', (_e2, d) => errors.push('渲染进程退出 ' + JSON.stringify(d)));
  win.webContents.once('did-finish-load', () => {
    if (win.webContents.getURL().includes('island.html')) run(win).catch((e) => { console.error(e); app.exit(1); });
  });
});

async function run(win) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const check = (name, ok, extra) => {
    if (ok) passed++; else failures.push(`[${state.mode}] ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  };
  // 截图只是给人看的，截不了（没有显卡的 CI 机器上会失败）不算测试失败
  let shotBroken = false;
  const shot = async (name) => {
    if (!shotDir || shotBroken) return;
    try {
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, name + '.png'), (await win.webContents.capturePage()).toPNG());
    } catch (e) { shotBroken = true; info.push('截图不可用：' + (e && e.message)); }
  };
  const formOf = () => js(`document.getElementById('morph').dataset.form`);
  const text = (id) => js(`document.getElementById('${id}').textContent`);
  const openPanel = async () => {
    await js(`document.getElementById('hot').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
    await wait(500);
    await js(`document.getElementById('tickerZone').click()`);
    await wait(900);
  };
  const closePanel = async () => { await js(`document.getElementById('btnClose').click()`); await wait(500); };
  const click = async (sel, ms = 500) => {
    const ok = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
    await wait(ms);
    return ok;
  };
  /** 把面板里所有能点的视图都点一遍 */
  const tour = async (label) => {
    await openPanel();
    check('面板展开', (await formOf()) === 'panel', await formOf());
    const h = await js(`document.getElementById('morph').getBoundingClientRect().height`);
    check('面板有高度', h > 300, h);
    for (const v of ['min5', 'day', 'week', 'min1']) {
      await click(`#chartTabs [data-view="${v}"]`, 700);
      // 在图上移动鼠标（十字光标）
      await js(`(() => { const h = document.getElementById('chartHit'); const r = h.getBoundingClientRect(); for (const k of [0.02, 0.5, 0.98]) h.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width * k, clientY: r.top + 40, bubbles: true })); h.dispatchEvent(new MouseEvent('mouseleave')); })()`);
      if (v === 'day') await shot(label + '-dayk');
    }
    for (const d of ['book', 'hold', 'data']) await click(`#dataTabs [data-d="${d}"]`, 400);
    await shot(label + '-panel');
    // 每只股票、每个指数、每个分组
    const chips = await js(`document.querySelectorAll('#chips .chip').length`);
    for (let i = 0; i < chips; i++) await click(`#chips .chip:nth-child(${i + 1})`, 250);
    const idx = await js(`document.querySelectorAll('#idxRow .idx').length`);
    for (let i = 0; i < idx; i++) await click(`#idxRow .idx:nth-child(${i + 1})`, 350);
    await click('#idxRow .idx[aria-pressed="true"]', 200);
    await click('#groupTabs .tab:nth-child(2)', 600);
    for (const v of ['day', 'min1']) await click(`#chartTabs [data-view="${v}"]`, 500);
    await click('#dataTabs [data-d="hold"]', 300);
    await shot(label + '-group2');
    await click('#dataTabs [data-d="data"]', 200);
    await click('#groupTabs .tab:nth-child(1)', 400);
    // 其他页面
    for (const p of ['music', 'clip', 'todo', 'msg', 'stock']) await click(`#pageTabs [data-page="${p}"]`, 350);
    check('切换一圈后面板还开着', (await formOf()) === 'panel', await formOf());
    await closePanel();
    check('面板收起', (await formOf()) !== 'panel', await formOf());
  };

  // ---------- 0. 第一次启动的欢迎卡片 ----------
  await wait(2500);
  check('第一次启动显示欢迎卡片', (await formOf()) === 'welcome', await formOf());
  await shot('welcome');
  await click('#wlOk', 900);
  check('知道了之后收成光带', (await formOf()) === 'strip', await formOf());

  // ---------- 1. 正常交易中 ----------
  await wait(1500);
  await js(`document.getElementById('hot').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
  await wait(700);
  const tick = await js(`document.getElementById('ticker').textContent`);
  check('岛上有报价', /1,701\.20/.test(tick), tick);
  await shot('normal-island');
  await openPanel();
  await click('#chips .chip:nth-child(1)', 600); // 岛上在轮播，点开的不一定是第一只
  check('现价', (await text('curPrice')) === '1,701.20', await text('curPrice'));
  check('交易状态', /A 股 交易中/.test(await text('sessionChip')), await text('sessionChip'));
  check('分时图画出来了', await js(`document.querySelectorAll('#chartSvg polyline').length >= 2`));
  check('指数条', /3,412\.56/.test(await text('idxRow')), await text('idxRow'));
  check('持仓行', /持有 100 股/.test(await text('holdLine')), await text('holdLine'));
  await click('#chartTabs [data-view="day"]', 900);
  check('日 K 画出来了', await js(`document.querySelectorAll('#chartSvg rect').length >= 30`));
  await click('#dataTabs [data-d="book"]', 900);
  check('五档', /卖一1,701\.30/.test(await text('dataView')), await text('dataView'));
  await click('#dataTabs [data-d="data"]', 200);
  await click('#chartTabs [data-view="min1"]', 300);
  // 预警：设一个已经满足的条件，应该马上弹卡片
  await click('#btnAlert', 500);
  check('预警小窗打开', await js(`document.getElementById('alertSheet').classList.contains('show')`));
  await js(`(() => { const i = document.querySelector('#asRules input[data-v="up"]'); i.value = '1750'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('#asSave', 400);
  check('预警已保存', /预警 1/.test(await text('alertCnt')), await text('alertCnt'));
  await closePanel();
  await wait(2000);
  check('没到价不提醒', (await formOf()) !== 'alert', await formOf());
  state.prices = { '1.600519': 1755.5 };
  await wait(3200);
  check('到价弹出卡片', (await formOf()) === 'alert', await formOf());
  check('预警标题', /贵州茅台 涨到 1,750\.00/.test(await text('alertTitle')), await text('alertTitle'));
  await shot('normal-alert');
  await wait(6800);
  check('卡片自动收起', (await formOf()) !== 'alert', await formOf());
  state.prices = null;
  // 在面板里搜索添加
  await openPanel();
  await click('#chips .chip-add', 500);
  check('添加小窗打开', await js(`document.getElementById('addSheet').classList.contains('show')`));
  await js(`(() => { const i = document.getElementById('adInput'); i.value = 'tx'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(900);
  check('搜索有结果', (await js(`document.querySelectorAll('#adList .ad-row').length`)) === 3);
  check('已有的不能重复加', await js(`document.querySelector('#adList .ad-row').disabled`));
  await shot('normal-add');
  await js(`document.getElementById('adInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(700);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(400);
  check('加进了分组', /腾讯控股/.test(await text('chips')), await text('chips'));
  check('添加后面板还开着', (await formOf()) === 'panel');
  // 键盘
  await click('#chips .chip:nth-child(1)', 300);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await wait(400);
  check('→ 换到下一只', (await text('curName')) === '宁德时代', await text('curName'));
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))`);
  await wait(900);
  check('3 切到日 K', await js(`document.querySelectorAll('#chartSvg rect').length >= 30`));
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))`);
  await wait(300);
  // 右键 → 移出分组
  await js(`(() => { const c = document.querySelector('#chips .chip:nth-child(6)'); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 20, clientY: r.top + 10, bubbles: true, cancelable: true })); })()`);
  await wait(300);
  await click('#ctxMenu [data-act="remove"]', 600);
  check('移出分组', !/腾讯控股/.test(await text('chips')), await text('chips'));
  await closePanel();
  await tour('normal');
  // diff 是对象而不是数组
  state.diffAsObject = true;
  await wait(2500);
  check('diff 为对象时也有报价', /1,701\.20/.test(await js(`document.getElementById('ticker').textContent`)));
  state.diffAsObject = false;

  // ---------- 2. 其他数据情况 ----------
  for (const mode of ['sparse', 'garbage', 'down', 'offline', 'normal']) {
    state.mode = mode;
    await wait(4200);
    await tour(mode);
    if (mode === 'offline') { await openPanel(); check('断网有提示', await js(`document.getElementById('foot').classList.contains('offline')`), await text('foot')); await shot('offline'); await closePanel(); }
    if (mode === 'down') { await openPanel(); check('东方财富挂了用腾讯', /腾讯/.test(await text('foot')), await text('foot')); await closePanel(); }
  }
  await openPanel();
  check('恢复后回到东方财富', /东方财富，/.test(await text('foot')), await text('foot'));
  await closePanel();
  // 没开盘 / 休市：现价是 "-"，行情时间是昨天。放在最后，因为休市后会降到 5 分钟刷新一次
  state.mode = 'preopen';
  await wait(4200);
  await tour('preopen');
  await openPanel();
  await click('#chips .chip:nth-child(1)', 500);
  check('休市时按昨收显示', (await text('curPrice')) === '1,668.50', await text('curPrice'));
  check('休市状态', /休市/.test(await text('sessionChip')), await text('sessionChip'));
  await closePanel();

  // ---------- 用快捷键唤出（鼠标不在岛上）：面板应该保持打开，不能一闪就收 ----------
  await js(`document.getElementById('hot').dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
  await wait(400);
  win.webContents.send('page:open', 'clip');
  await wait(2500);
  check('快捷键唤出后面板保持打开', (await formOf()) === 'panel', await formOf());
  info.push(`唤出后窗口焦点：isFocused=${win.isFocused()} isFocusable=${win.isFocusable()} isVisible=${win.isVisible()} 页面=${await js(`document.getElementById('panel').dataset.page`)}`);
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(700);
  check('Esc 收起', (await formOf()) !== 'panel', await formOf());
  info.push(`收起后窗口焦点：isFocused=${win.isFocused()} isFocusable=${win.isFocusable()}`);
  // 点击展开后过 3 秒还开着（Windows 上曾经出现过一展开就被收回）
  await openPanel();
  info.push(`点击展开后：isFocused=${win.isFocused()} isFocusable=${win.isFocusable()} bounds=${JSON.stringify(win.getBounds())}`);
  await wait(3000);
  check('点击展开 3 秒后还开着', (await formOf()) === 'panel', await formOf());
  const box = await js(`(() => { const r = document.getElementById('morph').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(document.getElementById('panel')).opacity]; })()`);
  check('面板有尺寸且可见', box[0] >= 590 && box[1] > 300 && box[2] === '1', box);
  await shot('panel-final');
  await closePanel();

  // ---------- 3. 设置窗口 ----------
  await js(`window.peek.openSettings && window.peek.openSettings('stock')`);
  await wait(2500);
  const { BrowserWindow } = require('electron');
  const sw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('settings.html'));
  check('设置窗口打开', !!sw);
  if (sw) {
    for (const sec of ['general', 'stock', 'alerts', 'holdings', 'stealth', 'look', 'music', 'notify', 'mail', 'clip', 'todo', 'about']) {
      await sw.webContents.executeJavaScript(`document.querySelector('#navList [data-section="${sec}"]').click()`);
      await wait(250);
    }
    const sjs = (code) => sw.webContents.executeJavaScript(code);
    // 检查更新：先是“已是最新”，发布了新版本后提示去下载
    await sjs(`document.getElementById('checkUpdate').click()`);
    await wait(800);
    check('检查更新：已是最新', /最新/.test(await sjs(`document.getElementById('updateHint').textContent`)), await sjs(`document.getElementById('updateHint').textContent`));
    state.latest = 'v99.0.0';
    await sjs(`document.getElementById('checkUpdate').click()`);
    await wait(800);
    check('检查更新：有新版本', /有新版本 99\.0\.0/.test(await sjs(`document.getElementById('updateHint').textContent`)), await sjs(`document.getElementById('updateHint').textContent`));
    // 恢复默认：点两次才生效，分组不动
    await sjs(`document.querySelector('#navList [data-section="about"]').click(); window.peek.setConfig({ rotateMs: 9000 })`);
    await wait(300);
    await sjs(`document.getElementById('resetConfig').click()`);
    await wait(200);
    await sjs(`document.getElementById('resetConfig').click()`);
    await wait(500);
    const after = await sjs(`window.peek.getConfig()`);
    check('恢复默认设置', after.rotateMs !== 9000 && after.groups.length === 2 && after.welcomed === true, { rotateMs: after.rotateMs, groups: after.groups.length });
    // 设置里搜索股票
    await sjs(`document.querySelector('#navList [data-section="stock"]').click()`);
    await sjs(`(() => { const i = document.getElementById('search'); if (!i) return; i.value = 'tx'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(1200);
    sw.close();
  }

  // ---------- 4. 真实的网络通道（Electron net.fetch，走系统代理）----------
  // 上面的测试都用假服务器；这里起一个本地 HTTP 服务，确认真正发请求的那条路是通的
  {
    const http = require('http');
    const seen = [];
    const srv = http.createServer((req, res) => {
      seen.push({ referer: req.headers.referer, cookie: req.headers.cookie });
      if (req.url.startsWith('/slow')) return;
      if (req.url.startsWith('/gbk')) return res.end(Buffer.from([0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8])); // “贵州茅台”的 GBK 编码
      res.setHeader('Set-Cookie', 'a=1');
      res.setHeader('Cache-Control', 'max-age=3600');
      res.end(String(seen.length));
    }).listen(0, '127.0.0.1');
    await new Promise((r) => srv.on('listening', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    const { getText } = require('../src/http');
    state.mode = 'net';
    global.fetch.isTestDouble = false;
    try {
      const h = { Referer: 'http://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' };
      const a = await getText(base + '/q', { headers: h });
      const b = await getText(base + '/q', { headers: h });
      check('不使用缓存', a === '1' && b === '2', [a, b]);
      check('带上 Referer、不带 Cookie', seen[1].referer === h.Referer && !seen[1].cookie, seen[1]);
      check('GBK 解码', (await getText(base + '/gbk', { encoding: 'gbk' })) === '贵州茅台');
      // 不合规的 Referer 会被 Chromium 拦掉，应该自动去掉后重试
      const c = await getText(base + '/q', { headers: { Referer: 'https://quote.eastmoney.com/center/' } });
      check('Referer 被拦时自动重试', /^\d+$/.test(c) && !seen[seen.length - 1].referer, c);
      const t0 = RealDate.now();
      const err = await getText(base + '/slow', { timeoutMs: 700 }).catch((e) => e.message);
      check('超时', err === '请求超时' && RealDate.now() - t0 < 2000, err);
    } catch (e) { check('真实网络通道', false, String(e && e.message)); }
    global.fetch.isTestDouble = true;
    srv.close();
  }

  await wait(300);
  const logFile = path.join(userData, 'logs', 'main.log');
  const mainErrors = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /uncaught|unhandled|TypeError|ReferenceError/i.test(l)) : [];
  console.log('\n平台：' + process.platform + ' ' + os.release() + '，Electron ' + process.versions.electron);
  for (const l of info) console.log('  ' + l);
  // CI 上把主进程日志也打出来，方便在构建记录里直接看
  if (process.env.CI && fs.existsSync(logFile)) console.log('---- main.log ----\n' + fs.readFileSync(logFile, 'utf8').split('\n').slice(-60).join('\n'));
  console.log(`\n通过 ${passed} 项`);
  if (failures.length) console.log('失败：\n  ' + failures.join('\n  '));
  if (errors.length) console.log('界面报错：\n  ' + Array.from(new Set(errors)).join('\n  '));
  if (mainErrors.length) console.log('主进程报错：\n  ' + mainErrors.join('\n  '));
  app.exit(failures.length || errors.length || mainErrors.length ? 1 : 0);
}

require('../src/main.js');
