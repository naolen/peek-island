// 剪贴板监听。
// Electron 45 起剪贴板是异步接口：clipboard.read() 返回 ClipboardItem[]，每项有 types 和 getType(type) → Blob。
//
// 什么时候去读剪贴板：
//   - 有原生小助手时：小助手用 Windows 的“剪贴板序号”发现变化后通知这里（poke），只在真正变化时读，几乎不耗电
//   - 没有小助手时：每 0.7 秒读一次文字；图片每 2 秒才检查一次（读图片比较重）
const { clipboard, nativeImage, ClipboardItem } = require('electron');
const crypto = require('crypto');

class ClipWatcher {
  constructor(store, { onChange, getOptions, log }) {
    this.store = store;
    this.onChange = onChange;
    this.getOptions = getOptions;
    this.log = log || (() => {});
    this.timer = null;
    this.lastText = null;
    this.lastImageKey = null;
    this.skipUntil = 0;
    this.busy = false;
    this.pending = false;
    this.native = false;    // 小助手在推送剪贴板变化时为 true
    this.lastImageCheck = 0;
    this.errors = 0;
  }

  async start() {
    // 启动时把当前内容当作“已见过”，避免一开就多出一条
    try {
      const snap = await this.snapshot(true);
      this.lastText = snap.text;
      this.lastImageKey = snap.imageKey;
    } catch (e) { /* ignore */ }
    this.stop();
    this.timer = setInterval(() => { if (!this.native) this.tick(false); }, 700);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  /** 小助手报告剪贴板变了 */
  poke() {
    this.native = true;
    this.tick(true);
  }

  /** 读剪贴板：返回 { text, hasImage, imageKey, png, width, height } */
  async snapshot(withImage) {
    const items = await clipboard.read();
    const item = items && items[0];
    const types = item ? item.types : [];
    let text = '';
    if (types.includes('text/plain')) {
      const blob = await item.getType('text/plain');
      text = typeof blob === 'string' ? blob : await blob.text();
    }
    const imageType = types.find((t) => /^image\//.test(t));
    const out = { text, hasImage: !!imageType, imageKey: null, png: null, width: 0, height: 0 };
    if (imageType && withImage) {
      const blob = await item.getType(imageType);
      const buf = Buffer.from(await blob.arrayBuffer());
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        // 缩小后再算指纹，避免对整张大图做哈希
        const key = width + 'x' + height + ':' + crypto.createHash('sha1').update(img.resize({ width: 32 }).toBitmap()).digest('hex');
        Object.assign(out, { imageKey: key, png: img, width, height });
      }
    }
    return out;
  }

  async tick(force) {
    const opts = this.getOptions();
    if (!opts.enabled) return;
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    let changed = false;
    try {
      const now = Date.now();
      // 没有小助手时，图片每 2 秒检查一次
      const checkImage = opts.images && (force || this.native || now - this.lastImageCheck > 2000);
      if (checkImage) this.lastImageCheck = now;
      const snap = await this.snapshot(checkImage);
      const skip = Date.now() < this.skipUntil;
      const textChanged = snap.text !== this.lastText;
      this.lastText = snap.text;

      // 有文字时优先记文字（Excel、Word 复制时会同时带一张图片，记文字更有用）
      if (textChanged && snap.text && snap.text.trim()) {
        if (!skip) changed = !!this.store.addText(snap.text) || changed;
      } else if (snap.imageKey && snap.imageKey !== this.lastImageKey && !snap.text.trim()) {
        if (!skip) {
          const img = snap.png;
          const thumb = img.resize(snap.width > snap.height ? { width: Math.min(240, snap.width) } : { height: Math.min(160, snap.height) });
          changed = !!this.store.addImage({ png: img.toPNG(), thumb: thumb.toPNG(), hash: snap.imageKey, width: snap.width, height: snap.height }) || changed;
        }
      }
      if (snap.imageKey) this.lastImageKey = snap.imageKey;
      else if (checkImage && !snap.hasImage) this.lastImageKey = null;
      this.errors = 0;
    } catch (e) {
      // 剪贴板被别的程序占用时会读取失败，下一轮再试；连续失败才记日志
      if (++this.errors === 5) this.log('[clip] 读取剪贴板连续失败：' + (e && e.message));
    } finally {
      this.busy = false;
    }
    if (changed) this.onChange();
    if (this.pending) { this.pending = false; this.tick(true); }
  }

  /** 把历史里的一条写回剪贴板；写回的内容不再重复记录 */
  async copy(item) {
    this.skipUntil = Date.now() + 1500;
    try {
      if (item.type === 'text') {
        await clipboard.writeText(item.text);
        this.lastText = item.text;
        this.store.addText(item.text);
      } else {
        const img = nativeImage.createFromPath(this.store.imagePath(item));
        if (img.isEmpty()) return false;
        const png = img.toPNG();
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
        this.lastText = '';
        this.lastImageKey = item.hash.replace(/^i:/, '');
        this.store.upsert({ type: 'image', hash: item.hash }, Date.now());
      }
      return true;
    } catch (e) {
      this.log('[clip] 写回剪贴板失败：' + (e && e.message));
      return false;
    }
  }
}

module.exports = { ClipWatcher };
