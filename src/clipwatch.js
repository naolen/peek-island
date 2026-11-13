// 剪贴板监听：每 0.6 秒看一眼剪贴板，有新内容就记进历史。
// Electron 没有“剪贴板变化”事件，只能轮询；为了省电，图片只在格式里出现图片时才处理，并先缩小再算指纹。
const { clipboard, nativeImage } = require('electron');
const crypto = require('crypto');

class ClipWatcher {
  constructor(store, { onChange, getOptions }) {
    this.store = store;
    this.onChange = onChange;
    this.getOptions = getOptions;
    this.timer = null;
    this.lastText = null;
    this.lastImageKey = null;
    this.skipUntil = 0;
  }

  start() {
    // 启动时把当前剪贴板内容当作“已见过”，避免一开就多出一条
    try {
      this.lastText = clipboard.readText();
      this.lastImageKey = this.imageKey(clipboard.readImage());
    } catch (e) { /* ignore */ }
    this.stop();
    this.timer = setInterval(() => this.tick(), 600);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  imageKey(img) {
    if (!img || img.isEmpty()) return null;
    const { width, height } = img.getSize();
    // 缩到 32 像素宽再算指纹，避免每次都对整张大图做哈希
    const small = img.resize({ width: 32 });
    return width + 'x' + height + ':' + crypto.createHash('sha1').update(small.toBitmap()).digest('hex');
  }

  tick() {
    const opts = this.getOptions();
    if (!opts.enabled) return;
    let changed = false;
    try {
      const formats = clipboard.availableFormats();
      const hasImage = formats.some((f) => /^image\//.test(f));
      const text = clipboard.readText();

      if (hasImage && opts.images) {
        const img = clipboard.readImage();
        const key = this.imageKey(img);
        if (key && key !== this.lastImageKey) {
          this.lastImageKey = key;
          if (Date.now() > this.skipUntil) {
            const { width, height } = img.getSize();
            const thumb = img.resize(width > height ? { width: Math.min(240, width) } : { height: Math.min(160, height) });
            changed = !!this.store.addImage({ png: img.toPNG(), thumb: thumb.toPNG(), hash: key, width, height });
          }
        }
      } else if (!hasImage) {
        this.lastImageKey = null;
      }

      if (text !== this.lastText) {
        this.lastText = text;
        // 复制图片时有的软件也会带一段文字（比如文件名），只有纯文字时才记文字
        if (!hasImage && Date.now() > this.skipUntil && text && text.trim()) {
          changed = !!this.store.addText(text) || changed;
        }
      }
    } catch (e) {
      // 剪贴板被别的程序占用时读取会失败，下一轮再试
    }
    if (changed) this.onChange();
  }

  /** 把历史里的一条写回剪贴板；写回的内容不再重复记录 */
  copy(item) {
    this.skipUntil = Date.now() + 1500;
    if (item.type === 'text') {
      clipboard.writeText(item.text);
      this.lastText = item.text;
      this.store.addText(item.text);
    } else {
      const img = nativeImage.createFromPath(this.store.imagePath(item));
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
      this.lastImageKey = this.imageKey(img);
      this.lastText = clipboard.readText();
      this.store.upsert({ type: 'image', hash: item.hash }, Date.now());
    }
    return true;
  }
}

module.exports = { ClipWatcher };
