const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const next = require("next");
const path = require("node:path");

const isDev = !app.isPackaged;
const DEV_SERVER_URL = "http://localhost:3000";
const PROD_SERVER_URL = "http://127.0.0.1:3131";
let mainWindow;
let server;
const preloadPath = path.join(__dirname, "preload.js");
const automationDirectory = path.join(__dirname, "publish-automation");

function setupPersistencePaths() {
  const userDataPath = app.getPath("userData");
  const sessionDataPath = path.join(userDataPath, "session-data");
  const dataPath = path.join(userDataPath, "data");
  fs.mkdirSync(sessionDataPath, { recursive: true });
  fs.mkdirSync(dataPath, { recursive: true });
  app.setPath("sessionData", sessionDataPath);
  process.env.GEO_DATA_DIR = dataPath;
}

setupPersistencePaths();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDataDir() {
  const userDataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(userDataDir, { recursive: true });
  process.env.GEO_DATA_DIR = userDataDir;
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
    server.listen(3131, "127.0.0.1", resolve);
  });

  return PROD_SERVER_URL;
}

async function createWindow() {
  ensureDataDir();
  const appUrl = await startNextServer();

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#08101d",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  await mainWindow.loadURL(appUrl);
}

function createScopedWindow(input = {}) {
  return new BrowserWindow({
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
}

function getPlatformSessionSpec(platform, publishUrl) {
  const normalizedPlatform = String(platform || "").trim();
  switch (normalizedPlatform) {
    case "xiaohongshu":
      return {
        publishUrl: publishUrl || "https://creator.xiaohongshu.com/publish/publish",
        loginUrlHints: ["/login", "passport", "signin", "signup"],
        loginTextHints: ["登录", "手机号登录", "验证码登录", "扫码登录", "请先登录", "立即登录"],
      };
    case "douyin":
      return {
        publishUrl: publishUrl || "https://creator.douyin.com/creator-micro/content/publish",
        loginUrlHints: ["/login", "passport", "signin", "sso"],
        loginTextHints: ["登录", "验证码登录", "扫码登录", "手机号登录", "请先登录", "立即登录"],
      };
    default:
      return {
        publishUrl: publishUrl || "",
        loginUrlHints: ["/login", "passport", "signin"],
        loginTextHints: ["登录", "扫码登录", "请先登录"],
      };
  }
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

  const partitionSession = partition ? session.fromPartition(partition) : session.defaultSession;
  let cookieCount = 0;
  try {
    const cookies = await partitionSession.cookies.get({ url: spec.publishUrl });
    cookieCount = cookies.length;
  } catch {
    cookieCount = 0;
  }

  const validationWindow = createScopedWindow({
    title: `${input.platform || "平台"} 会话检测`,
    sessionPartition: partition || undefined,
    show: false,
  });

  validationWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  try {
    await validationWindow.loadURL(spec.publishUrl);
    await waitForWindowStable(validationWindow);
    const inspection = await validationWindow.webContents.executeJavaScript(
      `(() => {
        const currentUrl = window.location.href;
        const pageText = String(document.body?.innerText || document.body?.textContent || "").replace(/\\s+/g, " ").trim();
        const loginUrlHints = ${JSON.stringify(spec.loginUrlHints)};
        const loginTextHints = ${JSON.stringify(spec.loginTextHints)};
        const matchedUrlHint = loginUrlHints.find((hint) => currentUrl.includes(hint)) || "";
        const matchedTextHint = loginTextHints.find((hint) => pageText.includes(hint)) || "";
        return {
          currentUrl,
          matchedUrlHint,
          matchedTextHint,
          pageTextSample: pageText.slice(0, 240),
        };
      })()`,
      true,
    );

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

    return {
      status: "authenticated",
      reason: cookieCount > 0 ? `检测到 ${cookieCount} 个会话 Cookie，且页面未出现登录提示。` : "页面未出现登录提示，判定为已登录。",
      currentUrl: inspection?.currentUrl || spec.publishUrl,
      cookieCount,
    };
  } catch (error) {
    return {
      status: "unknown",
      reason: error instanceof Error ? error.message : "平台会话检测失败。",
      currentUrl: spec.publishUrl,
      cookieCount,
    };
  } finally {
    if (!validationWindow.isDestroyed()) {
      validationWindow.close();
    }
  }
}

function openPlatformLoginWindow(input = {}) {
  const loginUrl = typeof input.loginUrl === "string" ? input.loginUrl.trim() : "";
  if (!loginUrl) {
    return { status: "unsupported" };
  }

  return new Promise((resolve) => {
    const loginWindow = createScopedWindow(input);

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });

    loginWindow.on("closed", () => {
      resolve({ status: "closed" });
    });

    loginWindow.loadURL(loginUrl).catch(() => {
      resolve({ status: "unsupported" });
      loginWindow.close();
    });
  });
}

function resolveAutomationFile(platform) {
  switch (String(platform || "").trim()) {
    case "xiaohongshu":
      return path.join(automationDirectory, "xiaohongshu.js");
    case "douyin":
      return path.join(automationDirectory, "douyin.js");
    default:
      return "";
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

async function prepareSinglePublishImage(imageUrl, index) {
  const normalizedUrl = String(imageUrl || "").trim();
  if (!normalizedUrl) {
    throw new Error("图片地址为空");
  }

  const dataUrlPayload = parseDataUrl(normalizedUrl);
  if (dataUrlPayload) {
    const extension = guessExtensionFromMimeType(dataUrlPayload.mimeType);
    return {
      name: `publish-${index + 1}${extension}`,
      mimeType: dataUrlPayload.mimeType,
      dataUrl: `data:${dataUrlPayload.mimeType};base64,${dataUrlPayload.buffer.toString("base64")}`,
    };
  }

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error(`下载图片失败：${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = String(response.headers.get("content-type") || "").split(";")[0].trim() || "image/png";
  const extension = guessExtensionFromMimeType(mimeType);
  return {
    name: `publish-${index + 1}${extension}`,
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

async function preparePublishImages(payload = {}, log) {
  const draftImages = Array.isArray(payload.draftImages) ? payload.draftImages : [];
  if (draftImages.length === 0) {
    return [];
  }

  log(`prepare_images: start (${draftImages.length})`);
  const preparedImages = [];
  for (let index = 0; index < draftImages.length; index += 1) {
    preparedImages.push(await prepareSinglePublishImage(draftImages[index], index));
  }
  log(`prepare_images: ready (${preparedImages.length})`);
  return preparedImages;
}

async function waitForWindowStable(windowInstance) {
  await sleep(1500);
  if (windowInstance.webContents.isLoading()) {
    await new Promise((resolve) => {
      windowInstance.webContents.once("did-finish-load", resolve);
    });
  }
  await sleep(1200);
}

async function executeAutomation(windowInstance, filePath, payload) {
  const source = fs.readFileSync(filePath, "utf8");
  return windowInstance.webContents.executeJavaScript(`(${source})(${JSON.stringify(payload)})`, true);
}

async function runPlatformPublish(input = {}) {
  const publishUrl = typeof input.publishUrl === "string" ? input.publishUrl.trim() : "";
  const automationFile = resolveAutomationFile(input.platform);
  const executionLog = [];

  function log(message) {
    executionLog.push(message);
  }

  if (!publishUrl || !automationFile) {
    log(!publishUrl ? "missing_publish_url: 缺少平台发布入口 URL" : "unsupported_platform: 当前平台没有可用的自动化脚本");
    return {
      status: "unsupported",
      errorMessage: "当前平台缺少可执行的桌面发布器。",
      executionLog,
      failureStage: !publishUrl ? "missing_publish_url" : "unsupported_platform",
    };
  }

  const publishWindow = createScopedWindow({
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "平台发布",
    sessionPartition: input.sessionPartition,
  });
  let shouldCloseWindow = false;

  publishWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  try {
    const validation = await inspectPlatformSession({
      platform: input.platform,
      publishUrl,
      sessionPartition: input.sessionPartition,
    });
    log(`validate_session: ${validation.status}${validation.reason ? ` (${validation.reason})` : ""}`);
    if (validation.status !== "authenticated") {
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
    try {
      payload.preparedImages = await preparePublishImages(payload, log);
    } catch (error) {
      const message = error instanceof Error ? error.message : "发布图片准备失败";
      log(`prepare_images_failed: ${message}`);
      return {
        status: "failed",
        errorMessage: `发布图片准备失败：${message}`,
        executionLog,
        failureStage: "prepare_images",
      };
    }

    log(`open_publish_page: ${publishUrl}`);
    await publishWindow.loadURL(publishUrl);
    await waitForWindowStable(publishWindow);
    log(`inject_automation: ${path.basename(automationFile)}`);
    const result = await executeAutomation(publishWindow, automationFile, {
      platform: input.platform,
      publishUrl,
      timeoutMs: input.timeoutMs,
      payload,
    });
    shouldCloseWindow = result?.status === "published";
    const resultExecutionLog = Array.isArray(result?.executionLog) ? result.executionLog : [];
    return {
      status: result?.status ?? "failed",
      draftUrl: result?.draftUrl,
      publishUrl: result?.publishUrl ?? result?.draftUrl,
      verificationUrl: result?.verificationUrl,
      externalStatus: result?.externalStatus,
      executionLog: [...executionLog, ...resultExecutionLog],
      verificationEvidence: result?.verificationEvidence,
      verificationAttempts: result?.verificationAttempts,
      platformItemId: result?.platformItemId,
      failureStage: result?.failureStage ?? (!result?.status ? "invalid_automation_result" : undefined),
      errorMessage: result?.errorMessage ?? (!result?.status ? "自动化脚本没有返回有效的发布结果。" : undefined),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "桌面自动发布失败。";
    log(`electron_publish: ${message}`);
    return {
      status: "failed",
      errorMessage: message,
      executionLog,
      failureStage: message.includes("ERR_") || message.includes("loadURL") ? "load_publish_page" : "electron_publish",
    };
  } finally {
    if (shouldCloseWindow && !publishWindow.isDestroyed()) {
      const currentUrl = publishWindow.webContents.getURL();
      if (currentUrl && !currentUrl.startsWith("devtools://")) {
        setTimeout(() => {
          if (!publishWindow.isDestroyed()) {
            publishWindow.close();
          }
        }, 2000);
      }
    }
  }
}

app.whenReady().then(createWindow);

ipcMain.handle("geo:open-platform-login", async (_, input) => openPlatformLoginWindow(input));
ipcMain.handle("geo:validate-platform-session", async (_, input) => inspectPlatformSession(input));
ipcMain.handle("geo:run-platform-publish", async (_, input) => runPlatformPublish(input));

app.on("window-all-closed", () => {
  if (server) {
    server.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
