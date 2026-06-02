import { NextResponse } from "next/server";
import { getAllPlatformAccounts, listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { createAccountPublishingJob, createPublishingJob, recordPublishingJobResult } from "@/lib/publish/jobs-service";
import { updatePublishingDraftRecord } from "@/lib/publish/workbench-service";
import { getAccountPublishingDraft, getPublishingDraft } from "@/lib/storage/data-store";
import { getPlatformDescriptor } from "@/lib/publish/platforms";

export async function POST(request: Request) {
  try {
    const { taskId, items } = (await request.json()) as {
      taskId: string;
      items: Array<{ draftId?: string; accountId?: string; accountPublishingDraftId?: string }>;
    };

    if (!taskId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "缺少发布任务参数。" }, { status: 400 });
    }

    const jobs = [];
    for (const item of items) {
      if (item.accountPublishingDraftId) {
        const accountDraft = await getAccountPublishingDraft(item.accountPublishingDraftId);
        if (!accountDraft) {
          return NextResponse.json({ error: "账号发布稿不存在或已失效。" }, { status: 400 });
        }
        const descriptor = getPlatformDescriptor(accountDraft.platform);
        if (!descriptor) {
          return NextResponse.json({ error: "账号发布稿所属平台不受支持。" }, { status: 400 });
        }
        if (!accountDraft.title.trim() || !accountDraft.body.trim()) {
          return NextResponse.json({ error: "账号发布稿缺少标题或正文。" }, { status: 400 });
        }

        const authenticatedAccounts = await listAuthenticatedPlatformAccounts(accountDraft.platform);
        const authenticatedAccountIds = new Set(authenticatedAccounts.map((account) => account.id));
        const job = await createAccountPublishingJob({
          taskId,
          accountPublishingDraftId: accountDraft.id,
        });

        if (!authenticatedAccountIds.has(accountDraft.accountId)) {
          jobs.push(
            await recordPublishingJobResult({
              jobId: job.id,
              status: "failed",
              errorMessage: `${descriptor.label}账号未认证或真实登录态已失效，请先到账号中心重新登录。`,
              failureStage: "account_binding",
            }),
          );
          continue;
        }

        if (descriptor.automationStatus !== "ready") {
          jobs.push(
            await recordPublishingJobResult({
              jobId: job.id,
              status: "manual_pending",
              notes: `${descriptor.label} 暂未接入自动发布，请按平台入口手动发布该账号稿。`,
              externalStatus: descriptor.automationStatus,
            }),
          );
          continue;
        }

        jobs.push(job);
        continue;
      }

      if (!item.draftId) {
        return NextResponse.json({ error: "缺少草稿 ID。" }, { status: 400 });
      }
      const draft = await getPublishingDraft(item.draftId);
      if (!draft) {
        return NextResponse.json({ error: "草稿不存在或已失效。" }, { status: 400 });
      }
      const descriptor = getPlatformDescriptor(draft.platform);
      if (!descriptor) {
        return NextResponse.json({ error: "当前草稿所属平台不受支持。" }, { status: 400 });
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

      if (descriptor.automationStatus !== "ready") {
        jobs.push(
          await recordPublishingJobResult({
            jobId: job.id,
            status: "manual_pending",
            notes: `${descriptor.label} 暂未接入自动发布，请按平台入口手动发布该草稿。`,
            externalStatus: descriptor.automationStatus,
          }),
        );
        continue;
      }

      if (!job.accountId) {
        const platformLabel = descriptor.label;
        const errorMessage =
          authenticatedCount === 0
            ? platformAccountCount > 0
              ? `当前${platformLabel}已有账号记录，但真实登录态已失效，请先到账号中心重新登录。`
              : `当前${platformLabel}还没有任何可发布账号，请先到账号中心完成登录。`
            : authenticatedCount > 1
              ? `当前${platformLabel}存在多个已登录账号，请先在平台草稿中明确选择一个账号。`
              : `${platformLabel}自动发布需要先为平台草稿绑定唯一的已登录账号；若草稿原绑定账号已失效，系统会要求重新确认。`;
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
