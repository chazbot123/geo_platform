import { NextResponse } from "next/server";
import {
  confirmMediumRiskContentPoolItem,
  disperseContentPoolItem,
  retryAllFailedContentPoolImages,
  retryContentPoolItemImage,
  startRetryAllFailedContentPoolImages,
  updateContentPoolItemImageCount,
  rewriteContentPoolItem,
} from "@/lib/content/service";
import { getContentPool, listContentPools } from "@/lib/storage/data-store";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const taskId = url.searchParams.get("taskId");
    if (!id) {
      return NextResponse.json({ error: "缺少文章 ID。" }, { status: 400 });
    }

    const records = taskId ? [await getContentPool(taskId)] : await listContentPools();
    const record = records.filter(Boolean).find((item) => item?.items.some((contentItem) => contentItem.id === id));
    const contentItem = record?.items.find((item) => item.id === id);
    if (!record || !contentItem) {
      return NextResponse.json({ error: "文章不存在。" }, { status: 404 });
    }

    return NextResponse.json({ item: contentItem, taskId: record.taskId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取文章详情失败。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      taskId?: string;
      itemId?: string;
      action?: "rewrite" | "confirm_medium" | "disperse" | "update_image_count" | "retry_image" | "retry_all_failed_images" | "retry_all_failed_images_async";
      expectedImageCount?: number;
      imageId?: string;
    };
    if (!body.taskId || !body.action || (body.action !== "retry_all_failed_images" && body.action !== "retry_all_failed_images_async" && !body.itemId)) {
      return NextResponse.json({ error: "缺少内容项或操作类型。" }, { status: 400 });
    }

    const record =
      body.action === "retry_all_failed_images_async"
        ? await startRetryAllFailedContentPoolImages(body.taskId)
        : body.action === "retry_all_failed_images"
        ? await retryAllFailedContentPoolImages(body.taskId)
        : body.action === "retry_image"
        ? await retryContentPoolItemImage(body.taskId, body.itemId!, body.imageId || "")
        : body.action === "update_image_count"
        ? await updateContentPoolItemImageCount(body.taskId, body.itemId!, body.expectedImageCount)
        : body.action === "rewrite"
        ? await rewriteContentPoolItem(body.taskId, body.itemId!)
        : body.action === "confirm_medium"
          ? await confirmMediumRiskContentPoolItem(body.taskId, body.itemId!)
          : await disperseContentPoolItem(body.taskId, body.itemId!);

    return body.action === "retry_all_failed_images" || body.action === "retry_all_failed_images_async" ? NextResponse.json(record) : NextResponse.json({ current: record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "内容项处理失败。" }, { status: 500 });
  }
}
