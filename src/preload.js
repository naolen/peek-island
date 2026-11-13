// 渲染进程能用的接口（经 contextBridge 暴露，渲染进程拿不到 Node 能力）
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('peek', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getQuotes: () => ipcRenderer.invoke('quotes:get'),
  getMinute: (code) => ipcRenderer.invoke('minute:get', code),
  search: (q) => ipcRenderer.invoke('search', q),
  setIgnoreMouse: (ignore) => ipcRenderer.send('mouse:ignore', ignore),
  openSettings: () => ipcRenderer.send('settings:open'),
  onQuotes: (cb) => on('quotes', cb),
  onConfig: (cb) => on('config', cb),
  onStatus: (cb) => on('status', cb)
});
