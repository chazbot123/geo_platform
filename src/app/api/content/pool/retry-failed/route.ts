import { NextResponse } from "next/server";
import { enqueueRetryFailedContentPoolItems } from "@/lib/content/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { taskId?: string };
    if (!body.taskId) {
      return NextResponse.json({ error: "缺少任务 ID。" }, { status: 400 });
    }

    const result = await enqueueRetryFailedContentPoolItems(body.taskId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "批量重试失败项失败。" }, { status: 500 });
  }
}
