import { NextResponse } from "next/server";
import { getCurrentContentPool, regenerateCurrentContentPool } from "@/lib/content/service";

export async function GET() {
  try {
    const data = await getCurrentContentPool();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取内容池失败。" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const current = await regenerateCurrentContentPool();
    return NextResponse.json({ current });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成内容池失败。" }, { status: 500 });
  }
}
