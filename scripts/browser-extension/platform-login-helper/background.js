const activeLoginSessions = new Map();
const activePublishSessions = new Map();
const autoResolvingLoginPlatforms = new Set();
const debugPrefix = "[ai-superweb-background]";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:33131";

const platformCookieDomains = {
  xiaohongshu: ["creator.xiaohongshu.com", ".xiaohongshu.com"],
  douyin: ["creator.douyin.com", ".douyin.com"],
  wechat_mp: ["channels.weixin.qq.com", ".weixin.qq.com", ".qq.com"],
  kuaishou: ["cp.kuaishou.com", "passport.kuaishou.com", ".kuaishou.com"],
};

function sendResponseSafe(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (_) {
    // Ignore closed message channels.
  }
}

function notifyApp(session, message) {
  if (!session || typeof session.appTabId !== "number") {
    return;
  }

  chrome.tabs.sendMessage(session.appTabId, message, () => {
    void chrome.runtime.lastError;
  });
}

function notifyPublishError(session, message) {
  notifyApp(session, {
    source: "ai-superweb-extension",
    type: "AI_SUPERWEB_EXTENSION_PUBLISH_ERROR",
    payload: {
      sessionId: session?.job?.id || "",
      platform: session?.platform,
      message,
    },
  });
}

async function closeLoginTabIfNeeded(session) {
  const loginTabId = Number(session?.loginTabId);
  const appTabId = Number(session?.appTabId);
  if (!Number.isInteger(loginTabId) || loginTabId <= 0) {
    return;
  }
  if (Number.isInteger(appTabId) && loginTabId === appTabId) {
    return;
  }
  await chrome.tabs.remove(loginTabId).catch(() => undefined);
}

function debugLog(scope, detail, extra) {
  if (typeof extra === "undefined") {
    console.log(`${debugPrefix}[${scope}] ${detail}`);
    return;
  }
  console.log(`${debugPrefix}[${scope}] ${detail}`, extra);
}

async function getCookiesByDomain(domain) {
  const cookies = await chrome.cookies.getAll({ domain });
  return cookies ?? [];
}

async function collectPlatformCookies(platform) {
  const domains = platformCookieDomains[platform] ?? [];
  const cookieMap = new Map();

  for (const domain of domains) {
    const cookies = await getCookiesByDomain(domain);
    for (const cookie of cookies) {
      const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
      if (!cookieMap.has(key)) {
        cookieMap.set(key, cookie);
      }
    }
  }

  return Array.from(cookieMap.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function collectPlatformCookieRecords(platform) {
  const domains = platformCookieDomains[platform] ?? [];
  const cookieMap = new Map();

  for (const domain of domains) {
    const cookies = await getCookiesByDomain(domain);
    for (const cookie of cookies) {
      const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
      if (!cookieMap.has(key)) {
        cookieMap.set(key, {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || "/",
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: cookie.sameSite || undefined,
          expirationDate: cookie.expirationDate,
        });
      }
    }
  }

  return Array.from(cookieMap.values()).sort((left, right) =>
    `${left.domain}|${left.path}|${left.name}`.localeCompare(`${right.domain}|${right.path}|${right.name}`),
  );
}

function buildCookieRemovalUrls(cookie) {
  const normalizedDomain = String(cookie?.domain || "").trim().replace(/^\./, "");
  const normalizedPath = String(cookie?.path || "/").trim() || "/";
  if (!normalizedDomain) {
    return [];
  }

  const protocols = cookie?.secure ? ["https"] : ["https", "http"];
  return protocols.map((protocol) => `${protocol}://${normalizedDomain}${normalizedPath}`);
}

async function clearPlatformCookies(platform) {
  const domains = platformCookieDomains[platform] ?? [];
  const cookies = [];

  for (const domain of domains) {
    const scopedCookies = await getCookiesByDomain(domain);
    cookies.push(...scopedCookies);
  }

  const deduplicatedCookies = new Map();
  for (const cookie of cookies) {
    const key = `${cookie.storeId || ""}|${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (!deduplicatedCookies.has(key)) {
      deduplicatedCookies.set(key, cookie);
    }
  }

  const removals = [];
  for (const cookie of deduplicatedCookies.values()) {
    const urls = buildCookieRemovalUrls(cookie);
    for (const url of urls) {
      removals.push(
        chrome.cookies
          .remove({
            url,
            name: cookie.name,
            storeId: cookie.storeId,
          })
          .catch(() => undefined),
      );
    }
  }

  await Promise.all(removals);
}

async function withTimeout(promise, timeoutMs, fallbackValue) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function parseCookieHeader(authPayload) {
  return String(authPayload || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return null;
      }
      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!name) {
        return null;
      }
      return { name, value };
    })
    .filter(Boolean);
}

function getPlatformCookieSetUrls(platform, job) {
  const urls = new Set([getPlatformPublishUrl(platform, job)]);
  if (platform === "xiaohongshu") {
    urls.add("https://creator.xiaohongshu.com/");
    urls.add("https://www.xiaohongshu.com/");
  }
  if (platform === "douyin") {
    urls.add("https://creator.douyin.com/");
    urls.add("https://www.douyin.com/");
  }
  if (platform === "wechat_mp") {
    urls.add("https://channels.weixin.qq.com/");
    urls.add("https://mp.weixin.qq.com/");
  }
  if (platform === "kuaishou") {
    urls.add("https://cp.kuaishou.com/");
    urls.add("https://www.kuaishou.com/");
  }
  return Array.from(urls);
}

function buildCookieWritePayloads(targetUrl, platform, cookie) {
  const host = new URL(targetUrl).hostname;
  const payloads = [
    {
      url: targetUrl,
      name: cookie.name,
      value: cookie.value,
      path: "/",
    },
  ];

  for (const domain of platformCookieDomains[platform] ?? []) {
    const normalizedDomain = String(domain || "").trim().replace(/^\./, "");
    if (!normalizedDomain || !host.endsWith(normalizedDomain)) {
      continue;
    }
    payloads.push({
      url: targetUrl,
      name: cookie.name,
      value: cookie.value,
      path: "/",
      domain,
    });
  }

  const deduplicated = new Map();
  for (const payload of payloads) {
    const key = `${payload.url}|${payload.name}|${payload.path}|${payload.domain || ""}`;
    if (!deduplicated.has(key)) {
      deduplicated.set(key, payload);
    }
  }
  return Array.from(deduplicated.values());
}

async function applyPlatformAuthPayload(platform, authPayload, job) {
  const parsedCookies = parseCookieHeader(authPayload);
  if (parsedCookies.length === 0) {
    throw new Error("所选账号缺少可注入的 Cookie");
  }

  const writes = [];
  for (const targetUrl of getPlatformCookieSetUrls(platform, job)) {
    for (const cookie of parsedCookies) {
      for (const payload of buildCookieWritePayloads(targetUrl, platform, cookie)) {
        writes.push(
          chrome.cookies
            .set(payload)
            .then((result) => Boolean(result))
            .catch(() => false),
        );
      }
    }
  }

  const results = await Promise.all(writes);
  if (!results.some(Boolean)) {
    throw new Error("所选账号 Cookie 注入失败，请重新登录该账号后再试");
  }
}

async function resolveExtensionPublishAuthPayload(apiBaseUrl, session) {
  const directAuthPayload = String(session?.accountAuthPayload || "").trim();
  if (directAuthPayload) {
    return directAuthPayload;
  }

  const response = await fetch(`${apiBaseUrl}/api/publishing/extension/publish-jobs/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionToken: session?.sessionToken || "",
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || "扩展补取所选账号登录态失败");
  }

  const accountAuthPayload = String(payload?.accountAuthPayload || "").trim();
  if (!accountAuthPayload) {
    throw new Error("扩展补取到的账号登录态为空，无法按指定账号发布");
  }

  return accountAuthPayload;
}

async function syncLoginResult(session, context) {
  if (!session || session.syncing || session.status === "completed") {
    return;
  }

  session.syncing = true;
  try {
    const authPayload = JSON.stringify({
      payloadFormat: "cookie_storage_v2",
      cookies: await collectPlatformCookieRecords(session.platform),
      localStorage: context?.authStorage?.localStorage || {},
      sessionStorage: context?.authStorage?.sessionStorage || {},
    });
    if (!authPayload || authPayload.length < 20) {
      throw new Error("当前页面还没有可用的登录 Cookie，请先完成平台登录。");
    }

    const accountName = String(context?.accountName || "").trim();
    const displayName = String(context?.displayName || "").trim();
    const avatarUrl = String(context?.avatarUrl || "").trim();
    const followerCount =
      typeof context?.followerCount === "number" && Number.isFinite(context.followerCount)
        ? Math.max(0, Math.round(context.followerCount))
        : null;
    const hasResolvedProfile =
      session.platform === "douyin"
        ? Boolean(accountName && displayName && avatarUrl && followerCount !== null)
        : Boolean(accountName || displayName || avatarUrl || followerCount !== null);
    if (!hasResolvedProfile) {
      return;
    }

    const response = await fetch(`${session.apiBaseUrl}/api/publishing/platform-accounts/extension-login/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        platform: session.platform,
        sessionToken: session.sessionToken,
        authType: "cookie",
        payloadFormat: "cookie_storage_v2",
        authPayload,
        accountName,
        displayName,
        sourceUrl: context?.url || "",
        avatarUrl,
        followerCount,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || "扩展回传登录信息失败");
    }

    session.status = "completed";
    notifyApp(session, {
      source: "ai-superweb-extension",
      type: "AI_SUPERWEB_EXTENSION_LOGIN_SYNCED",
      payload: {
        sessionId: session.sessionId,
        platform: session.platform,
        account: payload?.account,
      },
    });
    await closeLoginTabIfNeeded(session);
  } catch (error) {
    notifyApp(session, {
      source: "ai-superweb-extension",
      type: "AI_SUPERWEB_EXTENSION_LOGIN_ERROR",
      payload: {
        sessionId: session.sessionId,
        platform: session.platform,
        message: error instanceof Error ? error.message : "扩展自动同步失败",
      },
    });
  } finally {
    session.syncing = false;
  }
}

function getActiveSessionByPlatform(platform) {
  for (const session of activeLoginSessions.values()) {
    if (session.platform === platform && session.status !== "completed") {
      return session;
    }
  }
  return null;
}

async function resolvePendingLoginSession(platform) {
  try {
    const response = await fetch(`${DEFAULT_API_BASE_URL}/api/publishing/platform-accounts/extension-login/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ platform }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || "扩展获取待同步登录会话失败");
    }
    const sessionToken = String(payload?.sessionToken || "").trim();
    if (!sessionToken) {
      return null;
    }
    return {
      accountId: String(payload?.accountId || "").trim(),
      sessionId: `auto-sync-${platform}-${sessionToken}`,
      sessionToken,
      apiBaseUrl: DEFAULT_API_BASE_URL,
    };
  } catch (error) {
    debugLog("login", "resolve-pending-session-failed", {
      platform,
      message: error instanceof Error ? error.message : "扩展获取待同步登录会话失败",
    });
    return null;
  }
}

function syncLoginResultWithRetries(session, context) {
  void syncLoginResult(session, context);
  setTimeout(() => {
    void syncLoginResult(session, context);
  }, 2500);
  setTimeout(() => {
    void syncLoginResult(session, context);
  }, 6500);
  setTimeout(() => {
    void syncLoginResult(session, context);
  }, 12000);
}

function scheduleSync(platform, context) {
  const session = getActiveSessionByPlatform(platform);
  if (session) {
    syncLoginResultWithRetries(session, context);
    return;
  }

  if (platform !== "wechat_mp" || autoResolvingLoginPlatforms.has(platform)) {
    return;
  }

  autoResolvingLoginPlatforms.add(platform);
  void resolvePendingLoginSession(platform)
    .then((resolved) => {
      if (!resolved) {
        return;
      }
      const nextSession =
        getActiveSessionByPlatform(platform) ||
        {
          sessionId: resolved.sessionId,
          sessionToken: resolved.sessionToken,
          platform,
          apiBaseUrl: resolved.apiBaseUrl,
          appTabId: null,
          loginTabId: null,
          status: "pending",
          syncing: false,
        };
      activeLoginSessions.set(nextSession.sessionId, nextSession);
      syncLoginResultWithRetries(nextSession, context);
    })
    .finally(() => {
      autoResolvingLoginPlatforms.delete(platform);
    });
}

function getPlatformPublishUrl(platform, job) {
  const hasVideo = Boolean(job?.draftVideoUrl);
  if (platform === "xiaohongshu") {
    return hasVideo
      ? "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video&openFilePicker=true"
      : "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image&openFilePicker=true";
  }
  if (platform === "douyin") {
    return "https://creator.douyin.com/creator-micro/home";
  }
  if (platform === "wechat_mp") {
    return "https://channels.weixin.qq.com/platform";
  }
  if (platform === "kuaishou") {
    return "https://cp.kuaishou.com/profile";
  }
  return "https://www.google.com/";
}

function getPublishSessionByTabId(tabId) {
  for (const session of activePublishSessions.values()) {
    if (session.tabId === tabId) {
      return session;
    }
  }
  return null;
}

async function syncPublishResult(session, payload) {
  if (!session || !payload?.status) {
    return;
  }

  try {
    let authPayload = undefined;
    if (payload.status === "success") {
      authPayload = await collectPlatformCookies(session.platform);
    }

    const response = await fetch(`${session.apiBaseUrl}/api/publishing/extension/publish-jobs/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionToken: session.sessionToken,
        status: payload.status,
        draftUrl: payload.draftUrl || "",
        lastError: payload.lastError || "",
        authPayload,
        accountName: payload.accountName || "",
        displayName: payload.displayName || "",
        sourceUrl: payload.sourceUrl || "",
      }),
    });

    const nextJob = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(nextJob?.message || "扩展回传发布状态失败");
    }

    if (payload.status === "success" || payload.status === "failed") {
      session.status = payload.status;
    }

    notifyApp(session, {
      source: "ai-superweb-extension",
      type: "AI_SUPERWEB_EXTENSION_PUBLISH_SYNCED",
      payload: {
        sessionId: session.job.id,
        platform: session.platform,
        job: nextJob,
      },
    });
  } catch (error) {
    notifyPublishError(session, error instanceof Error ? error.message : "扩展本地发布失败");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AI_SUPERWEB_FROM_PAGE") {
    const payload = message.payload;
    if (payload?.action === "PING") {
      sendResponseSafe(sendResponse, { ok: true, version: "0.1.0" });
      return true;
    }

    if (payload?.action === "START_LOGIN") {
      void (async () => {
        try {
          const loginUrl = String(payload?.session?.loginUrl || "").trim();
          if (!loginUrl) {
            throw new Error("当前平台缺少登录入口 URL，扩展无法打开登录页");
          }

          const clearResult = payload.forceFreshLogin
            ? await withTimeout(
                clearPlatformCookies(payload.platform)
                  .then(() => ({ ok: true, timedOut: false, message: "" }))
                  .catch((error) => ({
                    ok: false,
                    timedOut: false,
                    message: error instanceof Error ? error.message : "清理旧登录态失败，已继续打开视频号登录页。",
                  })),
                4000,
                { ok: false, timedOut: true, message: "清理旧登录态超时，已继续打开视频号登录页。" },
              )
            : { ok: true, timedOut: false, message: "" };

          const session = {
            sessionId: payload.session.sessionId,
            sessionToken: payload.session.sessionToken,
            platform: payload.platform,
            apiBaseUrl: payload.apiBaseUrl,
            appTabId: sender.tab?.id,
            loginTabId: null,
            status: "pending",
            syncing: false,
          };
          activeLoginSessions.set(session.sessionId, session);
          const tab = await chrome.tabs.create({
            url: loginUrl,
            active: true,
          });
          session.loginTabId = Number(tab?.id) || null;
          debugLog("login", "login-tab-created", {
            platform: payload.platform,
            sessionId: session.sessionId,
            tabId: session.loginTabId,
            loginUrl,
            clearTimedOut: Boolean(clearResult.timedOut),
          });
          sendResponseSafe(sendResponse, {
            ok: true,
            clearTimedOut: Boolean(clearResult.timedOut),
            message: clearResult.message || "",
          });
        } catch (error) {
          sendResponseSafe(sendResponse, {
            ok: false,
            message: error instanceof Error ? error.message : "扩展清理平台登录态失败",
          });
        }
      })();
      return true;
    }

    if (payload?.action === "START_PUBLISH") {
      void (async () => {
        try {
          debugLog("publish", "start-publish-received", {
            platform: payload.platform,
            jobId: payload.session?.job?.id || "",
            hasVideo: Boolean(payload.session?.job?.draftVideoUrl),
          });
          const accountAuthPayload = await resolveExtensionPublishAuthPayload(
            payload.apiBaseUrl,
            payload.session,
          );

          await clearPlatformCookies(payload.platform);
          await applyPlatformAuthPayload(
            payload.platform,
            accountAuthPayload,
            payload.session.job,
          );

          const targetUrl = getPlatformPublishUrl(payload.platform, payload.session.job);
          const tab = await chrome.tabs.create({
            url: targetUrl,
            active: true,
          });
          debugLog("publish", "publish-tab-created", {
            platform: payload.platform,
            jobId: payload.session?.job?.id || "",
            tabId: tab.id,
            targetUrl,
          });
          activePublishSessions.set(payload.session.job.id, {
            sessionToken: payload.session.sessionToken,
            platform: payload.platform,
            apiBaseUrl: payload.apiBaseUrl,
            appTabId: sender.tab?.id,
            tabId: tab.id,
            job: payload.session.job,
            status: "pending",
            lastDispatchUrl: "",
            lastDispatchAt: 0,
            dispatching: false,
          });
          sendResponseSafe(sendResponse, { ok: true });
        } catch (error) {
          sendResponseSafe(sendResponse, {
            ok: false,
            message: error instanceof Error ? error.message : "扩展本地发布启动失败",
          });
        }
      })();
      return true;
    }

    if (payload?.action === "OPEN_ACCOUNT_HOME") {
      void (async () => {
        try {
          if (!String(payload.authPayload || "").trim()) {
            throw new Error("扩展未收到账号登录态，无法切换到指定账号");
          }

          await clearPlatformCookies(payload.platform);
          await applyPlatformAuthPayload(payload.platform, payload.authPayload, null);
          await chrome.tabs.create({
            url: payload.loginUrl,
            active: true,
          });
          sendResponseSafe(sendResponse, { ok: true });
        } catch (error) {
          sendResponseSafe(sendResponse, {
            ok: false,
            message: error instanceof Error ? error.message : "扩展打开指定账号页面失败",
          });
        }
      })();
      return true;
    }
  }

  if (message?.type === "AI_SUPERWEB_PLATFORM_PAGE_READY" && message.payload?.platform) {
    const loginSession = getActiveSessionByPlatform(message.payload.platform);
    if (loginSession && sender.tab?.id) {
      loginSession.loginTabId = sender.tab.id;
    }
    scheduleSync(message.payload.platform, message.payload);

    const publishSession = sender.tab?.id ? getPublishSessionByTabId(sender.tab.id) : null;
    const readyUrl = String(message.payload.url || "");
    const isTerminal =
      publishSession?.status === "success" || publishSession?.status === "failed";
    const isActivePublish =
      publishSession?.status === "running" ||
      publishSession?.status === "dispatching";
    const dispatchedRecently =
      publishSession &&
      publishSession.lastDispatchUrl === readyUrl &&
      Date.now() - Number(publishSession.lastDispatchAt || 0) < 15000;
    debugLog("page-ready", "received", {
      platform: message.payload.platform,
      readyUrl,
      tabId: sender.tab?.id,
      hasPublishSession: Boolean(publishSession),
      publishStatus: publishSession?.status || "",
      dispatchedRecently: Boolean(dispatchedRecently),
    });
    if (
      publishSession &&
      publishSession.platform === message.payload.platform &&
      !isTerminal &&
      !isActivePublish &&
      !dispatchedRecently
    ) {
      publishSession.status = "dispatching";
      publishSession.dispatching = true;
      publishSession.lastDispatchUrl = readyUrl;
      publishSession.lastDispatchAt = Date.now();
      debugLog("dispatch", "execute-publish-send", {
        platform: publishSession.platform,
        jobId: publishSession.job?.id || "",
        tabId: sender.tab?.id,
        readyUrl,
      });
      chrome.tabs.sendMessage(
        sender.tab.id,
        {
          source: "ai-superweb-extension",
          type: "AI_SUPERWEB_EXTENSION_EXECUTE_PUBLISH",
          payload: {
            session: {
              sessionToken: publishSession.sessionToken,
              job: publishSession.job,
            },
          },
        },
        () => {
          const runtimeMessage = chrome.runtime.lastError?.message || "";
          if (
            runtimeMessage &&
            !runtimeMessage.includes("The message port closed before a response was received.")
          ) {
            debugLog("dispatch", "execute-publish-send-failed", {
              platform: publishSession.platform,
              jobId: publishSession.job?.id || "",
              tabId: sender.tab?.id,
              message: runtimeMessage,
            });
            publishSession.status = "pending";
            publishSession.dispatching = false;
            publishSession.lastDispatchUrl = "";
            publishSession.lastDispatchAt = 0;
            notifyPublishError(publishSession, "扩展未能注入本地发布脚本");
            return;
          }
          debugLog("dispatch", "execute-publish-send-accepted", {
            platform: publishSession.platform,
            jobId: publishSession.job?.id || "",
            tabId: sender.tab?.id,
            message: runtimeMessage || "ok",
          });
        },
      );
    } else if (publishSession) {
      debugLog("dispatch", "execute-publish-skipped", {
        platform: publishSession.platform,
        jobId: publishSession.job?.id || "",
        readyUrl,
        isTerminal,
        isActivePublish,
        dispatchedRecently,
        status: publishSession.status,
      });
    }

    sendResponseSafe(sendResponse, { ok: true });
    return true;
  }

  if (message?.type === "AI_SUPERWEB_EXTENSION_PUBLISH_STATUS" && message.payload?.sessionToken) {
    const publishSession = Array.from(activePublishSessions.values()).find(
      (item) => item.sessionToken === message.payload.sessionToken,
    );
    if (publishSession) {
      debugLog("publish-status", "received", {
        platform: publishSession.platform,
        jobId: publishSession.job?.id || "",
        status: message.payload.status,
        sourceUrl: message.payload.sourceUrl || "",
        lastError: message.payload.lastError || "",
      });
      if (message.payload.status === "running") {
        publishSession.status = "running";
        publishSession.dispatching = false;
      }
      if (message.payload.status === "success" || message.payload.status === "failed") {
        publishSession.dispatching = false;
      }
      void syncPublishResult(publishSession, message.payload);
    }
    sendResponseSafe(sendResponse, { ok: true });
    return true;
  }

  return false;
});
