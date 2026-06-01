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
  const descriptor = getPlatformDescriptor(draft.platform);
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
    "平台：今日头条",
    job.accountName ? `账号：${job.accountName}` : "",
    job.publishEntryUrl ? `入口：${job.publishEntryUrl}` : "",
    "已创建今日头条图文发布任务；系统只会在收到明确成功反馈或人工回录后记为成功。",
    "若平台已经收稿，但系统未能自动确认，可回到工作台手动补录结果。",
  ]
    .filter(Boolean)
    .join("\n");
}
