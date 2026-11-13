// 邮箱：用本地的假 IMAP 服务器（hoodiecrow）跑一遍连接、取列表、新邮件提醒、读正文。
const test = require('node:test');
const assert = require('node:assert');
const hoodiecrow = require('hoodiecrow-imap');
const { MailAccount, testAccount } = require('../src/mail');
const { normalizeAccount, guessPreset, explainError, htmlToText } = require('../src/mailpresets');

function raw(subject, from, body, html) {
  const head = `From: ${from}\r\nTo: me@example.com\r\nSubject: ${subject}\r\nDate: Fri, 13 Nov 2026 10:00:00 +0800\r\nMIME-Version: 1.0\r\n`;
  if (html) return head + 'Content-Type: text/html; charset=utf-8\r\n\r\n' + html;
  return head + 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + body;
}

function startServer() {
  const server = hoodiecrow({
    plugins: ['IDLE', 'ID', 'UNSELECT', 'ENABLE', 'LITERALPLUS', 'SPECIAL-USE'],
    users: { me: { password: 'secret' } },
    storage: {
      INBOX: {
        messages: [
          { raw: raw('第一封', '张三 <zs@example.com>', '你好，这是第一封'), flags: [] },
          { raw: raw('第二封', 'li@example.com', '', '<p>Hello <b>HTML</b></p><img src="http://example.com/x.png"><script>x</script>'), flags: [] }
        ]
      }
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const account = (port, pass = 'secret') => normalizeAccount({ preset: 'custom', email: 'me@example.com', user: 'me', host: '127.0.0.1', port, secure: false, label: '测试邮箱' });

test('mailpresets：预设、校验、错误说明、HTML 转文字', () => {
  assert.strictEqual(guessPreset('a@QQ.com').id, 'qq');
  assert.strictEqual(guessPreset('a@gmail.com').host, 'imap.gmail.com');
  assert.strictEqual(guessPreset('a@unknown.org'), null);
  const a = normalizeAccount({ email: 'x@163.com' });
  assert.strictEqual(a.host, 'imap.163.com');
  assert.strictEqual(a.label, '网易 163 邮箱');
  assert.throws(() => normalizeAccount({ email: 'bad' }), /格式/);
  assert.throws(() => normalizeAccount({ email: 'a@b.cc', preset: 'custom', host: '' }), /服务器/);
  assert.match(explainError({ authenticationFailed: true }), /授权码/);
  assert.match(explainError({ code: 'ENOTFOUND' }), /找不到服务器/);
  assert.match(explainError(new Error('NO Unsafe Login. Please contact kefu@188.com')), /拦截/);
  assert.strictEqual(htmlToText('<p>a&amp;b</p><script>x</script><br>c'), 'a&b\n\nc'.replace('\n\n', '\n\n'));
});

test('testAccount：密码对 / 不对', async () => {
  const server = await startServer();
  const port = server.server ? server.server.address().port : server.address().port;
  try {
    const ok = await testAccount(account(port), 'secret');
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.strictEqual(ok.total, 2);
    const bad = await testAccount(account(port), 'wrong');
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /授权码|登录失败/);
  } finally {
    server.close();
  }
});

test('MailAccount：首次列表不提醒、新邮件提醒、读正文不标已读', async () => {
  const server = await startServer();
  const port = server.server ? server.server.address().port : server.address().port;
  const acc = new MailAccount(account(port), 'secret');
  const mails = [];
  acc.on('mail', (m) => mails.push(m));
  try {
    await acc.start();
    assert.strictEqual(acc.state, 'ok', acc.error);
    assert.deepStrictEqual(mails.map((m) => [m.title, m.alert]), [['第一封', false], ['第二封', false]]);
    assert.strictEqual(mails[0].body, '来自 张三');

    // 收到一封新邮件
    server.appendMessage('INBOX', [], false, raw('新邮件', '王五 <ww@example.com>', '下班前发我终版'));
    await acc.checkNew();
    const last = mails[mails.length - 1];
    assert.strictEqual(last.title, '新邮件');
    assert.strictEqual(last.alert, true);
    // 再检查一次不会重复
    await acc.checkNew();
    assert.strictEqual(mails.length, 3);

    // 读正文：纯文本；HTML 邮件转成文字，不保留图片和脚本
    const b1 = await acc.body(mails[0].uid);
    assert.strictEqual(b1.text, '你好，这是第一封');
    const b2 = await acc.body(mails[1].uid);
    assert.strictEqual(b2.text, 'Hello HTML');
    // 只读打开：读过的邮件不会被标成已读
    const flags = server.storage.INBOX.messages.map((m) => m.flags);
    assert.ok(flags.every((f) => !f.includes('\\Seen')), JSON.stringify(flags));
  } finally {
    await acc.stop();
    server.close();
  }
});
