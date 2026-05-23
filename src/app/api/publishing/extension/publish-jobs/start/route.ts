import { NextResponse } from "next/server";
import { startExtensionPublishSession } from "@/lib/publish/extension-session-service";

export async function POST(request: Request) {
  try {
    const { jobId } = (await request.json()) as { jobId: string };
    if (!jobId?.trim()) {
      return NextResponse.json({ message: "缺少发布任务 ID。" }, { status: 400 });
    }
    const session = await startExtensionPublishSession(jobId);
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "创建扩展发布会话失败。" }, { status: 500 });
  }
}
