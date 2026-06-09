import { NextResponse } from "next/server";
import packageJson from "../../../../../package.json";
import { compareVersions } from "@/lib/updates/client";

export const runtime = "nodejs";

function configuredEndpoint() {
  return process.env.GEO_RELEASE_ENDPOINT?.trim() || "";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const currentVersion = requestUrl.searchParams.get("version") || packageJson.version || "0.1.0";
  const platform = requestUrl.searchParams.get("platform") || "win32";
  const arch = requestUrl.searchParams.get("arch") || "x64";
  const endpoint = configuredEndpoint();

  if (!endpoint) {
    return NextResponse.json({ error: "更新服务端点未配置" }, { status: 503 });
  }

  const upstreamUrl = new URL(endpoint);
  if (process.env.NODE_ENV === "production" && upstreamUrl.protocol !== "https:") {
    return NextResponse.json({ error: "生产环境更新端点必须使用 HTTPS" }, { status: 503 });
  }

  upstreamUrl.searchParams.set("platform", platform);
  upstreamUrl.searchParams.set("arch", arch);
  upstreamUrl.searchParams.set("version", currentVersion);

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const result = (await response.json().catch(() => ({}))) as { version?: string; error?: string };

    if (!response.ok) {
      return NextResponse.json(
        { error: result.error ?? "更新服务暂时不可用，请稍后重试。" },
        { status: response.status },
      );
    }

    return NextResponse.json({
      ...result,
      currentVersion,
      updateAvailable: result.version ? compareVersions(result.version, currentVersion) > 0 : false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "检查更新失败，请稍后重试。" },
      { status: 502 },
    );
  }
}
