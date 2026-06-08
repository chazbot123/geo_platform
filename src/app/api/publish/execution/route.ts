import { NextResponse } from "next/server";
import {
  getPublishExecutionState,
  markArticleManualPublished,
  runNextPublishArticle,
} from "@/lib/publish/execution-service";

export async function GET() {
  try {
    return NextResponse.json(await getPublishExecutionState());
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
      action?: "run_next" | "mark_manual_published";
      jobId?: string;
      publishUrl?: string;
    };

    if (body.action === "mark_manual_published") {
      if (!body.jobId) {
        return NextResponse.json({ error: "缺少发布记录 ID。" }, { status: 400 });
      }
      return NextResponse.json(await markArticleManualPublished(body.jobId, body.publishUrl));
    }

    return NextResponse.json(await runNextPublishArticle());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "执行发布失败。" },
      { status: 500 },
    );
  }
}
