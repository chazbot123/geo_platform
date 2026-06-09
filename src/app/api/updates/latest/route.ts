import { NextResponse } from "next/server";
import packageJson from "../../../../../package.json";
import { compareVersions } from "@/lib/updates/client";

export const runtime = "nodejs";

const DEFAULT_RELEASE_ENDPOINT = "http://8.134.115.153/api/releases/latest";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const currentVersion = requestUrl.searchParams.get("version") || packageJson.version || "0.1.0";
  const platform = requestUrl.searchParams.get("platform") || "win32";
  const arch = requestUrl.searchParams.get("arch") || "x64";
  const endpoint = process.env.GEO_RELEASE_ENDPOINT ?? DEFAULT_RELEASE_ENDPOINT;
  const upstreamUrl = new URL(endpoint);

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
        { error: result.error ?? "更新服务暂不可用，请稍后重试。" },
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
