// 剪贴板历史的存储（不依赖 Electron，便于单元测试）。
// 文字直接存在 history.json；图片存成 PNG 文件，列表里只记文件名。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TEXT = 20000;

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

class ClipStore {
  /**
   * @param {string} dir 存储目录
   * @param {{limit:number}} opts limit = 最多保留多少条（收藏不算在内，永远保留）
   */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.imgDir = path.join(dir, 'img');
    this.file = path.join(dir, 'history.json');
    this.limit = opts.limit || 200;
    this.items = [];
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data.items)) this.items = data.items.filter((it) => it && it.id && (it.type === 'text' || it.type === 'image'));
    } catch (e) {
      this.items = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, items: this.items }), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[clip] 保存失败', e);
    }
  }

  setLimit(n) {
    this.limit = Math.max(10, Math.min(2000, Math.round(n) || 200));
    if (this.trim()) this.save();
  }

  /** 新增一条文字；和最近一条相同则只把它挪到最前面。返回新/挪动后的条目，空文本返回 null */
  addText(text, now = Date.now()) {
    if (typeof text !== 'string') return null;
    if (!text.trim()) return null;
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
    const hash = 't:' + crypto.createHash('sha1').update(text).digest('hex');
    return this.upsert({ type: 'text', text, hash }, now);
  }

  /** 新增一张图片。png 是 PNG 的 Buffer，thumb 是缩略图 PNG 的 Buffer，hash 用于去重 */
  addImage({ png, thumb, hash, width, height }, now = Date.now()) {
    if (!png || !png.length) return null;
    const key = 'i:' + hash;
    const existing = this.items.find((it) => it.hash === key);
    if (existing) return this.upsert({ type: 'image', hash: key }, now);
    const id = newId();
    try {
      fs.mkdirSync(this.imgDir, { recursive: true });
      fs.writeFileSync(path.join(this.imgDir, id + '.png'), png);
      if (thumb && thumb.length) fs.writeFileSync(path.join(this.imgDir, id + '.thumb.png'), thumb);
    } catch (e) {
      console.error('[clip] 图片保存失败', e);
      return null;
    }
    return this.upsert({ id, type: 'image', hash: key, width, height }, now);
  }

  upsert(entry, now) {
    const i = this.items.findIndex((it) => it.hash === entry.hash);
    let item;
    if (i >= 0) {
      item = this.items.splice(i, 1)[0];
      item.at = now;
    } else {
      item = Object.assign({ id: entry.id || newId(), fav: false, note: '' }, entry, { at: now });
    }
    this.items.unshift(item);
    this.trim();
    this.save();
    return item;
  }

  /** 超出上限时删掉最旧的非收藏条目；返回是否有删除 */
  trim() {
    let removed = false;
    let normal = this.items.filter((it) => !it.fav).length;
    for (let i = this.items.length - 1; i >= 0 && normal > this.limit; i--) {
      if (this.items[i].fav) continue;
      this.removeFiles(this.items[i]);
      this.items.splice(i, 1);
      normal--;
      removed = true;
    }
    return removed;
  }

  removeFiles(item) {
    if (item.type !== 'image') return;
    for (const f of [item.id + '.png', item.id + '.thumb.png']) {
      try { fs.unlinkSync(path.join(this.imgDir, f)); } catch (e) { /* ignore */ }
    }
  }

  get(id) { return this.items.find((it) => it.id === id) || null; }

  update(id, patch) {
    const it = this.get(id);
    if (!it) return null;
    if (typeof patch.fav === 'boolean') it.fav = patch.fav;
    if (typeof patch.note === 'string') it.note = patch.note.slice(0, 200);
    this.trim();
    this.save();
    return it;
  }

  remove(id) {
    const i = this.items.findIndex((it) => it.id === id);
    if (i < 0) return false;
    this.removeFiles(this.items[i]);
    this.items.splice(i, 1);
    this.save();
    return true;
  }

  /** 清空非收藏条目 */
  clear() {
    for (const it of this.items) if (!it.fav) this.removeFiles(it);
    this.items = this.items.filter((it) => it.fav);
    this.save();
  }

  imagePath(item) { return path.join(this.imgDir, item.id + '.png'); }
  thumbPath(item) { return path.join(this.imgDir, item.id + '.thumb.png'); }

  /**
   * 查询：q 匹配文字或备注（不区分大小写）；kind = all / fav / text / image
   */
  query({ q = '', kind = 'all', limit = 200 } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    return this.items.filter((it) => {
      if (kind === 'fav' && !it.fav) return false;
      if (kind === 'text' && it.type !== 'text') return false;
      if (kind === 'image' && it.type !== 'image') return false;
      if (!needle) return true;
      return (it.text || '').toLowerCase().includes(needle) || (it.note || '').toLowerCase().includes(needle);
    }).slice(0, limit);
  }
}

module.exports = { ClipStore, MAX_TEXT };
