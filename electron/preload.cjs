const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glasses', {
  invoke: (action, payload) => ipcRenderer.invoke('glasses:invoke', action, payload),
  subscribe: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('glasses:event', listener);
    return () => ipcRenderer.removeListener('glasses:event', listener);
  },
});
