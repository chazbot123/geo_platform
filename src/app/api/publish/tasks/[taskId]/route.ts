import { NextResponse } from "next/server";
import { getTaskBundle } from "@/lib/tasks/service";

export async function GET(_: Request, context: { params: { taskId: string } }) {
  const bundle = await getTaskBundle(context.params.taskId);
  if (!bundle?.publish) {
    return NextResponse.json({ error: "发布结果不存在。" }, { status: 404 });
  }
  return NextResponse.json({ publish: bundle.publish });
}