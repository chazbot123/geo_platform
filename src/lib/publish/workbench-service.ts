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
import {
  buildDraftBody,
  buildDraftTitle,
  buildTagsFromBundle,
  getDraftCoverImage,
  getDraftImages,
  getDraftLocalImagePaths,
} from "@/lib/publish/draft-builders";
import type { PlatformAccountRecord, PublishWorkbenchData, PublishingDraft, SocialPlatform, TaskBundle } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function buildDraft(bundle: TaskBundle, platform: SocialPlatform): PublishingDraft {
  const descriptor = getPlatformDescriptor(platform);
  const title = buildDraftTitle(bundle, platform);
  const body = buildDraftBody(bundle, platform);
  const tags = buildTagsFromBundle(bundle);
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
  const nextTags = buildTagsFromBundle(bundle);
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
