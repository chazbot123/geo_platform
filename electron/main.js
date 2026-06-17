const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const next = require("next");
const path = require("node:path");
const { createAutoPublishScheduler } = require("./auto-publish-scheduler");
const { createLocalBridge } = require("./local-bridge");

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.GEO_DEV_SERVER_URL || "http://localhost:3000";
const PROD_SERVER_PORT = Number(process.env.GEO_DESKTOP_WEB_PORT || 33131);
const PROD_SERVER_URL = `http://127.0.0.1:${PROD_SERVER_PORT}`;
let mainWindow;
let appTray;
let server;
let localBridge;
let isQuitting = false;
let closeNoticeShown = false;
const preloadPath = path.join(__dirname, "preload.js");
const automationDirectory = path.join(__dirname, "publish-automation");
const automationHelperFile = path.join(automationDirectory, "dom-helpers.js");
const videohaoExtensionRelativePath = path.join("browser-extension", "platform-login-helper-videohao-sync");
const videohaoExtensionDevPath = path.join(__dirname, "..", "scripts", "browser-extension", "platform-login-helper-videohao-sync");
const publishProgressSessions = new Map();
const PUBLISH_PROGRESS_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_SESSION_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const ACCOUNT_SESSION_STARTUP_REFRESH_DELAY_MS = 8000;
const AUTO_PUBLISH_INTERVAL_MS = 60 * 1000;
const AUTO_PUBLISH_STARTUP_DELAY_MS = 15000;
const AUTOMATION_SUCCESS_STATUSES = new Set(["published", "submitted", "verifying", "pending_review", "verification_failed"]);
const AUTOMATION_TERMINAL_STATUSES = new Set([...AUTOMATION_SUCCESS_STATUSES, "failed", "unsupported"]);
const GLOBAL_SESSION_AUDIT_INTERVAL_MS = 60 * 60 * 1000;
let activeBridgeOperations = 0;
let currentAppBaseUrl = "";
let globalSessionAuditTimer = null;
let globalSessionAuditRunning = false;
let accountSessionRefreshTimer = null;
let accountSessionStartupRefreshTimer = null;
let accountSessionRefreshRunning = false;
let autoPublishScheduler = null;
let appServerUrl = "";

const STAGE_LABELS = {
  init: "准备启动",
  validate_session: "会话校验",
  prepare_images: "图片准备",
  open_publish_page: "打开发布页",
  inject_automation: "注入自动化",
  load_publish_page: "页面加载",
  manage_page_ready: "管理页已就绪",
  open_manage_candidate: "尝试打开管理页",
  fill_title: "填写标题",
  fill_body: "填写正文",
  fill_tags: "填写标签",
  upload_images: "上传图片",
  wait_image_upload: "等待图片上传",
  image_upload_failed: "图片上传失败",
  image_distribution_plan: "图文分布规划",
  select_cover: "处理封面",
  cover_selected: "封面已选择",
  cover_thumb_clicked: "选中封面图",
  cover_confirm_clicked: "确认封面",
  cover_thumb_not_found: "未找到封面候选",
  cover_confirm_not_found: "未找到封面确认按钮",
  cover_dialog_dump: "封面弹层快照",
  submit: "提交发布",
  verify_attempt_1: "首次核验",
  verify_attempt_2: "二次核验",
  verify_attempt_3: "三次核验",
  verify_match_found: "找到发布内容",
  find_published_item: "查找发布结果",
  open_published_item: "打开发布详情",
  verify_published_item: "核验发布结果",
  open_manage_page: "打开管理页",
  verification_failed: "核验失败",
  published: "发布成功",
  error: "执行异常",
};

function now() {
  return new Date().toISOString();
}

function isVideohaoExtensionCookieAccount(account) {
  return (
    account &&
    account.platform === "videohao" &&
    account.authType === "cookie" &&
    account.source === "browser_extension"
  );
}

function formatStageLabel(stage) {
  const normalized = String(stage || "").trim();
  if (!normalized) {
    return "未知阶段";
  }
  return STAGE_LABELS[normalized] || normalized.replace(/_/g, " ");
}

function loadDesktopIcon() {
  const candidatePaths = [
    path.join(app.getAppPath(), "src", "img", "搜索.png"),
    path.join(__dirname, "assets", "ai-search.png"),
    path.join(__dirname, "assets", "tray-icon.png"),
    path.join(__dirname, "assets", "ai-search.ico"),
    path.join(__dirname, "assets", "ai-search.svg"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }
      const image = nativeImage.createFromPath(candidatePath);
      if (!image.isEmpty()) {
        return image;
      }
    } catch (_) {
      // Ignore invalid icon candidates and continue with fallbacks.
    }
  }

  return nativeImage.createEmpty();
}

function restoreMainWindow() {
  if (!mainWindow) {
    return;
  }
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function ensureTray() {
  if (appTray) {
    return appTray;
  }

  const icon = loadDesktopIcon();
  const trayIcon = icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 });
  appTray = new Tray(trayIcon);
  appTray.setToolTip("GEO桌面版");
  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => restoreMainWindow(),
      },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  appTray.on("click", () => restoreMainWindow());

  return appTray;
}

function hideMainWindowToTray() {
  if (!mainWindow) {
    return;
  }
  ensureTray();
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();

  if (process.platform === "win32" && appTray && !closeNoticeShown) {
    closeNoticeShown = true;
    try {
      appTray.displayBalloon({
        iconType: "info",
        title: "GEO桌面版",
        content: "程序已最小化到托盘，点击托盘图标可恢复窗口。",
      });
    } catch (_) {
      // Ignore tray balloon errors.
    }
  }
}

function createProgressSnapshot(sessionToken, platform) {
  const startedAt = now();
  return {
    sessionToken,
    platform: String(platform || ""),
    status: "running",
    currentStage: "init",
    currentStageLabel: formatStageLabel("init"),
    startedAt,
    lastUpdatedAt: startedAt,
    liveExecutionLog: [],
    stageTimeline: [
      {
        stage: "init",
        label: formatStageLabel("init"),
        message: "发布会话已启动",
        at: startedAt,
      },
    ],
    imageUploadProgress: undefined,
  };
}

function getOrCreateProgressSnapshot(sessionToken, platform) {
  const existing = publishProgressSessions.get(sessionToken);
  if (existing) {
    return existing;
  }
  const snapshot = createProgressSnapshot(sessionToken, platform);
  publishProgressSessions.set(sessionToken, snapshot);
  return snapshot;
}

function appendProgressLog(sessionToken, platform, message) {
  if (!sessionToken) {
    return;
  }
  const snapshot = getOrCreateProgressSnapshot(sessionToken, platform);
  const normalizedMessage = String(message || "").trim();
  if (!normalizedMessage) {
    return;
  }
  const lastLog = snapshot.liveExecutionLog[snapshot.liveExecutionLog.length - 1];
  if (lastLog !== normalizedMessage) {
    snapshot.liveExecutionLog.push(normalizedMessage);
    snapshot.liveExecutionLog = snapshot.liveExecutionLog.slice(-200);
  }

  const separatorIndex = normalizedMessage.indexOf(":");
  const stage = separatorIndex > 0 ? normalizedMessage.slice(0, separatorIndex).trim() : "info";
  const detail = separatorIndex > 0 ? normalizedMessage.slice(separatorIndex + 1).trim() : normalizedMessage;
  const at = now();

  // 解析 prepare_images: start (N) / ready (N) 来初始化 total
  if (stage === "prepare_images") {
    const matched = detail.match(/(?:start|ready)\s*\((\d+)\)/);
    if (matched) {
      const total = Number(matched[1]) || 0;
      snapshot.imageUploadProgress = {
        total,
        completed: snapshot.imageUploadProgress?.completed ?? 0,
        currentStrategy: snapshot.imageUploadProgress?.currentStrategy,
      };
    }
  }
  // 解析 upload_image_N_strategy_X_try / _done / _failed
  const uploadMatch = stage.match(/^upload_image_(\d+)_(.+)$/);
  if (uploadMatch) {
    const phase = uploadMatch[2];
    const total = snapshot.imageUploadProgress?.total ?? 0;
    const completed = snapshot.imageUploadProgress?.completed ?? 0;
    let strategy = snapshot.imageUploadProgress?.currentStrategy;
    if (phase === "strategy_A_try") strategy = "file_input";
    else if (phase === "strategy_B_try") strategy = "drop";
    else if (phase === "strategy_C_try") strategy = "paste";
    if (phase === "done" || phase.startsWith("done")) {
      snapshot.imageUploadProgress = {
        total,
        completed: completed + 1,
        currentStrategy: strategy,
      };
    } else {
      snapshot.imageUploadProgress = {
        total,
        completed,
        currentStrategy: strategy,
      };
    }
  }
  snapshot.currentStage = stage;
  snapshot.currentStageLabel = formatStageLabel(stage);
  snapshot.lastUpdatedAt = at;

  const lastTimelineEntry = snapshot.stageTimeline[snapshot.stageTimeline.length - 1];
  if (!lastTimelineEntry || lastTimelineEntry.stage !== stage || lastTimelineEntry.message !== detail) {
    snapshot.stageTimeline.push({
      stage,
      label: formatStageLabel(stage),
      message: detail || normalizedMessage,
      at,
    });
    snapshot.stageTimeline = snapshot.stageTimeline.slice(-40);
  }
}

function updateProgressStatus(sessionToken, platform, patch = {}) {
  if (!sessionToken) {
    return;
  }
  const snapshot = getOrCreateProgressSnapshot(sessionToken, platform);
  Object.assign(snapshot, patch, {
    lastUpdatedAt: now(),
  });
}

function getPlatformPublishProgress(input = {}) {
  const sessionToken = typeof input.sessionToken === "string" ? input.sessionToken.trim() : "";
  if (!sessionToken) {
    return null;
  }
  const snapshot = publishProgressSessions.get(sessionToken);
  if (!snapshot) {
    return null;
  }
  if (Date.now() - new Date(snapshot.lastUpdatedAt).getTime() > PUBLISH_PROGRESS_TTL_MS) {
    publishProgressSessions.delete(sessionToken);
    return null;
  }
  return snapshot;
}

function resolvePreferredDataDir() {
  const externalDataPath = String(process.env.GEO_DATA_DIR || "").trim();
  if (externalDataPath) {
    return externalDataPath;
  }
  if (isDev) {
    return path.join(process.cwd(), "data");
  }
  return path.join(app.getPath("userData"), "data");
}

function setupPersistencePaths() {
  const userDataPath = app.getPath("userData");
  const sessionDataPath = path.join(userDataPath, "session-data");
  const dataPath = resolvePreferredDataDir();
  fs.mkdirSync(sessionDataPath, { recursive: true });
  fs.mkdirSync(dataPath, { recursive: true });
  quarantineStaleVideohaoSessionPartitions(sessionDataPath, dataPath);
  app.setPath("sessionData", sessionDataPath);
  process.env.GEO_DATA_DIR = dataPath;
}

function quarantineStaleVideohaoSessionPartitions(sessionDataPath, dataPath) {
  try {
    const accountsDir = path.join(dataPath, "platform-accounts");
    if (!fs.existsSync(accountsDir)) {
      return;
    }
    const quarantineDir = path.join(sessionDataPath, "videohao-session-quarantine");
    for (const entry of fs.readdirSync(accountsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      let account;
      try {
        account = JSON.parse(fs.readFileSync(path.join(accountsDir, entry.name), "utf8"));
      } catch (_) {
        continue;
      }
      const sessionPartition = String(account?.sessionPartition || "").trim();
      const partitionName = sessionPartition.startsWith("persist:") ? sessionPartition.slice("persist:".length) : "";
      if (!isVideohaoExtensionCookieAccount(account) || !partitionName || !partitionName.startsWith("geo-platform-")) {
        continue;
      }
      const partitionPath = path.join(sessionDataPath, "Partitions", partitionName);
      if (!fs.existsSync(partitionPath)) {
        continue;
      }
      fs.mkdirSync(quarantineDir, { recursive: true });
      const targetPath = path.join(quarantineDir, `${partitionName}-${Date.now()}`);
      try {
        fs.renameSync(partitionPath, targetPath);
      } catch (_) {
        // If Chromium or antivirus still holds the profile, leave it untouched for the next startup.
      }
    }
  } catch (_) {
    // Startup must not fail because of best-effort session cleanup.
  }
}

setupPersistencePaths();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDataDir() {
  const dataDir = resolvePreferredDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.GEO_DATA_DIR = dataDir;
}

function hideWindowMenu(windowInstance) {
  if (!windowInstance) {
    return;
  }
  windowInstance.setMenuBarVisibility(false);
  if (typeof windowInstance.removeMenu === "function") {
    windowInstance.removeMenu();
  }
}

async function startNextServer() {
  if (isDev) {
    return DEV_SERVER_URL;
  }

  const appPath = app.getAppPath();
  const nextApp = next({ dev: false, dir: appPath });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  server = http.createServer((request, response) => handle(request, response));

  await new Promise((resolve) => {
    server.listen(PROD_SERVER_PORT, "127.0.0.1", resolve);
  });

  return PROD_SERVER_URL;
}

async function createWindow() {
  ensureDataDir();
  const appUrl = await startNextServer();
  currentAppBaseUrl = appUrl;
  appServerUrl = appUrl;
  const desktopIcon = loadDesktopIcon();

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#08101d",
    autoHideMenuBar: true,
    icon: desktopIcon.isEmpty() ? undefined : desktopIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  hideWindowMenu(mainWindow);
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    hideMainWindowToTray();
  });
  mainWindow.on("show", () => {
    mainWindow?.setSkipTaskbar(false);
  });

  await mainWindow.loadURL(appUrl);
  startGlobalSessionAuditScheduler();
}

function createScopedWindow(input = {}) {
  const scopedWindow = new BrowserWindow({
    show: input.show !== false,
    width: 1280,
    height: 900,
    minWidth: 1080,
    minHeight: 760,
    parent: mainWindow ?? undefined,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "平台窗口",
    backgroundColor: "#08101d",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      partition: typeof input.sessionPartition === "string" && input.sessionPartition.trim() ? input.sessionPartition.trim() : undefined,
    },
  });
  hideWindowMenu(scopedWindow);
  return scopedWindow;
}

function emitVideohaoExtensionDebug(hypothesisId, location, msg, data = {}) {
  // #region debug-point A:videohao-extension-log
  const envPath = path.join(process.cwd(), ".dbg", "videohao-extension-load.env");
  let debugServerUrl = "http://127.0.0.1:7777/event";
  let debugSessionId = "videohao-extension-load";
  try {
    const envContent = fs.readFileSync(envPath, "utf8");
    debugServerUrl = envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || debugServerUrl;
    debugSessionId = envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || debugSessionId;
  } catch {}
  fetch(debugServerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId: process.env.GEO_DEBUG_RUN_ID || "post-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function findPreferredBrowserExecutable() {
  if (process.platform !== "win32") {
    return "";
  }
  const candidatePaths = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  const matchedPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath)) || "";
  // #region debug-point B:browser-detect
  emitVideohaoExtensionDebug("B", "electron/main.js:findPreferredBrowserExecutable", "preferred browser detection result", {
    platform: process.platform,
    candidatePaths,
    matchedPath,
    env: {
      LOCALAPPDATA: process.env.LOCALAPPDATA || "",
      PROGRAMFILES: process.env.PROGRAMFILES || "",
      PROGRAMFILES_X86: process.env["PROGRAMFILES(X86)"] || "",
    },
  });
  // #endregion
  return matchedPath;
}

function getBundledVideohaoExtensionPath() {
  const packagedPath = path.join(process.resourcesPath || "", videohaoExtensionRelativePath);
  if (isDev) {
    return fs.existsSync(videohaoExtensionDevPath) ? videohaoExtensionDevPath : "";
  }
  return fs.existsSync(packagedPath) ? packagedPath : "";
}

function getVideohaoBrowserProfilePath() {
  return path.join(app.getPath("temp"), "geo-desktop", "videohao-browser-profile");
}

function ensureVideohaoBrowserProfilePath(profilePath) {
  const preferredPath = String(profilePath || "").trim() || getVideohaoBrowserProfilePath();
  try {
    fs.mkdirSync(preferredPath, { recursive: true });
    // #region debug-point F:profile-path-preferred
    emitVideohaoExtensionDebug("F", "electron/main.js:ensureVideohaoBrowserProfilePath", "using preferred videohao browser profile path", {
      preferredPath,
      fallbackUsed: false,
    });
    // #endregion
    return preferredPath;
  } catch (error) {
    const fallbackPath = path.join(app.getPath("userData"), "videohao-browser-profile");
    fs.mkdirSync(fallbackPath, { recursive: true });
    // #region debug-point F:profile-path-fallback
    emitVideohaoExtensionDebug("F", "electron/main.js:ensureVideohaoBrowserProfilePath", "using fallback videohao browser profile path", {
      preferredPath,
      fallbackPath,
      fallbackUsed: true,
      errorMessage: error instanceof Error ? error.message : String(error || ""),
    });
    // #endregion
    return fallbackPath;
  }
}

function prepareVideohaoBrowserProfilePath() {
  const profileRootPath = getVideohaoBrowserProfilePath();
  const tempRootPath = path.resolve(app.getPath("temp"), "geo-desktop");
  const resolvedProfileRootPath = path.resolve(profileRootPath);
  if (resolvedProfileRootPath !== tempRootPath && !resolvedProfileRootPath.startsWith(`${tempRootPath}${path.sep}`)) {
    throw new Error("Unsafe videohao browser profile path.");
  }

  try {
    fs.rmSync(resolvedProfileRootPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  } catch (_) {
    // Best effort only: a stale external browser may still hold the previous profile.
  }

  const launchProfilePath = path.join(resolvedProfileRootPath, `run-${Date.now()}-${process.pid}`);
  return ensureVideohaoBrowserProfilePath(launchProfilePath);
}

function buildPreferredBrowserArguments(targetUrl, options = {}) {
  const args = [targetUrl];
  if (!options.requireBundledVideohaoExtension) {
    return args;
  }

  const extensionPath = getBundledVideohaoExtensionPath();
  // #region debug-point C:extension-path
  emitVideohaoExtensionDebug("C", "electron/main.js:buildPreferredBrowserArguments", "resolved bundled extension path", {
    targetUrl,
    requireBundledVideohaoExtension: true,
    extensionPath,
    processResourcesPath: process.resourcesPath || "",
    cwd: process.cwd(),
    isDev,
  });
  // #endregion
  if (!extensionPath) {
    throw new Error("Missing bundled videohao browser extension.");
  }

  const profilePath = prepareVideohaoBrowserProfilePath();
  return [
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
    targetUrl,
  ];
}

async function openUrlInPreferredBrowser(url, options = {}) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    throw new Error("Missing browser url.");
  }
  const browserExecutable = findPreferredBrowserExecutable();
  if (browserExecutable) {
    const browserArgs = buildPreferredBrowserArguments(targetUrl, options);
    // #region debug-point D:browser-launch
    emitVideohaoExtensionDebug("D", "electron/main.js:openUrlInPreferredBrowser:before-exec", "launching preferred browser", {
      browserExecutable,
      browserArgs,
      requireBundledVideohaoExtension: Boolean(options.requireBundledVideohaoExtension),
    });
    // #endregion
    await new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(browserExecutable, browserArgs, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      child.once("error", (error) => {
        // #region debug-point E:browser-launch-error
        emitVideohaoExtensionDebug("E", "electron/main.js:openUrlInPreferredBrowser:spawn-error", "preferred browser launch failed", {
          browserExecutable,
          browserArgs,
          code: error.code || "",
          errno: error.errno || "",
          syscall: error.syscall || "",
          message: error.message || "",
        });
        // #endregion
        settle(reject, error);
      });
      child.unref();
      setTimeout(() => {
        // #region debug-point D:browser-launch-success
        emitVideohaoExtensionDebug("D", "electron/main.js:openUrlInPreferredBrowser:spawn-started", "preferred browser launch started", {
          browserExecutable,
          browserArgs,
          pid: child.pid || null,
        });
        // #endregion
        settle(resolve);
      }, 250);
    });
    return {
      browserExecutable,
      usedShellFallback: false,
    };
  }
  if (options.requireBundledVideohaoExtension) {
    // #region debug-point E:no-browser
    emitVideohaoExtensionDebug("E", "electron/main.js:openUrlInPreferredBrowser", "missing preferred browser executable for bundled extension launch", {
      targetUrl,
      requireBundledVideohaoExtension: true,
    });
    // #endregion
    throw new Error("Missing Chrome or Edge executable for bundled extension launch.");
  }
  await shell.openExternal(targetUrl);
  return {
    browserExecutable: "",
    usedShellFallback: true,
  };
}

function parseCookieHeader(authPayload) {
  const normalized = String(authPayload || "").trim();
  if (normalized.startsWith("[")) {
    try {
      const records = JSON.parse(normalized);
      if (Array.isArray(records)) {
        return records
          .map((record) => ({
            name: String(record?.name || "").trim(),
            value: String(record?.value || ""),
            domain: String(record?.domain || "").trim() || undefined,
            path: String(record?.path || "/").trim() || "/",
            secure: typeof record?.secure === "boolean" ? record.secure : true,
            httpOnly: typeof record?.httpOnly === "boolean" ? record.httpOnly : undefined,
            sameSite: typeof record?.sameSite === "string" ? record.sameSite : undefined,
            expirationDate: typeof record?.expirationDate === "number" ? record.expirationDate : undefined,
          }))
          .filter((cookie) => cookie.name);
      }
    } catch (_) {
      // Fall back to legacy name=value parsing below.
    }
  }
  if (normalized.startsWith("{")) {
    try {
      const record = JSON.parse(normalized);
      if (Array.isArray(record?.cookies)) {
        return record.cookies
          .map((cookie) => ({
            name: String(cookie?.name || "").trim(),
            value: String(cookie?.value || ""),
            domain: String(cookie?.domain || "").trim() || undefined,
            path: String(cookie?.path || "/").trim() || "/",
            secure: typeof cookie?.secure === "boolean" ? cookie.secure : true,
            httpOnly: typeof cookie?.httpOnly === "boolean" ? cookie.httpOnly : undefined,
            sameSite: typeof cookie?.sameSite === "string" ? cookie.sameSite : undefined,
            expirationDate: typeof cookie?.expirationDate === "number" ? cookie.expirationDate : undefined,
          }))
          .filter((cookie) => cookie.name);
      }
    } catch (_) {
      // Fall back to legacy name=value parsing below.
    }
  }
  return normalized
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) return null;
      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      return name ? { name, value } : null;
    })
    .filter(Boolean);
}

function parseAuthStorage(authPayload) {
  const normalized = String(authPayload || "").trim();
  if (!normalized.startsWith("{")) return null;
  try {
    const record = JSON.parse(normalized);
    return {
      localStorage: record?.localStorage && typeof record.localStorage === "object" ? record.localStorage : {},
      sessionStorage: record?.sessionStorage && typeof record.sessionStorage === "object" ? record.sessionStorage : {},
    };
  } catch (_) {
    return null;
  }
}

async function applyAuthStorageToWindow(windowInstance, authPayload, log) {
  const storage = parseAuthStorage(authPayload);
  if (!storage) return false;
  const localStorageEntries = Object.entries(storage.localStorage || {}).filter(([, value]) => typeof value === "string");
  const sessionStorageEntries = Object.entries(storage.sessionStorage || {}).filter(([, value]) => typeof value === "string");
  if (!localStorageEntries.length && !sessionStorageEntries.length) return false;
  try {
    await windowInstance.webContents.executeJavaScript(
      `(() => {
        const localEntries = ${JSON.stringify(localStorageEntries)};
        const sessionEntries = ${JSON.stringify(sessionStorageEntries)};
        for (const [key, value] of localEntries) window.localStorage.setItem(key, value);
        for (const [key, value] of sessionEntries) window.sessionStorage.setItem(key, value);
        return { local: localEntries.length, session: sessionEntries.length };
      })()`,
      true,
    );
    if (typeof log === "function") log(`auth_storage_applied: local=${localStorageEntries.length} session=${sessionStorageEntries.length}`);
    return true;
  } catch (error) {
    if (typeof log === "function") log(`auth_storage_failed: ${error instanceof Error ? error.message : "unknown"}`);
    return false;
  }
}

function getCookieTargetUrls(platform, publishUrl) {
  const urls = new Set([publishUrl].filter(Boolean));
  switch (String(platform || "")) {
    case "videohao":
      urls.add("https://channels.weixin.qq.com/");
      urls.add("https://mp.weixin.qq.com/");
      urls.add("https://weixin.qq.com/");
      break;
    case "wechat":
      urls.add("https://mp.weixin.qq.com/");
      urls.add("https://weixin.qq.com/");
      break;
    default:
      break;
  }
  return Array.from(urls);
}

function getCookieDomainsForUrl(url) {
  try {
    const host = new URL(url).hostname;
    const domains = [undefined];
    if (host.endsWith("weixin.qq.com")) domains.push(".weixin.qq.com");
    if (host.endsWith("qq.com")) domains.push(".qq.com");
    return domains;
  } catch (_) {
    return [undefined];
  }
}

async function applyAuthPayloadToPartition(input = {}) {
  const authPayload = String(input.authPayload || "").trim();
  const partition = typeof input.sessionPartition === "string" ? input.sessionPartition.trim() : "";
  if (!authPayload || !partition) return { applied: false, count: 0 };
  const cookies = parseCookieHeader(authPayload);
  if (!cookies.length) return { applied: false, count: 0 };

  const partitionSession = session.fromPartition(partition);
  const writes = [];
  const cookieSpecificTargetUrl = (cookie) => {
    const domain = String(cookie.domain || "").trim().replace(/^\./, "");
    if (!domain) return "";
    return `${cookie.secure === false ? "http" : "https"}://${domain}${cookie.path || "/"}`;
  };
  for (const targetUrl of getCookieTargetUrls(input.platform, input.publishUrl)) {
    for (const cookie of cookies) {
      if (cookie.domain) {
        const cookieUrl = cookieSpecificTargetUrl(cookie) || targetUrl;
        writes.push(
          partitionSession.cookies
            .set({
              url: cookieUrl,
              name: cookie.name,
              value: cookie.value,
              path: cookie.path || "/",
              secure: cookie.secure !== false,
              domain: cookie.domain,
              ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
              ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
              ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
            })
            .then(() => true)
            .catch(() => false),
        );
        continue;
      }
      for (const domain of getCookieDomainsForUrl(targetUrl)) {
        writes.push(
          partitionSession.cookies
            .set({
              url: targetUrl,
              name: cookie.name,
              value: cookie.value,
              path: "/",
              secure: true,
              ...(domain ? { domain } : {}),
            })
            .then(() => true)
            .catch(() => false),
        );
      }
    }
  }
  const results = await Promise.all(writes);
  return { applied: results.some(Boolean), count: results.filter(Boolean).length };
}

async function exportAuthPayloadFromPartition(input = {}) {
  const partition = typeof input.sessionPartition === "string" ? input.sessionPartition.trim() : "";
  if (!partition) return "";

  const spec = getPlatformSessionSpec(input.platform, input.publishUrl);
  if (!spec.publishUrl) return "";

  const partitionSession = session.fromPartition(partition);
  const cookiesByKey = new Map();
  for (const targetUrl of getCookieTargetUrls(input.platform, spec.publishUrl)) {
    try {
      const cookies = await partitionSession.cookies.get({ url: targetUrl });
      for (const cookie of cookies) {
        const key = [cookie.domain || "", cookie.path || "/", cookie.name || ""].join("|");
        if (!cookie.name || cookiesByKey.has(key)) continue;
        cookiesByKey.set(key, {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || "/",
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate,
        });
      }
    } catch (_) {
      // Ignore per-domain cookie export failures.
    }
  }

  const cookies = Array.from(cookiesByKey.values());
  return cookies.length ? JSON.stringify(cookies) : "";
}

function getPlatformSessionSpec(platform, publishUrl) {
  const normalizedPlatform = String(platform || "").trim();
  switch (normalizedPlatform) {
    case "toutiao":
      return {
        publishUrl: publishUrl || "https://mp.toutiao.com/profile_v4/graphic/publish",
        loginUrlHints: ["/auth/page/login", "/login", "passport", "signin", "sso"],
        loginTextHints: ["验证码登录", "扫码登录", "请先登录", "立即登录"],
      };
    case "baijiahao":
      return {
        publishUrl: publishUrl || "https://baijiahao.baidu.com/builder/rc/edit?type=news",
        loginUrlHints: ["/login", "passport", "signin", "sso", "cas.baidu.com"],
        loginTextHints: ["扫码登录", "请先登录", "百度账号登录", "立即登录"],
      };
    case "douyin":
      return {
        publishUrl: publishUrl || "https://creator.douyin.com/creator-micro/content/upload",
        loginUrlHints: ["/login", "passport", "signin", "sso"],
        loginTextHints: ["扫码登录", "请先登录", "验证码登录"],
      };
    case "xiaohongshu":
      return {
        publishUrl: publishUrl || "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        loginUrlHints: ["/login", "passport", "signin", "sso", "xiaohongshu.com/login"],
        loginTextHints: ["扫码登录", "验证码登录", "手机号登录", "请先登录", "登录小红书"],
      };
    case "wechat":
      return {
        publishUrl: publishUrl || "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10",
        loginUrlHints: ["/cgi-bin/bizlogin", "/cgi-bin/loginpage", "login.weixin.qq.com", "open.weixin.qq.com/connect/qrconnect"],
        loginTextHints: ["请使用微信扫码登录", "扫码登录", "微信扫一扫", "账号密码登录", "登录公众平台", "请重新登录"],
      };
    case "videohao":
      return {
        publishUrl: publishUrl || "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
        loginUrlHints: ["login.weixin.qq.com", "open.weixin.qq.com/connect/qrconnect", "/login"],
        loginTextHints: ["请使用微信扫码登录", "扫码登录", "微信扫一扫", "请重新登录", "登录"],
      };
    case "zhihu":
      return {
        publishUrl: publishUrl || "https://zhuanlan.zhihu.com/write",
        loginUrlHints: ["/signin", "/login", "passport", "oauth"],
        loginTextHints: ["扫码登录", "密码登录", "验证码登录"],
      };
    case "weibo":
      return {
        publishUrl: publishUrl || "https://weibo.com/",
        loginUrlHints: ["/login", "/newlogin", "passport", "sina.com.cn/signup", "signin"],
        loginTextHints: ["扫码登录", "账号登录", "请输入手机号", "请输入密码", "验证码登录"],
      };
    case "csdn":
      return {
        publishUrl: publishUrl || "https://editor.csdn.net/md/",
        loginUrlHints: ["/login", "passport", "sso", "signin"],
        loginTextHints: ["扫码登录", "账号密码登录", "请输入手机号", "验证码登录"],
        authenticatedPageUrlHints: ["editor.csdn.net"],
        authenticatedPageSelectors: [
          "#txtTitle",
          "input[name='title']",
          ".article-title-box input",
          ".article-title input",
          ".title-input",
          "textarea.editor",
          ".CodeMirror",
          ".editor__inner",
          "pre[contenteditable='true']",
        ],
        requiresAuthenticatedMarker: true,
      };
    default:
      return {
        publishUrl: publishUrl || "",
        loginUrlHints: ["/login", "passport", "signin"],
        loginTextHints: ["扫码登录", "请先登录"],
      };
  }
}

async function getSessionCookieCount(spec, partition) {
  const partitionSession = partition ? session.fromPartition(partition) : session.defaultSession;
  try {
    const cookies = await partitionSession.cookies.get({ url: spec.publishUrl });
    return cookies.length;
  } catch {
    return 0;
  }
}

async function getSessionCookiesForAuthPayload(input = {}, spec, partition) {
  const partitionSession = partition ? session.fromPartition(partition) : session.defaultSession;
  const targetUrls = getCookieTargetUrls(input.platform, spec.publishUrl);
  const seen = new Set();
  const collected = [];

  for (const targetUrl of targetUrls) {
    try {
      const cookies = await partitionSession.cookies.get({ url: targetUrl });
      for (const cookie of cookies) {
        const cookieKey = `${cookie.name}|${cookie.domain || ""}|${cookie.path || "/"}`;
        if (seen.has(cookieKey)) {
          continue;
        }
        seen.add(cookieKey);
        collected.push({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain || undefined,
          path: cookie.path || "/",
          secure: cookie.secure !== false,
          httpOnly: typeof cookie.httpOnly === "boolean" ? cookie.httpOnly : undefined,
          sameSite: typeof cookie.sameSite === "string" ? cookie.sameSite : undefined,
          expirationDate: typeof cookie.expirationDate === "number" ? cookie.expirationDate : undefined,
        });
      }
    } catch (_) {
      // Ignore per-domain cookie read failures and continue collecting the rest.
    }
  }

  return collected;
}

async function captureWindowStorage(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return { localStorage: {}, sessionStorage: {} };
  }
  try {
    return await windowInstance.webContents.executeJavaScript(
      `(() => {
        const readStorage = (storage) => {
          const entries = {};
          try {
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              if (!key) continue;
              const value = storage.getItem(key);
              if (typeof value === "string") {
                entries[key] = value;
              }
            }
          } catch (_) {
            // Ignore storage read errors and keep other values.
          }
          return entries;
        };
        return {
          localStorage: readStorage(window.localStorage),
          sessionStorage: readStorage(window.sessionStorage),
        };
      })()`,
      true,
    );
  } catch (_) {
    return { localStorage: {}, sessionStorage: {} };
  }
}

async function buildSessionAuthPayload(input = {}, windowInstance, spec, partition) {
  const validatedAt = now();
  const [cookies, storage] = await Promise.all([
    getSessionCookiesForAuthPayload(input, spec, partition),
    captureWindowStorage(windowInstance),
  ]);
  const localStorage = storage?.localStorage && typeof storage.localStorage === "object" ? storage.localStorage : {};
  const sessionStorage = storage?.sessionStorage && typeof storage.sessionStorage === "object" ? storage.sessionStorage : {};
  if (!cookies.length && !Object.keys(localStorage).length && !Object.keys(sessionStorage).length) {
    return { validatedAt };
  }
  return {
    authPayload: JSON.stringify({
      cookies,
      localStorage,
      sessionStorage,
    }),
    authPayloadUpdatedAt: validatedAt,
    validatedAt,
  };
}

async function inspectLoadedPlatformPage(windowInstance, spec, cookieCount) {
  const inspection = await windowInstance.webContents.executeJavaScript(
    `(() => {
      const currentUrl = window.location.href;
      const pageText = String(document.body?.innerText || document.body?.textContent || "").replace(/\\s+/g, " ").trim();
      const loginUrlHints = ${JSON.stringify(spec.loginUrlHints)};
      const loginTextHints = ${JSON.stringify(spec.loginTextHints)};
      const authenticatedSelectors = ${JSON.stringify(spec.authenticatedSelectors || [])};
      const authenticatedPageUrlHints = ${JSON.stringify(spec.authenticatedPageUrlHints || [])};
      const authenticatedPageSelectors = ${JSON.stringify(spec.authenticatedPageSelectors || [])};
      const requiresAuthenticatedMarker = ${JSON.stringify(Boolean(spec.requiresAuthenticatedMarker))};
      const lowerUrl = currentUrl.toLowerCase();
      const matchedUrlHint = loginUrlHints.find((hint) => lowerUrl.includes(String(hint).toLowerCase())) || "";
      const hasAuthenticatedMarker = authenticatedSelectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        }),
      );
      const matchedAuthenticatedPageUrlHint = authenticatedPageUrlHints.find((hint) => lowerUrl.includes(String(hint).toLowerCase())) || "";
      const hasAuthenticatedPageSelector = authenticatedPageSelectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        }),
      );
      const hasAuthenticatedPage = Boolean(matchedAuthenticatedPageUrlHint && hasAuthenticatedPageSelector);
      const visibleControls = Array.from(document.querySelectorAll("input, textarea, button, [role='button'], a"))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        });
      const hasLoginInput = visibleControls.some((element) => {
        const text = [
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          element.getAttribute("name"),
          element.getAttribute("type"),
          element.textContent,
        ].filter(Boolean).join(" ");
        return /手机号|手机|验证码|密码|账号|email|e-mail|password|tel|login|signin/i.test(text);
      });
      const hasLoginAction = visibleControls.some((element) => {
        const text = String(element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, "");
        return /扫码登录|账号登录|密码登录|验证码登录|立即登录|请先登录|登录公众平台|百度账号登录/.test(text);
      });
      const hasLoginFormSignal = Boolean(matchedUrlHint || hasLoginInput || hasLoginAction);
      const matchedTextHint = hasLoginFormSignal ? (loginTextHints.find((hint) => pageText.includes(hint)) || "") : "";
      return {
        currentUrl,
        matchedUrlHint,
        matchedTextHint,
        hasAuthenticatedMarker: hasAuthenticatedMarker || hasAuthenticatedPage,
        requiresAuthenticatedMarker,
      };
    })()`,
    true,
  );

  if (inspection?.hasAuthenticatedMarker && !inspection?.matchedUrlHint && !inspection?.matchedTextHint) {
    return {
      status: "authenticated",
      reason: cookieCount > 0 ? `检测到 ${cookieCount} 个会话 Cookie，且命中平台已登录标记。` : "命中平台已登录标记，判定为已登录。",
      currentUrl: inspection?.currentUrl || spec.publishUrl,
      cookieCount,
    };
  }

  if (inspection?.matchedUrlHint || inspection?.matchedTextHint) {
    return {
      status: cookieCount > 0 ? "expired" : "missing_session",
      reason: inspection?.matchedTextHint
        ? `页面显示登录提示：${inspection.matchedTextHint}`
        : `页面跳转到登录相关地址：${inspection?.matchedUrlHint || inspection?.currentUrl || "unknown"}`,
      currentUrl: inspection?.currentUrl || spec.publishUrl,
      cookieCount,
    };
  }

  if (inspection?.requiresAuthenticatedMarker) {
    return {
      status: cookieCount > 0 ? "expired" : "missing_session",
      reason: "Authenticated marker was not detected.",
      currentUrl: inspection?.currentUrl || spec.publishUrl,
      cookieCount,
    };
  }

  return {
    status: "authenticated",
    reason: cookieCount > 0 ? `检测到 ${cookieCount} 个会话 Cookie，且页面未出现登录提示。` : "页面未出现登录提示，判定为已登录。",
    currentUrl: inspection?.currentUrl || spec.publishUrl,
    cookieCount,
  };
}

function buildPlatformAccountProfileProbe(platform) {
  switch (String(platform || "").trim()) {
    case "toutiao":
      return {
        displayNameSelectors: [
          ".auth-avator-name",
          "span.name",
          ".user-name",
          ".header-user-name",
          ".user-info-name",
          ".user__name",
          ".header-right .name",
          ".header-user-info .name",
          ".header-user-info .user-name",
          ".header-user-info [class*='name']",
          ".topbar-user-name",
          ".avatar-name",
          "[class*='user-name']",
          "[class*='account-name']",
          "[class*='nick-name']",
          "[class*='nickname']",
          "[data-e2e='user-name']",
        ],
        avatarSelectors: [
          ".auth-avator-img",
          ".header-avatar img",
          ".header-avatar",
          ".user-avatar img",
          ".user-avatar",
          ".avatar img",
          ".avatar",
          "[class*='avatar'] img",
          "[class*='avatar']",
          "[class*='user-avatar'] img",
          "[class*='user-avatar']",
          "img[alt*='头像']",
          "img[src*='toutiaoimg.com']",
          "img[src*='byteimg.com']",
          "img[data-src*='toutiaoimg.com']",
          "img[data-src*='byteimg.com']",
          "img[srcset*='toutiaoimg.com']",
          "img[srcset*='byteimg.com']",
        ],
        accountIdSelectors: [".user-id", ".account-id", "[data-e2e='user-id']", "[class*='user-id']", "[class*='account-id']"],
        idPatterns: ["头条号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})", "ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "douyin":
      return {
        displayNameSelectors: [
          ".name-_lSSDc",
          ".semi-navigation-header .user-name",
          ".creator-header-user-name",
          ".account-info-name",
          ".creator-header .name",
          "[data-e2e='creator-name']",
          "[class*='creator-name']",
          "[class*='nickname']",
          "[class*='user-name']",
          "[class*='account-name']",
        ],
        avatarSelectors: [
          ".semi-navigation-header img",
          ".creator-header img",
          ".account-avatar img",
          ".creator-avatar img",
          ".semi-avatar img",
          "[data-e2e='creator-avatar'] img",
          "[class*='avatar'] img",
          "[class*='account-avatar'] img",
          "[class*='creator-avatar'] img",
          "[class*='semi-avatar'] img",
          "[class*='avatar']",
          "[class*='creator-avatar']",
          "[data-e2e='creator-avatar']",
          "img[alt*='头像']",
          "img[src*='douyinpic.com']",
          "img[src*='byteimg.com']",
          "img[src*='pstatp.com']",
        ],
        accountIdSelectors: [".unique_id-EuH8eA", ".account-id", "[data-e2e='account-id']", ".creator-header .user-id", "[class*='account-id']", "[class*='user-id']"],
        idPatterns: ["抖音号[:：\\\\s]*([A-Za-z0-9._-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9._-]{4,})", "ID[:：\\\\s]*([A-Za-z0-9._-]{4,})"],
      };
    case "baijiahao":
      return {
        displayNameSelectors: [
          "a[href*='/builder/rc/settings/accountSet']",
          ".FeReactApp-_67642abe502443cd-userName",
          "[class*='userName']",
          "[class*='user-name']",
          "[class*='account-name']",
          ".user-name",
        ],
        avatarSelectors: [
          "[class*='avatar'] img",
          ".avatar img",
          "img[src*='bcebos.com']",
          "img[src*='bdstatic.com']",
        ],
        accountIdSelectors: [
          ".FeReactApp-_67642abe502443cd-bjhIdName",
          "[class*='bjhIdName']",
          "[class*='account-id']",
          "[class*='user-id']",
        ],
        idPatterns: ["百家号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})", "百家号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "wechat":
      return {
        displayNameSelectors: [
          ".weui-desktop_name",
          "[data-v-f8205402]",
          ".weui-desktop-account__info-name",
          ".account_box .account_name",
          ".account_box .nickname",
          ".weui-desktop-layout__hd [class*='name']",
          "[class*='account-name']",
        ],
        avatarSelectors: [
          ".weui-desktop-account__img",
          ".weui-desktop-account__info-avatar img",
          ".account_box img",
          "[class*='avatar'] img",
          "img[src*='qlogo.cn']",
          "img[src*='wx.qlogo.cn']",
        ],
        accountIdSelectors: [
          "[data-v-f8205402]",
          ".weui-desktop-account__info-id",
          ".account_box .account_meta",
          "[class*='account-id']",
        ],
        idPatterns: ["微信号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "公众号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "videohao":
      return {
        displayNameSelectors: [
          ".finder-nickname",
          "[class*='nickname']",
          "[class*='account-name']",
          "[class*='user-name']",
          "[class*='creator-name']",
          "[class*='profile-name']",
          ".account-name",
          ".user-name",
          ".name",
        ],
        avatarSelectors: [
          "img.avatar[alt*='视频号头像']",
          "img.avatar",
          "[class*='avatar'] img",
          "[class*='avatar']",
          ".account-avatar img",
          ".user-avatar img",
          "img[src*='qlogo.cn']",
          "img[src*='wx.qlogo.cn']",
        ],
        accountIdSelectors: [
          "a[href*='channels.weixin.qq.com']",
          "[class*='account-id']",
          "[class*='user-id']",
          "[class*='channel-id']",
        ],
        idPatterns: ["视频号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "微信号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "xiaohongshu":
      return {
        displayNameSelectors: [
          "[class*='user-name']",
          "[class*='nickname']",
          "[class*='account-name']",
          "[class*='creator-name']",
          "[class*='profile-name']",
          ".user-name",
          ".nickname",
          ".name",
        ],
        avatarSelectors: [
          "[class*='avatar'] img",
          "[class*='avatar']",
          ".user-avatar img",
          ".creator-avatar img",
          "img[src*='xhscdn.com']",
          "img[src*='xiaohongshu.com']",
        ],
        accountIdSelectors: [
          "a[href*='/user/profile/']",
          "a[href*='/explore/']",
          "[class*='user-id']",
          "[class*='account-id']",
          "[class*='xhs-id']",
        ],
        idPatterns: ["小红书号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "小红书ID[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "zhihu":
      return {
        displayNameSelectors: [
          "span.ProfileHeader-name",
          ".ProfileHeader-name",
          ".AppHeader-profileEntry-name",
          "[class*='ProfileHeader-name']",
          "[class*='profileEntry'] [class*='name']",
        ],
        avatarSelectors: [
          "img.Avatar.AppHeader-profileAvatar",
          ".AppHeader-profileAvatar",
          ".ProfileHeader-avatar img",
          ".AppHeader-profile img",
          "[class*='Avatar'] img",
          "img[src*='zhimg.com']",
        ],
        accountIdSelectors: [
          "a.Menu-item[href*='/people/']",
          "a[href*='/people/']",
          ".ProfileHeader-content a[href*='/people/']",
        ],
        idPatterns: ["知乎号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "weibo":
      return {
        displayNameSelectors: [
          "._name_1yc79_291",
          "[class*='_name_']",
          "[class*='profile-name']",
          "[class*='user-name']",
          "[class*='nickname']",
        ],
        avatarSelectors: [
          "img[class*='_avatar_']",
          "img[alt='profile']",
          "[class*='avatar'] img",
          "[class*='_avatar_'] img",
          ".woo-avatar-img",
          "img[src*='sinaimg.cn']",
          "img[src*='weiboimg.com']",
        ],
        accountIdSelectors: [
          "a[href*='/u/']",
          "a[href*='/profile/']",
          "[class*='user-id']",
        ],
        idPatterns: ["微博号[:：\\\\s]*([A-Za-z0-9_-]{4,})", "UID[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    case "csdn":
      return {
        displayNameSelectors: [
          ".csdn-profile-nickName",
          ".csdn-profile-top .csdn-profile-nickName",
          ".csdn-toolbar-plugin .csdn-profile-nickName",
          "[class*='toolbar-name']",
          "[class*='profile-name']",
          "[class*='user-name']",
          ".toolbar-btn-name",
          ".user-name",
        ],
        avatarSelectors: [
          ".csdn-profile-avatar img",
          ".csdn-toolbar-plugin .csdn-profile-avatar img",
          "a.hasAvatar img",
          "[class*='avatar'] img",
          ".toolbar-avatar img",
          "img[src*='csdnimg.cn']",
          "img[src*='csdn.net']",
        ],
        accountIdSelectors: [
          ".csdn-profile-avatar[href*='blog.csdn.net/']",
          "a[href*='blog.csdn.net/']",
          "a[href*='/user/']",
          "[class*='user-id']",
        ],
        idPatterns: ["CSDNID[:：\\\\s]*([A-Za-z0-9_-]{4,})", "账号ID[:：\\\\s]*([A-Za-z0-9_-]{4,})"],
      };
    default:
      return {
        displayNameSelectors: [],
        avatarSelectors: [],
        accountIdSelectors: [],
        idPatterns: ["账号ID[:：\\\\s]*([A-Za-z0-9._-]{4,})", "ID[:：\\\\s]*([A-Za-z0-9._-]{4,})"],
      };
  }
}

async function extractPlatformAccountProfile(windowInstance, input = {}) {
  const probe = buildPlatformAccountProfileProbe(input.platform);
  return windowInstance.webContents.executeJavaScript(
    `(async () => {
      const probe = ${JSON.stringify(probe)};
      const platform = ${JSON.stringify(String(input.platform || "").trim())};
      const blockedNames = new Set(["主页", "创作", "文章", "视频", "微头条", "管理", "数据", "收益", "任务", "创作中心", "发布", "发布作品", "内容管理", "作品管理", "首页", "消息", "登录", "退出登录", "去发布", "发作品", "发布内容", "高清发布", "立即发布", "定时发布", "发布设置", "活动管理"]);
      const genericPlatformNames = new Set(["今日头条", "今日头条账号", "百家号", "百家号账号", "抖音", "抖音账号", "小红书", "小红书账号", "微信公众号", "微信公众号账号", "视频号", "视频号账号", "知乎", "知乎账号", "微博", "微博账号", "CSDN", "CSDN账号"]);
      const blockedNamePattern = /发文规范|创作中心|内容管理|作品管理|发布作品|发布内容|创作服务平台|工作台|去发布|发作品|退出登录|活动管理|互动管理|\\u70ed\\u70b9\\u699c|\\u5feb\\u6765\\u770b\\u770b|^\\s*\\u5207\\u6362\\s+.*\\(\\d+s\\)\\s*$/i;
      const invalidProfileValues = new Set(["true", "false", "null", "undefined", "nan", "[object object]"]);
      const userTrailPattern = /user|account|profile|creator|author|member|owner|avatar|nick|display|uid|sec_uid|secuid|login/i;
      const displayNameTrailPattern =
        platform === "douyin"
          ? /nickname|nick_name|screen_name|display_name|displayname|remark_name|nick/i
          : /nickname|nick_name|screen_name|display_name|displayname|name|user_name|username|authorname/i;
      const displayNameValuePattern =
        platform === "douyin"
          ? /nickname|nick_name|screen_name|display_name|displayname|remark_name|nick/i
          : /nickname|nick_name|screen_name|display_name|displayname|name|user_name|username|authorname/i;
      const normalizeText = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const sanitizeDisplayNameByPlatform = (value) => {
        const text = normalizeText(value);
        if (!text) return "";
        if (platform === "baijiahao") {
          const matched = text.match(/^(?:上午好|中午好|下午好|晚上好)[,，]\\s*(.+)$/);
          if (matched?.[1]) {
            return normalizeText(matched[1]);
          }
        }
        return text;
      };
      const isMeaningfulName = (value) => {
        const text = sanitizeDisplayNameByPlatform(value);
        const lower = text.toLowerCase();
        return Boolean(text) && !blockedNames.has(text) && !genericPlatformNames.has(text) && !invalidProfileValues.has(lower) && !blockedNamePattern.test(text) && text.length >= 2 && text.length <= 40;
      };
      const stripPlatformIdPrefix = (value) =>
        normalizeText(value).replace(/^(账号ID|ID|抖音号|头条号|百家号ID|百家号|知乎号|微博号|微信号|公众号|视频号|小红书号|小红书ID|CSDNID|UID)[:：\\s]*/i, "");
      const isMeaningfulPlatformId = (value) => {
        const text = stripPlatformIdPrefix(value);
        const lower = text.toLowerCase();
        if (!text || invalidProfileValues.has(lower)) return false;
        if (text.length < 4 || text.length > 80) return false;
        if (/^(yes|no|on|off)$/i.test(text)) return false;
        if (!/[a-z0-9._-]/i.test(text)) return false;
        return true;
      };
      const toAbsoluteUrl = (value) => {
        const text = normalizeText(value);
        if (!text) return "";
        try {
          return new URL(text, window.location.href).href;
        } catch (_) {
          return text;
        }
      };
      const ensureZhihuProfilePage = async () => {
        if (platform !== "zhihu") return;
        const currentUrl = toAbsoluteUrl(window.location.href);
        if (/\\/people\\/(?!self(?:[/?#]|$))[^/?#]+/i.test(currentUrl)) {
          return;
        }
        const avatarNode =
          document.querySelector("img.AppHeader-profileAvatar") ||
          document.querySelector(".AppHeader-profileAvatar") ||
          document.querySelector(".AppHeader-profile img") ||
          document.querySelector(".AppHeader-profile");
        const avatarTrigger = avatarNode?.closest?.("button, a, [role='button']") || avatarNode;
        if (avatarTrigger && typeof avatarTrigger.click === "function") {
          avatarTrigger.click();
          await sleep(250);
        }
        const menuItems = Array.from(document.querySelectorAll("a[href*='/people/']"));
        const homeLink = menuItems.find((node) => {
          const text = normalizeText(node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
          const href = toAbsoluteUrl(node.getAttribute("href") || "");
          return (/我的主页/.test(text) || /\\/people\\/(?!self(?:[/?#]|$))[^/?#]+/i.test(href)) && /^https?:\\/\\//i.test(href);
        });
        const profileUrl = toAbsoluteUrl(homeLink?.getAttribute?.("href") || "");
        if (profileUrl && profileUrl !== currentUrl && /\\/people\\/(?!self(?:[/?#]|$))[^/?#]+/i.test(profileUrl)) {
          window.location.href = profileUrl;
          await sleep(250);
        }
      };
      const ensureBaijiahaoAccountMenu = async () => {
        if (platform !== "baijiahao") return;
        const accountLinkSelector = "a[href*='/builder/rc/settings/accountSet']";
        const hasVisibleGreeting = () =>
          Array.from(document.querySelectorAll(accountLinkSelector)).some((node) =>
            isVisible(node) && /^(?:上午好|中午好|下午好|晚上好)[,，]\\s*.+$/.test(normalizeText(node.textContent || ""))
          );
        if (hasVisibleGreeting()) {
          return;
        }
        const triggerCandidates = Array.from(
          document.querySelectorAll(
            "header [role='button'], header button, header a, header div, nav [role='button'], nav button, nav a, nav div",
          ),
        ).filter((node) => {
          if (!node || !isVisible(node)) return false;
          const text = normalizeText(node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
          const classText = normalizeText(node.className || "");
          return (
            /user|avatar|account|header|profile/i.test(classText) ||
            /账号|头像|个人|用户/.test(text) ||
            Boolean(node.querySelector?.("img, svg"))
          );
        });
        for (const trigger of triggerCandidates.slice(0, 8)) {
          ["mouseenter", "mouseover", "mousemove"].forEach((eventName) => {
            trigger.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
          });
          if (typeof trigger.click === "function") {
            trigger.click();
          }
          await sleep(250);
          if (hasVisibleGreeting()) {
            return;
          }
        }
      };
      const isVisible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      await ensureZhihuProfilePage();
      await ensureBaijiahaoAccountMenu();
      const pickTextBySelectors = (selectors, validator = isMeaningfulName) => {
        for (const selector of selectors || []) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            const text = sanitizeDisplayNameByPlatform(
              node?.textContent ||
                node?.getAttribute?.("title") ||
                node?.getAttribute?.("aria-label") ||
                node?.getAttribute?.("alt") ||
                node?.getAttribute?.("data-name") ||
                "",
            );
            if (isVisible(node) && validator(text)) return text;
          }
        }
        return "";
      };
      const extractPlatformIdFromHref = (href) => {
        const text = toAbsoluteUrl(href);
        if (!/^https?:\\/\\//i.test(text)) return "";
        try {
          const url = new URL(text, window.location.href);
          const pathname = url.pathname || "";
          const matched =
            pathname.match(/\\/people\\/([^/?#]+)/i) ||
            pathname.match(/\\/u\\/([^/?#]+)/i) ||
            pathname.match(/\\/user\\/profile\\/([^/?#]+)/i) ||
            pathname.match(/\\/profile\\/([^/?#]+)/i) ||
            pathname.match(/\\/platform\\/([^/?#]+)/i) ||
            pathname.match(/blog\\.csdn\\.net\\/([^/?#]+)/i) ||
            url.href.match(/blog\\.csdn\\.net\\/([^/?#]+)/i);
          return matched?.[1] ? stripPlatformIdPrefix(matched[1]) : "";
        } catch (_) {
          return "";
        }
      };
      const pickPlatformIdBySelectors = (selectors) => {
        for (const selector of selectors || []) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            if (!isVisible(node)) continue;
            const text = stripPlatformIdPrefix(node?.textContent);
            if (isMeaningfulPlatformId(text)) return text;
            const hrefId = extractPlatformIdFromHref(node?.getAttribute?.("href") || "");
            if (isMeaningfulPlatformId(hrefId)) return hrefId;
            const dataHrefId = extractPlatformIdFromHref(node?.getAttribute?.("data-href") || "");
            if (isMeaningfulPlatformId(dataHrefId)) return dataHrefId;
          }
        }
        return "";
      };
      const pickAvatarBySelectors = (selectors) => {
        const pickUrlFromSrcset = (value) => {
          const raw = String(value || "").trim();
          if (!raw) return "";
          const firstCandidate = raw
            .split(",")
            .map((item) => item.trim().split(/\s+/)[0])
            .find(Boolean);
          return toAbsoluteUrl(firstCandidate || "");
        };
        for (const selector of selectors || []) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            if (!node) continue;
            const currentSrc = toAbsoluteUrl(
              node.currentSrc ||
                node.getAttribute("src") ||
                node.getAttribute("data-src") ||
                "",
            );
            const hasRenderableImageSignal =
              /^https?:\/\//i.test(currentSrc) &&
              ((typeof node.naturalWidth === "number" && node.naturalWidth >= 32) ||
                (typeof node.naturalHeight === "number" && node.naturalHeight >= 32));
            if (!isVisible(node) && !hasRenderableImageSignal) continue;
            const src = toAbsoluteUrl(
              node.currentSrc ||
                node.getAttribute("src") ||
                node.getAttribute("data-src") ||
                node.getAttribute("data-avatar") ||
                node.getAttribute("poster") ||
                "",
            );
            if (src && /^https?:\\/\\//i.test(src)) return src;
            const srcset = pickUrlFromSrcset(node.getAttribute("srcset") || node.getAttribute("data-srcset") || "");
            if (srcset && /^https?:\\/\\//i.test(srcset)) return srcset;
            const backgroundImage = normalizeText(window.getComputedStyle(node).backgroundImage || "");
            const matched = backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/i);
            const backgroundUrl = toAbsoluteUrl(matched?.[1] || "");
            if (backgroundUrl && /^https?:\\/\\//i.test(backgroundUrl)) return backgroundUrl;
          }
        }
        return "";
      };
      const parseJson = (value) => {
        try {
          return JSON.parse(value);
        } catch (_) {
          return null;
        }
      };
      const storageCandidates = [];
      const walkObject = (node, trail, depth) => {
        if (!node || depth > 3) return;
        if (typeof node === "string") {
          storageCandidates.push([trail.join("."), node]);
          return;
        }
        if (typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.slice(0, 8).forEach((item, index) => walkObject(item, [...trail, String(index)], depth + 1));
          return;
        }
        Object.entries(node).slice(0, 30).forEach(([key, value]) => walkObject(value, [...trail, key], depth + 1));
      };
      for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key || !/user|account|profile|creator|login|member/i.test(key)) continue;
            const raw = storage.getItem(key);
            if (!raw) continue;
            const parsed = parseJson(raw);
            if (parsed) walkObject(parsed, [key], 0);
          }
        } catch (_) {
          // Ignore storage access errors.
        }
      }
      for (const script of Array.from(document.querySelectorAll("script")).slice(0, 20)) {
        try {
          const type = normalizeText(script.getAttribute("type") || "");
          const id = normalizeText(script.getAttribute("id") || "");
          if (!(type.includes("json") || /state|data|initial|rehydration/i.test(id))) continue;
          const raw = String(script.textContent || "").trim();
          if (!raw || raw.length > 400000 || !/^[\\[{]/.test(raw)) continue;
          const parsed = parseJson(raw);
          if (parsed) walkObject(parsed, [id || type || "script-json"], 0);
        } catch (_) {
          // Ignore script parsing errors.
        }
      }
      const globalObjectCandidates = [
        ["__INITIAL_STATE__", window.__INITIAL_STATE__],
        ["__NEXT_DATA__", window.__NEXT_DATA__],
        ["__NUXT__", window.__NUXT__],
        ["__STORE__", window.__STORE__],
      ];
      for (const [key, value] of globalObjectCandidates) {
        try {
          if (value && typeof value === "object") {
            walkObject(value, [key], 0);
          }
        } catch (_) {
          // Ignore global data access errors.
        }
      }
      const pickStorageValue = (pattern, validator, trailValidator) => {
        for (const [trail, value] of storageCandidates) {
          if (!pattern.test(trail)) continue;
          if (trailValidator && !trailValidator(trail)) continue;
          const text = normalizeText(value);
          if (text && (!validator || validator(text))) return text;
        }
        return "";
      };
      const fallbackName = Array.from(document.querySelectorAll("header *, nav *, [class*='header'] *, [class*='avatar'] *, [class*='user'] *"))
        .filter((element) => isVisible(element))
        .map((element) => normalizeText(element.textContent))
        .find((text) => isMeaningfulName(text) && text.length <= 32) || "";
      const metaAvatar = toAbsoluteUrl(
        document.querySelector("meta[property='og:image'], meta[name='og:image'], meta[name='twitter:image'], meta[itemprop='image']")?.getAttribute("content") || "",
      );
      const fallbackAvatar = Array.from(document.querySelectorAll("img"))
        .filter((element) => isVisible(element) && element.naturalWidth >= 32 && element.naturalHeight >= 32)
        .map((element) => toAbsoluteUrl(element.currentSrc || element.getAttribute("src") || element.getAttribute("data-src") || ""))
        .find((src) => /avatar|head|portrait|douyinpic|toutiaoimg|byteimg|pstatp|sinaimg|weiboimg/i.test(src)) || "";
      const pageText = normalizeText(document.body?.innerText || "");
      let platformAccountId = pickPlatformIdBySelectors(probe.accountIdSelectors)
        || pickStorageValue(
          /uid|user_id|userid|sec_uid|secuid|account_id|accountid|profile_id|profileid|memberid|unique_id|short_id|douyin_id/i,
          isMeaningfulPlatformId,
          (trail) => userTrailPattern.test(trail),
        )
        || "";
      if (!platformAccountId) {
        for (const source of probe.idPatterns || []) {
          const matched = pageText.match(new RegExp(source, "i"));
          if (matched?.[1] && isMeaningfulPlatformId(matched[1])) {
            platformAccountId = stripPlatformIdPrefix(matched[1]);
            break;
          }
        }
      }
      const allowFallbackName = !["douyin", "weibo", "baijiahao"].includes(platform);
      const displayName = pickTextBySelectors(probe.displayNameSelectors, isMeaningfulName)
        || pickStorageValue(
          displayNameValuePattern,
          (text) => isMeaningfulName(text),
          (trail) => userTrailPattern.test(trail) && displayNameTrailPattern.test(trail),
        )
        || (allowFallbackName ? fallbackName : "");
      const avatarUrl = pickAvatarBySelectors(probe.avatarSelectors)
        || pickStorageValue(
          /avatar|avatarurl|avatar_url|head_url|headurl|portrait|image/i,
          (text) => /^https?:\\/\\//i.test(text),
          (trail) => userTrailPattern.test(trail),
        )
        || metaAvatar
        || fallbackAvatar;
      const accountName = sanitizeDisplayNameByPlatform(displayName || platformAccountId || "");
      return {
        accountName: accountName || undefined,
        displayName: sanitizeDisplayNameByPlatform(displayName) || undefined,
        platformAccountId: normalizeText(platformAccountId) || undefined,
        avatarUrl: normalizeText(avatarUrl) || undefined,
        sourceUrl: normalizeText(window.location.href) || undefined,
      };
    })()`,
    true,
  );
}

function isMeaningfulAccountProfileText(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (!text) {
    return false;
  }
  if (["true", "false", "null", "undefined", "nan", "[object object]"].includes(lower)) {
    return false;
  }
  if (["高清发布", "立即发布", "定时发布", "发布设置", "活动管理"].includes(text)) {
    return false;
  }
  return !/^(douyin|toutiao|baijiahao|wechat|videohao|weibo|zhihu|csdn)[-_]?(account|user)-\d{6,}$/i.test(text);
}

function hasMeaningfulAccountProfile(profile = {}) {
  return Boolean(
    isMeaningfulAccountProfileText(profile.displayName) ||
      isMeaningfulAccountProfileText(profile.platformAccountId) ||
      /^https?:\/\//i.test(String(profile.avatarUrl || "").trim()),
  );
}

function mergePlatformAccountProfiles(currentProfile = {}, nextProfile = {}) {
  const merged = { ...currentProfile };

  const nextDisplayName = String(nextProfile.displayName || "").trim();
  const currentDisplayName = String(currentProfile.displayName || "").trim();
  if (isMeaningfulAccountProfileText(nextDisplayName) || !isMeaningfulAccountProfileText(currentDisplayName)) {
    if (nextDisplayName) {
      merged.displayName = nextDisplayName;
    }
  }

  const nextAccountName = String(nextProfile.accountName || "").trim();
  const currentAccountName = String(currentProfile.accountName || "").trim();
  if (isMeaningfulAccountProfileText(nextAccountName) || !isMeaningfulAccountProfileText(currentAccountName)) {
    if (nextAccountName) {
      merged.accountName = nextAccountName;
    }
  }

  const nextPlatformId = String(nextProfile.platformAccountId || "").trim();
  const currentPlatformId = String(currentProfile.platformAccountId || "").trim();
  if (isMeaningfulAccountProfileText(nextPlatformId) || !isMeaningfulAccountProfileText(currentPlatformId)) {
    if (nextPlatformId) {
      merged.platformAccountId = nextPlatformId;
    }
  }

  const nextAvatarUrl = String(nextProfile.avatarUrl || "").trim();
  if (/^https?:\/\//i.test(nextAvatarUrl)) {
    merged.avatarUrl = nextAvatarUrl;
  }

  const nextSourceUrl = String(nextProfile.sourceUrl || "").trim();
  if (nextSourceUrl) {
    merged.sourceUrl = nextSourceUrl;
  }

  return merged;
}

function getPlatformAccountProfileProbeUrls(input = {}) {
  const platform = String(input.platform || "").trim();
  const currentProfile = input.currentProfile && typeof input.currentProfile === "object" ? input.currentProfile : {};
  const resolveCsdnProfileId = () => {
    const directId = String(currentProfile.platformAccountId || "").trim();
    if (isMeaningfulAccountProfileText(directId)) {
      return directId;
    }
    const avatarUrl = String(currentProfile.avatarUrl || "").trim();
    const avatarMatched = avatarUrl.match(/_([A-Za-z0-9_-]{4,})\.(?:png|jpe?g|webp|gif)(?:[!?].*)?$/i);
    if (avatarMatched?.[1] && isMeaningfulAccountProfileText(avatarMatched[1])) {
      return avatarMatched[1];
    }
    const sourceUrl = String(currentProfile.sourceUrl || "").trim();
    const sourceMatched = sourceUrl.match(/blog\.csdn\.net\/([^/?#]+)/i);
    if (sourceMatched?.[1] && isMeaningfulAccountProfileText(sourceMatched[1])) {
      return sourceMatched[1];
    }
    return "";
  };
  switch (platform) {
    case "toutiao":
      return [
        "https://mp.toutiao.com/",
        "https://mp.toutiao.com/profile_v4/",
        "https://mp.toutiao.com/profile_v4/index",
      ];
    case "douyin":
      return [
        "https://creator.douyin.com/creator-micro/home",
        "https://creator.douyin.com/creator-micro/content/manage",
      ];
    case "xiaohongshu":
      return [
        "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        "https://creator.xiaohongshu.com/",
      ];
    case "wechat":
      return ["https://mp.weixin.qq.com/cgi-bin/home?t=home/index"];
    case "videohao":
      return [
        "https://channels.weixin.qq.com/platform",
        "https://channels.weixin.qq.com/platform/post/list",
      ];
    case "zhihu":
      return ["https://www.zhihu.com/people/self", "https://www.zhihu.com/creator"];
    case "weibo":
      return [
        "https://me.weibo.com/",
        "https://dss.sc.weibo.com/pc/index",
      ];
    case "baijiahao":
      return [
        "https://baijiahao.baidu.com/builder/rc/settings/accountSet",
        "https://baijiahao.baidu.com/builder/rc/home",
      ];
    case "csdn": {
      const profileId = resolveCsdnProfileId();
      if (!profileId) {
        return [];
      }
      return [
        `https://blog.csdn.net/${profileId}?spm=1000.2115.3001.5343`,
        `https://blog.csdn.net/${profileId}`,
      ];
    }
    default:
      return [];
  }
}

async function resolvePlatformAccountProfileFromWindow(windowInstance, input = {}, timeoutMs = 12000, options = {}) {
  const startedAt = Date.now();
  let latestProfile = {};
  const requireDisplayName = Boolean(options.requireDisplayName);
  const requiredSourcePrefix = typeof options.requiredSourcePrefix === "string" ? options.requiredSourcePrefix.trim() : "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const profile = await extractPlatformAccountProfile(windowInstance, input);
      latestProfile = profile && typeof profile === "object" ? profile : latestProfile;
      const hasRequiredDisplayName = !requireDisplayName || isMeaningfulAccountProfileText(latestProfile.displayName);
      const hasRequiredSource = !requiredSourcePrefix || String(latestProfile.sourceUrl || "").startsWith(requiredSourcePrefix);
      if (hasMeaningfulAccountProfile(latestProfile) && hasRequiredDisplayName && hasRequiredSource) {
        return latestProfile;
      }
    } catch (_) {
      // Ignore transient extraction failures while the platform shell is hydrating.
    }
    await sleep(1200);
  }
  return latestProfile;
}

async function resolvePlatformAccountProfile(windowInstance, input = {}) {
  const platform = String(input.platform || "").trim();
  const initialProfile = await resolvePlatformAccountProfileFromWindow(windowInstance, input, 12000);
  const probeUrls = getPlatformAccountProfileProbeUrls({ ...input, currentProfile: initialProfile });
  const hasMeaningfulDisplayName = isMeaningfulAccountProfileText(initialProfile.displayName);
  const forceProbeProfile = ["weibo", "csdn", "zhihu", "baijiahao"].includes(platform);
  if (!forceProbeProfile && (!probeUrls.length || hasMeaningfulDisplayName) && hasMeaningfulAccountProfile(initialProfile) && (initialProfile.avatarUrl || initialProfile.platformAccountId)) {
    return initialProfile;
  }
  if (!probeUrls.length) {
    return initialProfile;
  }

  const probeWindow = createScopedWindow({
    title: `${input.platform || "平台"} 资料探测`,
    sessionPartition: typeof input.sessionPartition === "string" && input.sessionPartition.trim() ? input.sessionPartition.trim() : undefined,
    show: false,
  });
  probeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let latestProfile = initialProfile;
  let lockedDisplayName = "";
  let lockedAccountName = "";
  let lockedPlatformAccountId = "";
  try {
    for (const probeUrl of probeUrls) {
      const isWeiboProfilePage = platform === "weibo" && /^https:\/\/me\.weibo\.com\/?/i.test(probeUrl);
      const isCsdnProfilePage = platform === "csdn" && /^https:\/\/blog\.csdn\.net\/[^/?#]+/i.test(probeUrl);
      const isZhihuProfileProbe = platform === "zhihu";
      await loadWindowUrlWithTimeout(probeWindow, probeUrl, 20000);
      await waitForWindowStable(probeWindow);
      const profile = await resolvePlatformAccountProfileFromWindow(
        probeWindow,
        { ...input, loginUrl: probeUrl },
        5000,
        (isWeiboProfilePage || isCsdnProfilePage)
          ? {
              requireDisplayName: true,
              requiredSourcePrefix: isWeiboProfilePage ? "https://me.weibo.com/" : "https://blog.csdn.net/",
            }
          : undefined,
      );
      if (profile && typeof profile === "object") {
        latestProfile = mergePlatformAccountProfiles(latestProfile, profile);
        if (isWeiboProfilePage && isMeaningfulAccountProfileText(profile.displayName)) {
          lockedDisplayName = String(profile.displayName || "").trim();
          lockedAccountName = String(profile.accountName || profile.displayName || "").trim();
          lockedPlatformAccountId = String(profile.platformAccountId || "").trim();
        }
        if (isCsdnProfilePage && isMeaningfulAccountProfileText(profile.displayName)) {
          lockedDisplayName = String(profile.displayName || "").trim();
          lockedAccountName = String(profile.accountName || profile.displayName || "").trim();
          lockedPlatformAccountId = String(profile.platformAccountId || profile.displayName || "").trim();
        }
        if (
          isZhihuProfileProbe &&
          /^https:\/\/www\.zhihu\.com\/people\/(?!self(?:[/?#]|$))[^/?#]+/i.test(String(profile.sourceUrl || "").trim()) &&
          isMeaningfulAccountProfileText(profile.displayName)
        ) {
          lockedDisplayName = String(profile.displayName || "").trim();
          lockedAccountName = String(profile.accountName || profile.displayName || "").trim();
          lockedPlatformAccountId = String(profile.platformAccountId || "").trim();
        }
        if (lockedDisplayName) {
          latestProfile.displayName = lockedDisplayName;
        }
        if (lockedAccountName) {
          latestProfile.accountName = lockedAccountName;
        }
        if (lockedPlatformAccountId) {
          latestProfile.platformAccountId = lockedPlatformAccountId;
        }
      }
      if ((platform === "weibo" || platform === "csdn" || platform === "zhihu") && lockedDisplayName) {
        break;
      }
      if (hasMeaningfulAccountProfile(latestProfile) && latestProfile.avatarUrl && latestProfile.platformAccountId) {
        break;
      }
    }
  } catch (_) {
    // Ignore hidden profile probe failures and fall back to the best profile collected so far.
  } finally {
    if (!probeWindow.isDestroyed()) {
      probeWindow.close();
    }
  }
  if ((platform === "weibo" || platform === "csdn" || platform === "zhihu") && !lockedDisplayName) {
    delete latestProfile.displayName;
    delete latestProfile.accountName;
  }
  return latestProfile;
}

async function inspectPlatformSession(input = {}) {
  const spec = getPlatformSessionSpec(input.platform, input.publishUrl);
  const partition = typeof input.sessionPartition === "string" ? input.sessionPartition.trim() : "";
  if (!spec.publishUrl) {
    return {
      status: "unknown",
      reason: "缺少平台发布地址，无法校验登录状态。",
      currentUrl: "",
      cookieCount: 0,
    };
  }

  if (!input.skipAuthPayloadApply) {
    await applyAuthPayloadToPartition({
      platform: input.platform,
      publishUrl: spec.publishUrl,
      sessionPartition: input.sessionPartition,
      authPayload: input.authPayload,
    });
  }

  const cookieCount = await getSessionCookieCount(spec, partition);

  const validationWindow = createScopedWindow({
    title: `${input.platform || "平台"} 会话检测`,
    sessionPartition: partition || undefined,
    show: false,
  });

  validationWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  try {
    await validationWindow.loadURL(spec.publishUrl);
    await waitForWindowStable(validationWindow);
    const storageApplied = input.skipAuthPayloadApply ? false : await applyAuthStorageToWindow(validationWindow, input.authPayload);
    if (storageApplied) {
      await validationWindow.loadURL(spec.publishUrl);
      await waitForWindowStable(validationWindow);
    }
    const inspection = await inspectLoadedPlatformPage(validationWindow, spec, cookieCount);
    if (inspection.status === "authenticated") {
      const sessionPayload = await buildSessionAuthPayload(
        { ...input, publishUrl: spec.publishUrl },
        validationWindow,
        spec,
        partition,
      );
      return {
        ...inspection,
        ...sessionPayload,
      };
    }
    return {
      ...inspection,
      validatedAt: now(),
    };
  } catch (error) {
    return {
      status: "unknown",
      reason: error instanceof Error ? error.message : "平台会话检测失败。",
      currentUrl: spec.publishUrl,
      cookieCount,
      validatedAt: now(),
    };
  } finally {
    if (!validationWindow.isDestroyed()) {
      validationWindow.close();
    }
  }
}

function buildPlatformSessionFailureReason(status, reason) {
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason) {
    return normalizedReason;
  }

  switch (String(status || "")) {
    case "expired":
      return "检测到平台登录会话已失效，请重新登录。";
    case "missing_session":
      return "未检测到有效的平台登录会话，请重新登录。";
    case "unknown":
      return "暂时无法确认当前平台登录状态，请重新登录后再发布。";
    default:
      return "桌面登录未完成。";
  }
}

function getAppServerUrl() {
  return String(appServerUrl || (isDev ? DEV_SERVER_URL : PROD_SERVER_URL)).replace(/\/+$/g, "");
}

async function fetchAppJson(pathname, options = {}) {
  const response = await fetch(`${getAppServerUrl()}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `App API request failed: ${response.status}`);
  }
  return payload;
}

function shouldRefreshPlatformAccountSession(account) {
  const blockedStatuses = new Set(["disabled", "cooling_down", "verification_blocked"]);
  return (
    account &&
    !isVideohaoExtensionCookieAccount(account) &&
    account.loginStatus === "authenticated" &&
    account.provider === "electron" &&
    account.authType !== "manual" &&
    !blockedStatuses.has(account.status) &&
    !blockedStatuses.has(account.riskState) &&
    typeof account.sessionPartition === "string" &&
    account.sessionPartition.trim().length > 0
  );
}

async function updatePlatformAccountFromSessionRefresh(account, validation) {
  const authenticated = validation.status === "authenticated";
  const patch = authenticated
    ? {
        loginStatus: "authenticated",
        status: "valid",
        lastError: undefined,
      }
    : {
        loginStatus: "failed",
        status: "invalid",
        lastError: buildPlatformSessionFailureReason(validation.status, validation.reason),
      };

  if (authenticated) {
    const authPayload = await exportAuthPayloadFromPartition({
      platform: account.platform,
      publishUrl: account.loginUrl,
      sessionPartition: account.sessionPartition,
    });
    if (authPayload) {
      patch.authPayload = authPayload;
      patch.authPayloadUpdatedAt = now();
    }
  }

  await fetchAppJson(`/api/publish/accounts/${encodeURIComponent(account.id)}`, {
    method: "PATCH",
    headers: {
      "x-geo-internal-session-refresh": "1",
    },
    body: JSON.stringify(patch),
  });

  return {
    status: authenticated ? "refreshed" : "downgraded",
    validationStatus: validation.status,
  };
}

async function refreshSavedPlatformAccountSessions(reason = "interval") {
  if (accountSessionRefreshRunning) {
    return { skipped: true, reason: "already_running" };
  }
  accountSessionRefreshRunning = true;

  try {
    const payload = await fetchAppJson("/api/publish/accounts");
    const accounts = Array.isArray(payload.items) ? payload.items.filter(shouldRefreshPlatformAccountSession) : [];
    let refreshedCount = 0;
    let downgradedCount = 0;

    for (const account of accounts) {
      try {
        const validation = await inspectPlatformSession({
          platform: account.platform,
          publishUrl: account.loginUrl,
          sessionPartition: account.sessionPartition,
          skipAuthPayloadApply: true,
        });
        const result = await updatePlatformAccountFromSessionRefresh(account, validation);
        if (result.status === "refreshed") {
          refreshedCount += 1;
        } else {
          downgradedCount += 1;
        }
      } catch (error) {
        console.error(
          `Failed to refresh platform session for ${account.platform}/${account.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (accounts.length) {
      console.info(
        `GEO platform session refresh (${reason}) completed: ${refreshedCount} refreshed, ${downgradedCount} downgraded.`,
      );
    }
    return { skipped: false, total: accounts.length, refreshedCount, downgradedCount };
  } catch (error) {
    console.error("Failed to run GEO platform session refresh:", error instanceof Error ? error.message : error);
    return { skipped: false, error: error instanceof Error ? error.message : "unknown" };
  } finally {
    accountSessionRefreshRunning = false;
  }
}

function startPlatformAccountSessionRefreshLoop() {
  if (accountSessionRefreshTimer) {
    clearInterval(accountSessionRefreshTimer);
  }
  if (accountSessionStartupRefreshTimer) {
    clearTimeout(accountSessionStartupRefreshTimer);
  }

  accountSessionStartupRefreshTimer = setTimeout(() => {
    accountSessionStartupRefreshTimer = null;
    void refreshSavedPlatformAccountSessions("startup");
  }, ACCOUNT_SESSION_STARTUP_REFRESH_DELAY_MS);
  if (typeof accountSessionStartupRefreshTimer.unref === "function") {
    accountSessionStartupRefreshTimer.unref();
  }

  accountSessionRefreshTimer = setInterval(() => {
    void refreshSavedPlatformAccountSessions("interval");
  }, ACCOUNT_SESSION_REFRESH_INTERVAL_MS);
  if (typeof accountSessionRefreshTimer.unref === "function") {
    accountSessionRefreshTimer.unref();
  }
}

function stopPlatformAccountSessionRefreshLoop() {
  if (accountSessionStartupRefreshTimer) {
    clearTimeout(accountSessionStartupRefreshTimer);
    accountSessionStartupRefreshTimer = null;
  }
  if (accountSessionRefreshTimer) {
    clearInterval(accountSessionRefreshTimer);
    accountSessionRefreshTimer = null;
  }
}

function startAutoPublishScheduler() {
  if (!autoPublishScheduler) {
    autoPublishScheduler = createAutoPublishScheduler({
      getBaseUrl: () => getAppServerUrl(),
      intervalMs: AUTO_PUBLISH_INTERVAL_MS,
      startupDelayMs: AUTO_PUBLISH_STARTUP_DELAY_MS,
      notifyFrontend: () => notifyFrontendAccountsRefresh(),
      logger: console,
    });
  }
  autoPublishScheduler.start();
}

function stopAutoPublishScheduler() {
  if (!autoPublishScheduler) {
    return;
  }
  autoPublishScheduler.stop();
}

function openPlatformLoginWindow(input = {}) {
  const loginUrl = typeof input.loginUrl === "string" ? input.loginUrl.trim() : "";
  if (!loginUrl) {
    return { status: "unsupported" };
  }
  if (String(input.platform || "").trim() === "videohao") {
    // #region debug-point A:videohao-login-entry
    emitVideohaoExtensionDebug("A", "electron/main.js:openPlatformLoginWindow", "videohao login requested", {
      loginUrl,
      hasSessionToken: Boolean(String(input.loginSessionToken || "").trim()),
      sessionPartition: String(input.sessionPartition || ""),
    });
    // #endregion
    return openUrlInPreferredBrowser(loginUrl, { requireBundledVideohaoExtension: true })
      .then((result) => ({
        status: "opened",
        reason: result.usedShellFallback
          ? "视频号已在系统浏览器打开。GEO 已在后端准备独立浏览器登录环境，请在 Edge 或 Chrome 完成登录后返回 GEO。"
          : "视频号已在 Edge 或 Chrome 打开。GEO 已在后端准备独立浏览器登录环境，请完成登录后返回 GEO。",
      }))
      .catch((error) => {
        // #region debug-point E:videohao-login-catch
        emitVideohaoExtensionDebug("E", "electron/main.js:openPlatformLoginWindow:catch", "videohao login browser handoff failed", {
          message: error instanceof Error ? error.message : String(error || ""),
          stack: error instanceof Error ? error.stack || "" : "",
        });
        // #endregion
        return {
          status: "unsupported",
          reason: "视频号无法在外部浏览器打开，请确认本机已安装 Edge 或 Chrome。",
        };
      });
  }

  return new Promise((resolve) => {
    const loginWindow = createScopedWindow(input);
    const spec = getPlatformSessionSpec(input.platform, loginUrl);
    const partition = typeof input.sessionPartition === "string" ? input.sessionPartition.trim() : "";
    let settled = false;
    let inspecting = false;
    let queuedInspection = false;
    let periodicInspection = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (periodicInspection) {
        clearInterval(periodicInspection);
        periodicInspection = null;
      }
      resolve(payload);
    };

    const finishAuthenticated = (payload) => {
      finish(payload);
      if (!loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    };

    const inspectLoginState = async () => {
      if (settled || loginWindow.isDestroyed()) {
        return;
      }
      if (inspecting) {
        queuedInspection = true;
        return;
      }
      inspecting = true;
      try {
        await waitForWindowStable(loginWindow);
        const cookieCount = await getSessionCookieCount(spec, partition);
        const sessionState = await inspectLoadedPlatformPage(loginWindow, spec, cookieCount);
        if (sessionState.status === "authenticated") {
          const profile = await resolvePlatformAccountProfile(loginWindow, input).catch(() => ({}));
          const sessionPayload = await buildSessionAuthPayload(
            { ...input, publishUrl: spec.publishUrl || loginUrl },
            loginWindow,
            spec,
            partition,
          ).catch(() => ({ validatedAt: now() }));
          finishAuthenticated({
            status: "authenticated",
            reason: sessionState.reason,
            profile,
            authPayload: sessionPayload.authPayload,
            authPayloadUpdatedAt: sessionPayload.authPayloadUpdatedAt,
            validatedAt: sessionPayload.validatedAt,
          });
          return;
        }
      } catch (_) {
        // Ignore transient inspection failures while the login page is still loading.
      } finally {
        inspecting = false;
        if (queuedInspection && !settled) {
          queuedInspection = false;
          setTimeout(() => {
            void inspectLoginState();
          }, 600);
        }
      }
    };

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
    loginWindow.webContents.on("will-prevent-unload", (event) => {
      event.preventDefault();
    });

    loginWindow.on("closed", () => {
      finish({ status: "closed" });
    });

    loginWindow.webContents.on("did-finish-load", () => {
      void inspectLoginState();
    });
    loginWindow.webContents.on("did-navigate", () => {
      void inspectLoginState();
    });
    loginWindow.webContents.on("did-navigate-in-page", () => {
      void inspectLoginState();
    });

    periodicInspection = setInterval(() => {
      void inspectLoginState();
    }, 1500);
    loginWindow.loadURL(loginUrl).catch(() => {
      finish({ status: "unsupported" });
      if (!loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    });
  });
}

function resolveAutomationFile(platform) {
  switch (String(platform || "").trim()) {
    case "toutiao":
      return path.join(automationDirectory, "toutiao.js");
    case "baijiahao":
      return path.join(automationDirectory, "baijiahao.js");
    case "douyin":
      return path.join(automationDirectory, "douyin.js");
    case "xiaohongshu":
      return path.join(automationDirectory, "xiaohongshu.js");
    case "wechat":
      return path.join(automationDirectory, "wechat.js");
    case "videohao":
      return path.join(automationDirectory, "videohao.js");
    case "zhihu":
      return path.join(automationDirectory, "zhihu.js");
    case "weibo":
      return path.join(automationDirectory, "weibo.js");
    case "csdn":
      return path.join(automationDirectory, "csdn.js");
    default:
      return "";
  }
}

async function trackBridgeOperation(operation) {
  activeBridgeOperations += 1;
  try {
    return await operation();
  } finally {
    activeBridgeOperations = Math.max(0, activeBridgeOperations - 1);
  }
}

function guessExtensionFromMimeType(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/png":
    default:
      return ".png";
  }
}

function parseDataUrl(value) {
  const matched = String(value || "").match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!matched) {
    return null;
  }

  const mimeType = matched[1] || "image/png";
  const base64 = matched[2] || "";
  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
}

async function prepareSinglePublishImageFromLocalPath(imagePath, index) {
  const normalizedPath = String(imagePath || "").trim();
  if (!normalizedPath) {
    throw new Error("图片本地路径为空");
  }

  const buffer = await fs.promises.readFile(normalizedPath);
  const extension = path.extname(normalizedPath).toLowerCase() || ".png";
  let mimeType = "image/png";
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      mimeType = "image/jpeg";
      break;
    case ".webp":
      mimeType = "image/webp";
      break;
    case ".gif":
      mimeType = "image/gif";
      break;
    default:
      mimeType = "image/png";
      break;
  }

  return {
    name: `publish-${index + 1}${extension || guessExtensionFromMimeType(mimeType)}`,
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    filePath: normalizedPath,
  };
}

async function preparePublishImages(payload = {}, log) {
  const publishMode = String(payload.publishMode || "").trim() || "with_images";
  if (publishMode === "text_only") {
    log("prepare_images: skipped (text_only)");
    return [];
  }

  const draftImagePaths = [
    ...(Array.isArray(payload.draftImagePaths) ? payload.draftImagePaths : []),
    ...(Array.isArray(payload.draftImageUrls) ? payload.draftImageUrls : []).filter((item) => {
      const value = String(item || "").trim();
      return value && !/^https?:\/\//i.test(value) && !/^data:/i.test(value);
    }),
  ];
  if (draftImagePaths.length === 0) {
    return [];
  }

  log(`prepare_images: start (${draftImagePaths.length})`);
  const preparedImages = [];
  for (let index = 0; index < draftImagePaths.length; index += 1) {
    preparedImages.push(await prepareSinglePublishImageFromLocalPath(draftImagePaths[index], index));
  }
  log(`prepare_images: ready (${preparedImages.length})`);
  return preparedImages;
}

async function waitForWindowStable(windowInstance) {
  await sleep(1500);
  if (windowInstance.webContents.isLoading()) {
    await Promise.race([
      new Promise((resolve) => {
        windowInstance.webContents.once("did-finish-load", resolve);
      }),
      sleep(12000),
    ]);
  }
  await sleep(1200);
}

async function resolveWechatTokenizedPublishUrl(windowInstance, fallbackUrl, log) {
  const extractToken = async () => {
    try {
      return await windowInstance.webContents.executeJavaScript(
        `(() => {
          const urls = [
            window.location.href,
            ...Array.from(document.querySelectorAll("a[href]")).map((node) => node.href || "")
          ];
          for (const url of urls) {
            try {
              const token = new URL(url, window.location.href).searchParams.get("token");
              if (token && /^\\d+$/.test(token)) return token;
            } catch (_) {}
          }
          const text = document.body?.innerText || "";
          const matched = text.match(/token[=:]\\s*(\\d{4,})/i);
          return matched?.[1] || "";
        })()`,
        true,
      );
    } catch (_) {
      return "";
    }
  };

  let token = await extractToken();
  if (!token) {
    log("wechat_token_resolve: load_home");
    await loadWindowUrlWithTimeout(windowInstance, "https://mp.weixin.qq.com/cgi-bin/home?t=home/index", 25000);
    await waitForWindowStable(windowInstance);
    const startedAt = Date.now();
    while (!token && Date.now() - startedAt < 10000) {
      token = await extractToken();
      if (token) break;
      await sleep(500);
    }
  }

  if (!token) {
    const currentUrl = windowInstance.webContents.getURL() || fallbackUrl;
    try {
      token = new URL(currentUrl).searchParams.get("token") || "";
    } catch (_) {
      token = "";
    }
  }

  if (!token) {
    log(`wechat_token_resolve_failed_url: ${windowInstance.webContents.getURL() || fallbackUrl}`);
    return fallbackUrl;
  }

  const tokenizedUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&token=${token}&lang=zh_CN`;
  log(`wechat_token_resolved: ${tokenizedUrl.replace(/token=\\d+/, "token=***")}`);
  return tokenizedUrl;
}

async function loadWindowUrlWithTimeout(windowInstance, url, timeoutMs = 25000) {
  let timedOut = false;
  await Promise.race([
    windowInstance.loadURL(url),
    sleep(timeoutMs).then(() => {
      timedOut = true;
    }),
  ]);
  return timedOut;
}

function attachPublishNetworkLogger(windowInstance, sessionToken, platform) {
  const webContents = windowInstance?.webContents;
  if (!webContents || !sessionToken) return () => {};
  const seen = new Set();
  const logNetwork = (message) => appendProgressLog(sessionToken, platform, message);
  try {
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach("1.3");
    }
    webContents.debugger.sendCommand("Network.enable").catch(() => {});
    const onDebuggerMessage = (_, method, params = {}) => {
      if (method !== "Network.requestWillBeSent") return;
      const request = params.request || {};
      const resourceType = String(params.type || "").toLowerCase();
      const url = String(request.url || "");
      const requestMethod = String(request.method || "GET").toUpperCase();
      if (!url || !["xhr", "fetch"].includes(resourceType)) return;
      if (!/csdn|baidu|toutiao|weibo|zhihu|weixin|douyin|xiaohongshu|xhscdn|byte|creator|mp\./i.test(url)) return;
      const normalizedUrl = url.replace(/([?&](?:token|access_token|csrf|session|cookie|signature|sign|key|secret)=)[^&]+/gi, "$1***");
      const key = `${requestMethod} ${normalizedUrl}`;
      if (seen.has(key)) return;
      seen.add(key);
      logNetwork(`network_${resourceType}: ${requestMethod} ${normalizedUrl.slice(0, 500)}`);
      const postData = typeof request.postData === "string" ? request.postData : "";
      if (postData && /csdn\.net\/blog.*(saveArticle|article|publish|create|save|history-version|get-quality-score)/i.test(url)) {
        const sanitizedPostData = postData
          .replace(/("(?:token|access_token|csrf|session|cookie|signature|sign|key|secret)"\s*:\s*")[^"]+"/gi, "$1***\"")
          .replace(/((?:token|access_token|csrf|session|cookie|signature|sign|key|secret)=)[^&]+/gi, "$1***");
        logNetwork(`network_${resourceType}_postdata: ${sanitizedPostData.slice(0, 1200)}`);
      }
    };
    webContents.debugger.on("message", onDebuggerMessage);
    return () => {
      try {
        webContents.debugger.off("message", onDebuggerMessage);
        if (webContents.debugger.isAttached()) {
          webContents.debugger.detach();
        }
      } catch (_) {
        // ignore debugger cleanup errors
      }
    };
  } catch (error) {
    logNetwork(`network_logger_failed: ${error instanceof Error ? error.message : "unknown"}`);
    return () => {};
  }
}

async function executeAutomation(windowInstance, filePath, payload) {
  const helperSource = fs.readFileSync(automationHelperFile, "utf8");
  const source = fs.readFileSync(filePath, "utf8");
  const timeoutMs = Number(payload?.timeoutMs) || 180000;
  const scriptPromise = windowInstance.webContents.executeJavaScript(
    `(async () => {
      try {
        ${helperSource}
        const payload = ${JSON.stringify(payload)};
        const timeoutMs = Number(payload?.timeoutMs) || 180000;
        return await Promise.race([
          (${source})(payload),
          new Promise((resolve) => {
            setTimeout(() => {
              const pageLogs = Array.isArray(window.__geoPublishAutomationLogs) ? window.__geoPublishAutomationLogs : [];
              resolve({
                status: "failed",
                failureStage: "script_timeout",
                errorMessage: "自动化脚本执行超时，可能卡在平台弹层、编辑器加载或提交确认阶段。",
                executionLog: [...pageLogs, "script_timeout: " + timeoutMs + "ms"],
                verificationEvidence: "failed_at_script_timeout",
                draftUrl: window.location.href,
              });
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        const message = error instanceof Error ? (error.stack || error.message) : String(error || "automation script failed");
        return {
          status: "failed",
          failureStage: "inject_automation",
          errorMessage: message,
          executionLog: ["inject_automation_error: " + message],
          verificationEvidence: "failed_at_inject_automation",
          draftUrl: window.location.href,
        };
      }
    })()`,
    true,
  );
  return Promise.race([
    scriptPromise,
    new Promise((resolve) => {
      setTimeout(async () => {
        let pageLogs = [];
        let draftUrl = "";
        try {
          draftUrl = windowInstance.webContents.getURL();
          pageLogs = await windowInstance.webContents.executeJavaScript(
            "Array.isArray(window.__geoPublishAutomationLogs) ? window.__geoPublishAutomationLogs : []",
            true,
          );
        } catch (_) {
          pageLogs = [];
        }
        resolve({
          status: "failed",
          failureStage: "script_timeout",
          errorMessage: "自动化脚本执行超时，可能卡在平台弹层、编辑器加载或页面跳转阶段。",
          executionLog: [...(Array.isArray(pageLogs) ? pageLogs : []), `script_timeout_outer: ${timeoutMs}ms`],
          verificationEvidence: "failed_at_script_timeout",
          draftUrl,
        });
      }, timeoutMs + 5000);
    }),
  ]);
}

async function connectCdpWebSocket(webSocketDebuggerUrl) {
  if (typeof WebSocket !== "function") {
    throw new Error("当前 Electron 运行时不支持 WebSocket CDP fallback。");
  }
  const socket = new WebSocket(webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    } catch (_) {
      // Ignore malformed CDP messages.
    }
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("无法连接外部 Edge CDP WebSocket。"));
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++messageId;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        socket.close();
      } catch (_) {
        // Ignore close errors.
      }
    },
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function requestJsonWithTimeout(url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : `HTTP ${response.status}`;
      throw new Error(reason);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function buildSessionAuditFailureReason(status, reason) {
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason) {
    return normalizedReason;
  }
  switch (String(status || "").trim()) {
    case "expired":
      return "登录已失效，请重新登录";
    case "missing_session":
      return "未检测到登录信息，请重新登录";
    case "unknown":
      return "暂时无法确认当前平台登录状态，请重新登录后再发布。";
    default:
      return "桌面登录未完成。";
  }
}

function isAuditablePlatformAccount(account) {
  return (
    account &&
    !isVideohaoExtensionCookieAccount(account) &&
    account.loginStatus === "authenticated" &&
    account.provider === "electron" &&
    account.authType !== "manual" &&
    typeof account.sessionPartition === "string" &&
    account.sessionPartition.trim()
  );
}

async function listAuditablePlatformAccounts() {
  if (!currentAppBaseUrl) {
    return [];
  }
  const payload = await requestJsonWithTimeout(`${currentAppBaseUrl}/api/publish/accounts`, undefined, 12000);
  return Array.isArray(payload?.items) ? payload.items.filter(isAuditablePlatformAccount) : [];
}

function buildSessionAuditPatch(validation) {
  const validatedAt = validation?.validatedAt || now();
  if (validation?.status === "authenticated") {
    const patch = {
      action: "session_audit",
      loginStatus: "authenticated",
      status: "valid",
      lastError: undefined,
      lastValidatedAt: validatedAt,
    };
    if (typeof validation?.authPayload === "string" && validation.authPayload.trim()) {
      patch.authPayload = validation.authPayload.trim();
      patch.authPayloadUpdatedAt = validation.authPayloadUpdatedAt || validatedAt;
    }
    return patch;
  }
  const lastError = buildSessionAuditFailureReason(validation?.status, validation?.reason);
  return {
    action: "session_audit",
    loginStatus: "failed",
    status: "invalid",
    lastError,
    lastValidatedAt: validatedAt,
  };
}

async function persistSessionAuditPatch(accountId, patch) {
  if (!currentAppBaseUrl || !accountId) {
    return null;
  }
  return requestJsonWithTimeout(
    `${currentAppBaseUrl}/api/publish/accounts/${encodeURIComponent(accountId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
    12000,
  );
}

async function runGlobalSessionAudit(trigger = "interval") {
  if (globalSessionAuditRunning || !currentAppBaseUrl) {
    return;
  }
  globalSessionAuditRunning = true;
  try {
    const accounts = await listAuditablePlatformAccounts();
    if (!accounts.length) {
      return;
    }

    let verifiedCount = 0;
    let downgradedCount = 0;

    for (const account of accounts) {
      const validation = await inspectPlatformSession({
        platform: account.platform,
        publishUrl: account.loginUrl,
        sessionPartition: account.sessionPartition,
        authPayload: account.authPayload,
      });
      if (validation?.status === "unsupported") {
        continue;
      }
      await persistSessionAuditPatch(account.id, buildSessionAuditPatch(validation));
      if (validation?.status === "authenticated") {
        verifiedCount += 1;
      } else {
        downgradedCount += 1;
      }
    }

    if (verifiedCount || downgradedCount) {
      await notifyFrontendAccountsRefresh();
      console.log(
        `[GEO global session audit] trigger=${trigger} verified=${verifiedCount} downgraded=${downgradedCount}`,
      );
    }
  } catch (error) {
    console.warn(
      `[GEO global session audit] trigger=${trigger} failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  } finally {
    globalSessionAuditRunning = false;
  }
}

function startGlobalSessionAuditScheduler() {
  if (globalSessionAuditTimer || !currentAppBaseUrl) {
    return;
  }
  void trackBridgeOperation(() => runGlobalSessionAudit("startup"));
  globalSessionAuditTimer = setInterval(() => {
    void trackBridgeOperation(() => runGlobalSessionAudit("interval"));
  }, GLOBAL_SESSION_AUDIT_INTERVAL_MS);
}

function stopGlobalSessionAuditScheduler() {
  if (!globalSessionAuditTimer) {
    return;
  }
  clearInterval(globalSessionAuditTimer);
  globalSessionAuditTimer = null;
}

async function notifyFrontendAccountsRefresh() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  try {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
        window.dispatchEvent(new Event("geo-platform-accounts-refresh"));
        window.dispatchEvent(new Event("geo-workflow-status-refresh"));
      })()`,
      true,
    );
  } catch (_) {
    // Ignore refresh notification failures when the page is reloading or unavailable.
  }
}

async function findExternalVideohaoTarget() {
  const targets = await fetchJsonWithTimeout("http://127.0.0.1:9223/json", 2500);
  return Array.isArray(targets)
    ? targets.find((target) => target.type === "page" && String(target.url || "").includes("channels.weixin.qq.com"))
    : null;
}

function buildVideohaoTextBody(payload = {}) {
  const title = String(payload.draftTitle || "").trim();
  const body = String(payload.draftBody || "").trim();
  const tags = Array.isArray(payload.draftTags)
    ? payload.draftTags
        .map((tag) => String(tag || "").trim().replace(/^#+/, ""))
        .filter(Boolean)
        .slice(0, 5)
        .map((tag) => `#${tag}`)
        .join(" ")
    : "";
  return [body, tags].filter(Boolean).join("\n\n").slice(0, 1200);
}

async function runExternalEdgeVideohaoPublish(input = {}, preparedImages = [], log = () => {}) {
  const target = await findExternalVideohaoTarget();
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("未检测到已开启 9223 调试端口的外部 Edge 视频号页面。");
  }
  const cdp = await connectCdpWebSocket(target.webSocketDebuggerUrl);
  const title = String(input.payload?.draftTitle || "").trim().slice(0, 22) || "图文动态";
  const body = buildVideohaoTextBody(input.payload);
  const imagePaths = preparedImages
    .map((image) => String(image?.filePath || image?.path || "").trim())
    .filter(Boolean)
    .slice(0, 9);
  if (!imagePaths.length) {
    cdp.close();
    throw new Error("视频号图文发布至少需要 1 张本地图片。");
  }

  try {
    log("videohao_external_cdp_detected");
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    let initialVideoCount = null;
    try {
      await cdp.send("Page.navigate", { url: "https://channels.weixin.qq.com/platform" });
      await sleep(7000);
      const countResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
          const matched = text.match(/\\u89c6\\u9891\\s*(\\d+)/);
          return matched ? Number(matched[1]) : null;
        })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      const countValue = countResult.result?.result?.value;
      if (Number.isFinite(countValue)) {
        initialVideoCount = countValue;
        log(`videohao_external_initial_video_count: ${initialVideoCount}`);
      }
    } catch (countError) {
      log(`videohao_external_initial_video_count_failed: ${countError instanceof Error ? countError.message : "unknown"}`);
    }
    await cdp.send("Page.navigate", { url: "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate" });
    await sleep(9000);

    const inputEval = await cdp.send("Runtime.evaluate", {
      expression: "document.querySelector('wujie-app')?.shadowRoot?.querySelector('input[type=file]')",
      objectGroup: "geo-videohao",
    });
    const objectId = inputEval.result?.result?.objectId;
    if (!objectId) throw new Error("未找到视频号图文图片上传控件。");
    await cdp.send("DOM.setFileInputFiles", { objectId, files: imagePaths });
    log(`videohao_external_upload_files: ${imagePaths.length}`);
    await sleep(15000);

    const fillExpression = `(() => {
      const root = document.querySelector('wujie-app')?.shadowRoot;
      if (!root) return { ok: false, stage: 'shadow_root_missing' };
      const fire = (el) => {
        for (const type of ['input', 'change', 'compositionend', 'blur']) {
          el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        }
      };
      const titleInput = Array.from(root.querySelectorAll('input')).find((node) =>
        String(node.placeholder || '').includes('标题')
      );
      if (!titleInput) return { ok: false, stage: 'title_input_missing' };
      titleInput.focus();
      titleInput.value = ${JSON.stringify(title)};
      fire(titleInput);
      const candidates = Array.from(
        root.querySelectorAll('textarea,[contenteditable=true],[role=textbox],.input-editor,.rich-editor')
      ).map((node) => ({ node, placeholder: node.getAttribute('placeholder') || '', rect: node.getBoundingClientRect(), text: String(node.innerText || node.value || node.textContent || '') }));
      const desc = (
        candidates.find((item) => item.placeholder.includes('描述')) ||
        candidates.find((item) => item.text.includes('#话题')) ||
        candidates.find((item) => item.rect.width > 100 && item.rect.height > 40) ||
        {}
      ).node;
      if (desc) {
        desc.focus();
        if (desc.tagName === 'TEXTAREA' || desc.tagName === 'INPUT') {
          desc.value = ${JSON.stringify(body)};
          fire(desc);
        } else {
          desc.innerText = ${JSON.stringify(body)};
          desc.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ${JSON.stringify(body)} }));
          desc.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          desc.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        }
      }
      const button = Array.from(root.querySelectorAll('button')).find((node) => String(node.innerText || '').trim() === '发表');
      return {
        ok: true,
        descFound: Boolean(desc),
        publishDisabled: Boolean(button?.disabled || String(button?.className || '').includes('disabled')),
        imageVisible: Array.from(root.querySelectorAll('img')).some((img) => String(img.src || '').startsWith('blob:') && img.getBoundingClientRect().width > 20),
      };
    })()`;
    const fillResult = await cdp.send("Runtime.evaluate", { expression: fillExpression, returnByValue: true, awaitPromise: true });
    const fillValue = fillResult.result?.result?.value;
    if (!fillValue?.ok || fillValue.publishDisabled || !fillValue.imageVisible) {
      throw new Error(`视频号外部 Edge 填充校验失败：${JSON.stringify(fillValue)}`);
    }
    log("videohao_external_fill_verified");

    const submitResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.querySelector('wujie-app')?.shadowRoot;
        const button = Array.from(root?.querySelectorAll('button') || []).find((node) => String(node.innerText || '').trim() === '发表');
        if (!button) return { ok: false, stage: 'submit_button_missing' };
        button.click();
        return { ok: true, url: location.href };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (!submitResult.result?.result?.value?.ok) {
      throw new Error(`视频号外部 Edge 点击发表失败：${JSON.stringify(submitResult.result?.result?.value)}`);
    }
    log("videohao_external_submit_clicked");
    await sleep(2500);

    const confirmResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.querySelector('wujie-app')?.shadowRoot;
        const buttons = Array.from(root?.querySelectorAll('button') || []).filter((button) => {
          const rect = button.getBoundingClientRect();
          const text = String(button.innerText || '').trim();
          const disabled = button.disabled || String(button.className || '').includes('disabled');
          return rect.width > 0 && rect.height > 0 && !disabled && /^(发表|确定|确认)$/.test(text);
        });
        const button = buttons[buttons.length - 1];
        if (!button) return { clicked: false };
        button.click();
        return { clicked: true, text: String(button.innerText || '').trim() };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (confirmResult.result?.result?.value?.clicked) {
      log(`videohao_external_confirm_clicked: ${confirmResult.result.result.value.text || "confirm"}`);
    }
    await sleep(12000);

    await cdp.send("Page.navigate", { url: "https://channels.weixin.qq.com/platform/post/finderNewLifePostList" });
    await sleep(12000);

    const robustVerificationAttempts = [];
    let robustVerifyValue = {};
    const robustVerifyStartedAt = Date.now();
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const robustVerifyResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const root = document.querySelector('wujie-app')?.shadowRoot;
          const shadowText = String(root?.innerText || '').replace(/\\s+/g, ' ').trim();
          const bodyText = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
          const text = shadowText || bodyText;
          const sample = text.slice(0, 600);
          return {
            url: location.href,
            hasShadowRoot: Boolean(root),
            textLength: text.length,
            containsTitle: text.includes(${JSON.stringify(title)}),
            hasPublished: /\\u5df2\\u53d1\\u8868|\\u56fe\\u6587\\s*\\(\\d+\\)|\\u53d1\\u8868\\u6210\\u529f|\\u53d1\\u5e03\\u6210\\u529f|\\u5ba1\\u6838/.test(text),
            hasBlocking: /\\u9a8c\\u8bc1\\u7801|\\u4e0d\\u80fd\\u4e3a\\u7a7a|\\u5931\\u8d25|\\u8fdd\\u89c4|\\u9519\\u8bef/.test(text),
            sample,
          };
        })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      robustVerifyValue = robustVerifyResult.result?.result?.value || {};
      if (robustVerifyValue.sample) robustVerificationAttempts.push(robustVerifyValue.sample);
      if (robustVerifyValue.hasBlocking || robustVerifyValue.containsTitle || robustVerifyValue.hasPublished) break;
      if (Date.now() - robustVerifyStartedAt >= 75000) break;
      await sleep(2500);
    }
    robustVerificationAttempts.splice(6);
    if (robustVerifyValue.hasBlocking) {
      return {
        status: "verification_failed",
        failureStage: "external_edge_verify",
        errorMessage: "Videohao external Edge returned blocking text after submit.",
        publishUrl: robustVerifyValue.url,
        verificationEvidence: "videohao_external_edge_blocking_text",
        verificationAttempts: robustVerificationAttempts,
      };
    }
    if (robustVerifyValue.containsTitle || robustVerifyValue.hasPublished) {
      return {
        status: "published",
        publishUrl: robustVerifyValue.url,
        verificationEvidence: "videohao_external_edge_published_list",
        verificationAttempts: robustVerificationAttempts,
      };
    }

    if (Number.isFinite(initialVideoCount)) {
      const countVerificationAttempts = [];
      await cdp.send("Page.navigate", { url: "https://channels.weixin.qq.com/platform" });
      await sleep(5000);
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const countResult = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
            const matched = text.match(/\\u89c6\\u9891\\s*(\\d+)/);
            const videoCount = matched ? Number(matched[1]) : null;
            return {
              url: location.href,
              videoCount,
              increased: Number.isFinite(videoCount) && videoCount > ${JSON.stringify(initialVideoCount)},
              sample: text.slice(0, 600),
            };
          })()`,
          returnByValue: true,
          awaitPromise: true,
        });
        const countValue = countResult.result?.result?.value || {};
        if (countValue.sample) countVerificationAttempts.push(countValue.sample);
        if (countValue.increased) {
          return {
            status: "published",
            publishUrl: "https://channels.weixin.qq.com/platform/post/finderNewLifePostList",
            verificationEvidence: "videohao_external_edge_home_count_incremented",
            verificationAttempts: [...robustVerificationAttempts, ...countVerificationAttempts].slice(0, 8),
          };
        }
        await sleep(3000);
      }
    }

    const verifyResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const root = document.querySelector('wujie-app')?.shadowRoot;
        const text = String(root?.innerText || document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
        return {
          url: location.href,
          containsTitle: text.includes(${JSON.stringify(title)}),
          hasPublished: /已发表|发表成功|发布成功|审核/.test(text),
          hasBlocking: /验证码|不能为空|失败|违规|错误/.test(text),
          sample: text.slice(0, 600),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const verifyValue = verifyResult.result?.result?.value || {};
    if (verifyValue.hasBlocking) {
      return {
        status: "verification_failed",
        failureStage: "external_edge_verify",
        errorMessage: "视频号外部 Edge 提交后出现阻断提示。",
        publishUrl: verifyValue.url,
        verificationEvidence: "videohao_external_edge_blocking_text",
        verificationAttempts: [verifyValue.sample].filter(Boolean),
      };
    }
    if (verifyValue.containsTitle || verifyValue.hasPublished) {
      return {
        status: verifyValue.hasPublished ? "published" : "submitted",
        publishUrl: verifyValue.url,
        verificationEvidence: "videohao_external_edge_published_list",
        verificationAttempts: [verifyValue.sample].filter(Boolean),
      };
    }
    return {
      status: "submitted",
      publishUrl: verifyValue.url,
      verificationEvidence: "videohao_external_edge_submit_clicked",
      verificationAttempts: [verifyValue.sample].filter(Boolean),
    };
  } finally {
    cdp.close();
  }
}

function normalizeAutomationResult(rawResult, fallback = {}) {
  const result = rawResult && typeof rawResult === "object" ? rawResult : {};
  const rawStatus = typeof result.status === "string" ? result.status.trim() : "";
  const status = AUTOMATION_TERMINAL_STATUSES.has(rawStatus) ? rawStatus : "failed";
  const failureStage =
    typeof result.failureStage === "string" && result.failureStage.trim()
      ? result.failureStage.trim()
      : status === "failed"
        ? fallback.failureStage || "invalid_automation_result"
        : undefined;
  const errorMessage =
    typeof result.errorMessage === "string" && result.errorMessage.trim()
      ? result.errorMessage
      : status === "failed"
        ? fallback.errorMessage || "自动化脚本没有返回有效的发布结果。"
        : undefined;
  const executionLog = Array.isArray(result.executionLog) ? result.executionLog.map((item) => String(item || "")).filter(Boolean) : [];
  const verificationEvidence =
    typeof result.verificationEvidence === "string" && result.verificationEvidence.trim()
      ? result.verificationEvidence
      : status === "failed" && failureStage
        ? `failed_at_${failureStage}`
        : undefined;
  const closeWindow = result.closeWindow === true;

  return {
    status,
    draftUrl: result.draftUrl,
    publishUrl: result.publishUrl ?? result.draftUrl,
    verificationUrl: result.verificationUrl,
    externalStatus: result.externalStatus,
    executionLog,
    verificationEvidence,
    verificationAttempts: result.verificationAttempts,
    platformItemId: result.platformItemId,
    failureStage,
    errorMessage,
    closeWindow,
  };
}

function detectBrokenPublishText(payload = {}) {
  const values = [
    payload.draftTitle,
    payload.draftBody,
    ...(Array.isArray(payload.draftTags) ? payload.draftTags : []),
  ]
    .map((item) => String(item || ""))
    .filter(Boolean);
  const brokenPattern = new RegExp(
    [
      "\\uFFFD",
      "\\?{3,}",
      "\\u9365",
      "\\u6D93",
      "\\u7ED7",
      "\\u93CD",
      "\\u6FC9",
      "\\u5BF0",
      "\\u9427",
      "\\u59DD",
      "\\u5F42",
      "\\u71B6",
      "\\u53C6",
      "\\u5815",
      "\\u7161",
      "\\u7359",
    ].join("|"),
  );
  const matched = values.find((value) => brokenPattern.test(value));
  return matched ? matched.slice(0, 120) : "";
}

async function runPlatformPublish(input = {}) {
  const publishUrl = typeof input.publishUrl === "string" ? input.publishUrl.trim() : "";
  let effectivePublishUrl = publishUrl;
  const automationFile = resolveAutomationFile(input.platform);
  const executionLog = [];
  const sessionToken = typeof input.sessionToken === "string" ? input.sessionToken.trim() : "";

  function log(message) {
    executionLog.push(message);
    appendProgressLog(sessionToken, input.platform, message);
  }

  if (sessionToken) {
    publishProgressSessions.set(sessionToken, createProgressSnapshot(sessionToken, input.platform));
  }

  if (!publishUrl || !automationFile) {
    log(!publishUrl ? "missing_publish_url: 缺少平台发布入口 URL" : "unsupported_platform: 当前平台没有可用的自动化脚本");
    return {
      status: "unsupported",
      errorMessage: "当前平台缺少可执行的桌面发布器。",
      executionLog,
      failureStage: !publishUrl ? "missing_publish_url" : "unsupported_platform",
      verificationEvidence: !publishUrl ? "failed_at_missing_publish_url" : "failed_at_unsupported_platform",
    };
  }

  if (String(input.platform || "") === "videohao") {
    const fallbackPayload = { ...(input.payload || {}) };
    const brokenText = detectBrokenPublishText(fallbackPayload);
    if (brokenText) {
      const message = `发布文案疑似编码损坏，已阻断提交：${brokenText}`;
      log(`payload_encoding_error: ${message}`);
      updateProgressStatus(sessionToken, input.platform, {
        status: "failed",
        failureStage: "payload_encoding_error",
        verificationEvidence: "failed_at_payload_encoding_error",
        errorMessage: message,
      });
      return {
        status: "failed",
        errorMessage: message,
        executionLog,
        failureStage: "payload_encoding_error",
        verificationEvidence: "failed_at_payload_encoding_error",
      };
    }
    try {
      log("videohao_external_cdp_preferred");
      fallbackPayload.preparedImages = await preparePublishImages(fallbackPayload, log);
      const fallbackResult = await runExternalEdgeVideohaoPublish(
        { ...input, payload: fallbackPayload },
        fallbackPayload.preparedImages,
        log,
      );
      const normalizedFallback = normalizeAutomationResult(fallbackResult, {
        executionLog,
        draftUrl: fallbackResult.publishUrl,
        verificationEvidence: fallbackResult.verificationEvidence,
      });
      normalizedFallback.executionLog = [
        ...executionLog,
        ...(Array.isArray(normalizedFallback.executionLog) ? normalizedFallback.executionLog : []),
      ];
      updateProgressStatus(sessionToken, input.platform, normalizedFallback);
      return normalizedFallback;
    } catch (fallbackError) {
      log(`videohao_external_cdp_failed: ${fallbackError instanceof Error ? fallbackError.message : "unknown"}`);
    }
  }

  const publishWindow = createScopedWindow({
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "平台发布",
    sessionPartition: input.sessionPartition,
    show: false,
  });
  let shouldCloseWindow = false;
  const detachNetworkLogger = attachPublishNetworkLogger(publishWindow, sessionToken, input.platform);

  if (process.env.GEO_OPEN_PUBLISH_DEVTOOLS === "1") {
    publishWindow.webContents.openDevTools({ mode: "detach" });
  }

  publishWindow.webContents.on("console-message", (_, _level, message) => {
    const text = String(message || "");
    const prefix = text.match(/^\[geo-(toutiao|baijiahao|douyin|xiaohongshu|wechat|videohao|zhihu|weibo|csdn)\]\s*/);
    if (!prefix) {
      return;
    }
    const normalized = text.replace(/^\[geo-(toutiao|baijiahao|douyin|xiaohongshu|wechat|videohao|zhihu|weibo|csdn)\]\s*/, "").trim();
    if (!normalized) {
      return;
    }
    appendProgressLog(sessionToken, input.platform, normalized);
  });

  publishWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  publishWindow.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault();
  });

  try {
    const validation = await inspectPlatformSession({
      platform: input.platform,
      publishUrl: effectivePublishUrl,
      sessionPartition: input.sessionPartition,
      authPayload: input.authPayload,
    });
    log(`validate_session: ${validation.status}${validation.reason ? ` (${validation.reason})` : ""}`);
    if (validation.status !== "authenticated") {
      if (String(input.platform || "") === "videohao") {
        try {
          const fallbackPayload = { ...(input.payload || {}) };
          fallbackPayload.preparedImages = await preparePublishImages(fallbackPayload, log);
          const fallbackResult = await runExternalEdgeVideohaoPublish(
            { ...input, payload: fallbackPayload },
            fallbackPayload.preparedImages,
            log,
          );
          const normalizedFallback = normalizeAutomationResult(fallbackResult, {
            executionLog,
            draftUrl: fallbackResult.publishUrl,
            verificationEvidence: fallbackResult.verificationEvidence,
          });
          normalizedFallback.executionLog = [
            ...executionLog,
            ...(Array.isArray(normalizedFallback.executionLog) ? normalizedFallback.executionLog : []),
          ];
          updateProgressStatus(sessionToken, input.platform, normalizedFallback);
          return normalizedFallback;
        } catch (fallbackError) {
          log(`videohao_external_cdp_failed: ${fallbackError instanceof Error ? fallbackError.message : "unknown"}`);
        }
      }
      updateProgressStatus(sessionToken, input.platform, {
        status: "failed",
        failureStage: validation.status === "missing_session" ? "platform_session_missing" : "platform_login_required",
        verificationEvidence: validation.status === "missing_session" ? "failed_at_platform_session_missing" : "failed_at_platform_login_required",
        errorMessage: validation.reason || "当前平台会话不可用，请重新登录。",
      });
      return {
        status: "failed",
        errorMessage: validation.reason || "当前平台会话不可用，请重新登录。",
        executionLog,
        failureStage: validation.status === "missing_session" ? "platform_session_missing" : "platform_login_required",
      };
    }

    const payload = {
      ...(input.payload || {}),
    };
    const brokenText = detectBrokenPublishText(payload);
    if (brokenText) {
      const message = `发布文案疑似编码损坏，已阻断提交：${brokenText}`;
      log(`payload_encoding_error: ${message}`);
      updateProgressStatus(sessionToken, input.platform, {
        status: "failed",
        failureStage: "payload_encoding_error",
        verificationEvidence: "failed_at_payload_encoding_error",
        errorMessage: message,
      });
      return {
        status: "failed",
        errorMessage: message,
        executionLog,
        failureStage: "payload_encoding_error",
        verificationEvidence: "failed_at_payload_encoding_error",
      };
    }
    try {
      payload.preparedImages = await preparePublishImages(payload, log);
    } catch (error) {
      const message = error instanceof Error ? error.message : "发布图片准备失败";
      log(`prepare_images_failed: ${message}`);
      updateProgressStatus(sessionToken, input.platform, {
        status: "failed",
        failureStage: "prepare_images",
        verificationEvidence: "failed_at_prepare_images",
        errorMessage: `发布图片准备失败：${message}`,
      });
      return {
        status: "failed",
        errorMessage: `发布图片准备失败：${message}`,
        executionLog,
        failureStage: "prepare_images",
      };
    }

    log(`open_publish_page: ${effectivePublishUrl}`);
    const loadTimedOut = await loadWindowUrlWithTimeout(publishWindow, effectivePublishUrl, 25000);
    if (loadTimedOut) {
      log("open_publish_page_timeout: 页面加载超过 25 秒，继续注入自动化脚本。");
    }
    await waitForWindowStable(publishWindow);
    const publishStorageApplied = await applyAuthStorageToWindow(publishWindow, input.authPayload, log);
    if (publishStorageApplied) {
      log("auth_storage_reload_publish_entry");
      const storageReloadTimedOut = await loadWindowUrlWithTimeout(publishWindow, effectivePublishUrl, 25000);
      if (storageReloadTimedOut) {
        log("auth_storage_reload_timeout: publish entry reload exceeded 25s; continue automation injection");
      }
      await waitForWindowStable(publishWindow);
    }

    if (String(input.platform || "") === "wechat") {
      const tokenizedUrl = await resolveWechatTokenizedPublishUrl(publishWindow, effectivePublishUrl, log);
      if (tokenizedUrl && tokenizedUrl !== effectivePublishUrl) {
        effectivePublishUrl = tokenizedUrl;
        const tokenizedLoadTimedOut = await loadWindowUrlWithTimeout(publishWindow, effectivePublishUrl, 25000);
        if (tokenizedLoadTimedOut) {
          log("open_publish_page_tokenized_timeout: wechat tokenized editor load exceeded 25s; continue automation injection");
        }
        await waitForWindowStable(publishWindow);
      }
    }
    
    const isBlank = await publishWindow.webContents.executeJavaScript(`document.body?.innerText.trim().length === 0`);
    if (isBlank) {
      log("page_blank: 页面加载空白，尝试刷新...");
      publishWindow.webContents.reload();
      await waitForWindowStable(publishWindow);
      await sleep(2000);
    }

    log(`inject_automation: ${path.basename(automationFile)}`);
    const rawResult = await executeAutomation(publishWindow, automationFile, {
      platform: input.platform,
      publishUrl,
      sessionToken,
      timeoutMs: input.timeoutMs || 180000,
      payload,
    });
    const result = normalizeAutomationResult(rawResult, {
      failureStage: "invalid_automation_result",
      errorMessage: "自动化脚本没有返回有效的发布结果。",
    });
    // 只有明确成功或要求关闭时才关闭
    shouldCloseWindow = result.closeWindow || result.status === "published" || result.status === "pending_review" || result.status === "submitted";
    const resultExecutionLog = result.executionLog;
    resultExecutionLog.forEach((item) => appendProgressLog(sessionToken, input.platform, item));
    updateProgressStatus(sessionToken, input.platform, {
      status: result.status,
      failureStage: result.failureStage,
      errorMessage: result.errorMessage,
    });
    return {
      status: result.status,
      draftUrl: result.draftUrl,
      publishUrl: result.publishUrl,
      verificationUrl: result.verificationUrl,
      externalStatus: result.externalStatus,
      executionLog: [...executionLog, ...resultExecutionLog],
      verificationEvidence: result.verificationEvidence,
      verificationAttempts: result.verificationAttempts,
      platformItemId: result.platformItemId,
      failureStage: result.failureStage,
      errorMessage: result.errorMessage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "桌面自动发布失败。";
    log(`electron_publish: ${message}`);
    updateProgressStatus(sessionToken, input.platform, {
      status: "failed",
      failureStage: message.includes("ERR_") || message.includes("loadURL") ? "load_publish_page" : "electron_publish",
      verificationEvidence: message.includes("ERR_") || message.includes("loadURL") ? "failed_at_load_publish_page" : "failed_at_electron_publish",
      errorMessage: message,
    });
    return {
      status: "failed",
      errorMessage: message,
      executionLog,
      failureStage: message.includes("ERR_") || message.includes("loadURL") ? "load_publish_page" : "electron_publish",
    };
  } finally {
    detachNetworkLogger();
    if (shouldCloseWindow && !publishWindow.isDestroyed()) {
      const currentUrl = publishWindow.webContents.getURL();
      if (currentUrl && !currentUrl.startsWith("devtools://")) {
        setTimeout(() => {
          if (!publishWindow.isDestroyed()) {
            publishWindow.close();
          }
        }, 5000);
      }
    }
  }
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.geo.desktop");
  }
  localBridge = createLocalBridge({
    isReady: () => app.isReady(),
    getVersion: () => app.getVersion(),
    openPlatformLogin: (input) => trackBridgeOperation(() => openPlatformLoginWindow(input)),
    validatePlatformSession: (input) => trackBridgeOperation(() => inspectPlatformSession(input)),
    runPlatformPublish: (input) => trackBridgeOperation(() => runPlatformPublish(input)),
    getPlatformPublishProgress: (input) => getPlatformPublishProgress(input),
  });

  try {
    await localBridge.start();
  } catch (error) {
    console.error("Failed to start GEO local bridge:", error);
  }

  await createWindow();
  startPlatformAccountSessionRefreshLoop();
  startAutoPublishScheduler();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopGlobalSessionAuditScheduler();
  stopAutoPublishScheduler();
});

ipcMain.handle("geo:open-platform-login", async (_, input) => openPlatformLoginWindow(input));
ipcMain.handle("geo:validate-platform-session", async (_, input) => inspectPlatformSession(input));
ipcMain.handle("geo:run-platform-publish", async (_, input) => runPlatformPublish(input));
ipcMain.handle("geo:get-platform-publish-progress", async (_, input) => getPlatformPublishProgress(input));

app.on("window-all-closed", () => {
  if (activeBridgeOperations > 0) {
    return;
  }

  stopPlatformAccountSessionRefreshLoop();
  stopAutoPublishScheduler();
  if (server) {
    server.close();
  }
  if (localBridge) {
    void localBridge.stop().catch((error) => {
      console.error("Failed to stop GEO local bridge:", error);
    });
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    restoreMainWindow();
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().then(() => {
      startPlatformAccountSessionRefreshLoop();
      startAutoPublishScheduler();
    });
  }
});
