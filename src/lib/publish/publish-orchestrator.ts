import {
  createRecordId,
  getAccountPublishingDraftsByTask,
  saveAccountPublishingDraft,
} from "@/lib/storage/data-store";
import { listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { getPlatformDescriptor } from "@/lib/publish/platforms";
import { getPlatformsBySearchProvider } from "@/lib/publish/provider-platform-matrix";
import type {
  AccountPublishingDraft,
  PlatformAccountRecord,
  SearchProvider,
  SocialPlatform,
  TaskBundle,
} from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function compactText(value: string | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractTags(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[\s,，。；;!！?？#]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ),
  ).slice(0, 8);
}

function platformTitlePrefix(platform: SocialPlatform) {
  const descriptor = getPlatformDescriptor(platform);
  return descriptor?.label ?? platform;
}

function buildAccountDraftTitle(bundle: TaskBundle, platform: SocialPlatform, account: PlatformAccountRecord) {
  const sourceTitle = compactText(bundle.content?.title);
  const theme = compactText(bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword);
  const productName = compactText(bundle.product.productName);
  const platformLabel = platformTitlePrefix(platform);
  const accountLabel = compactText(account.displayName ?? account.accountName);

  if (platform === "weibo") {
    return `${theme || productName}，怎么判断更靠谱？`;
  }
  if (platform === "douyin" || platform === "videohao") {
    return `${theme || productName}，先看这几个判断点`;
  }
  if (sourceTitle) {
    return platform === "toutiao" ? sourceTitle : `${sourceTitle}｜${platformLabel}`;
  }
  return `${theme || productName}：${platformLabel}${accountLabel ? `-${accountLabel}` : ""}发布稿`;
}

function buildSourceBody(bundle: TaskBundle) {
  const content = bundle.content;
  const structured: string[] = [];

  if (content?.reportIntroduction?.trim()) {
    structured.push(content.reportIntroduction.trim());
  }
  for (const section of content?.reportSections ?? []) {
    if (section.body?.trim()) {
      structured.push(section.body.trim());
    }
  }
  if (content?.reportConclusion?.trim()) {
    structured.push(content.reportConclusion.trim());
  }

  return structured.length
    ? structured.join("\n\n")
    : [content?.summary, content?.content].map(compactText).filter(Boolean).join("\n\n");
}

function trimForPlatform(body: string, platform: SocialPlatform) {
  const normalized = body.trim();
  if (!normalized) return "";

  if (platform === "weibo") {
    return normalized.replace(/\s+/g, " ").slice(0, 480);
  }
  if (platform === "douyin" || platform === "videohao") {
    return normalized
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join("\n");
  }
  if (platform === "csdn") {
    return `## 背景\n\n${normalized}\n\n## 方法建议\n\n请结合实际业务场景补充可验证资料、执行步骤和边界条件。`;
  }
  if (platform === "zhihu") {
    return `先给结论：这个问题需要从场景、判断标准和风险边界一起看。\n\n${normalized}`;
  }
  return normalized;
}

function getDraftImages(bundle: TaskBundle) {
  const imageItems = bundle.image?.images ?? [];
  if (imageItems.length > 0) {
    return imageItems.map((item) => item.url);
  }
  return bundle.image?.url ? [bundle.image.url] : [];
}

function getDraftLocalImagePaths(bundle: TaskBundle) {
  return (bundle.image?.images ?? []).map((item) => item.localPath).filter((item): item is string => Boolean(item));
}

function getDraftCoverImage(bundle: TaskBundle) {
  return bundle.image?.images?.[0]?.url ?? bundle.image?.url;
}

function buildAccountPublishingDraft(
  bundle: TaskBundle,
  account: PlatformAccountRecord,
  searchProvider: SearchProvider,
): AccountPublishingDraft {
  const descriptor = getPlatformDescriptor(account.platform);
  const sourceBody = buildSourceBody(bundle);
  const title = buildAccountDraftTitle(bundle, account.platform, account);
  const body = trimForPlatform(sourceBody, account.platform);
  const imageUrls = getDraftImages(bundle);
  const localImagePaths = getDraftLocalImagePaths(bundle);
  const theme = bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword;

  return {
    id: createRecordId(),
    taskId: bundle.task.id,
    platform: account.platform,
    accountId: account.id,
    accountName: account.displayName ?? account.accountName,
    searchProvider,
    sourceContentTaskId: bundle.content?.taskId,
    sourceTheme: theme,
    title,
    body,
    tags: extractTags([theme, ...(bundle.theme?.selectedKeywords ?? []), bundle.product.category, bundle.product.brandTone].filter(Boolean).join(" ")),
    coverImageUrl: getDraftCoverImage(bundle),
    imageUrls,
    localImagePaths,
    publishMode: imageUrls.length ? "with_images" : "text_only",
    publishEntryUrl: descriptor?.publishEntryUrl,
    styleProfile: descriptor?.contentProfile,
    contentLengthProfile: account.platform,
    updatedAt: now(),
  };
}

function shouldRefreshAccountDraft(draft: AccountPublishingDraft, nextDraft: AccountPublishingDraft) {
  return (
    draft.title !== nextDraft.title ||
    draft.body !== nextDraft.body ||
    draft.tags.join("|") !== nextDraft.tags.join("|") ||
    draft.imageUrls.join("|") !== nextDraft.imageUrls.join("|") ||
    draft.localImagePaths.join("|") !== nextDraft.localImagePaths.join("|") ||
    draft.publishMode !== nextDraft.publishMode ||
    draft.publishEntryUrl !== nextDraft.publishEntryUrl ||
    draft.styleProfile !== nextDraft.styleProfile
  );
}

export async function ensureAccountPublishingDrafts(bundle: TaskBundle) {
  const searchProvider = bundle.task.searchProvider ?? bundle.theme?.searchProvider;
  const targetPlatforms = getPlatformsBySearchProvider(searchProvider);
  const accounts = (await listAuthenticatedPlatformAccounts()).filter((account) => targetPlatforms.includes(account.platform));
  const existingDrafts = await getAccountPublishingDraftsByTask(bundle.task.id);
  const nextDrafts: AccountPublishingDraft[] = [];

  for (const account of accounts) {
    const draftSearchProvider = searchProvider ?? "doubao";
    const candidate = buildAccountPublishingDraft(bundle, account, draftSearchProvider);
    const existing = existingDrafts.find((draft) => draft.accountId === account.id && draft.platform === account.platform);
    if (!existing) {
      const saved = await saveAccountPublishingDraft(candidate);
      nextDrafts.push(saved);
      continue;
    }
    if (!shouldRefreshAccountDraft(existing, candidate)) {
      nextDrafts.push(existing);
      continue;
    }
    const refreshed = await saveAccountPublishingDraft({
      ...existing,
      ...candidate,
      id: existing.id,
      updatedAt: now(),
    });
    nextDrafts.push(refreshed);
  }

  return nextDrafts.sort((left, right) => `${left.platform}-${left.accountName ?? ""}`.localeCompare(`${right.platform}-${right.accountName ?? ""}`));
}
