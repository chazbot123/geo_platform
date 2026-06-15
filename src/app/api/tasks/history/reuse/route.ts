import { NextResponse } from "next/server";
import { createTaskFromHistoricalKeywords } from "@/lib/tasks/history-service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { taskId?: string };
    if (!body.taskId?.trim()) {
      return NextResponse.json({ error: "缺少历史任务 ID。" }, { status: 400 });
    }

    const result = await createTaskFromHistoricalKeywords(body.taskId);
    return NextResponse.json({
      taskId: result.task.id,
      sourceTaskId: result.sourceTaskId,
      links: result.links,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "复用历史任务关键词失败。" },
      { status: 400 },
    );
  }
}
