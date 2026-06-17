import { NextResponse } from "next/server";
import {
  getPublishExecutionState,
  markArticleManualNotPublished,
  markArticleManualPublished,
  repairPublishingJobAccountBinding,
  runNextPublishArticle,
} from "@/lib/publish/execution-service";
import { runDuePublishingJobs } from "@/lib/publish/publish-queue-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId") || undefined;
    return NextResponse.json(await getPublishExecutionState(taskId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取发布进度失败。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "run_next" | "mark_manual_published" | "mark_manual_not_published" | "repair_account_binding" | "run_due";
      taskId?: string;
      jobId?: string;
      accountId?: string;
      publishUrl?: string;
    };

    if (body.action === "mark_manual_published") {
      if (!body.jobId) {
        return NextResponse.json({ error: "缺少发布记录 ID。" }, { status: 400 });
      }
      return NextResponse.json(await markArticleManualPublished(body.jobId, body.publishUrl));
    }

    if (body.action === "mark_manual_not_published") {
      if (!body.jobId) {
        return NextResponse.json({ error: "缺少发布记录 ID。" }, { status: 400 });
      }
      return NextResponse.json(await markArticleManualNotPublished(body.jobId));
    }

    if (body.action === "run_due") {
      return NextResponse.json(await runDuePublishingJobs(new Date(), { taskId: body.taskId }));
    }

    if (body.action === "repair_account_binding") {
      if (!body.jobId || !body.accountId) {
        return NextResponse.json({ error: "缺少发布任务或账号。"}, { status: 400 });
      }
      return NextResponse.json(await repairPublishingJobAccountBinding(body.jobId, body.accountId));
    }

    return NextResponse.json(await runNextPublishArticle(body.taskId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "执行发布失败。" },
      { status: 500 },
    );
  }
}
