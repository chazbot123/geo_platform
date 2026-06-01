import { NextResponse } from "next/server";
import { getAllPlatformAccounts, listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { createPublishingJob, recordPublishingJobResult } from "@/lib/publish/jobs-service";
import { updatePublishingDraftRecord } from "@/lib/publish/workbench-service";
import { getPublishingDraft } from "@/lib/storage/data-store";

export async function POST(request: Request) {
  try {
    const { taskId, items } = (await request.json()) as {
      taskId: string;
      items: Array<{ draftId: string; accountId?: string }>;
    };

    if (!taskId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "缺少发布任务参数。" }, { status: 400 });
    }

    const jobs = [];
    for (const item of items) {
      const draft = await getPublishingDraft(item.draftId);
      if (!draft) {
        return NextResponse.json({ error: "草稿不存在或已失效。" }, { status: 400 });
      }
      if (draft.platform !== "toutiao") {
        return NextResponse.json({ error: "当前发布工作台仅支持创建今日头条发布任务。" }, { status: 400 });
      }
      if (!draft.title.trim() || !draft.body.trim()) {
        return NextResponse.json({ error: "当前任务缺少可发布的文章内容，请先回到第二阶段生成并保存文章后再发布。" }, { status: 400 });
      }

      let resolvedAccountId = item.accountId;
      let authenticatedCount = 0;
      let platformAccountCount = 0;

      const authenticatedAccounts = await listAuthenticatedPlatformAccounts(draft.platform);
      authenticatedCount = authenticatedAccounts.length;
      const authenticatedAccountIds = new Set(authenticatedAccounts.map((account) => account.id));
      const platformAccounts = (await getAllPlatformAccounts()).filter((account) => account.platform === draft.platform);
      platformAccountCount = platformAccounts.length;

      if (!resolvedAccountId && draft.accountId) {
        resolvedAccountId = draft.accountId;
      }

      if (resolvedAccountId && !authenticatedAccountIds.has(resolvedAccountId)) {
        resolvedAccountId = undefined;
      }

      const job = await createPublishingJob({
        taskId,
        draftId: item.draftId,
        accountId: resolvedAccountId,
      });

      if (!job.accountId) {
        const errorMessage =
          authenticatedCount === 0
            ? platformAccountCount > 0
              ? "当前平台已有账号记录，但真实登录态已失效，请先到账号中心重新登录。"
              : "当前平台还没有任何可发布账号，请先到账号中心完成登录。"
            : authenticatedCount > 1
              ? "当前平台存在多个已登录账号，请先在平台草稿中明确选择一个账号。"
              : "今日头条自动发布需要先为平台草稿绑定唯一的已登录账号；若草稿原绑定账号已失效，系统会要求重新确认。";
        jobs.push(
          await recordPublishingJobResult({
            jobId: job.id,
            status: "failed",
            errorMessage,
            failureStage: "account_binding",
          }),
        );
        continue;
      }

      jobs.push(job);
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建发布任务失败。" }, { status: 500 });
  }
}
