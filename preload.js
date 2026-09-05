const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  discoverCameras: () => ipcRenderer.invoke('discover-cameras'),
  getCameras: (tenantId) => ipcRenderer.invoke('get-cameras', tenantId),
  addCamera: (camData) => ipcRenderer.invoke('add-camera', camData),
  testCamera: (rtspUrl) => ipcRenderer.invoke('test-camera', rtspUrl),
  removeCamera: (id) => ipcRenderer.invoke('remove-camera', id),
  getGo2RtcStatus: () => ipcRenderer.invoke('get-go2rtc-status')
});
