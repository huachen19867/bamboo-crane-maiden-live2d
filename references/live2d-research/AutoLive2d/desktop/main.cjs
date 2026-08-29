const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, powerSaveBlocker, session, shell } = require("electron");

const DEFAULT_URL = "http://127.0.0.1:5173/";
const MAIN_ZOOM = Number(process.env.AUTO_LIVE2D_DESKTOP_ZOOM || "0.82");
let powerSaveBlockerId = 0;
const userDataBase = process.env.APPDATA || process.env.XDG_CONFIG_HOME || process.env.HOME || process.cwd();
const userDataRoot = path.join(userDataBase, "AutoLive2DStudioDesktop");
fs.mkdirSync(userDataRoot, { recursive: true });
app.setPath("userData", userDataRoot);

app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion,IntensiveWakeUpThrottling");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disk-cache-dir", path.join(userDataRoot, "Cache"));

function webPreferences() {
  return {
    backgroundThrottling: false,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true
  };
}

function isAppUrl(targetUrl, appUrl) {
  if (!targetUrl || targetUrl === "about:blank") return true;
  try {
    const appOrigin = new URL(appUrl).origin;
    if (targetUrl.startsWith(`blob:${appOrigin}`)) return true;
    return new URL(targetUrl).origin === appOrigin;
  } catch {
    return false;
  }
}

function installPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" || permission === "display-capture";
  });
}

function configureWindow(window, appUrl, isRuntime = false) {
  window.webContents.once("did-finish-load", () => {
    window.webContents.setZoomFactor(isRuntime ? 1 : MAIN_ZOOM);
  });

  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (!isAppUrl(url, appUrl)) {
      shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        title: frameName || "Auto Live2D Runtime",
        width: 460,
        height: 760,
        minWidth: 260,
        minHeight: 360,
        resizable: true,
        autoHideMenuBar: true,
        backgroundColor: "#101216",
        webPreferences: webPreferences()
      }
    };
  });

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isAppUrl(targetUrl, appUrl)) return;
    event.preventDefault();
    shell.openExternal(targetUrl).catch(() => undefined);
  });

  window.webContents.on("did-create-window", (child) => {
    child.setMenuBarVisibility(false);
    if (isRuntime) return;
    configureWindow(child, appUrl, true);
  });
}

function createMainWindow() {
  const appUrl = process.env.AUTO_LIVE2D_DESKTOP_URL || DEFAULT_URL;
  const window = new BrowserWindow({
    title: "Auto Live2D Studio",
    width: 1760,
    height: 1060,
    minWidth: 1180,
    minHeight: 760,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: "#f6f7fb",
    webPreferences: webPreferences()
  });
  configureWindow(window, appUrl);
  window.loadURL(appUrl);
}

app.whenReady().then(() => {
  if (!powerSaveBlockerId) {
    powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  }
  installPermissions();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
