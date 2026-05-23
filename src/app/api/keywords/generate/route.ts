import { NextResponse } from "next/server";
import { generateKeywordsForTask } from "@/lib/keywords/service";

export async function POST(request: Request) {
  try {
    const { taskId } = (await request.json()) as { taskId: string };
    const theme = await generateKeywordsForTask(taskId);
    return NextResponse.json({ theme });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成关键词失败。" }, { status: 500 });
  }
}