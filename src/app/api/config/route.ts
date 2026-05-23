import { NextResponse } from "next/server";
import { getAppConfig, updateAppConfig } from "@/lib/config/service";
import type { AppConfig } from "@/lib/types";

export async function GET() {
  const config = await getAppConfig();
  return NextResponse.json({ config });
}

export async function POST(request: Request) {
  try {
    const config = (await request.json()) as AppConfig;
    const saved = await updateAppConfig(config);
    return NextResponse.json({ config: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "配置保存失败" }, { status: 500 });
  }
}