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
  getMedia: () => ipcRenderer.invoke('media:get'),
  mediaCmd: (cmd) => ipcRenderer.send('media:cmd', cmd),
  onQuotes: (cb) => on('quotes', cb),
  onConfig: (cb) => on('config', cb),
  onStatus: (cb) => on('status', cb),
  onMedia: (cb) => on('media', cb),
  onLevel: (cb) => on('level', cb),
  // 剪贴板
  clipList: (q) => ipcRenderer.invoke('clip:list', q),
  clipCopy: (id) => ipcRenderer.invoke('clip:copy', id),
  clipUpdate: (id, patch) => ipcRenderer.invoke('clip:update', id, patch),
  clipRemove: (id) => ipcRenderer.invoke('clip:remove', id),
  clipClear: () => ipcRenderer.invoke('clip:clear'),
  onClipChanged: (cb) => on('clip:changed', cb),
  // 待办
  todoGet: (key) => ipcRenderer.invoke('todo:get', key),
  todoAdd: (text) => ipcRenderer.invoke('todo:add', text),
  todoToggle: (key, id) => ipcRenderer.invoke('todo:toggle', key, id),
  todoEdit: (key, id, text) => ipcRenderer.invoke('todo:edit', key, id, text),
  todoRemove: (key, id) => ipcRenderer.invoke('todo:remove', key, id),
  todoMove: (key, id, d) => ipcRenderer.invoke('todo:move', key, id, d),
  todoNote: (note) => ipcRenderer.invoke('todo:note', note),
  todoExport: (which) => ipcRenderer.invoke('todo:export', which),
  onTodoChanged: (cb) => on('todo:changed', cb),
  // 消息（通知 / 邮件）
  inboxList: (kind) => ipcRenderer.invoke('inbox:list', kind),
  inboxReadAll: () => ipcRenderer.invoke('inbox:read-all'),
  inboxRemove: (key) => ipcRenderer.invoke('inbox:remove', key),
  inboxClear: (kind) => ipcRenderer.invoke('inbox:clear', kind),
  onInboxNew: (cb) => on('inbox:new', cb),
  onInboxChanged: (cb) => on('inbox:changed', cb),
  notifyStatus: () => ipcRenderer.invoke('notify:status'),
  notifyApps: () => ipcRenderer.invoke('notify:apps'),
  openNotifySettings: () => ipcRenderer.send('notify:open-settings'),
  onNotifyStatus: (cb) => on('notify:status', cb),
  onNotifyApps: (cb) => on('notify:apps', cb),
  // 邮箱
  mailPresets: () => ipcRenderer.invoke('mail:presets'),
  mailAccounts: () => ipcRenderer.invoke('mail:accounts'),
  mailSave: (acc, password) => ipcRenderer.invoke('mail:save', acc, password),
  mailRemove: (id) => ipcRenderer.invoke('mail:remove', id),
  mailToggle: (id, enabled) => ipcRenderer.invoke('mail:toggle', id, enabled),
  mailRetry: (id) => ipcRenderer.invoke('mail:retry', id),
  mailBody: (accountId, uid) => ipcRenderer.invoke('mail:body', accountId, uid),
  onMailStatus: (cb) => on('mail:status', cb),
  // 焦点与快捷键
  setFocus: (on) => ipcRenderer.send('focus:set', on),
  onPageOpen: (cb) => on('page:open', cb),
  getShortcuts: () => ipcRenderer.invoke('shortcuts:get'),
  onShortcuts: (cb) => on('shortcuts', cb)
});
