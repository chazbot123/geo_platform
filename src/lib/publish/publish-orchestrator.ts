import {
  createRecordId,
  getAccountPublishingDraftsByTask,
  saveAccountPublishingDraft,
} from "@/lib/storage/data-store";
import { listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { getPlatformDescriptor } from "@/lib/publish/platforms";
import { getPlatformsBySearchProvider } from "@/lib/publish/provider-platform-matrix";
import {
  buildAccountDraftTitle,
  buildDraftBody,
  buildTagsFromBundle,
  getDraftCoverImage,
  getDraftImages,
  getDraftLocalImagePaths,
} from "@/lib/publish/draft-builders";
import { formatAccountDisplayLabel, resolveAccountIdentifier } from "@/lib/publish/account-label";
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

function buildAccountPublishingDraft(
  bundle: TaskBundle,
  account: PlatformAccountRecord,
  searchProvider: SearchProvider,
): AccountPublishingDraft {
  const descriptor = getPlatformDescriptor(account.platform);
  const title = buildAccountDraftTitle(bundle, account.platform, formatAccountDisplayLabel(account, account.id));
  const body = buildDraftBody(bundle, account.platform);
  const imageUrls = getDraftImages(bundle);
  const localImagePaths = getDraftLocalImagePaths(bundle);
  const theme = bundle.theme?.selectedKeywordTheme ?? bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword;

  return {
    id: createRecordId(),
    taskId: bundle.task.id,
    platform: account.platform,
    accountId: account.id,
    accountName: resolveAccountIdentifier(account, account.id),
    searchProvider,
    sourceContentTaskId: bundle.content?.taskId,
    sourceTheme: theme,
    title,
    body,
    tags: buildTagsFromBundle(bundle),
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
