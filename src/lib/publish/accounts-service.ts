import path from "node:path";
import { dataDirectories } from "@/lib/paths";
import { isMeaningfulAccountIdentifier, sanitizeAccountProfileForSave } from "@/lib/publish/account-label";
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
  saveAccountPublishingDraft,
  savePlatformAccount,
  savePublishingDraft,
  savePublishingJob,
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
const DEBUG_SERVER_URL = "http://127.0.0.1:7778/event";
const DEBUG_SESSION_ID = "account-info-fetch";

interface CachedAccountDetection {
  items: PlatformAccountDetectionItem[];
  updatedAt: string;
}

function now() {
  return new Date().toISOString();
}

function emitDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>) {
  // #region debug-point shared:emit
  fetch(DEBUG_SERVER_URL, {
    method: "POST",
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function normalizeIdentity(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
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

function collectAccountIdentityKeys(
  account: Pick<PlatformAccountRecord, "platformAccountId" | "accountName"> &
    Partial<Pick<PlatformAccountRecord, "platform">>,
) {
  const keys: string[] = [];
  const platformAccountId = normalizeIdentity(account.platformAccountId);
  const accountName = normalizeIdentity(account.accountName);
  const platform = "platform" in account ? account.platform : undefined;
  if (platformAccountId && (!platform || isMeaningfulAccountIdentifier(account.platformAccountId || "", platform))) {
    keys.push(`platform:${platformAccountId}`);
  }
  if (accountName && (!platform || isMeaningfulAccountIdentifier(account.accountName || "", platform))) {
    keys.push(`name:${accountName}`);
  }
  return keys;
}

function buildLoginResultPatch(
  current: PlatformAccountRecord,
  result: {
    loginStatus: PlatformAccountLoginStatus;
    status?: PlatformAccountStatus;
    lastError?: string;
    accountName?: string;
    displayName?: string;
    platformAccountId?: string;
    avatarUrl?: string;
    authPayload?: string;
    authPayloadUpdatedAt?: string;
    lastValidatedAt?: string;
  },
): Partial<PlatformAccountRecord> {
  const hasProfileUpdate =
    typeof result.accountName === "string" ||
    typeof result.displayName === "string" ||
    typeof result.platformAccountId === "string";
  const sanitizedProfile = hasProfileUpdate
    ? sanitizeAccountProfileForSave(
        current.platform,
        {
          accountName: result.accountName,
          displayName: result.displayName,
          platformAccountId: result.platformAccountId,
        },
        current,
      )
    : undefined;
  const patch: Partial<PlatformAccountRecord> = {
    loginStatus: result.loginStatus,
    status: result.status ?? (result.loginStatus === "authenticated" ? "active" : "saved"),
    riskState: result.loginStatus === "authenticated" ? "active" : "needs_login",
    riskReason: result.loginStatus === "authenticated" ? undefined : result.lastError,
    cooldownUntil: undefined,
    lastError: result.lastError,
    lastLoginCompletedAt: now(),
    lastValidatedAt: result.lastValidatedAt ?? now(),
    sessionPartition: current.sessionPartition,
    loginUrl: current.loginUrl,
    lastLoginStartedAt: current.lastLoginStartedAt,
  };
  if (sanitizedProfile) {
    patch.accountName = sanitizedProfile.accountName;
    patch.displayName = sanitizedProfile.displayName;
    patch.platformAccountId = sanitizedProfile.platformAccountId;
  }
  if (typeof result.avatarUrl === "string") {
    patch.avatarUrl = result.avatarUrl.trim() || undefined;
  }
  if (typeof result.authPayload === "string") {
    patch.authPayload = result.authPayload.trim() || undefined;
    patch.authPayloadUpdatedAt = result.authPayloadUpdatedAt || now();
  }
  return patch;
}

function buildSessionAuditPatch(
  current: PlatformAccountRecord,
  result: {
    loginStatus: PlatformAccountLoginStatus;
    status?: PlatformAccountStatus;
    lastError?: string;
    authPayload?: string;
    authPayloadUpdatedAt?: string;
    lastValidatedAt?: string;
  },
): Partial<PlatformAccountRecord> {
  const patch: Partial<PlatformAccountRecord> = {
    loginStatus: result.loginStatus,
    status: result.status ?? (result.loginStatus === "authenticated" ? "valid" : "invalid"),
    riskState: result.loginStatus === "authenticated" ? "active" : "needs_login",
    riskReason: result.loginStatus === "authenticated" ? undefined : result.lastError,
    cooldownUntil: undefined,
    lastError: result.lastError,
    lastValidatedAt: result.lastValidatedAt ?? now(),
    sessionPartition: current.sessionPartition,
    loginUrl: current.loginUrl,
  };
  if (typeof result.authPayload === "string") {
    patch.authPayload = result.authPayload.trim() || undefined;
    patch.authPayloadUpdatedAt = result.authPayloadUpdatedAt || patch.lastValidatedAt;
  }
  return patch;
}

async function replaceAccountReferences(fromAccountId: string, toAccountId: string, accountName?: string) {
  const [tasks, publishingDrafts, accountPublishingDrafts, publishingJobs] = await Promise.all([
    listTasks(),
    listPublishingDrafts(),
    listAccountPublishingDrafts(),
    listPublishingJobs(),
  ]);

  await Promise.all(
    tasks.map(async (task) => {
      if (!task.publishPlan) return;

      let changed = false;
      const enabledPlatforms = task.publishPlan.enabledPlatforms.map((platformPlan) => {
        if (!platformPlan.accountIds.includes(fromAccountId)) {
          return platformPlan;
        }

        changed = true;
        const accountIds = uniqueValues(platformPlan.accountIds.map((id) => (id === fromAccountId ? toAccountId : id)));
        const enabled = platformPlan.enabled && accountIds.length > 0;
        const accountCount = enabled ? accountIds.length : 0;
        return {
          ...platformPlan,
          enabled,
          accountIds: enabled ? accountIds : [],
          accountCount,
          articleCount: accountCount * task.publishPlan!.days * task.publishPlan!.articlesPerAccountPerDay,
        };
      });

      if (!changed) return;

      const totalAccountCount = enabledPlatforms.reduce((total, platformPlan) => total + (platformPlan.enabled ? platformPlan.accountCount : 0), 0);
      const totalArticleCount = enabledPlatforms.reduce((total, platformPlan) => total + platformPlan.articleCount, 0);
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
      const nextAccountId = draft.accountId === fromAccountId ? toAccountId : draft.accountId;
      const nextAccountIds = draft.accountIds?.includes(fromAccountId)
        ? uniqueValues(draft.accountIds.map((id) => (id === fromAccountId ? toAccountId : id)))
        : draft.accountIds;
      if (nextAccountId === draft.accountId && nextAccountIds === draft.accountIds) {
        return;
      }
      await savePublishingDraft({
        ...draft,
        accountId: nextAccountId,
        accountIds: nextAccountIds,
        updatedAt: now(),
      });
    }),
  );

  await Promise.all(
    accountPublishingDrafts.map(async (draft) => {
      if (draft.accountId !== fromAccountId) return;
      await saveAccountPublishingDraft({
        ...draft,
        accountId: toAccountId,
        accountName: accountName ?? draft.accountName,
        updatedAt: now(),
      });
    }),
  );

  await Promise.all(
    publishingJobs.map(async (job) => {
      if (job.accountId !== fromAccountId) return;
      await savePublishingJob({
        ...job,
        accountId: toAccountId,
        accountName: accountName ?? job.accountName,
        updatedAt: now(),
      });
    }),
  );
}

function selectCanonicalAccount(accounts: PlatformAccountRecord[]) {
  return [...accounts].sort((left, right) => {
    const leftScore =
      (left.loginStatus === "authenticated" ? 100 : 0) +
      ((left.status === "valid" || left.status === "active") ? 20 : 0) +
      (left.sessionPartition ? 10 : 0) +
      (left.platformAccountId ? 5 : 0) +
      (left.avatarUrl ? 1 : 0);
    const rightScore =
      (right.loginStatus === "authenticated" ? 100 : 0) +
      ((right.status === "valid" || right.status === "active") ? 20 : 0) +
      (right.sessionPartition ? 10 : 0) +
      (right.platformAccountId ? 5 : 0) +
      (right.avatarUrl ? 1 : 0);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    const rightLoginAt = new Date(right.lastLoginCompletedAt ?? right.updatedAt).getTime();
    const leftLoginAt = new Date(left.lastLoginCompletedAt ?? left.updatedAt).getTime();
    if (rightLoginAt !== leftLoginAt) {
      return rightLoginAt - leftLoginAt;
    }

    const createdDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return createdDiff || left.id.localeCompare(right.id);
  })[0];
}

function buildCanonicalMergePatch(canonical: PlatformAccountRecord, related: PlatformAccountRecord[]) {
  const richest = selectCanonicalAccount(related);
  return {
    accountName: richest.accountName || canonical.accountName,
    displayName: richest.displayName || canonical.displayName,
    platformAccountId: richest.platformAccountId || canonical.platformAccountId,
    avatarUrl: richest.avatarUrl || canonical.avatarUrl,
    loginStatus: richest.loginStatus,
    status: richest.status,
    riskState: richest.riskState,
    riskReason: richest.riskReason,
    cooldownUntil: richest.cooldownUntil,
    lastError: richest.lastError,
    lastLoginStartedAt: richest.lastLoginStartedAt || canonical.lastLoginStartedAt,
    lastLoginCompletedAt: richest.lastLoginCompletedAt || canonical.lastLoginCompletedAt,
    lastValidatedAt: richest.lastValidatedAt || canonical.lastValidatedAt,
    sessionPartition: richest.sessionPartition || canonical.sessionPartition,
    loginUrl: richest.loginUrl || canonical.loginUrl,
    authPayload: richest.authPayload || canonical.authPayload,
    authPayloadUpdatedAt: richest.authPayloadUpdatedAt || canonical.authPayloadUpdatedAt,
    loginSessionToken: richest.loginSessionToken || canonical.loginSessionToken,
    publishSessionToken: richest.publishSessionToken || canonical.publishSessionToken,
    browserProfileDir: richest.browserProfileDir || canonical.browserProfileDir,
    remark: canonical.remark || richest.remark,
  } satisfies Partial<PlatformAccountRecord>;
}

function groupDuplicateAccounts(accounts: PlatformAccountRecord[]) {
  const visited = new Set<string>();
  const groups: PlatformAccountRecord[][] = [];

  for (const account of accounts) {
    if (visited.has(account.id)) continue;
    const seedKeys = collectAccountIdentityKeys(account);
    if (!seedKeys.length) continue;

    const queue = [account];
    const group = new Map<string, PlatformAccountRecord>();
    const knownKeys = new Set(seedKeys);

    while (queue.length) {
      const current = queue.shift();
      if (!current || group.has(current.id)) continue;
      group.set(current.id, current);
      const currentKeys = collectAccountIdentityKeys(current);
      for (const key of currentKeys) {
        knownKeys.add(key);
      }

      for (const candidate of accounts) {
        if (candidate.platform !== account.platform || group.has(candidate.id)) continue;
        const candidateKeys = collectAccountIdentityKeys(candidate);
        if (!candidateKeys.length) continue;
        if (candidateKeys.some((key) => knownKeys.has(key))) {
          queue.push(candidate);
        }
      }
    }

    if (group.size > 1) {
      const groupedAccounts = Array.from(group.values());
      groupedAccounts.forEach((item) => visited.add(item.id));
      groups.push(groupedAccounts);
    } else {
      visited.add(account.id);
    }
  }

  return groups;
}

async function mergeDuplicateAccounts(
  current: PlatformAccountRecord,
  patch: Partial<PlatformAccountRecord>,
) {
  const identityKeys = collectAccountIdentityKeys({
    platform: current.platform,
    platformAccountId: typeof patch.platformAccountId === "string" ? patch.platformAccountId : current.platformAccountId,
    accountName: typeof patch.accountName === "string" ? patch.accountName : current.accountName,
  });
  if (!identityKeys.length) {
    return updatePlatformAccountRecord(current.id, patch);
  }

  const allAccounts = await getAllPlatformAccounts();
  const duplicates = allAccounts.filter((account) => {
    if (account.id === current.id || account.platform !== current.platform) {
      return false;
    }
    const accountKeys = collectAccountIdentityKeys(account);
    return accountKeys.some((key) => identityKeys.includes(key));
  });

  if (!duplicates.length) {
    return updatePlatformAccountRecord(current.id, patch);
  }

  const canonical = [current, ...duplicates]
    .sort((left, right) => {
      const createdDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return createdDiff || left.id.localeCompare(right.id);
    })[0];

  const next = await updatePlatformAccountRecord(canonical.id, {
    ...patch,
    sessionPartition: current.sessionPartition || canonical.sessionPartition,
    loginUrl: current.loginUrl || canonical.loginUrl,
    lastLoginStartedAt: current.lastLoginStartedAt || canonical.lastLoginStartedAt,
  });

  const duplicatesToRemove = [current, ...duplicates].filter((account) => account.id !== canonical.id);
  for (const duplicate of duplicatesToRemove) {
    await replaceAccountReferences(duplicate.id, canonical.id, next.displayName ?? next.accountName);
    await deletePlatformAccount(duplicate.id);
  }

  return next;
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
  const sanitizedProfile = sanitizeAccountProfileForSave(input.platform, {
    accountName: input.accountName,
    displayName: input.displayName,
  });
  const record: PlatformAccountRecord = {
    id,
    platform: input.platform,
    provider: "electron",
    authType: "session",
    source: "electron_shell",
    accountName: sanitizedProfile.accountName,
    displayName: sanitizedProfile.displayName,
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
    authPayload?: string;
    authPayloadUpdatedAt?: string;
    lastValidatedAt?: string;
  },
) {
  const current = await getPlatformAccount(accountId);
  if (!current) {
    throw new Error("账号不存在");
  }

  // #region debug-point B:service-input
  emitDebug("B", "accounts-service.ts:markPlatformAccountLoginResult:input", "服务端收到登录结果 patch", {
    accountId,
    platform: current.platform,
    currentAccountName: current.accountName,
    currentDisplayName: current.displayName ?? null,
    currentPlatformAccountId: current.platformAccountId ?? null,
    nextAccountName: result.accountName ?? null,
    nextDisplayName: result.displayName ?? null,
    nextPlatformAccountId: result.platformAccountId ?? null,
    nextAvatarUrl: result.avatarUrl ?? null,
    loginStatus: result.loginStatus,
    status: result.status ?? null,
  });
  // #endregion
  const patch = buildLoginResultPatch(current, result);
  // #region debug-point C:service-patch
  emitDebug("C", "accounts-service.ts:markPlatformAccountLoginResult:patch", "服务端构造最终登录 patch", {
    accountId,
    platform: current.platform,
    patchAccountName: patch.accountName ?? null,
    patchDisplayName: patch.displayName ?? null,
    patchPlatformAccountId: patch.platformAccountId ?? null,
    patchAvatarUrl: patch.avatarUrl ?? null,
    patchLoginStatus: patch.loginStatus ?? null,
    patchStatus: patch.status ?? null,
  });
  // #endregion
  return mergeDuplicateAccounts(current, patch);
}

export async function markPlatformAccountSessionAuditResult(
  accountId: string,
  result: {
    loginStatus: PlatformAccountLoginStatus;
    status?: PlatformAccountStatus;
    lastError?: string;
    authPayload?: string;
    authPayloadUpdatedAt?: string;
    lastValidatedAt?: string;
  },
) {
  const current = await getPlatformAccount(accountId);
  if (!current) {
    throw new Error("账号不存在");
  }
  return updatePlatformAccountRecord(accountId, buildSessionAuditPatch(current, result));
}

export async function deduplicateHistoricalPlatformAccounts(platform?: SocialPlatform) {
  const allAccounts = await getAllPlatformAccounts();
  const scopedAccounts = platform ? allAccounts.filter((account) => account.platform === platform) : allAccounts;
  const duplicateGroups = groupDuplicateAccounts(scopedAccounts);

  let mergedGroups = 0;
  let removedAccounts = 0;

  for (const group of duplicateGroups) {
    const canonical = selectCanonicalAccount(group);
    const duplicates = group.filter((account) => account.id !== canonical.id);
    if (!duplicates.length) continue;

    const next = await updatePlatformAccountRecord(canonical.id, buildCanonicalMergePatch(canonical, group));
    for (const duplicate of duplicates) {
      await replaceAccountReferences(duplicate.id, canonical.id, next.displayName ?? next.accountName);
      await deletePlatformAccount(duplicate.id);
    }

    mergedGroups += 1;
    removedAccounts += duplicates.length;
  }

  return {
    mergedGroups,
    removedAccounts,
    remainingAccounts: (await getAllPlatformAccounts()).filter((account) => (!platform || account.platform === platform)).length,
  };
}

export function getPlatformAccountSessionPartition(account: Pick<PlatformAccountRecord, "id" | "sessionPartition">) {
  return account.sessionPartition?.trim() || buildSessionPartition(account.id);
}
