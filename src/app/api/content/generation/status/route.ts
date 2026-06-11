import { NextResponse } from "next/server";
import { getContentGenerationStatus } from "@/lib/content/service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId") || undefined;
    const data = await getContentGenerationStatus(taskId);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取生成进度失败。" }, { status: 500 });
  }
}
