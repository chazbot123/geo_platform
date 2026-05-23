import { NextResponse } from "next/server";
import { confirmKeyword } from "@/lib/keywords/service";

export async function POST(request: Request) {
  try {
    const { taskId, selectedKeyword } = (await request.json()) as { taskId: string; selectedKeyword: string };
    const theme = await confirmKeyword(taskId, selectedKeyword);
    return NextResponse.json({ theme });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "确认关键词失败。" }, { status: 500 });
  }
}