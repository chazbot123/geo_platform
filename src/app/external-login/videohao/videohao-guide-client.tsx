"use client";

import { useEffect, useState } from "react";

const PAGE_SOURCE = "ai-superweb-page";
const EXTENSION_SOURCE = "ai-superweb-extension";

function emitVideohaoWebDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown> = {}) {
  // #region debug-point G:videohao-web-page
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

function createRequestId() {
  return `videohao-login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function VideohaoExternalLoginGuideClient({
  loginUrl,
  sessionToken,
  platform,
}: {
  loginUrl: string;
  sessionToken: string;
  platform: string;
}) {
  const [message, setMessage] = useState("正在清理旧登录态并打开视频号登录页...");
  const [started, setStarted] = useState(false);
  const manualLoginUrl = loginUrl || "https://channels.weixin.qq.com/";

  function openLoginPage(reason: string) {
    setMessage(reason);
    const popup = window.open(manualLoginUrl, "_blank", "noopener,noreferrer");
    emitVideohaoWebDebug("H", "videohao-guide-client.tsx:openLoginPage", "manual login window.open executed", {
      reason,
      manualLoginUrl,
      popupOpened: Boolean(popup),
    });
  }

  useEffect(() => {
    if (!loginUrl || !sessionToken || started) {
      return;
    }

    const requestId = createRequestId();
    setStarted(true);
    emitVideohaoWebDebug("G", "videohao-guide-client.tsx:useEffect:start", "videohao web guide started", {
      loginUrl,
      sessionTokenPresent: Boolean(sessionToken),
      platform,
      requestId,
    });

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data.source !== EXTENSION_SOURCE || data.type !== "AI_SUPERWEB_EXTENSION_RESPONSE" || data.requestId !== requestId) {
        return;
      }

      const payload = data.payload || {};
      emitVideohaoWebDebug("G", "videohao-guide-client.tsx:handleMessage", "extension response received on web guide", {
        requestId,
        ok: Boolean(payload.ok),
        message: String(payload.message || ""),
      });
      if (payload.ok) {
        setMessage(
          String(payload.message || "").trim() ||
            "已清理旧登录态，正在打开视频号登录页...",
        );
        window.setTimeout(() => {
          window.close();
        }, 1200);
        return;
      }

      setMessage(
        String(payload.message || "").trim() ||
          "未检测到浏览器扩展，请先重载扩展后重试，或手动打开视频号登录页。",
      );
    };

    window.addEventListener("message", handleMessage);
    emitVideohaoWebDebug("G", "videohao-guide-client.tsx:postMessage", "posting START_LOGIN to extension bridge", {
      requestId,
      mappedPlatform: platform === "videohao" ? "wechat_mp" : platform,
      origin: window.location.origin,
    });
    window.postMessage(
      {
        source: PAGE_SOURCE,
        type: "AI_SUPERWEB_EXTENSION_REQUEST",
        requestId,
        payload: {
          action: "START_LOGIN",
          platform: platform === "videohao" ? "wechat_mp" : platform,
          apiBaseUrl: window.location.origin,
          forceFreshLogin: true,
          session: {
            sessionId: `videohao-login-${sessionToken}`,
            sessionToken,
            loginUrl,
          },
        },
      },
      window.location.origin,
    );

    const timeoutId = window.setTimeout(() => {
      emitVideohaoWebDebug("H", "videohao-guide-client.tsx:timeout", "extension response timeout on web guide", {
        requestId,
        manualLoginUrl,
      });
      openLoginPage("未收到扩展响应，已直接打开视频号登录页。请完成扫码登录后返回 GEO。");
    }, 5000);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.clearTimeout(timeoutId);
    };
  }, [loginUrl, platform, sessionToken, started]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#08101d",
        color: "#f8fafc",
        padding: "24px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "560px",
          borderRadius: "16px",
          border: "1px solid rgba(148, 163, 184, 0.24)",
          background: "rgba(15, 23, 42, 0.92)",
          padding: "24px",
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.35)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "24px", lineHeight: 1.3 }}>视频号登录准备中</h1>
        <p style={{ margin: "12px 0 0", color: "#cbd5e1", lineHeight: 1.7 }}>{message}</p>
        <p style={{ margin: "12px 0 0", color: "#94a3b8", lineHeight: 1.7 }}>
          为避免外部浏览器直接沿用旧账号，系统会先让扩展清理视频号相关 Cookie，再打开真实登录页。
        </p>
        <a
          href={manualLoginUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            marginTop: "20px",
            color: "#60a5fa",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          手动打开视频号登录页
        </a>
      </section>
    </main>
  );
}
