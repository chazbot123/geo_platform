import { NextResponse } from "next/server";
import type { LicenseActivationPayload } from "@/lib/license/client";
import { resolveLicenseEndpoint } from "@/lib/license/server-endpoints";

export const runtime = "nodejs";

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

    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === "string" ? result.error : "授权服务暂时不可用" },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "授权激活失败，请稍后重试" },
      { status: 502 },
    );
  }
}
