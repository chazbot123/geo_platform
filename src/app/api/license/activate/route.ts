import { NextResponse } from "next/server";
import type { LicenseActivationPayload } from "@/lib/license/client";
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

function isActivationPayload(payload: Partial<LicenseActivationPayload>): payload is LicenseActivationPayload {
  return (
    typeof payload.licenseCode === "string" &&
    payload.licenseCode.trim().length > 0 &&
    typeof payload.deviceFingerprint === "string" &&
    payload.deviceFingerprint.trim().length > 0 &&
    typeof payload.machineCode === "string" &&
    typeof payload.deviceLabel === "string" &&
    typeof payload.appVersion === "string"
  );
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<LicenseActivationPayload>;
    // #region debug-point A:payload-received
    emitDebug("A", "api/license/activate:payload", "授权激活请求进入服务端", {
      hasLicenseCode: typeof payload.licenseCode === "string" && payload.licenseCode.trim().length > 0,
      licenseCodeSuffix: typeof payload.licenseCode === "string" ? payload.licenseCode.trim().slice(-8) : null,
      deviceFingerprint: payload.deviceFingerprint ?? null,
      machineCode: payload.machineCode ?? null,
      appVersion: payload.appVersion ?? null,
    });
    // #endregion
    if (!isActivationPayload(payload)) {
      return NextResponse.json({ error: "授权激活参数不完整" }, { status: 400 });
    }

    const endpoint = resolveLicenseEndpoint("activate");
    if (!endpoint) {
      return NextResponse.json({ error: "授权服务端点未配置" }, { status: 503 });
    }

    const upstreamUrl = new URL(endpoint);
    if (process.env.NODE_ENV === "production" && upstreamUrl.protocol !== "https:") {
      return NextResponse.json({ error: "生产环境授权端点必须使用 HTTPS" }, { status: 503 });
    }

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    // #region debug-point A:upstream-response
    emitDebug("A", "api/license/activate:upstream", "授权激活上游返回", {
      upstreamUrl: upstreamUrl.toString(),
      statusCode: response.status,
      ok: response.ok,
      resultStatus: typeof result.status === "string" ? result.status : null,
      error: typeof result.error === "string" ? result.error : null,
      activatedAt:
        typeof result === "object" && result && "license" in result && typeof result.license === "object" && result.license
          ? (result.license as { activatedAt?: string | null }).activatedAt ?? null
          : null,
    });
    // #endregion

    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === "string" ? result.error : "授权服务暂时不可用" },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    // #region debug-point A:route-error
    emitDebug("A", "api/license/activate:error", "授权激活路由异常", {
      error: error instanceof Error ? error.message : String(error),
    });
    // #endregion
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "授权激活失败，请稍后重试" },
      { status: 502 },
    );
  }
}
