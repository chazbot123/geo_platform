const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("geoDesktop", {
  openPlatformLogin(input) {
    return ipcRenderer.invoke("geo:open-platform-login", input);
  },
  validatePlatformSession(input) {
    return ipcRenderer.invoke("geo:validate-platform-session", input);
  },
  runPlatformPublish(input) {
    return ipcRenderer.invoke("geo:run-platform-publish", input);
  },
  getPlatformPublishProgress(input) {
    return ipcRenderer.invoke("geo:get-platform-publish-progress", input);
  },
});
