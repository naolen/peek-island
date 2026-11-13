// 消息收件箱：系统通知和（之后的）邮件都放在这里。只存在内存里，不写磁盘。
// 也负责判断“哪些应用的通知要在岛上提醒”。

// 默认就会提醒的应用：办公沟通和邮件类
const PRESET = /飞书|feishu|lark|qq|钉钉|dingtalk|企业微信|wecom|wxwork|outlook|teams|邮件|mail|foxmail|网易邮箱/i;

function isPreset(app) {
  return PRESET.test(String(app || ''));
}

/**
 * 这个应用的通知要不要提醒
 * cfg.notifyAll = true 时全部提醒；否则 = 手动勾选的 + 预设里没被手动取消的
 */
function isAllowed(app, cfg) {
  if (!app) return false;
  if (cfg.notifyAll) return !(cfg.notifyMuted || []).includes(app);
  if ((cfg.notifyAllowed || []).includes(app)) return true;
  return isPreset(app) && !(cfg.notifyMuted || []).includes(app);
}

class Inbox {
  constructor(limit = 50) {
    this.limit = limit;
    this.items = [];
    this.apps = new Map(); // 见过的应用：name -> { name, count, last }
  }

  /** 记下见过的应用（设置里列出来让用户勾选），返回是否首次见到 */
  seeApp(app, at = Date.now()) {
    if (!app) return false;
    const a = this.apps.get(app);
    if (a) { a.count++; a.last = at; return false; }
    this.apps.set(app, { name: app, count: 1, last: at });
    return true;
  }

  add(item) {
    const it = Object.assign({ read: false }, item);
    it.key = it.kind + ':' + it.id;
    if (this.items.some((x) => x.key === it.key)) return null;
    this.items.unshift(it);
    this.items.sort((a, b) => b.time - a.time);
    if (this.items.length > this.limit) this.items.length = this.limit;
    return it;
  }

  unread() { return this.items.filter((x) => !x.read).length; }

  markAllRead() {
    let n = 0;
    for (const x of this.items) if (!x.read) { x.read = true; n++; }
    return n;
  }

  remove(key) {
    const i = this.items.findIndex((x) => x.key === key);
    if (i >= 0) this.items.splice(i, 1);
    return i >= 0;
  }

  clear(kind) {
    this.items = kind ? this.items.filter((x) => x.kind !== kind) : [];
  }

  list(kind) {
    return kind && kind !== 'all' ? this.items.filter((x) => x.kind === kind) : this.items.slice();
  }

  appList() {
    return Array.from(this.apps.values()).sort((a, b) => b.last - a.last);
  }
}

module.exports = { Inbox, isAllowed, isPreset };
