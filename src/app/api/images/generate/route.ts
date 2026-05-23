import { NextResponse } from "next/server";
import { generateImageForTask } from "@/lib/images/service";

export async function POST(request: Request) {
  try {
    const { taskId } = (await request.json()) as { taskId: string };
    const image = await generateImageForTask(taskId);
    return NextResponse.json({ image });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片生成失败" }, { status: 500 });
  }
}