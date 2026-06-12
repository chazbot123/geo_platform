import { NextResponse } from "next/server";
import { resolveLicenseEndpoint } from "@/lib/license/server-endpoints";

export const runtime = "nodejs";

const DEBUG_SERVER_URL = "http://127.0.0.1:7777/event";
const DEBUG_SESSION_ID = "license-activation-failed";

function emitDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>) {
  // #region debug-point shared:emit
  fetch(DEBUG_SERVER_URL, {
    method: "POST",
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const deviceFingerprint = requestUrl.searchParams.get("deviceFingerprint")?.trim() || "";
  // #region debug-point B:status-entry
  emitDebug("B", "api/license/status:entry", "授权状态请求进入服务端", {
    deviceFingerprint,
  });
  // #endregion
  if (!deviceFingerprint) {
    return NextResponse.json({ error: "缺少设备指纹" }, { status: 400 });
  }

  const endpoint = resolveLicenseEndpoint("status");
  if (!endpoint) {
    return NextResponse.json({ error: "授权状态端点未配置" }, { status: 503 });
  }

  const upstreamUrl = new URL(endpoint);
  if (process.env.NODE_ENV === "production" && upstreamUrl.protocol !== "https:") {
    return NextResponse.json({ error: "生产环境授权状态端点必须使用 HTTPS" }, { status: 503 });
  }

  upstreamUrl.searchParams.set("deviceFingerprint", deviceFingerprint);

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    // #region debug-point B:upstream-response
    emitDebug("B", "api/license/status:upstream", "授权状态上游返回", {
      upstreamUrl: upstreamUrl.toString(),
      statusCode: response.status,
      ok: response.ok,
      resultStatus: typeof result.status === "string" ? result.status : null,
      error: typeof result.error === "string" ? result.error : null,
      boundAt:
        typeof result === "object" && result && "binding" in result && typeof result.binding === "object" && result.binding
          ? (result.binding as { boundAt?: string | null }).boundAt ?? null
          : null,
    });
    // #endregion

    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === "string" ? result.error : "授权状态服务暂时不可用" },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    // #region debug-point B:route-error
    emitDebug("B", "api/license/status:error", "授权状态路由异常", {
      error: error instanceof Error ? error.message : String(error),
    });
    // #endregion
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "检查授权状态失败，请稍后重试" },
      { status: 502 },
    );
  }
}
