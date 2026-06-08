import { NextResponse } from "next/server";
import {
  confirmMediumRiskContentPoolItem,
  disperseContentPoolItem,
  rewriteContentPoolItem,
} from "@/lib/content/service";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId?: string;
      itemId?: string;
      action?: "rewrite" | "confirm_medium" | "disperse";
    };
    if (!body.taskId || !body.itemId || !body.action) {
      return NextResponse.json({ error: "缺少内容项或操作类型。" }, { status: 400 });
    }

    const record =
      body.action === "rewrite"
        ? await rewriteContentPoolItem(body.taskId, body.itemId)
        : body.action === "confirm_medium"
          ? await confirmMediumRiskContentPoolItem(body.taskId, body.itemId)
          : await disperseContentPoolItem(body.taskId, body.itemId);

    return NextResponse.json({ current: record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "内容项处理失败。" }, { status: 500 });
  }
}
