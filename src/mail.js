// 邮箱：用 IMAP 只读地盯着收件箱，有新邮件就通知；正文点开时才拉取，只取纯文本。
// - 以只读方式打开收件箱（EXAMINE），看邮件不会把它标成已读
// - 不下载附件、不加载远程图片
// - 授权码不在这里保存，由调用方（主进程）用系统加密存储后传进来
const { EventEmitter } = require('events');
// imapflow + mailparser 加起来近 30 MB，没配邮箱的人用不到，第一次用时才加载
let imapflowMod = null, mailparserMod = null;
const ImapFlowCls = () => (imapflowMod || (imapflowMod = require('imapflow'))).ImapFlow;
const simpleParser = (...args) => (mailparserMod || (mailparserMod = require('mailparser'))).simpleParser(...args);
const { explainError, htmlToText } = require('./mailpresets');

const RECENT = 20;           // 连上时取最近多少封显示在列表里
const POLL_MS = 2 * 60 * 1000; // IDLE 之外的兜底检查
const MAX_BODY = 2 * 1024 * 1024;

function dateMs(d) {
  const t = d instanceof Date ? d.getTime() : new Date(d || Date.now()).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function fromName(env) {
  const f = env && env.from && env.from[0];
  if (!f) return '';
  return f.name || f.address || '';
}

class MailAccount extends EventEmitter {
  constructor(account, password) {
    super();
    this.account = account;
    this.password = password;
    this.client = null;
    this.lastUid = 0;
    this.stopped = false;
    this.retry = 0;
    this.timer = null;
    this.poller = null;
    this.state = 'idle';
    this.error = '';
  }

  setState(state, error = '') {
    this.state = state;
    this.error = error;
    this.emit('status', { id: this.account.id, state, error });
  }

  makeClient() {
    const a = this.account;
    return new (ImapFlowCls())({
      host: a.host,
      port: a.port,
      secure: a.secure,
      auth: { user: a.user || a.email, pass: this.password },
      logger: false,
      // 网易邮箱要求客户端先报上名字（IMAP ID），否则会提示 Unsafe Login
      clientInfo: { name: 'PeekIsland', version: '0.2.0', vendor: 'naolen' },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 5 * 60 * 1000
    });
  }

  async start() {
    this.stopped = false;
    clearTimeout(this.timer);
    this.setState('connecting');
    const client = this.makeClient();
    this.client = client;
    client.on('error', (e) => this.onFail(e));
    client.on('close', () => { if (!this.stopped) this.onFail(new Error('连接已断开')); });
    try {
      await client.connect();
      const box = await client.mailboxOpen('INBOX', { readOnly: true });
      this.retry = 0;
      this.setState('ok');
      // 首次连上：取最近几封作为列表，不提醒
      const first = !this.lastUid;
      const uidNext = box.uidNext || 1;
      const from = Math.max(1, uidNext - RECENT);
      await this.fetchRange(`${first ? from : this.lastUid + 1}:*`, !first);
      if (!this.lastUid) this.lastUid = uidNext - 1;
      // 服务器推送新邮件（IDLE）
      client.on('exists', () => this.checkNew());
      clearInterval(this.poller);
      this.poller = setInterval(() => this.checkNew(), POLL_MS);
    } catch (e) {
      this.onFail(e);
    }
  }

  async checkNew() {
    if (!this.client || this.state !== 'ok') return;
    try {
      await this.fetchRange(`${this.lastUid + 1}:*`, true);
    } catch (e) {
      this.onFail(e);
    }
  }

  async fetchRange(range, alert) {
    const found = [];
    for await (const m of this.client.fetch(range, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
      // “N:*” 在没有新邮件时会返回最后一封，过滤掉已见过的
      if (m.uid <= this.lastUid) continue;
      found.push(m);
    }
    found.sort((a, b) => a.uid - b.uid);
    for (const m of found) {
      this.lastUid = Math.max(this.lastUid, m.uid);
      const env = m.envelope || {};
      this.emit('mail', {
        kind: 'mail',
        id: this.account.id + ':' + m.uid,
        uid: m.uid,
        accountId: this.account.id,
        app: this.account.label,
        account: this.account.label,
        title: env.subject || '（无主题）',
        body: '来自 ' + (fromName(env) || '未知发件人'),
        from: fromName(env),
        time: dateMs(m.internalDate || env.date),
        alert
      });
    }
  }

  /** 取一封邮件的正文（纯文本） */
  async body(uid) {
    if (!this.client || this.state !== 'ok') throw new Error('邮箱还没连上');
    const msg = await this.client.fetchOne(String(uid), { source: { start: 0, maxLength: MAX_BODY }, envelope: true }, { uid: true });
    if (!msg || !msg.source) throw new Error('没有找到这封邮件');
    const parsed = await simpleParser(msg.source, { skipImageLinks: true, skipHtmlToText: true });
    let text = parsed.text || htmlToText(parsed.html || '');
    if (text.length > 20000) text = text.slice(0, 20000) + '\n…';
    return {
      subject: parsed.subject || (msg.envelope && msg.envelope.subject) || '（无主题）',
      from: parsed.from ? parsed.from.text : '',
      to: parsed.to ? parsed.to.text : '',
      date: parsed.date ? parsed.date.getTime() : 0,
      text: text.trim() || '（这封邮件没有文字内容）',
      attachments: (parsed.attachments || []).map((a) => a.filename || '附件').slice(0, 20)
    };
  }

  onFail(e) {
    if (this.stopped) return;
    clearInterval(this.poller);
    const c = this.client;
    this.client = null;
    if (c) { try { c.removeAllListeners(); c.close(); } catch (x) { /* ignore */ } }
    const authFail = e && (e.authenticationFailed || /auth|login|Unsafe/i.test(String(e.responseText || e.message || '')));
    this.setState('error', explainError(e));
    // 授权失败不自动重试（避免被邮箱封号）；网络问题退避重连：30s、1m、2m … 最长 10 分钟
    if (authFail) return;
    const delay = Math.min(10 * 60 * 1000, 30000 * Math.pow(2, this.retry++));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.start(), delay);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.poller);
    const c = this.client;
    this.client = null;
    if (c) { try { c.removeAllListeners(); await c.logout(); } catch (e) { try { c.close(); } catch (x) { /* ignore */ } } }
    this.setState('stopped');
  }
}

/** 只测试能不能登录，不留连接 */
async function testAccount(account, password) {
  const acc = new MailAccount(account, password);
  const client = acc.makeClient();
  client.on('error', () => {});
  try {
    await client.connect();
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const total = box.exists;
    await client.logout();
    return { ok: true, total };
  } catch (e) {
    try { client.close(); } catch (x) { /* ignore */ }
    return { ok: false, error: explainError(e) };
  }
}

module.exports = { MailAccount, testAccount };
