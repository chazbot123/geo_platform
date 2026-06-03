const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const next = require("next");
const path = require("node:path");
const { createLocalBridge } = require("./local-bridge");

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.GEO_DEV_SERVER_URL || "http://localhost:3000";
const PROD_SERVER_URL = "http://127.0.0.1:3131";
let mainWindow;
let server;
let localBridge;
const preloadPath = path.join(__dirname, "preload.js");
const automationDirectory = path.join(__dirname, "publish-automation");
const automationHelperFile = path.join(automationDirectory, "dom-helpers.js");
const publishProgressSessions = new Map();
const PUBLISH_PROGRESS_TTL_MS = 10 * 60 * 1000;
const AUTOMATION_SUCCESS_STATUSES = new Set(["published", "submitted", "verifying", "pending_review", "verification_failed"]);
const AUTOMATION_TERMINAL_STATUSES = new Set([...AUTOMATION_SUCCESS_STATUSES, "failed", "unsupported"]);

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

function formatStageLabel(stage) {
  const normalized = String(stage || "").trim();
  if (!normalized) {
    return "未知阶段";
  }
  return STAGE_LABELS[normalized] || normalized.replace(/_/g, " ");
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
    case "wechat":
      return {
        publishUrl: publishUrl || "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10",
        loginUrlHints: ["/cgi-bin/bizlogin", "/cgi-bin/loginpage", "login.weixin.qq.com", "open.weixin.qq.com/connect/qrconnect"],
        loginTextHints: ["请使用微信扫码登录", "扫码登录", "微信扫一扫", "账号密码登录", "登录公众平台"],
      };
    case "videohao":
      return {
        publishUrl: publishUrl || "https://channels.weixin.qq.com/platform/post/create",
        loginUrlHints: ["login.weixin.qq.com", "open.weixin.qq.com/connect/qrconnect", "/login"],
        loginTextHints: ["请使用微信扫码登录", "扫码登录", "微信扫一扫"],
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
      };
    default:
      return {
        publishUrl: publishUrl || "",
        loginUrlHints: ["/login", "passport", "signin"],
        loginTextHints: ["扫码登录", "请先登录"],
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
        const lowerUrl = currentUrl.toLowerCase();
        const matchedUrlHint = loginUrlHints.find((hint) => lowerUrl.includes(String(hint).toLowerCase())) || "";
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
          hasLoginInput,
          hasLoginAction,
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
    case "toutiao":
      return path.join(automationDirectory, "toutiao.js");
    case "baijiahao":
      return path.join(automationDirectory, "baijiahao.js");
    case "douyin":
      return path.join(automationDirectory, "douyin.js");
    case "wechat":
      return path.join(automationDirectory, "wechat.js");
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
  };
}

async function preparePublishImages(payload = {}, log) {
  const publishMode = String(payload.publishMode || "").trim() || "with_images";
  if (publishMode === "text_only") {
    log("prepare_images: skipped (text_only)");
    return [];
  }

  const draftImagePaths = Array.isArray(payload.draftImagePaths) ? payload.draftImagePaths : [];
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
    await new Promise((resolve) => {
      windowInstance.webContents.once("did-finish-load", resolve);
    });
  }
  await sleep(1200);
}

async function executeAutomation(windowInstance, filePath, payload) {
  const helperSource = fs.readFileSync(automationHelperFile, "utf8");
  const source = fs.readFileSync(filePath, "utf8");
  return windowInstance.webContents.executeJavaScript(
    `(async () => {
      ${helperSource}
      return (${source})(${JSON.stringify(payload)});
    })()`,
    true,
  );
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
  };
}

async function runPlatformPublish(input = {}) {
  const publishUrl = typeof input.publishUrl === "string" ? input.publishUrl.trim() : "";
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

  const publishWindow = createScopedWindow({
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "平台发布",
    sessionPartition: input.sessionPartition,
  });
  let shouldCloseWindow = false;

  publishWindow.webContents.openDevTools({ mode: 'detach' });

  publishWindow.webContents.on("console-message", (_, _level, message) => {
    const text = String(message || "");
    const prefix = text.match(/^\[geo-(toutiao|baijiahao|douyin|wechat)\]\s*/);
    if (!prefix) {
      return;
    }
    const normalized = text.replace(/^\[geo-(toutiao|baijiahao|douyin|wechat)\]\s*/, "").trim();
    if (!normalized) {
      return;
    }
    appendProgressLog(sessionToken, input.platform, normalized);
  });

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

    log(`open_publish_page: ${publishUrl}`);
    await publishWindow.loadURL(publishUrl);
    await waitForWindowStable(publishWindow);
    
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
    shouldCloseWindow = result.status === "published" || result.status === "pending_review" || result.status === "submitted";
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
  localBridge = createLocalBridge({
    isReady: () => app.isReady(),
    getVersion: () => app.getVersion(),
    openPlatformLogin: (input) => openPlatformLoginWindow(input),
    validatePlatformSession: (input) => inspectPlatformSession(input),
    runPlatformPublish: (input) => runPlatformPublish(input),
    getPlatformPublishProgress: (input) => getPlatformPublishProgress(input),
  });

  try {
    await localBridge.start();
  } catch (error) {
    console.error("Failed to start GEO local bridge:", error);
  }

  await createWindow();
});

ipcMain.handle("geo:open-platform-login", async (_, input) => openPlatformLoginWindow(input));
ipcMain.handle("geo:validate-platform-session", async (_, input) => inspectPlatformSession(input));
ipcMain.handle("geo:run-platform-publish", async (_, input) => runPlatformPublish(input));
ipcMain.handle("geo:get-platform-publish-progress", async (_, input) => getPlatformPublishProgress(input));

app.on("window-all-closed", () => {
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
