(function () {
  const PAGE_SOURCE = "ai-superweb-page";
  const EXTENSION_SOURCE = "ai-superweb-extension";
  const debugPrefix = "[ai-superweb-content]";
  const publishExecutionState = {
    sessionToken: "",
    pageUrl: "",
    running: false,
  };

  function debugLog(scope, detail, extra) {
    if (typeof extra === "undefined") {
      console.log(`${debugPrefix}[${scope}] ${detail}`);
      return;
    }
    console.log(`${debugPrefix}[${scope}] ${detail}`, extra);
  }

  function emitVideohaoExtensionDebug(hypothesisId, location, msg, data = {}) {
    // #region debug-point K:videohao-web-content
    fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "videohao-extension-load",
        runId: "web-dev",
        hypothesisId,
        location,
        msg: `[DEBUG] ${msg}`,
        data,
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }

  function resolvePlatformFromHost(hostname) {
    if (hostname.includes("xiaohongshu.com")) return "xiaohongshu";
    if (hostname.includes("douyin.com")) return "douyin";
    if (hostname.includes("channels.weixin.qq.com") || hostname.includes("weixin.qq.com")) return "wechat_mp";
    if (hostname.includes("kuaishou.com")) return "kuaishou";
    return null;
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseCountText(value) {
    const normalized = normalize(value).replace(/[,，]/g, "");
    if (!normalized) return null;
    const match = normalized.match(/(\d+(?:\.\d+)?)(万|w|W|k|K)?/);
    if (!match) return null;
    const base = Number(match[1]);
    if (Number.isNaN(base)) return null;
    const unit = match[2];
    if (unit === "万" || unit === "w" || unit === "W") {
      return Math.round(base * 10000);
    }
    if (unit === "k" || unit === "K") {
      return Math.round(base * 1000);
    }
    return Math.round(base);
  }

  function getPageText() {
    const text = normalize(document.body?.innerText || document.body?.textContent || "");
    return text.length > 20000 ? text.slice(0, 20000) : text;
  }

  function findFirstText(selectors) {
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        const text = normalize(node?.innerText || node?.textContent || "");
        if (text && text.length <= 120) {
          return text;
        }
      } catch (_) {
        // ignore invalid selector
      }
    }
    return "";
  }

  function findFirstImageSrc(selectors) {
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        const src = normalize(node?.getAttribute?.("src") || node?.src || "");
        if (src) {
          return src;
        }
      } catch (_) {
        // ignore invalid selector
      }
    }
    return "";
  }

  function pickNameFromTextBlock(text, platform) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((item) => normalize(item))
      .filter(Boolean);
    for (const line of lines) {
      if (line.length > 24) continue;
      if (looksLikePlatformLabel(line, platform)) continue;
      if (/(粉丝|关注|获赞|点赞|作品|数据|平台|创作|服务|矩阵|登录|发布)/.test(line)) continue;
      if (parseCountText(line) !== null) continue;
      if (/\d{3,}/.test(line)) continue;
      return line;
    }
    return "";
  }

  function findNearbyProfileName(selectors, platform) {
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        if (!node) continue;
        let current = node instanceof HTMLElement ? node : node.parentElement;
        let depth = 0;
        while (current && depth < 5) {
          const candidate = pickNameFromTextBlock(current.innerText || current.textContent || "", platform);
          if (candidate) {
            return candidate;
          }
          current = current.parentElement;
          depth += 1;
        }
      } catch (_) {
        // ignore invalid selector
      }
    }
    return "";
  }

  function findMetricCountByLabel(label) {
    const labelNodes = Array.from(document.querySelectorAll("span, div, p"));
    for (const node of labelNodes) {
      const text = normalize(node.textContent || "");
      if (!text || !text.includes(label) || text.length > 40) continue;
      const containers = [
        node.parentElement,
        node.parentElement?.parentElement,
        node.closest?.("li, div, section, article"),
      ].filter(Boolean);
      for (const container of containers) {
        const scopedMetric = normalize(
          container?.querySelector?.(
            ".finder-info-num, [class*='finder-info-num'], .numerical, [class*='numerical']",
          )?.textContent || "",
        );
        const parsedScopedMetric = parseCountText(scopedMetric);
        if (parsedScopedMetric !== null) {
          return parsedScopedMetric;
        }
      }
    }

    const metricContainers = Array.from(document.querySelectorAll("div, li, section, article"));
    for (const container of metricContainers) {
      const text = normalize(container.textContent || "");
      if (!text || !text.includes(label) || text.length > 160) continue;
      const scopedMetric = normalize(
        container.querySelector?.(".finder-info-num, [class*='finder-info-num'], .numerical, [class*='numerical']")
          ?.textContent || "",
      );
      const parsedScopedMetric = parseCountText(scopedMetric);
      if (parsedScopedMetric !== null) {
        return parsedScopedMetric;
      }
    }

    const nodes = Array.from(document.querySelectorAll("span, div, p"));
    for (const node of nodes) {
      const text = normalize(node.textContent || "");
      if (!text || !text.includes(label) || text.length > 80) continue;

      const directCount = parseCountText(text.replace(label, " "));
      if (directCount !== null) {
        return directCount;
      }

      const parent = node.parentElement;
      const nearbyCount = normalize(
        parent?.querySelector?.(".numerical, [class*='numerical'], .finder-info-num, [class*='finder-info-num']")
          ?.textContent || "",
      );
      const parsedNearby = parseCountText(nearbyCount);
      if (parsedNearby !== null) {
        return parsedNearby;
      }

      const siblingText = normalize(parent?.textContent || "");
      const parsedSibling = parseCountText(siblingText.replace(label, " "));
      if (parsedSibling !== null) {
        return parsedSibling;
      }
    }
    return null;
  }

  function extractByRegex(text, regex) {
    const match = text.match(regex);
    return match?.[1]?.trim() || "";
  }

  function normalizeDouyinAccountId(value) {
    const normalized = normalize(value);
    if (!normalized) return "";
    const cleaned = normalized
      .replace(/^抖音号\s*[:：]?\s*/i, "")
      .replace(/^douyin\s*id\s*[:：]?\s*/i, "")
      .trim();
    return /^[A-Za-z0-9_-]{2,}$/.test(cleaned) ? cleaned : "";
  }

  function looksLikePlatformLabel(value, platform) {
    const normalized = normalize(value).toLowerCase();
    const labels = {
      xiaohongshu: ["小红书", "xiaohongshu", "创作服务平台"],
      douyin: ["抖音", "douyin", "创作者平台"],
      wechat_mp: ["视频号", "视频号助手", "channels", "wechat"],
      kuaishou: ["快手", "kuaishou"],
    };
    return (labels[platform] || []).some((label) => normalized.includes(String(label).toLowerCase()));
  }

  function isGenericPlatformText(value, platform) {
    const normalized = normalize(value).toLowerCase();
    if (!normalized) return true;
    if (looksLikePlatformLabel(normalized, platform)) return true;

    const genericLabels = {
      xiaohongshu: [
        "创作服务平台",
        "创作中心",
        "发布中心",
        "内容管理",
        "数据中心",
        "小红书专业号",
      ],
      douyin: ["创作者平台", "创作服务平台"],
      wechat_mp: ["视频号助手", "视频号管理"],
      kuaishou: ["快手创作者服务平台"],
    };

    return (genericLabels[platform] || []).some((label) =>
      normalized.includes(String(label).toLowerCase()),
    );
  }

  function extractNameFromTitle(title, platform) {
    const normalizedTitle = normalize(title);
    if (!normalizedTitle) {
      return null;
    }

    const separators = [" - ", "_", "|", "｜", "—", "–"];
    for (const separator of separators) {
      const parts = normalizedTitle
        .split(separator)
        .map((item) => normalize(item))
        .filter(Boolean);
      const candidate = parts.find((item) => !looksLikePlatformLabel(item, platform));
      if (candidate) {
        return candidate;
      }
    }

    return looksLikePlatformLabel(normalizedTitle, platform) ? null : normalizedTitle;
  }

  function extractProfileFromPageText(text, platform) {
    if (!text) {
      return { accountName: null, displayName: null };
    }

    const compactText = normalize(text);
    const matchers = {
      douyin: [
        {
          account: /抖音号\s*[:：]?\s*([A-Za-z0-9_-]+)/i,
          display: /([^\s]{1,40})\s+抖音号\s*[:：]?\s*[A-Za-z0-9_-]+/i,
        },
        {
          account: /([A-Za-z0-9_-]{4,})\s+获赞\s*\d+\s+关注\s*\d+\s+粉丝\s*\d+/i,
          display: /([^\s]{1,40})\s+[A-Za-z0-9_-]{4,}\s+获赞\s*\d+\s+关注\s*\d+\s+粉丝\s*\d+/i,
        },
      ],
      wechat_mp: [
        {
          account: /视频号ID\s*[:：]?\s*([A-Za-z0-9_-]+)/i,
          display: /([^\s]{1,40})\s+视频号认证/i,
        },
        {
          account:
            /([^\s]{1,40})\s+视频号认证[\s\S]{0,80}?视频号ID\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i,
          display: /([^\s]{1,40})\s+视频号认证[\s\S]{0,80}?视频号ID\s*[:：]?\s*[A-Za-z0-9_-]{4,}/i,
        },
        {
          account: /视频号\s*[:：]?\s*([A-Za-z0-9_-]+)/i,
          display: /视频号名称\s*[:：]?\s*([^\s]{1,40})/i,
        },
        {
          account: /视频号ID\s*[:：]?\s*([A-Za-z0-9_-]+)[\s\S]{0,80}?被赞\s*\d+\s+关注\s*\d+/i,
          display: /([^\s]{1,40})\s+视频号认证[\s\S]{0,40}?视频号ID\s*[:：]?\s*[A-Za-z0-9_-]+/i,
        },
      ],
      xiaohongshu: [
        {
          account: /小红书(?:号|账号)\s*[:：]?\s*([A-Za-z0-9_-]+)/i,
          display: /昵称\s*[:：]?\s*([^\s]{1,40})/i,
        },
        {
          account: /([^\s]{1,40})\s+小红书(?:号|账号)\s*[:：]?\s*([A-Za-z0-9_-]{4,})/i,
          display: /([^\s]{1,40})\s+小红书(?:号|账号)\s*[:：]?\s*[A-Za-z0-9_-]{4,}/i,
        },
        {
          account: /([A-Za-z0-9_-]{4,})\s+(?:粉丝|获赞|收藏)/i,
          display: /([^\s]{1,40})\s+[A-Za-z0-9_-]{4,}\s+(?:粉丝|获赞|收藏)/i,
        },
      ],
      kuaishou: [
        {
          account: /快手号\s*[:：]?\s*([A-Za-z0-9_-]+)/i,
          display: /昵称\s*[:：]?\s*([^\s]{1,40})/i,
        },
        {
          account: /([A-Za-z0-9_-]{4,})\s+(?:获赞|关注|粉丝)/i,
          display: /([^\s]{1,40})\s+[A-Za-z0-9_-]{4,}\s+(?:获赞|关注|粉丝)/i,
        },
      ],
    };

    for (const matcher of matchers[platform] || []) {
      const accountMatch = compactText.match(matcher.account);
      const accountName = normalize(accountMatch?.[2] || accountMatch?.[1] || "");
      const displayName = matcher.display ? normalize(compactText.match(matcher.display)?.[1] || "") : "";
      if (accountName || displayName) {
        return {
          accountName: accountName || null,
          displayName:
            displayName && !looksLikePlatformLabel(displayName, platform) ? displayName : null,
        };
      }
    }

    return { accountName: null, displayName: null };
  }

  function findAncestorTextBlock(node, anchor) {
    let current = node instanceof HTMLElement ? node : node?.parentElement;
    while (current) {
      const text = normalize(current.innerText || current.textContent || "");
      if (text.includes(String(anchor)) && text.length >= 8 && text.length <= 240) {
        return text;
      }
      current = current.parentElement;
    }
    return "";
  }

  function findTextBlockByAnchors(anchors) {
    const nodes = Array.from(document.querySelectorAll("div, span, p, h2, h3"));
    for (const anchor of anchors) {
      for (const node of nodes) {
        const text = normalize(node.innerText || node.textContent || "");
        if (!text || !text.includes(anchor)) continue;
        const blockText = findAncestorTextBlock(node, anchor);
        if (blockText) return blockText;
      }
    }
    return "";
  }

  function extractProfile(platform) {
    const pageText = getPageText();
    const anchors = {
      xiaohongshu: ["小红书号", "小红书账号"],
      douyin: ["抖音号"],
      wechat_mp: ["视频号ID", "视频号 Id", "视频号"],
      kuaishou: ["快手号"],
    };
    const anchoredBlockText = findTextBlockByAnchors(anchors[platform] || []);
    const anchoredText = anchoredBlockText || pageText;

    const directDisplayName =
      findFirstText(
        {
          xiaohongshu: [
            ".account-name",
            "div.account-name",
            "div.account-name[data-v-bf295dc2]",
            "[class*='user-name']",
            "[class*='username']",
            "[class*='nickname']",
            "[class*='account-name']",
          ],
          douyin: [
            "div.name-_lSSDc",
            "[data-e2e*='user-name']",
            "[class*='creator-name']",
            "[class*='nickname']",
            "[class*='user-name']",
          ],
          wechat_mp: [
            "h2.finder-nickname",
            ".finder-nickname",
            "[class*='finder-nickname']",
            ".weui-desktop-account__info-name",
            ".finder_account_name",
            ".account_meta_primary",
            "[class*='finder'] [class*='name']",
            "[class*='account'] [class*='name']",
            "[class*='name']",
          ],
          kuaishou: [
            "div.user-info-name",
            "[class*='account-name']",
            "[class*='user-name']",
            "[class*='nickname']",
            "[class*='profile'] [class*='name']",
            "[class*='name']",
          ],
        }[platform] || [],
      ) || null;
    const directAccountName =
      platform === "douyin"
        ? normalizeDouyinAccountId(
            findFirstText([
              "div.unique_id-EuH8eA",
              "[class*='unique_id-']",
              "[class*='unique-id']",
              "[class*='douyin-id']",
            ]),
          ) || null
        : null;

    const profileFromAnchoredText =
      platform === "douyin" ? { accountName: null, displayName: null } : extractProfileFromPageText(anchoredText, platform);
    const profileFromPageText =
      platform === "douyin" ? { accountName: null, displayName: null } : extractProfileFromPageText(pageText, platform);
    const titleFallback =
      platform === "xiaohongshu" || platform === "douyin"
        ? null
        : extractNameFromTitle(document.title || "", platform);
    const displayName =
      directDisplayName ||
      profileFromAnchoredText.displayName ||
      profileFromPageText.displayName ||
      titleFallback ||
      null;
    const accountName =
      directAccountName ||
      profileFromAnchoredText.accountName ||
      profileFromPageText.accountName ||
      displayName ||
      titleFallback ||
      null;

    const avatarUrl =
      platform === "xiaohongshu"
        ? findFirstImageSrc([
            "img[src*='img.xiaohongshu.com/avatar']",
            "img[src*='/avatar/']",
            ".avatar img",
            "[class*='avatar'] img",
            "[class*='user'] img",
          ]) || null
        : platform === "douyin"
          ? findFirstImageSrc([
              "img.img-PeynF_",
              "img[src*='aweme-avatar']",
              "img[src*='douyinpic.com/aweme/']",
            ]) || null
        : platform === "wechat_mp"
          ? findFirstImageSrc([
              "img.avatar",
              "img[src*='wx.qlogo.cn/finderhead/']",
              "[class*='finder'] img.avatar",
              "[class*='finder'] [class*='avatar'] img",
              ".weui-desktop-account__info img",
            ]) || null
          : null;
    const followerCount =
      platform === "xiaohongshu" || platform === "wechat_mp"
        ? findMetricCountByLabel("粉丝")
        : platform === "douyin"
          ? parseCountText(
              findFirstText([
                "span.number-No6ev9",
                "[class*='fans'] span.number-No6ev9",
                "[class*='follower'] span.number-No6ev9",
              ]),
            ) ||
            findMetricCountByLabel("粉丝")
          : null;

    const normalizedDisplayName =
      displayName && !isGenericPlatformText(displayName, platform) ? displayName : null;
    const normalizedAccountName =
      accountName && !isGenericPlatformText(accountName, platform) ? accountName : null;
    return {
      accountName: normalizedAccountName || normalizedDisplayName,
      displayName: normalizedDisplayName,
      avatarUrl,
      followerCount,
    };
  }

  // #region debug-point K:content-script-ready
  emitVideohaoExtensionDebug("K", "content.js:init", "content script booted", {
    href: window.location.href,
    hostname: window.location.hostname,
    title: document.title || "",
  });
  // #endregion

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE || data.type !== "AI_SUPERWEB_EXTENSION_REQUEST") {
      return;
    }

    // #region debug-point L:page-message-forward
    emitVideohaoExtensionDebug("L", "content.js:window-message", "content script received page request", {
      href: window.location.href,
      requestId: data.requestId || "",
      action: data.payload?.action || "",
    });
    // #endregion
    chrome.runtime.sendMessage(
      {
        type: "AI_SUPERWEB_FROM_PAGE",
        requestId: data.requestId,
        payload: data.payload,
      },
      (response) => {
        // #region debug-point L:page-message-response
        emitVideohaoExtensionDebug("L", "content.js:window-message:callback", "content script received background response", {
          href: window.location.href,
          requestId: data.requestId || "",
          ok: Boolean(response?.ok),
          runtimeError: chrome.runtime.lastError?.message || "",
          responseMessage: response?.message || "",
        });
        // #endregion
        window.postMessage(
          {
            source: EXTENSION_SOURCE,
            type: "AI_SUPERWEB_EXTENSION_RESPONSE",
            requestId: data.requestId,
            payload: response ?? {
              ok: false,
              message: chrome.runtime.lastError?.message || "扩展未返回结果",
            },
          },
          window.location.origin,
        );
      },
    );
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.source !== EXTENSION_SOURCE) {
      return;
    }

    if (message.type === "AI_SUPERWEB_EXTENSION_EXECUTE_PUBLISH" && message.payload?.session) {
      const session = message.payload.session;
      const currentUrl = window.location.href;
      debugLog("publish", "execute-message-received", {
        currentUrl,
        sessionToken: String(session.sessionToken || "").slice(0, 12),
        running: publishExecutionState.running,
        rememberedUrl: publishExecutionState.pageUrl,
      });
      if (
        publishExecutionState.running &&
        publishExecutionState.sessionToken === session.sessionToken &&
        publishExecutionState.pageUrl === currentUrl
      ) {
        debugLog("publish", "execute-message-skipped-same-session", {
          currentUrl,
          sessionToken: String(session.sessionToken || "").slice(0, 12),
        });
        return;
      }

      publishExecutionState.sessionToken = session.sessionToken;
      publishExecutionState.pageUrl = currentUrl;
      publishExecutionState.running = true;
      const sendStatus = async (payload) => {
        const profile = extractProfile(platform);
        debugLog("publish-status", "send", {
          status: payload?.status || "",
          sourceUrl: payload?.sourceUrl || window.location.href,
          lastError: payload?.lastError || "",
        });
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: "AI_SUPERWEB_EXTENSION_PUBLISH_STATUS",
              payload: {
                sessionToken: session.sessionToken,
                ...payload,
                accountName: profile.accountName,
                displayName: profile.displayName,
              },
            },
            () => resolve(undefined),
          );
        });
      };

      void globalThis.AISuperWebPublishAutomation.executePublishSession(session, sendStatus)
        .catch(async (error) => {
          debugLog("publish", "execute-failed", {
            currentUrl: window.location.href,
            message: error instanceof Error ? error.message : "扩展本地发布失败",
          });
          await sendStatus({
            status: "failed",
            lastError: error instanceof Error ? error.message : "扩展本地发布失败",
            sourceUrl: window.location.href,
          });
        })
        .finally(() => {
          debugLog("publish", "execute-finished", {
            currentUrl: window.location.href,
            sessionToken: String(session.sessionToken || "").slice(0, 12),
          });
          publishExecutionState.running = false;
        });
      return;
    }

    window.postMessage(message, window.location.origin);
  });

  const platform = resolvePlatformFromHost(window.location.hostname);
  if (!platform) {
    return;
  }

  const notifyPageReady = () => {
    const profile = extractProfile(platform);
    debugLog("page-ready", "send", {
      platform,
      url: window.location.href,
      title: document.title || "",
      accountName: profile.accountName,
      displayName: profile.displayName,
    });
    chrome.runtime.sendMessage({
      type: "AI_SUPERWEB_PLATFORM_PAGE_READY",
      payload: {
        platform,
        url: window.location.href,
        title: document.title || "",
        accountName: profile.accountName,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        followerCount: profile.followerCount,
        authStorage:
          platform === "wechat_mp"
            ? {
                localStorage: Object.fromEntries(Object.keys(window.localStorage || {}).map((key) => [key, window.localStorage.getItem(key) || ""])),
                sessionStorage: Object.fromEntries(Object.keys(window.sessionStorage || {}).map((key) => [key, window.sessionStorage.getItem(key) || ""])),
              }
            : undefined,
      },
    });
  };

  notifyPageReady();
  window.addEventListener("load", notifyPageReady, { once: true });
  setTimeout(notifyPageReady, 2500);
  setTimeout(notifyPageReady, 6000);
})();
