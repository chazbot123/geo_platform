import { NextResponse } from "next/server";
import { getTaskPlanningPrerequisites, savePublishTaskPlan } from "@/lib/tasks/service";
import type { SearchProvider, SocialPlatform } from "@/lib/types";

export async function GET() {
  try {
    const prerequisites = await getTaskPlanningPrerequisites();
    return NextResponse.json(prerequisites);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取任务规划失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId: string;
      searchProvider: SearchProvider;
      enabledPlatforms: SocialPlatform[];
      days: number;
      forceRefreshAccounts?: boolean;
    };
    if (!body.taskId || !body.searchProvider) {
      return NextResponse.json({ error: "缺少任务或 GEO AI 平台。" }, { status: 400 });
    }
    const publishPlan = await savePublishTaskPlan(body);
    return NextResponse.json({ publishPlan });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存任务规划失败。" }, { status: 400 });
  }
}
