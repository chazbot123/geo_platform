import { NextResponse } from "next/server";
import { generateContentForTask } from "@/lib/content/service";

export async function POST(request: Request) {
  try {
    const { taskId } = (await request.json()) as { taskId: string };
    const content = await generateContentForTask(taskId);
    return NextResponse.json({ content });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "内容生成失败" }, { status: 500 });
  }
}