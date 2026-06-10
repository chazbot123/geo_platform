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
let activeBridgeOperations = 0;

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
  const externalDataPath = String(process.env.GEO_DATA_DIR || "").trim();
  const dataPath = externalDataPath || path.join(userDataPath, "data");
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
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  hideWindowMenu(mainWindow);

  await mainWindow.loadURL(appUrl);
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
        publishUrl: publishUrl || "https://channels.weixin.qq.com/platform/post/create",
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

  await applyAuthPayloadToPartition({
    platform: input.platform,
    publishUrl: spec.publishUrl,
    sessionPartition: input.sessionPartition,
    authPayload: input.authPayload,
  });

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
    const storageApplied = await applyAuthStorageToWindow(validationWindow, input.authPayload);
    if (storageApplied) {
      await validationWindow.loadURL(spec.publishUrl);
      await waitForWindowStable(validationWindow);
    }
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

  const publishWindow = createScopedWindow({
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : "平台发布",
    sessionPartition: input.sessionPartition,
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
});

ipcMain.handle("geo:open-platform-login", async (_, input) => openPlatformLoginWindow(input));
ipcMain.handle("geo:validate-platform-session", async (_, input) => inspectPlatformSession(input));
ipcMain.handle("geo:run-platform-publish", async (_, input) => runPlatformPublish(input));
ipcMain.handle("geo:get-platform-publish-progress", async (_, input) => getPlatformPublishProgress(input));

app.on("window-all-closed", () => {
  if (activeBridgeOperations > 0) {
    return;
  }

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
