const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClipStore } = require('../src/clipstore');
const { TodoStore, dayLabel } = require('../src/todostore');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'peek-'));

test('ClipStore：去重、置顶、收藏不被清理', () => {
  const dir = tmp();
  const s = new ClipStore(dir, { limit: 3 });
  s.addText('a', 1); s.addText('b', 2); s.addText('c', 3);
  s.addText('a', 4); // 重复：挪到最前
  assert.deepStrictEqual(s.items.map((x) => x.text), ['a', 'c', 'b']);
  s.update(s.items[2].id, { fav: true }); // 收藏 b
  s.addText('d', 5); s.addText('e', 6);
  assert.deepStrictEqual(s.items.map((x) => x.text), ['e', 'd', 'a', 'b']);
  assert.strictEqual(s.items.filter((x) => !x.fav).length, 3);
  // 重新加载后数据还在
  const s2 = new ClipStore(dir, { limit: 3 });
  assert.deepStrictEqual(s2.items.map((x) => x.text), ['e', 'd', 'a', 'b']);
});

test('ClipStore：空白不记录，超长截断，搜索文字和备注', () => {
  const s = new ClipStore(tmp(), { limit: 50 });
  assert.strictEqual(s.addText('   \n '), null);
  const long = s.addText('x'.repeat(30000));
  assert.strictEqual(long.text.length, 20000);
  const it = s.addText('会议纪要 第三版');
  s.update(it.id, { note: '给张总' });
  s.addText('Hello World');
  assert.strictEqual(s.query({ q: '张总' }).length, 1);
  assert.strictEqual(s.query({ q: 'hello' }).length, 1);
  assert.strictEqual(s.query({ kind: 'image' }).length, 0);
});

test('ClipStore：图片落盘、删除时清理文件', () => {
  const dir = tmp();
  const s = new ClipStore(dir, { limit: 50 });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const it = s.addImage({ png, thumb: png, hash: 'h1', width: 10, height: 5 });
  assert.ok(fs.existsSync(s.imagePath(it)));
  assert.ok(fs.existsSync(s.thumbPath(it)));
  // 同一张图再复制一次：不新增
  s.addImage({ png, thumb: png, hash: 'h1', width: 10, height: 5 });
  assert.strictEqual(s.items.length, 1);
  s.remove(it.id);
  assert.ok(!fs.existsSync(s.imagePath(it)));
});

test('TodoStore：新的一天自动顺延未完成事项', () => {
  const file = path.join(tmp(), 'todo.json');
  const s = new TodoStore(file);
  s.ensureToday('2026-11-12');
  const a = s.add('2026-11-12', '写周报');
  s.add('2026-11-12', '回邮件');
  s.toggle('2026-11-12', a.id);
  s.ensureToday('2026-11-13');
  assert.deepStrictEqual(s.day('2026-11-13').tasks.map((x) => [x.text, x.from]), [['回邮件', '2026-11-12']]);
  // 原来那天还保留着，并标记为已顺延
  assert.strictEqual(s.day('2026-11-12').tasks[1].rolled, true);
  // 同一天再次进入不会重复顺延
  s.ensureToday('2026-11-13');
  assert.strictEqual(s.day('2026-11-13').tasks.length, 1);
  // 关闭顺延
  const s2 = new TodoStore(path.join(tmp(), 'todo.json'));
  s2.add('2026-11-12', 'x');
  s2.ensureToday('2026-11-13', false);
  assert.strictEqual(s2.day('2026-11-13').tasks.length, 0);
});

test('TodoStore：编辑、排序、归档统计与 Markdown 导出', () => {
  const s = new TodoStore(path.join(tmp(), 'todo.json'));
  const k = '2026-11-13';
  const a = s.add(k, '一');
  const b = s.add(k, '二');
  s.move(k, b.id, -1);
  assert.deepStrictEqual(s.day(k).tasks.map((x) => x.text), ['二', '一']);
  s.edit(k, a.id, '一（改）');
  s.toggle(k, a.id);
  s.setNote(k, '今天效率不错');
  assert.strictEqual(s.add(k, '   '), null);
  const ar = s.archive();
  assert.deepStrictEqual(ar[0], { key: k, label: dayLabel(k), total: 2, done: 1, hasNote: true });
  const md = s.toMarkdown(k);
  assert.ok(md.includes('- [ ] 二'));
  assert.ok(md.includes('- [x] 一（改）'));
  assert.ok(md.includes('今天效率不错'));
  assert.strictEqual(dayLabel('2026-11-13'), '11 月 13 日 周五');
});
