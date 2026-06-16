import { NextResponse } from "next/server";
import { listHistoricalTaskSummaries } from "@/lib/tasks/history-service";

export async function GET() {
  try {
    return NextResponse.json({ items: await listHistoricalTaskSummaries() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取任务记录失败。" },
      { status: 500 },
    );
  }
}
