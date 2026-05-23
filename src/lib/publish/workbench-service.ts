import {
  createRecordId,
  deletePublishingDraftsByTask,
  deletePublishingJobsByTask,
  getPublishingDraft,
  getPublishingDraftsByTask,
  getPublishingJobsByTask,
  listPlatformAccounts,
  savePublishingDraft,
} from "@/lib/storage/data-store";
import { listAuthenticatedPlatformAccounts } from "@/lib/publish/accounts-service";
import { getTaskBundle, listTaskBundles } from "@/lib/tasks/service";
import { getPlatformDescriptor, publishPlatformDescriptors } from "@/lib/publish/platforms";
import type { PlatformAccountRecord, PublishPlatform, PublishWorkbenchData, PublishingDraft, TaskBundle } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toPlainParagraphs(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.replace(/^#{1,6}\s*/, "").replace(/^\*\s+/, "").trim())
    .filter(Boolean);
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

function buildXiaohongshuTitle(bundle: TaskBundle) {
  const productName = compactText(bundle.product.productName);
  const keyword = compactText(bundle.theme?.selectedKeyword ?? bundle.theme?.mainKeyword ?? productName);
  const sellingPoint = compactText(bundle.product.sellingPoints.split(/[，。；;、]/)[0] ?? "");
  const rawCandidates = [
    bundle.content?.title?.trim(),
    `${keyword}怎么做更高效`,
    `${productName}真的能解决${keyword}吗`,
    `${productName}使用体验分享`,
    sellingPoint ? `${sellingPoint}，适合谁看` : "",
  ].filter((item): item is string => Boolean(item));

  for (const candidate of rawCandidates) {
    const next = compactText(candidate);
    if (!next) continue;
    if (next.length <= 20) return next;
    if (next.length <= 28) return next.slice(0, 28);
    return next.slice(0, 24);
  }

  return `${productName}使用分享`.slice(0, 20);
}

function buildXiaohongshuBody(bundle: TaskBundle) {
  const summary = compactText(bundle.content?.summary ?? "");
  const cta = compactText(bundle.content?.cta ?? "");
  const paragraphs = toPlainParagraphs(bundle.content?.content ?? "");
  const sellingPoint = compactText(bundle.product.sellingPoints.split(/[，。；;、]/)[0] ?? "");
  const scenarios = compactText(bundle.product.scenarios.split(/[，。；;、]/)[0] ?? "");
  const audience = compactText(bundle.product.targetAudience.split(/[，。；;、]/)[0] ?? "");
  const intro = summary || (sellingPoint ? `最近在看 ${bundle.product.productName}，最先打动我的是 ${sellingPoint}。` : `最近研究了 ${bundle.product.productName}。`);
  const notes = [
    intro,
    scenarios ? `如果你也常在 ${scenarios} 这种场景里用到它，这点会很有感。` : audience ? `如果你本身就是 ${audience}，这类方案会更容易代入。` : "",
    ...paragraphs.slice(0, 3).map((item) => compactText(item).slice(0, 80)),
    cta ? compactText(cta).slice(0, 50) : "",
  ].filter(Boolean);

  return notes.join("\n\n");
}

function buildDraftTitle(bundle: TaskBundle, platform: PublishPlatform) {
  if (platform === "xiaohongshu") {
    return buildXiaohongshuTitle(bundle);
  }

  return bundle.content?.title ?? `${bundle.product.productName} 发布草稿`;
}

function buildDraftBody(bundle: TaskBundle, platform: PublishPlatform) {
  if (platform === "xiaohongshu") {
    return buildXiaohongshuBody(bundle);
  }

  const baseBody = bundle.content?.content?.trim() ?? "";
  const summary = bundle.content?.summary?.trim() ?? "";
  const cta = bundle.content?.cta?.trim() ?? "";
  return [summary, baseBody.slice(0, 280), cta].filter(Boolean).join("\n\n");
}

function buildDraft(bundle: TaskBundle, platform: PublishPlatform): PublishingDraft {
  const descriptor = getPlatformDescriptor(platform);
  const title = buildDraftTitle(bundle, platform);
  const body = buildDraftBody(bundle, platform);
  const tags = extractTags(
    [bundle.theme?.selectedKeyword, bundle.theme?.mainKeyword, bundle.product.category, bundle.product.brandTone].filter(Boolean).join(" "),
  );

  return {
    id: createRecordId(),
    taskId: bundle.task.id,
    platform,
    title,
    body,
    tags,
    coverImageUrl: bundle.image?.url,
    imageUrls: bundle.image?.url ? [bundle.image.url] : [],
    publishEntryUrl: descriptor?.publishEntryUrl,
    updatedAt: now(),
  };
}

function shouldRefreshXiaohongshuDraft(draft: PublishingDraft, bundle: TaskBundle) {
  if (draft.platform !== "xiaohongshu") {
    return false;
  }

  const legacyTitle = bundle.content?.title ?? `${bundle.product.productName} 发布草稿`;
  const legacyBody = [bundle.content?.summary?.trim() ?? "", (bundle.content?.content?.trim() ?? "").slice(0, 280), bundle.content?.cta?.trim() ?? ""]
    .filter(Boolean)
    .join("\n\n");

  return draft.title === legacyTitle || draft.body === legacyBody || (!draft.title.trim() && !draft.body.trim());
}

async function ensureTaskDrafts(bundle: TaskBundle) {
  const existingDrafts = await getPublishingDraftsByTask(bundle.task.id);
  if (existingDrafts.length > 0) {
    const normalizedDrafts = await Promise.all(
      existingDrafts.map(async (draft) => {
        if (!shouldRefreshXiaohongshuDraft(draft, bundle)) {
          return draft;
        }

        const refreshedDraft: PublishingDraft = {
          ...draft,
          title: buildDraftTitle(bundle, "xiaohongshu"),
          body: buildDraftBody(bundle, "xiaohongshu"),
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

  const drafts = publishPlatformDescriptors.map((item) => buildDraft(bundle, item.key));
  await Promise.all(drafts.map((draft) => savePublishingDraft(draft)));
  return drafts;
}

async function ensureDraftAccountBindings(drafts: PublishingDraft[], accounts: PlatformAccountRecord[]) {
  const nextDrafts = await Promise.all(
    drafts.map(async (draft) => {
      if (draft.accountId) {
        return draft;
      }

      const candidates = accounts.filter((account) => account.platform === draft.platform);
      if (candidates.length !== 1) {
        return draft;
      }

      const nextDraft: PublishingDraft = {
        ...draft,
        accountId: candidates[0].id,
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
  const nextDraft: PublishingDraft = {
    ...current,
    ...patch,
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
