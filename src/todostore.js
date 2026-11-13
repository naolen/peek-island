// 待办与每日笔记（不依赖 Electron，便于单元测试）。
// 按天存储：days['2026-11-13'] = { tasks: [{ id, text, done, doneAt, from }], note: '' }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${m} 月 ${d} 日 ${WEEK[date.getDay()]}`;
}

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

class TodoStore {
  constructor(file) {
    this.file = file;
    this.days = {};
    this.load();
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data && typeof data.days === 'object') this.days = data.days;
    } catch (e) {
      this.days = {};
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, days: this.days }, null, 1), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[todo] 保存失败', e);
    }
  }

  day(key) {
    if (!this.days[key]) this.days[key] = { tasks: [], note: '' };
    return this.days[key];
  }

  /**
   * 进入新的一天：把之前最近一天没做完的事挪到今天（rollover 开启时）。
   * 原来那天会留下记录（标记为“已顺延”），历史里还能看到。
   * 返回今天的 key。
   */
  ensureToday(today = dayKey(), rollover = true) {
    const fresh = !this.days[today];
    const t = this.day(today);
    if (fresh && rollover) {
      const prev = Object.keys(this.days).filter((k) => k < today).sort().pop();
      if (prev) {
        const left = this.days[prev].tasks.filter((x) => !x.done && !x.rolled);
        for (const x of left) {
          x.rolled = true;
          t.tasks.push({ id: newId(), text: x.text, done: false, from: x.from || prev });
        }
      }
    }
    if (fresh) this.save();
    return today;
  }

  add(key, text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return null;
    const task = { id: newId(), text, done: false };
    this.day(key).tasks.push(task);
    this.save();
    return task;
  }

  find(key, id) {
    return this.day(key).tasks.find((x) => x.id === id) || null;
  }

  toggle(key, id, now = Date.now()) {
    const x = this.find(key, id);
    if (!x) return null;
    x.done = !x.done;
    x.doneAt = x.done ? now : undefined;
    this.save();
    return x;
  }

  edit(key, id, text) {
    const x = this.find(key, id);
    text = String(text || '').trim().slice(0, 300);
    if (!x || !text) return null;
    x.text = text;
    this.save();
    return x;
  }

  remove(key, id) {
    const t = this.day(key);
    const i = t.tasks.findIndex((x) => x.id === id);
    if (i < 0) return false;
    t.tasks.splice(i, 1);
    this.save();
    return true;
  }

  move(key, id, delta) {
    const tasks = this.day(key).tasks;
    const i = tasks.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= tasks.length) return false;
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    this.save();
    return true;
  }

  setNote(key, note) {
    this.day(key).note = String(note || '').slice(0, 20000);
    this.save();
  }

  /** 有内容的日子，新的在前：[{ key, label, total, done, hasNote }] */
  archive() {
    return Object.keys(this.days)
      .filter((k) => this.days[k].tasks.length || (this.days[k].note || '').trim())
      .sort()
      .reverse()
      .map((k) => {
        const d = this.days[k];
        const own = d.tasks.filter((x) => !x.rolled);
        return { key: k, label: dayLabel(k), total: own.length, done: own.filter((x) => x.done).length, hasNote: !!(d.note || '').trim() };
      });
  }

  /** 导出一天为 Markdown */
  toMarkdown(key) {
    const d = this.day(key);
    const lines = [`# ${dayLabel(key)}`, ''];
    if (d.tasks.length) {
      lines.push('## 待办', '');
      for (const x of d.tasks) {
        const tag = x.rolled ? '（已顺延）' : x.from ? `（从 ${x.from} 顺延）` : '';
        lines.push(`- [${x.done ? 'x' : ' '}] ${x.text}${tag}`);
      }
      lines.push('');
    }
    if ((d.note || '').trim()) lines.push('## 笔记', '', d.note.trim(), '');
    return lines.join('\n');
  }

  /** 导出全部历史为一个 Markdown（新的在前） */
  allToMarkdown() {
    return this.archive().map((a) => this.toMarkdown(a.key)).join('\n---\n\n');
  }
}

module.exports = { TodoStore, dayKey, dayLabel };
