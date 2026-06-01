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
import { normalizeToutiaoTitle } from "@/lib/publish/toutiao-title";
import { getTaskBundle, listTaskBundles } from "@/lib/tasks/service";
import { getPlatformDescriptor, publishPlatformDescriptors } from "@/lib/publish/platforms";
import type { PlatformAccountRecord, PublishWorkbenchData, PublishingDraft, TaskBundle } from "@/lib/types";

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

function buildToutiaoTitle(bundle: TaskBundle) {
  const productName = compactText(bundle.product.productName);
  const keyword = compactText(bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? productName);
  const titleCandidates = [
    bundle.content?.title?.trim(),
    `${keyword}：${productName}${bundle.product.category}分析报告`,
    `${productName}${bundle.product.category}怎么选`,
    `${productName}值不值得进一步了解`,
  ].filter((item): item is string => Boolean(item));

  for (const candidate of titleCandidates) {
    const next = normalizeToutiaoTitle(candidate, `${productName}分析报告`);
    if (!next) continue;
    return next;
  }

  return normalizeToutiaoTitle(`${productName}分析报告`);
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

function buildToutiaoBody(bundle: TaskBundle) {
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

  const source =
    structured.length > 0
      ? structured.join("\n\n")
      : [compactText(content?.summary ?? ""), (content?.content ?? "").trim()].filter(Boolean).join("\n\n");

  return splitIntoParagraphs(source).join("\n\n");
}

function buildDraftTitle(bundle: TaskBundle) {
  return buildToutiaoTitle(bundle);
}

function buildDraftBody(bundle: TaskBundle) {
  return buildToutiaoBody(bundle);
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

function buildDraft(bundle: TaskBundle): PublishingDraft {
  const descriptor = getPlatformDescriptor("toutiao");
  const title = buildDraftTitle(bundle);
  const body = buildDraftBody(bundle);
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
    platform: "toutiao",
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

function shouldRefreshToutiaoDraft(draft: PublishingDraft, bundle: TaskBundle) {
  const legacyTitle = bundle.content?.title ?? `${bundle.product.productName} 发布草稿`;
  const legacyBody = bundle.content?.content?.trim() ?? "";
  const nextTitle = buildDraftTitle(bundle);
  const nextBody = buildDraftBody(bundle);
  const nextTags = extractTags(
    [bundle.theme?.selectedKeywordTheme, ...(bundle.theme?.selectedKeywords ?? []), bundle.product.category, bundle.product.brandTone]
      .filter(Boolean)
      .join(" "),
  );
  const nextImages = getDraftImages(bundle);
  const nextLocalImagePaths = getDraftLocalImagePaths(bundle);
  const currentLocalImagePaths = draft.localImagePaths ?? [];
  const expectedPublishMode = nextImages.length > 0 ? "with_images" : "text_only";

  return (
    draft.title === legacyTitle ||
    draft.body === legacyBody ||
    (!draft.title.trim() && !draft.body.trim()) ||
    draft.title !== nextTitle ||
    draft.body !== nextBody ||
    nextTags.join("|") !== draft.tags.join("|") ||
    nextImages.join("|") !== draft.imageUrls.join("|") ||
    nextLocalImagePaths.join("|") !== currentLocalImagePaths.join("|") ||
    draft.publishMode !== expectedPublishMode
  );
}

async function ensureTaskDrafts(bundle: TaskBundle) {
  const existingDrafts = await getPublishingDraftsByTask(bundle.task.id);
  if (existingDrafts.length > 0) {
    const normalizedDrafts = await Promise.all(
      existingDrafts.map(async (draft) => {
        if (!shouldRefreshToutiaoDraft(draft, bundle)) {
          return draft;
        }

        const refreshedDraft: PublishingDraft = {
          ...draft,
          title: buildDraftTitle(bundle),
          body: buildDraftBody(bundle),
          tags: extractTags(
            [bundle.theme?.selectedKeywordTheme, ...(bundle.theme?.selectedKeywords ?? []), bundle.product.category, bundle.product.brandTone]
              .filter(Boolean)
              .join(" "),
          ),
          coverImageUrl: getDraftCoverImage(bundle),
          imageUrls: getDraftImages(bundle),
          localImagePaths: getDraftLocalImagePaths(bundle),
          publishMode: getDraftImages(bundle).length > 0 ? "with_images" : "text_only",
          updatedAt: now(),
        };
        await savePublishingDraft(refreshedDraft);
        return refreshedDraft;
      }),
    );

    return normalizedDrafts
      .filter((draft) => publishPlatformDescriptors.some((item) => item.key === draft.platform))
      .sort((left, right) => left.platform.localeCompare(right.platform));
  }

  const drafts = publishPlatformDescriptors.map(() => buildDraft(bundle));
  await Promise.all(drafts.map((draft) => savePublishingDraft(draft)));
  return drafts;
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
