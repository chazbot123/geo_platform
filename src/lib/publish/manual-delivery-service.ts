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
    hint: descriptor?.hint ?? "当前平台发布脚本尚未补齐，需先接入 Electron 自动化脚本。",
  };
}

export function buildManualDeliveryNotes(job: PublishingJobRecord) {
  const descriptor = getPlatformDescriptor(job.platform);
  const platformLabel = descriptor?.label ?? job.platform;
  return [
    `平台：${platformLabel}`,
    job.accountName ? `账号：${job.accountName}` : "",
    job.publishEntryUrl ? `入口：${job.publishEntryUrl}` : "",
    `已创建${platformLabel}发布任务；系统只会在收到明确成功反馈或人工回录后记为成功。`,
    "若平台已经收稿，但系统未能自动确认，可回到工作台手动补录结果。",
  ]
    .filter(Boolean)
    .join("\n");
}
