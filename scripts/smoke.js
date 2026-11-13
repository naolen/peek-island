// 本地截图自测：xvfb-run npx electron scripts/smoke.js <输出目录>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const out = process.argv[process.argv.length - 1];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 720, height: 660, show: true, backgroundColor: '#2A313C', webPreferences: { preload: path.join(__dirname, 'mock-preload.js'), contextIsolation: true, sandbox: false } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'island.html'));
  const shot = async (name) => { await wait(900); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); };
  const js = (code) => win.webContents.executeJavaScript(code);
  await shot('1-strip');
  await js(`(() => { const s = document.querySelectorAll('.seg-item')[3]; s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()`);
  await shot('2-strip-hover');
  await js(`document.getElementById('segs').dispatchEvent(new MouseEvent('mouseleave')); document.getElementById('hot').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
  await shot('3-island');
  await js(`document.getElementById('tickerZone').dispatchEvent(new MouseEvent('mouseenter'))`);
  await shot('4-island-bubble');
  await js(`document.getElementById('tickerZone').click()`);
  await shot('5-panel');
  await js(`(() => { const h = document.getElementById('chartHit'); const r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width * 0.3, clientY: r.top + 50, bubbles: true })); })()`);
  await shot('6-panel-cross');
  const errs = await js('window.__errs || []');
  console.log('done', errs);
  app.quit();
});
