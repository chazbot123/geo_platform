import { NextResponse } from "next/server";
import { listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { createPublishingJob, recordPublishingJobResult } from "@/lib/publish/jobs-service";
import { updatePublishingDraftRecord } from "@/lib/publish/workbench-service";
import { getPublishingDraft } from "@/lib/storage/data-store";
import type { SocialPlatform } from "@/lib/types";

function isSocialPlatform(platform: string): platform is SocialPlatform {
  return platform !== "blog";
}

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
      let resolvedAccountId = item.accountId;
      let authenticatedCount = 0;

      if (draft && isSocialPlatform(draft.platform)) {
        const authenticatedAccounts = await listAuthenticatedPlatformAccounts(draft.platform);
        authenticatedCount = authenticatedAccounts.length;

        if (!resolvedAccountId && draft.accountId) {
          resolvedAccountId = draft.accountId;
        }

        if (!resolvedAccountId && authenticatedAccounts.length === 1) {
          resolvedAccountId = authenticatedAccounts[0].id;
          await updatePublishingDraftRecord(draft.id, { accountId: resolvedAccountId });
        }
      }

      const job = await createPublishingJob({
        taskId,
        draftId: item.draftId,
        accountId: resolvedAccountId,
      });

      if (!job.accountId) {
        const errorMessage =
          authenticatedCount === 0
            ? "当前平台还没有已登录账号，请先到账号中心完成登录。"
            : authenticatedCount > 1
              ? "当前平台存在多个已登录账号，请先在平台草稿中明确选择一个账号。"
              : "社媒真发布需要先为平台草稿绑定一个已登录账号。";
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
