import path from "node:path";
import { dataDirectories } from "@/lib/paths";
import { getSocialPlatformDescriptor } from "@/lib/publish/platforms";
import {
  createRecordId,
  deleteAccountPublishingDraft,
  deletePlatformAccount,
  getPlatformAccount,
  listAccountPublishingDrafts,
  listPlatformAccounts,
  listPublishingDrafts,
  listPublishingJobs,
  listTasks,
  savePlatformAccount,
  savePublishingDraft,
  saveTask,
} from "@/lib/storage/data-store";
import { readJsonFile, writeJsonFile } from "@/lib/storage/json-store";
import type {
  AccountPublishedJobsGroup,
  PlatformAccountDetectionItem,
  PlatformAccountDetectionResult,
  PlatformAccountLoginStatus,
  PlatformAccountRecord,
  PlatformAccountStatus,
  PublishableAccountSummary,
  SocialPlatform,
} from "@/lib/types";

const ACCOUNT_DETECTION_CACHE_TTL_MS = 30 * 60 * 1000;
const ACCOUNT_DETECTION_CACHE_FILE = path.join(dataDirectories.config, "publish-account-detection-cache.json");

interface CachedAccountDetection {
  items: PlatformAccountDetectionItem[];
  updatedAt: string;
}

function now() {
  return new Date().toISOString();
}

function buildSessionPartition(accountId: string) {
  return `persist:geo-platform-${accountId}`;
}

function buildAuthPayloadPreview(authPayload?: string) {
  const normalized = String(authPayload || "").trim();
  if (!normalized) return undefined;
  const preview = normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
  return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
}

export async function getAllPlatformAccounts() {
  const items = await listPlatformAccounts();
  return items.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export async function getPublishedJobsByAccount(platform?: SocialPlatform): Promise<AccountPublishedJobsGroup[]> {
  const jobs = await listPublishingJobs();
  const filteredJobs = jobs
    .filter((job) => job.status === "published" && job.accountId && (!platform || job.platform === platform))
    .sort(
      (left, right) =>
        new Date(right.publishedAt ?? right.updatedAt).getTime() -
        new Date(left.publishedAt ?? left.updatedAt).getTime(),
    );

  const grouped = new Map<string, AccountPublishedJobsGroup>();
  for (const job of filteredJobs) {
    if (!job.accountId) {
      continue;
    }
    const current = grouped.get(job.accountId) ?? { accountId: job.accountId, jobs: [] };
    current.jobs.push(job);
    grouped.set(job.accountId, current);
  }
  return Array.from(grouped.values());
}

export async function listAuthenticatedPlatformAccounts(platform?: SocialPlatform) {
  const items = await getAllPlatformAccounts();
  return items.filter(
    (item) =>
      item.loginStatus === "authenticated" &&
      item.status !== "disabled" &&
      item.status !== "cooling_down" &&
      item.status !== "needs_login" &&
      item.status !== "verification_blocked" &&
      item.riskState !== "disabled" &&
      item.riskState !== "verification_blocked" &&
      item.riskState !== "needs_login" &&
      (!platform || item.platform === platform),
  );
}

export function isPublishablePlatformAccount(account: PlatformAccountRecord) {
  return (
    account.loginStatus === "authenticated" &&
    (account.status === "valid" || account.status === "active") &&
    (!account.riskState || account.riskState === "active") &&
    account.provider === "electron" &&
    account.authType !== "manual"
  );
}

export async function listPublishablePlatformAccounts(platform?: SocialPlatform) {
  const items = await getAllPlatformAccounts();
  return items.filter((item) => isPublishablePlatformAccount(item) && (!platform || item.platform === platform));
}

function sanitizePublishableAccount(account: PlatformAccountRecord): PublishableAccountSummary {
  return {
    id: account.id,
    platform: account.platform,
    accountName: account.accountName,
    displayName: account.displayName,
    platformAccountId: account.platformAccountId,
    avatarUrl: account.avatarUrl,
    lastValidatedAt: account.lastValidatedAt,
  };
}

function isDetectionFresh(item: PlatformAccountDetectionItem, nowMs: number) {
  return new Date(item.cacheExpiresAt).getTime() > nowMs;
}

async function readAccountDetectionCache() {
  return readJsonFile<CachedAccountDetection>(ACCOUNT_DETECTION_CACHE_FILE, { items: [], updatedAt: "" });
}

async function writeAccountDetectionCache(items: PlatformAccountDetectionItem[]) {
  await writeJsonFile<CachedAccountDetection>(ACCOUNT_DETECTION_CACHE_FILE, {
    items,
    updatedAt: now(),
  });
}

function buildDetectionItem(platform: SocialPlatform, accounts: PlatformAccountRecord[], detectedAt: string): PlatformAccountDetectionItem {
  const descriptor = getSocialPlatformDescriptor(platform);
  const publishableAccounts = accounts.filter((account) => account.platform === platform && isPublishablePlatformAccount(account));
  const platformAccounts = accounts.filter((account) => account.platform === platform);
  const manualOnlyCount = platformAccounts.filter((account) => account.authType === "manual" || account.provider === "manual").length;
  const unavailableCount = descriptor?.automationStatus !== "ready" ? platformAccounts.length : 0;
  const ignoredCount = Math.max(platformAccounts.length - publishableAccounts.length, 0);

  return {
    platform,
    accountCount: publishableAccounts.length,
    accounts: publishableAccounts.map(sanitizePublishableAccount),
    ignoredCount,
    manualOnlyCount,
    unavailableCount,
    detectedAt,
    cacheExpiresAt: new Date(new Date(detectedAt).getTime() + ACCOUNT_DETECTION_CACHE_TTL_MS).toISOString(),
    fromCache: false,
  };
}

export async function detectPublishablePlatformAccounts(
  platforms: SocialPlatform[],
  options: { forceRefresh?: boolean } = {},
): Promise<PlatformAccountDetectionResult> {
  const uniquePlatforms = Array.from(new Set(platforms));
  const nowMs = Date.now();
  const cached = await readAccountDetectionCache();
  const cachedByPlatform = new Map<SocialPlatform, PlatformAccountDetectionItem>(
    cached.items.map((item) => [item.platform, item]),
  );
  const freshCachedItems = options.forceRefresh
    ? []
    : uniquePlatforms
        .map((platform) => cachedByPlatform.get(platform))
        .filter((item): item is PlatformAccountDetectionItem => item !== undefined && isDetectionFresh(item, nowMs));
  const freshPlatforms = new Set(freshCachedItems.map((item) => item.platform));
  const stalePlatforms = uniquePlatforms.filter((platform) => !freshPlatforms.has(platform));

  let refreshedItems: PlatformAccountDetectionItem[] = [];
  if (stalePlatforms.length) {
    const accounts = await getAllPlatformAccounts();
    const detectedAt = now();
    refreshedItems = stalePlatforms.map((platform) => buildDetectionItem(platform, accounts, detectedAt));
    const nextItemsByPlatform = new Map<SocialPlatform, PlatformAccountDetectionItem>(
      cached.items.map((item) => [item.platform, item]),
    );
    for (const item of refreshedItems) {
      nextItemsByPlatform.set(item.platform, item);
    }
    await writeAccountDetectionCache(Array.from(nextItemsByPlatform.values()));
  }

  const refreshedByPlatform = new Map(refreshedItems.map((item) => [item.platform, item]));
  return {
    items: uniquePlatforms.map((platform) => {
      const refreshed = refreshedByPlatform.get(platform);
      if (refreshed) return refreshed;
      const cachedItem = cachedByPlatform.get(platform);
      return cachedItem ? { ...cachedItem, fromCache: true } : buildDetectionItem(platform, [], now());
    }),
    cacheTtlMinutes: 30,
  };
}

export async function getUniqueAuthenticatedPlatformAccount(platform: SocialPlatform) {
  const items = await listAuthenticatedPlatformAccounts(platform);
  return items.length === 1 ? items[0] : null;
}

export async function createPlatformAccount(input: {
  platform: SocialPlatform;
  accountName: string;
  displayName?: string;
  remark?: string;
  loginUrl?: string;
  loginStatus?: PlatformAccountLoginStatus;
  status?: PlatformAccountStatus;
  sessionPartition?: string;
}) {
  const id = createRecordId();
  const sessionPartition = input.sessionPartition?.trim() || buildSessionPartition(id);
  const record: PlatformAccountRecord = {
    id,
    platform: input.platform,
    provider: "electron",
    authType: "session",
    source: "electron_shell",
    accountName: input.accountName.trim(),
    displayName: input.displayName?.trim() || input.accountName.trim(),
    loginUrl: input.loginUrl?.trim(),
    sessionPartition,
    loginStatus: input.loginStatus ?? "idle",
    status: input.status ?? "saved",
    riskState: input.status === "valid" || input.status === "active" ? "active" : undefined,
    remark: input.remark?.trim(),
    createdAt: now(),
    updatedAt: now(),
  };
  return savePlatformAccount(record);
}

export async function updatePlatformAccountRecord(accountId: string, patch: Partial<PlatformAccountRecord>) {
  const current = await getPlatformAccount(accountId);
  if (!current) {
    throw new Error("账号不存在");
  }

  const next: PlatformAccountRecord = {
    ...current,
    ...patch,
    authPayloadPreview: typeof patch.authPayload !== "undefined" ? buildAuthPayloadPreview(patch.authPayload) : patch.authPayloadPreview ?? current.authPayloadPreview,
    updatedAt: now(),
  };
  return savePlatformAccount(next);
}

export async function removePlatformAccount(accountId: string) {
  const account = await getPlatformAccount(accountId);
  if (!account) {
    throw new Error("账号不存在");
  }

  const [tasks, publishingDrafts, accountPublishingDrafts] = await Promise.all([
    listTasks(),
    listPublishingDrafts(),
    listAccountPublishingDrafts(),
  ]);

  await Promise.all(
    tasks.map(async (task) => {
      if (!task.publishPlan?.enabledPlatforms.some((platform) => platform.accountIds.includes(accountId))) {
        return;
      }

      const enabledPlatforms = task.publishPlan.enabledPlatforms.map((platform) => {
        const accountIds = platform.accountIds.filter((id) => id !== accountId);
        const enabled = platform.enabled && accountIds.length > 0;
        const accountCount = enabled ? accountIds.length : 0;
        return {
          ...platform,
          enabled,
          accountIds: enabled ? accountIds : [],
          accountCount,
          articleCount: accountCount * task.publishPlan!.days * task.publishPlan!.articlesPerAccountPerDay,
        };
      });

      const totalAccountCount = enabledPlatforms.reduce((total, platform) => total + (platform.enabled ? platform.accountCount : 0), 0);
      const totalArticleCount = enabledPlatforms.reduce((total, platform) => total + platform.articleCount, 0);
      await saveTask({
        ...task,
        publishPlan: {
          ...task.publishPlan,
          enabledPlatforms,
          totalAccountCount,
          totalArticleCount,
          updatedAt: now(),
        },
        updatedAt: now(),
      });
    }),
  );

  await Promise.all(
    publishingDrafts.map(async (draft) => {
      const nextAccountIds = draft.accountIds?.filter((id) => id !== accountId);
      const accountIdChanged = draft.accountId === accountId;
      const accountIdsChanged = Boolean(draft.accountIds && nextAccountIds && nextAccountIds.length !== draft.accountIds.length);
      if (!accountIdChanged && !accountIdsChanged) {
        return;
      }
      await savePublishingDraft({
        ...draft,
        accountId: accountIdChanged ? undefined : draft.accountId,
        accountIds: nextAccountIds,
        updatedAt: now(),
      });
    }),
  );

  await Promise.all(
    accountPublishingDrafts
      .filter((draft) => draft.accountId === accountId)
      .map((draft) => deleteAccountPublishingDraft(draft.id)),
  );

  await deletePlatformAccount(accountId);
}

export async function markPlatformAccountLoginStarted(accountId: string) {
  return updatePlatformAccountRecord(accountId, {
    loginStatus: "pending",
    status: "saved",
    riskState: undefined,
    riskReason: undefined,
    cooldownUntil: undefined,
    lastLoginStartedAt: now(),
    lastError: undefined,
  });
}

export async function markPlatformAccountLoginResult(
  accountId: string,
  result: {
    loginStatus: PlatformAccountLoginStatus;
    status?: PlatformAccountStatus;
    lastError?: string;
    accountName?: string;
    displayName?: string;
    platformAccountId?: string;
    avatarUrl?: string;
  },
) {
  const patch: Partial<PlatformAccountRecord> = {
    loginStatus: result.loginStatus,
    status: result.status ?? (result.loginStatus === "authenticated" ? "active" : "saved"),
    riskState: result.loginStatus === "authenticated" ? "active" : "needs_login",
    riskReason: result.loginStatus === "authenticated" ? undefined : result.lastError,
    cooldownUntil: result.loginStatus === "authenticated" ? undefined : undefined,
    lastError: result.lastError,
    lastLoginCompletedAt: now(),
    lastValidatedAt: now(),
  };
  if (result.accountName?.trim()) {
    patch.accountName = result.accountName.trim();
  }
  if (typeof result.displayName === "string") {
    patch.displayName = result.displayName.trim() || undefined;
  }
  if (typeof result.platformAccountId === "string") {
    patch.platformAccountId = result.platformAccountId.trim() || undefined;
  }
  if (typeof result.avatarUrl === "string") {
    patch.avatarUrl = result.avatarUrl.trim() || undefined;
  }
  return updatePlatformAccountRecord(accountId, patch);
}

export function getPlatformAccountSessionPartition(account: Pick<PlatformAccountRecord, "id" | "sessionPartition">) {
  return account.sessionPartition?.trim() || buildSessionPartition(account.id);
}
