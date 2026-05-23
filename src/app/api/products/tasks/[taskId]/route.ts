import { NextResponse } from "next/server";
import { getTaskBundle } from "@/lib/tasks/service";

export async function GET(_: Request, context: { params: { taskId: string } }) {
  const bundle = await getTaskBundle(context.params.taskId);
  if (!bundle) {
    return NextResponse.json({ error: "任务不存在。" }, { status: 404 });
  }
  return NextResponse.json(bundle);
}