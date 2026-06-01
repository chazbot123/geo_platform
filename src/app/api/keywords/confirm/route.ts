import { NextResponse } from "next/server";
import { confirmKeywords } from "@/lib/keywords/service";

export async function POST(request: Request) {
  try {
    const { taskId, selectedKeywords } = (await request.json()) as { taskId: string; selectedKeywords: string[] };
    if (!taskId || !Array.isArray(selectedKeywords) || !selectedKeywords.length) {
      return NextResponse.json({ error: "缺少任务 ID 或选中的关键词列表。" }, { status: 400 });
    }
    const theme = await confirmKeywords(taskId, selectedKeywords);
    return NextResponse.json({ theme });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "确认关键词失败。" }, { status: 400 });
  }
}
