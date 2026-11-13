// 常用邮箱的 IMAP 服务器预设，以及把连接错误翻译成人话（纯函数，便于单元测试）。

const PRESETS = [
  { id: 'qq', name: 'QQ 邮箱', host: 'imap.qq.com', port: 993, domains: ['qq.com', 'foxmail.com', 'vip.qq.com'],
    help: '在 QQ 邮箱网页版「设置 → 账号」里开启 IMAP/SMTP 服务，按提示生成“授权码”，这里填授权码，不是 QQ 密码。' },
  { id: '163', name: '网易 163 邮箱', host: 'imap.163.com', port: 993, domains: ['163.com'],
    help: '在 163 邮箱网页版「设置 → POP3/SMTP/IMAP」里开启 IMAP 服务，生成“授权码”填在这里。' },
  { id: '126', name: '网易 126 邮箱', host: 'imap.126.com', port: 993, domains: ['126.com'],
    help: '在 126 邮箱网页版「设置 → POP3/SMTP/IMAP」里开启 IMAP 服务，生成“授权码”填在这里。' },
  { id: 'yeah', name: '网易 yeah.net 邮箱', host: 'imap.yeah.net', port: 993, domains: ['yeah.net'],
    help: '在邮箱网页版设置里开启 IMAP 服务并生成“授权码”。' },
  { id: 'gmail', name: 'Gmail', host: 'imap.gmail.com', port: 993, domains: ['gmail.com', 'googlemail.com'],
    help: 'Google 账号需开启两步验证，然后在「Google 账号 → 安全性 → 应用专用密码」里生成 16 位密码填在这里。' },
  { id: 'outlook', name: 'Outlook / Hotmail', host: 'outlook.office365.com', port: 993, domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    help: '微软已逐步停用个人邮箱的密码登录，可能连接不上；如果开启了两步验证，可以试试“应用密码”。' },
  { id: 'icloud', name: 'iCloud 邮箱', host: 'imap.mail.me.com', port: 993, domains: ['icloud.com', 'me.com', 'mac.com'],
    help: '在 appleid.apple.com「登录与安全 → App 专用密码」里生成密码填在这里。' },
  { id: 'yahoo', name: 'Yahoo 邮箱', host: 'imap.mail.yahoo.com', port: 993, domains: ['yahoo.com'],
    help: '在 Yahoo 账号安全设置里生成“应用密码”填在这里。' },
  { id: 'sina', name: '新浪邮箱', host: 'imap.sina.com', port: 993, domains: ['sina.com', 'sina.cn'],
    help: '在新浪邮箱「设置 → 客户端 POP/IMAP/SMTP」里开启 IMAP 服务，按提示获取授权码。' },
  { id: 'aliyun', name: '阿里邮箱（个人）', host: 'imap.aliyun.com', port: 993, domains: ['aliyun.com'],
    help: '在阿里邮箱网页版设置里开启 IMAP 服务后填写登录密码或授权码。' },
  { id: 'exmail', name: '腾讯企业邮箱', host: 'imap.exmail.qq.com', port: 993, domains: [],
    help: '在企业邮箱「设置 → 客户端设置」里开启 IMAP；如果开启了安全登录，需要使用“客户端专用密码”。' },
  { id: 'qiye163', name: '网易企业邮箱', host: 'imap.qiye.163.com', port: 993, domains: [],
    help: '在企业邮箱设置里开启 IMAP 服务；开启了客户端授权码的话填授权码。' },
  { id: 'aliqiye', name: '阿里企业邮箱', host: 'imap.qiye.aliyun.com', port: 993, domains: [],
    help: '在企业邮箱设置里开启 IMAP 服务后填写密码。' },
  { id: 'custom', name: '其他邮箱（手动填写）', host: '', port: 993, domains: [],
    help: '填写邮箱服务商提供的 IMAP 服务器地址和端口（一般是 993，SSL）。' }
];

function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

/** 根据邮箱地址猜预设：xxx@qq.com → QQ 邮箱 */
function guessPreset(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain) return null;
  const d = domain.toLowerCase().trim();
  return PRESETS.find((p) => p.domains.includes(d)) || null;
}

/** 校验并补全一个账户配置；不合法时抛出带中文说明的错误 */
function normalizeAccount(a) {
  const email = String(a.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('邮箱地址格式不对');
  const preset = presetById(a.preset) || guessPreset(email) || presetById('custom');
  const host = String(preset.id === 'custom' ? a.host || '' : preset.host).trim();
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('请填写 IMAP 服务器地址，例如 imap.example.com');
  const port = Math.round(Number(preset.id === 'custom' ? a.port : preset.port) || 993);
  if (port < 1 || port > 65535) throw new Error('端口不对');
  return {
    id: a.id || 'm' + Date.now().toString(36),
    preset: preset.id,
    email,
    user: String(a.user || email).trim(),
    host,
    port,
    secure: preset.id === 'custom' ? a.secure !== false : true,
    label: String(a.label || '').trim().slice(0, 20) || (preset.id === 'custom' ? email.split('@')[1] : preset.name),
    enabled: a.enabled !== false
  };
}

/** 连接错误 → 给用户看的中文说明 */
function explainError(err) {
  const msg = String((err && (err.responseText || err.message)) || err || '');
  const code = err && err.code;
  if (/Unsafe Login/i.test(msg)) return '邮箱服务商拦截了这次登录，请在邮箱网页版确认开启了 IMAP 并使用授权码';
  if (err && err.authenticationFailed) return '账号或授权码不对（注意要填授权码 / 应用专用密码，不是登录密码）';
  if (/auth|login|credential|password|Invalid|认证|密码/i.test(msg) && !/timeout/i.test(msg)) return '登录失败：账号或授权码不对，或者没有开启 IMAP 服务';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '找不到服务器，请检查服务器地址和网络';
  if (code === 'ECONNREFUSED') return '服务器拒绝连接，请检查端口';
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) return '连接超时，请检查网络';
  if (/certificate|SSL|TLS/i.test(msg)) return '安全连接失败（证书或 SSL 设置不对）';
  return '连接失败：' + (msg || '未知错误').slice(0, 120);
}

/** 把 HTML 邮件粗略转成纯文本（不加载任何远程内容） */
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { PRESETS, presetById, guessPreset, normalizeAccount, explainError, htmlToText };
