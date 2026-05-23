import { getPlatformDescriptor } from "@/lib/publish/platforms";
import type { PlatformAccountRecord, PublishingDraft, PublishingJobRecord } from "@/lib/types";

export interface ManualDeliveryPayload {
  platformLabel: string;
  publishEntryUrl?: string;
  title: string;
  body: string;
  tags: string[];
  imageUrls: string[];
  accountName?: string;
  hint: string;
}

export function buildManualDeliveryPayload(draft: PublishingDraft, account?: PlatformAccountRecord | null): ManualDeliveryPayload {
  const descriptor = draft.platform === "blog" ? undefined : getPlatformDescriptor(draft.platform);
  return {
    platformLabel: descriptor?.label ?? draft.platform,
    publishEntryUrl: draft.publishEntryUrl ?? descriptor?.publishEntryUrl,
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    imageUrls: draft.imageUrls,
    accountName: account?.displayName ?? account?.accountName,
    hint: descriptor?.hint ?? "请复制草稿内容并在平台创作页完成手动发布。",
  };
}

export function buildManualDeliveryNotes(job: PublishingJobRecord) {
  return [
    `平台：${job.platform}`,
    job.accountName ? `账号：${job.accountName}` : "",
    job.publishEntryUrl ? `入口：${job.publishEntryUrl}` : "",
    "已创建发布任务；社媒只有在平台作品列表里再次核验到新内容时，系统才会自动记为成功。",
    "若平台已经收稿，但自动核验没有通过，可回到工作台手动补录结果。",
  ]
    .filter(Boolean)
    .join("\n");
}
