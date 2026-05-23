import { NextResponse } from "next/server";
import { updateContentDraft } from "@/lib/content/service";

export async function POST(request: Request) {
  try {
    const { taskId, title, summary, cta, content } = (await request.json()) as { taskId: string; title: string; summary: string; cta: string; content: string };
    const draft = await updateContentDraft(taskId, { title, summary, cta, content });
    return NextResponse.json({ content: draft });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "内容保存失败" }, { status: 500 });
  }
}