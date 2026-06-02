import {
  createRecordId,
  deletePublishingDraftsByTask,
  deletePublishingJobsByTask,
  getPublishingDraft,
  getPublishingDraftsByTask,
  getPublishingJobsByTask,
  savePublishingDraft,
} from "@/lib/storage/data-store";
import { listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { ensureAccountPublishingDrafts } from "@/lib/publish/publish-orchestrator";
import { getPlatformsBySearchProvider } from "@/lib/publish/provider-platform-matrix";
import { normalizeToutiaoTitle } from "@/lib/publish/toutiao-title";
import { getTaskBundle, listTaskBundles } from "@/lib/tasks/service";
import { getPlatformDescriptor, publishPlatformDescriptors } from "@/lib/publish/platforms";
import type { PlatformAccountRecord, PublishWorkbenchData, PublishingDraft, SocialPlatform, TaskBundle } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
  return getPlatformDescriptor(platform)?.label ?? platform;
}

function buildSourceBody(bundle: TaskBundle) {
  const content = bundle.content;
  const structured: string[] = [];

  const introduction = (content?.reportIntroduction ?? "").trim();
  if (introduction) {
    structured.push(introduction);
  }
  for (const section of content?.reportSections ?? []) {
    const body = (section?.body ?? "").trim();
    if (body) {
      structured.push(body);
    }
  }
  const conclusion = (content?.reportConclusion ?? "").trim();
  if (conclusion) {
    structured.push(conclusion);
  }

  return structured.length > 0
    ? structured.join("\n\n")
    : [compactText(content?.summary ?? ""), (content?.content ?? "").trim()].filter(Boolean).join("\n\n");
}

function buildDraftTitle(bundle: TaskBundle, platform: SocialPlatform) {
  const productName = compactText(bundle.product.productName);
  const keyword = compactText(bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? productName);
  const sourceTitle = bundle.content?.title?.trim();
  const platformLabel = platformTitlePrefix(platform);

  if (platform === "weibo") {
    return `${keyword || productName}，怎么判断更靠谱？`;
  }
  if (platform === "douyin" || platform === "videohao") {
    return `${keyword || productName}，先看这几个判断点`;
  }

  const titleCandidates = [
    sourceTitle ? (platform === "toutiao" ? sourceTitle : `${sourceTitle}｜${platformLabel}`) : "",
    `${keyword}：${productName}${bundle.product.category}分析报告`,
    platform === "zhihu"
      ? `${keyword || productName}怎么判断更合适？`
      : `${productName}${bundle.product.category}怎么选`,
    `${productName}${platform === "wechat" ? "实用拆解" : "值不值得进一步了解"}`,
  ].filter((item): item is string => Boolean(item));

  for (const candidate of titleCandidates) {
    const next = platform === "toutiao" ? normalizeToutiaoTitle(candidate, `${productName}分析报告`) : candidate;
    if (!next?.trim()) continue;
    return next;
  }

  return platform === "toutiao" ? normalizeToutiaoTitle(`${productName}分析报告`) : `${productName}｜${platformLabel}`;
}

function splitIntoParagraphs(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [] as string[];
  }

  const byNewline = normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const paragraphs: string[] = [];

  for (const block of byNewline) {
    if (block.length <= 120) {
      paragraphs.push(block);
      continue;
    }
    // 长段落按句末标点切分，累积到 >120 字符再断段，避免碎句
    const sentences = block.match(/[^。！？!?]*[。！？!?]+|[^。！？!?]+$/g) ?? [block];
    let buffer = "";
    for (const sentence of sentences) {
      buffer += sentence;
      if (buffer.length >= 120) {
        paragraphs.push(buffer.trim());
        buffer = "";
      }
    }
    if (buffer.trim()) {
      paragraphs.push(buffer.trim());
    }
  }

  return paragraphs;
}

function trimForPlatform(body: string, platform: SocialPlatform) {
  const normalized = body.trim();
  if (!normalized) {
    return "";
  }
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
  if (platform === "toutiao") {
    return splitIntoParagraphs(normalized).join("\n\n");
  }
  return normalized;
}

function buildDraftBody(bundle: TaskBundle, platform: SocialPlatform) {
  return trimForPlatform(buildSourceBody(bundle), platform);
}

function getDraftImages(bundle: TaskBundle) {
  const imageItems = bundle.image?.images ?? [];
  if (imageItems.length > 0) {
    return imageItems.map((item) => item.url);
  }
  if (bundle.image?.url) {
    return [bundle.image.url];
  }
  return [];
}

function getDraftLocalImagePaths(bundle: TaskBundle) {
  const imageItems = bundle.image?.images ?? [];
  return imageItems.map((item) => item.localPath).filter((item): item is string => Boolean(item));
}

function getDraftCoverImage(bundle: TaskBundle) {
  const imageItems = bundle.image?.images ?? [];
  if (imageItems.length > 0) {
    return imageItems[0]?.url;
  }
  return bundle.image?.url;
}

function buildDraft(bundle: TaskBundle, platform: SocialPlatform): PublishingDraft {
  const descriptor = getPlatformDescriptor(platform);
  const title = buildDraftTitle(bundle, platform);
  const body = buildDraftBody(bundle, platform);
  const tags = extractTags(
    [
      bundle.theme?.selectedKeywordTheme,
      ...(bundle.theme?.selectedKeywords ?? []),
      bundle.theme?.selectedKeyword,
      bundle.theme?.mainKeyword,
      bundle.product.category,
      bundle.product.brandTone,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const imageUrls = getDraftImages(bundle);
  const localImagePaths = getDraftLocalImagePaths(bundle);
  const hasImages = imageUrls.length > 0;

  return {
    id: createRecordId(),
    taskId: bundle.task.id,
    platform,
    title,
    body,
    tags,
    coverImageUrl: getDraftCoverImage(bundle),
    imageUrls,
    localImagePaths,
    publishMode: hasImages ? "with_images" : "text_only",
    publishEntryUrl: descriptor?.publishEntryUrl,
    updatedAt: now(),
  };
}

function shouldRefreshDraft(draft: PublishingDraft, bundle: TaskBundle, platform: SocialPlatform) {
  const legacyTitle = bundle.content?.title ?? `${bundle.product.productName} 发布草稿`;
  const legacyBody = bundle.content?.content?.trim() ?? "";
  const nextCandidate = buildDraft(bundle, platform);
  const nextTags = extractTags(
    [bundle.theme?.selectedKeywordTheme, ...(bundle.theme?.selectedKeywords ?? []), bundle.product.category, bundle.product.brandTone]
      .filter(Boolean)
      .join(" "),
  );
  const currentLocalImagePaths = draft.localImagePaths ?? [];

  return (
    draft.title === legacyTitle ||
    draft.body === legacyBody ||
    (!draft.title.trim() && !draft.body.trim()) ||
    draft.title !== nextCandidate.title ||
    draft.body !== nextCandidate.body ||
    nextTags.join("|") !== draft.tags.join("|") ||
    nextCandidate.imageUrls.join("|") !== draft.imageUrls.join("|") ||
    nextCandidate.localImagePaths.join("|") !== currentLocalImagePaths.join("|") ||
    draft.publishMode !== nextCandidate.publishMode ||
    draft.publishEntryUrl !== nextCandidate.publishEntryUrl
  );
}

function dedupeDraftsByPlatform(drafts: PublishingDraft[], platforms: SocialPlatform[]) {
  const latestDraftByPlatform = new Map<SocialPlatform, PublishingDraft>();
  for (const draft of drafts) {
    if (!platforms.includes(draft.platform as SocialPlatform)) {
      continue;
    }
    const platform = draft.platform as SocialPlatform;
    const current = latestDraftByPlatform.get(platform);
    if (!current || new Date(draft.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
      latestDraftByPlatform.set(platform, draft);
    }
  }
  return latestDraftByPlatform;
}

async function ensureTaskDrafts(bundle: TaskBundle) {
  const searchProvider = bundle.task.searchProvider ?? bundle.theme?.searchProvider;
  const targetPlatforms = getPlatformsBySearchProvider(searchProvider);
  const existingDrafts = await getPublishingDraftsByTask(bundle.task.id);
  const latestDraftByPlatform = dedupeDraftsByPlatform(existingDrafts, targetPlatforms);
  const normalizedDrafts: PublishingDraft[] = [];

  for (const platform of targetPlatforms) {
    const existing = latestDraftByPlatform.get(platform);
    if (!existing) {
      const createdDraft = await savePublishingDraft(buildDraft(bundle, platform));
      normalizedDrafts.push(createdDraft);
      continue;
    }

    if (!shouldRefreshDraft(existing, bundle, platform)) {
      normalizedDrafts.push(existing);
      continue;
    }

    const candidate = buildDraft(bundle, platform);
    const refreshedDraft: PublishingDraft = {
      ...existing,
      ...candidate,
      id: existing.id,
      accountId: existing.accountId,
      accountIds: existing.accountIds,
      updatedAt: now(),
    };
    await savePublishingDraft(refreshedDraft);
    normalizedDrafts.push(refreshedDraft);
  }

  return normalizedDrafts.sort((left, right) => targetPlatforms.indexOf(left.platform as SocialPlatform) - targetPlatforms.indexOf(right.platform as SocialPlatform));
}

async function ensureDraftAccountBindings(drafts: PublishingDraft[], accounts: PlatformAccountRecord[]) {
  const nextDrafts = await Promise.all(
    drafts.map(async (draft) => {
      if (draft.accountIds?.length || draft.accountId) {
        return draft;
      }

      const candidates = accounts.filter((account) => account.platform === draft.platform);
      if (candidates.length !== 1) {
        return draft;
      }

      const nextDraft: PublishingDraft = {
        ...draft,
        accountId: candidates[0].id,
        accountIds: [candidates[0].id],
        updatedAt: now(),
      };
      await savePublishingDraft(nextDraft);
      return nextDraft;
    }),
  );
  return nextDrafts.sort((left, right) => left.platform.localeCompare(right.platform));
}

export async function updatePublishingDraftRecord(draftId: string, patch: Partial<PublishingDraft>) {
  const current = await getPublishingDraft(draftId);
  if (!current) {
    throw new Error("草稿不存在");
  }
  const normalizedTitle =
    current.platform === "toutiao"
      ? normalizeToutiaoTitle(
          typeof patch.title === "string" ? patch.title : current.title,
          current.title || `${current.platform}发布草稿`,
        )
      : patch.title;
  const nextDraft: PublishingDraft = {
    ...current,
    ...patch,
    title: typeof normalizedTitle === "string" ? normalizedTitle : current.title,
    localImagePaths: Array.isArray(patch.localImagePaths) ? patch.localImagePaths : (current.localImagePaths ?? []),
    publishMode: patch.publishMode ?? current.publishMode ?? "text_only",
    updatedAt: now(),
  };
  await savePublishingDraft(nextDraft);
  return nextDraft;
}

export async function getWorkbenchData(taskId: string): Promise<PublishWorkbenchData | null> {
  const bundle = await getTaskBundle(taskId);
  if (!bundle) {
    return null;
  }

  const [drafts, accounts, jobs] = await Promise.all([
    ensureTaskDrafts(bundle),
    listAuthenticatedPlatformAccounts(),
    getPublishingJobsByTask(taskId),
  ]);
  const accountDrafts = await ensureAccountPublishingDrafts(bundle);
  const normalizedDrafts = await ensureDraftAccountBindings(drafts, accounts);
  const visibleJobs = jobs.filter((job) => publishPlatformDescriptors.some((item) => item.key === job.platform));

  return {
    taskId,
    task: bundle.task,
    product: bundle.product,
    content: bundle.content,
    image: bundle.image,
    publish: bundle.publish,
    drafts: normalizedDrafts,
    accountDrafts,
    accounts,
    jobs: visibleJobs.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
  };
}

export async function listWorkbenchTasks() {
  const bundles = await listTaskBundles();
  return bundles.filter((bundle) => bundle.content || bundle.image);
}

export async function clearWorkbenchPublishData(taskId: string) {
  await Promise.all([
    deletePublishingJobsByTask(taskId),
    deletePublishingDraftsByTask(taskId),
  ]);
}
