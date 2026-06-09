import { NextResponse } from "next/server";
import { getWorkflowStatus } from "@/lib/workflow/status-service";

export async function GET() {
  try {
    return NextResponse.json(await getWorkflowStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取工作流状态失败。" },
      { status: 500 },
    );
  }
}
