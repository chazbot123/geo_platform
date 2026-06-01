import { NextResponse } from "next/server";
import { getPublishingDraft } from "@/lib/storage/data-store";
import { updatePublishingDraftRecord } from "@/lib/publish/workbench-service";

export async function GET(_: Request, context: { params: { draftId: string } }) {
  const draft = await getPublishingDraft(context.params.draftId);
  if (!draft) {
    return NextResponse.json({ error: "草稿不存在。" }, { status: 404 });
  }
  return NextResponse.json({ draft });
}

export async function PATCH(request: Request, context: { params: { draftId: string } }) {
  try {
    const { title, body, tags, accountId, accountIds } = (await request.json()) as {
      title?: string;
      body?: string;
      tags?: string[];
      accountId?: string;
      accountIds?: string[];
    };
    const draft = await updatePublishingDraftRecord(context.params.draftId, {
      title,
      body,
      tags,
      accountId,
      accountIds,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新草稿失败。" }, { status: 500 });
  }
}
