import { NextResponse } from "next/server";

export const runtime = "nodejs";

function configuredEndpoint() {
  return process.env.GEO_LICENSE_STATUS_ENDPOINT?.trim() || "";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const deviceFingerprint = requestUrl.searchParams.get("deviceFingerprint")?.trim() || "";
  if (!deviceFingerprint) {
    return NextResponse.json({ error: "缺少设备指纹" }, { status: 400 });
  }

  const endpoint = configuredEndpoint();
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

    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === "string" ? result.error : "授权状态服务暂时不可用" },
        { status: response.status },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "检查授权状态失败，请稍后重试" },
      { status: 502 },
    );
  }
}
