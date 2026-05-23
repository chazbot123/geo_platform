import { NextResponse } from "next/server";
import { clearWorkbenchPublishData, getWorkbenchData } from "@/lib/publish/workbench-service";

export async function GET(_: Request, context: { params: { taskId: string } }) {
  const data = await getWorkbenchData(context.params.taskId);
  if (!data) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_: Request, context: { params: { taskId: string } }) {
  try {
    const data = await getWorkbenchData(context.params.taskId);
    if (!data) {
      return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
    }

    await clearWorkbenchPublishData(context.params.taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "清空发布数据失败。" }, { status: 500 });
  }
}
