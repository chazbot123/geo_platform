import {
  createRecordId,
  getExtensionPublishSession,
  getPlatformAccount,
  getPublishingJob,
  listExtensionLoginSessions,
  listExtensionPublishSessions,
  saveExtensionLoginSession,
  saveExtensionPublishSession,
} from "@/lib/storage/data-store";
import { createPlatformAccount, markPlatformAccountLoginResult, markPlatformAccountLoginStarted, updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { getSocialPlatformDescriptor } from "@/lib/publish/platforms";
import { recordPublishingJobResult, updatePublishingJobRecord } from "@/lib/publish/jobs-service";
import type {
  PlatformAccountRecord,
  PlatformExtensionLoginSession,
  PlatformExtensionPublishSession,
  SocialPlatform,
  StoredPlatformExtensionLoginSession,
  StoredPlatformExtensionPublishSession,
} from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function expiresAt(minutes = 30) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function buildToken() {
  return `${createRecordId()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isExpired(value?: string) {
  return !value || new Date(value).getTime() <= Date.now();
}

async function findLoginSessionByToken(sessionToken: string) {
  const items = await listExtensionLoginSessions();
  return (
    items.find((item) => item.sessionToken === sessionToken.trim() && item.status !== "expired") ??
    null
  );
}

async function findPublishSessionByToken(sessionToken: string) {
  const items = await listExtensionPublishSessions();
  return (
    items.find((item) => item.sessionToken === sessionToken.trim() && item.status !== "expired") ??
    null
  );
}

function buildDefaultAccountName(platform: SocialPlatform) {
  return `${platform}-account-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
}

export async function startExtensionLoginSession(input: { platform: SocialPlatform; accountId?: string | null }) {
  const descriptor = getSocialPlatformDescriptor(input.platform);
  if (!descriptor) {
    throw new Error("不支持的平台账号登录。");
  }

  let account =
    input.accountId?.trim() ? await getPlatformAccount(input.accountId.trim()) : null;

  if (!account) {
    account = await createPlatformAccount({
      platform: input.platform,
      accountName: buildDefaultAccountName(input.platform),
      displayName: descriptor.label,
      loginUrl: descriptor.publishEntryUrl,
    });
  }

  await markPlatformAccountLoginStarted(account.id);

  const session: StoredPlatformExtensionLoginSession = {
    sessionId: createRecordId(),
    sessionToken: buildToken(),
    platform: input.platform,
    accountId: account.id,
    expiresAt: expiresAt(20),
    loginUrl: descriptor.publishEntryUrl ?? "",
    createdAt: now(),
    updatedAt: now(),
    status: "pending",
  };

  await saveExtensionLoginSession(session);
  await updatePlatformAccountRecord(account.id, {
    provider: "extension",
    authType: "cookie",
    source: "browser_extension",
    loginSessionToken: session.sessionToken,
  });

  const response: PlatformExtensionLoginSession = {
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
    platform: session.platform,
    accountId: session.accountId,
    expiresAt: session.expiresAt,
    loginUrl: session.loginUrl,
  };
  return { session: response, account };
}

export async function syncExtensionLoginSession(input: {
  sessionToken: string;
  authType?: "cookie" | "session" | "manual";
  authPayload?: string;
  accountName?: string;
  displayName?: string;
  sourceUrl?: string;
  avatarUrl?: string;
  followerCount?: number;
}) {
  const session = await findLoginSessionByToken(input.sessionToken);
  if (!session || isExpired(session.expiresAt)) {
    throw new Error("登录会话已过期，请重新发起账号登录。");
  }

  const account = await getPlatformAccount(session.accountId);
  if (!account) {
    throw new Error("登录会话关联的账号不存在。");
  }

  const nextAccount = await updatePlatformAccountRecord(account.id, {
    provider: "extension",
    authType: input.authType ?? "cookie",
    status: "valid",
    loginStatus: "authenticated",
    accountName: input.accountName?.trim() || account.accountName,
    displayName: input.displayName?.trim() || input.accountName?.trim() || account.displayName || account.accountName,
    avatarUrl: input.avatarUrl?.trim() || account.avatarUrl,
    authPayload: input.authPayload?.trim() || account.authPayload,
    loginUrl: input.sourceUrl?.trim() || account.loginUrl,
    lastError: undefined,
    lastValidatedAt: now(),
    authPayloadUpdatedAt: input.authPayload?.trim() ? now() : account.authPayloadUpdatedAt,
  });

  await markPlatformAccountLoginResult(account.id, {
    loginStatus: "authenticated",
    status: "valid",
  });

  await saveExtensionLoginSession({
    ...session,
    status: "completed",
    updatedAt: now(),
  });

  return { account: nextAccount };
}

export async function startExtensionPublishSession(jobId: string) {
  const job = await getPublishingJob(jobId);
  if (!job) {
    throw new Error("发布任务不存在。");
  }
  if (!job.accountId) {
    throw new Error("当前发布任务尚未绑定平台账号。");
  }

  const account = await getPlatformAccount(job.accountId);
  if (!account) {
    throw new Error("绑定的平台账号不存在。");
  }
  if (!account.authPayload?.trim()) {
    throw new Error("当前账号没有可复用的登录 Cookie，请先重新登录。");
  }
  if (job.platform === "blog") {
    throw new Error("当前平台不支持扩展自动发布。");
  }

  const session: StoredPlatformExtensionPublishSession = {
    sessionToken: buildToken(),
    expiresAt: expiresAt(20),
    platform: job.platform,
    jobId: job.id,
    accountId: account.id,
    accountAuthPayload: account.authPayload,
    platformAccountId: account.id,
    platformAccountName: account.accountName,
    platformAccountDisplayName: account.displayName,
    job: {
      id: job.id,
      platform: job.platform,
      publishEntryUrl: job.publishEntryUrl,
      draftTitle: job.draftTitle,
      draftBody: job.draftBody,
      draftTags: job.draftTags,
      draftImages: job.draftImages,
    },
    createdAt: now(),
    updatedAt: now(),
    status: "pending",
  };

  await saveExtensionPublishSession(session);
  await updatePlatformAccountRecord(account.id, {
    publishSessionToken: session.sessionToken,
    provider: "extension",
  });
  await updatePublishingJobRecord(job.id, {
    sessionToken: session.sessionToken,
    executionMode: "extension_automation",
  });

  const response: PlatformExtensionPublishSession = {
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    job: session.job,
    accountAuthPayload: session.accountAuthPayload,
    platformAccountId: session.platformAccountId,
    platformAccountName: session.platformAccountName,
    platformAccountDisplayName: session.platformAccountDisplayName,
  };

  return response;
}

export async function getExtensionPublishAuth(sessionToken: string) {
  const session = await findPublishSessionByToken(sessionToken);
  if (!session || isExpired(session.expiresAt)) {
    throw new Error("发布会话已过期，请重新发起自动发布。");
  }
  return {
    accountAuthPayload: session.accountAuthPayload,
    platformAccountId: session.platformAccountId,
    platform: session.platform,
  };
}

export async function syncExtensionPublishSession(input: {
  sessionToken: string;
  status: "running" | "success" | "failed";
  draftUrl?: string;
  lastError?: string;
  authPayload?: string;
  accountName?: string;
  displayName?: string;
  sourceUrl?: string;
}) {
  const session = await findPublishSessionByToken(input.sessionToken);
  if (!session || isExpired(session.expiresAt)) {
    throw new Error("发布会话已过期，请重新发起自动发布。");
  }

  const account = await getPlatformAccount(session.accountId);
  if (account) {
    await updatePlatformAccountRecord(account.id, {
      provider: "extension",
      authType: "cookie",
      accountName: input.accountName?.trim() || account.accountName,
      displayName: input.displayName?.trim() || account.displayName || account.accountName,
      authPayload: input.authPayload?.trim() || account.authPayload,
      authPayloadUpdatedAt: input.authPayload?.trim() ? now() : account.authPayloadUpdatedAt,
      lastPublishCompletedAt: input.status === "success" ? now() : account.lastPublishCompletedAt,
      lastPublishError: input.status === "failed" ? input.lastError?.trim() || "扩展自动发布失败" : undefined,
      lastError: input.status === "failed" ? input.lastError?.trim() || "扩展自动发布失败" : undefined,
    });
  }

  await saveExtensionPublishSession({
    ...session,
    status: input.status,
    updatedAt: now(),
    accountAuthPayload: input.authPayload?.trim() || session.accountAuthPayload,
  });

  const nextStatus =
    input.status === "running" ? "running" : input.status === "success" ? "pending_review" : "failed";

  return recordPublishingJobResult({
    jobId: session.jobId,
    status: nextStatus,
    draftUrl: input.draftUrl?.trim() || undefined,
    publishUrl: input.sourceUrl?.trim() || undefined,
    externalStatus: input.status,
    errorMessage: input.status === "failed" ? input.lastError?.trim() || "扩展自动发布失败" : undefined,
    failureStage: input.status === "failed" ? "extension_publish_failed" : undefined,
    notes:
      input.status === "success"
        ? "扩展已提交发布，当前先标记为待核验。"
        : input.status === "running"
          ? "扩展已接管发布流程，正在执行本地自动化。"
          : "扩展自动发布失败。",
  });
}

export async function openExtensionPlatformAccountHome(accountId: string) {
  const account = await getPlatformAccount(accountId);
  if (!account) {
    throw new Error("账号不存在。");
  }
  if (!account.authPayload?.trim()) {
    throw new Error("当前账号还没有可复用的登录态，请先重新登录。");
  }
  return {
    platform: account.platform,
    loginUrl: account.loginUrl ?? getSocialPlatformDescriptor(account.platform)?.publishEntryUrl ?? "",
    authPayload: account.authPayload,
  };
}

export async function getStoredExtensionPublishSession(jobId: string) {
  return getExtensionPublishSession(jobId);
}

export async function resolveExtensionAccount(accountId: string): Promise<PlatformAccountRecord | null> {
  return getPlatformAccount(accountId);
}
