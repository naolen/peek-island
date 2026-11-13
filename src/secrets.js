// 邮箱授权码的加密保存：用 Electron safeStorage（Windows 上是系统 DPAPI，只有当前 Windows 用户能解开）。
// 文件里只有加密后的内容，不存明文。
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

class Secrets {
  constructor(dir) {
    this.file = path.join(dir, 'mail-secrets.json');
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { this.data = {}; }
  }

  available() {
    try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; }
  }

  set(id, secret) {
    if (!this.available()) throw new Error('当前系统不支持加密保存，无法记住授权码');
    this.data[id] = safeStorage.encryptString(String(secret)).toString('base64');
    this.save();
  }

  get(id) {
    const v = this.data[id];
    if (!v || !this.available()) return null;
    try { return safeStorage.decryptString(Buffer.from(v, 'base64')); } catch (e) { return null; }
  }

  remove(id) {
    delete this.data[id];
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Secrets };
