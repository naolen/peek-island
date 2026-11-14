// 管理原生小助手 PeekNative.exe：启动、按行解析 JSON、崩溃后自动重启。
// 只在 Windows 上运行；其他系统上什么也不做（音乐等功能会显示为不可用）。
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

class NativeHelper extends EventEmitter {
  constructor({ packaged, resourcesPath }) {
    super();
    this.exe = packaged
      ? path.join(resourcesPath, 'native', 'PeekNative.exe')
      : path.join(__dirname, '..', 'native', 'publish', 'PeekNative.exe');
    this.proc = null;
    this.stopping = false;
    this.restarts = 0;
    this.timer = null;
    this.available = false;
  }

  start() {
    if (process.platform !== 'win32' || !fs.existsSync(this.exe)) {
      this.available = false;
      this.emit('unavailable', process.platform !== 'win32' ? '仅支持 Windows' : '没有找到 PeekNative.exe');
      return;
    }
    this.stopping = false;
    const proc = spawn(this.exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'ready') { this.available = true; this.restarts = 0; }
      this.emit(msg.type, msg);
    });
    proc.stderr.on('data', (d) => console.warn('[native]', String(d).trim()));
    proc.on('error', (e) => console.warn('[native] 启动失败', e.message));
    proc.on('exit', (code) => {
      this.proc = null;
      this.available = false;
      if (this.stopping) return;
      // 崩溃后退避重启：1s、2s、4s … 最长 30s
      const delay = Math.min(30000, 1000 * Math.pow(2, this.restarts++));
      console.warn(`[native] 已退出（${code}），${delay / 1000}s 后重启`);
      this.timer = setTimeout(() => this.start(), delay);
    });
  }

  send(obj) {
    if (!this.proc || !this.proc.stdin.writable) return;
    try { this.proc.stdin.write(JSON.stringify(obj) + '\n'); } catch (e) { /* ignore */ }
  }

  /** 问小助手占了多少内存（KB），1 秒内没回就当 0 */
  memoryKb() {
    if (!this.proc) return Promise.resolve(0);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.off('mem', on); resolve(0); }, 1000);
      const on = (m) => { clearTimeout(t); resolve(Number(m.kb) || 0); };
      this.once('mem', on);
      this.send({ cmd: 'mem' });
    });
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    if (this.proc) {
      try { this.proc.stdin.end(); } catch (e) { /* ignore */ }
      const p = this.proc;
      setTimeout(() => { try { p.kill(); } catch (e) { /* ignore */ } }, 500);
    }
  }
}

module.exports = { NativeHelper };
