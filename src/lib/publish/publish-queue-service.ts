import path from "node:path";
import { promises as fs } from "node:fs";
import { createRecordId, getPlatformAccount, getPublishingJob, listPublishingJobs } from "@/lib/storage/data-store";
import { dataDirectories } from "@/lib/paths";
import { resolveAccountIdentifier } from "@/lib/publish/account-label";
import { updatePlatformAccountRecord } from "@/lib/publish/accounts-service";
import { recordPublishingJobResult, updatePublishingJobRecord } from "@/lib/publish/jobs-service";
import { runQueuedPublishingJob } from "@/lib/publish/server-publish-runner";
import type {
  PlatformAccountRecord,
  PlatformAccountRiskState,
  PublishAuditLogEntry,
  PublishPlatform,
  PublishingJobRecord,
} from "@/lib/types";

const AUDIT_LOG_FILE = path.join(dataDirectories.config, "publish-audit-log.jsonl");
const DEFAULT_DAILY_CAP = 2;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MINUTES = 15;

const PLATFORM_COOLDOWN_MINUTES: Record<PublishPlatform, number> = {
  toutiao: 90,
  baijiahao: 90,
  douyin: 120,
  xiaohongshu: 120,
  wechat: 180,
  videohao: 180,
  zhihu: 90,
  weibo: 60,
  csdn: 60,
};

function now() {
  return new Date().toISOString();
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function hasActiveScheduledNextRun(job: PublishingJobRecord, at: Date) {
  if (!job.nextRunAt || new Date(job.nextRunAt).getTime() <= at.getTime()) return false;
  if (job.queueBlockedReason !== "job_scheduled_for_later") return true;
  if (!job.plannedPublishTime) return true;
  return new Date(job.plannedPublishTime).getTime() > at.getTime();
}

function normalizeRiskState(account: PlatformAccountRecord): PlatformAccountRiskState {
  if (account.riskState) return account.riskState;
  if (account.status === "disabled") return "disabled";
  if (account.status === "invalid" || account.loginStatus !== "authenticated") return "needs_login";
  return "active";
}

function isSameLocalDay(left?: string, right = new Date()) {
  if (!left) return false;
  const date = new Date(left);
  return (
    date.getFullYear() === right.getFullYear() &&
    date.getMonth() === right.getMonth() &&
    date.getDate() === right.getDate()
  );
}

export function riskReasonFromJob(job: PublishingJobRecord) {
  const haystack = [
    job.status,
    job.failureStage,
    job.externalStatus,
    job.errorMessage,
    job.verificationEvidence,
    ...(job.executionLog ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(prepare_images|upload_images|图片|image|素材|未提供|missing_images|without images)/i.test(haystack)) {
    return null;
  }

  if (/(captcha|验证码|验证|verification|verify)/i.test(haystack)) {
    return { state: "verification_blocked" as const, reason: "verification_or_captcha_detected" };
  }
  if (/(risk|风控|安全|异常|限制|blocked)/i.test(haystack)) {
    return { state: "verification_blocked" as const, reason: "platform_risk_block_detected" };
  }
  if (/(login|登录|session|cookie|account_binding)/i.test(haystack)) {
    return { state: "needs_login" as const, reason: "login_or_session_invalid" };
  }
  return null;
}

export function materialReasonFromJob(job: PublishingJobRecord) {
  const failureStage = String(job.failureStage || "").toLowerCase();
  const executionStage = String(job.executionStage || "").toLowerCase();
  const errorText = [job.errorMessage, job.verificationEvidence].filter(Boolean).join(" ").toLowerCase();
  const logText = (job.executionLog ?? []).join(" ").toLowerCase();
  const stageIndicatesMissingImages =
    failureStage === "prepare_images" || failureStage === "upload_images" || failureStage === "missing_images";
  const textIndicatesMissingImages =
    /(缺少可上传图片|缺少图片|图片素材缺失|未提供图片|missing images?|missing image|without images?|without image|no images?|no image)/i.test(
      errorText,
    );
  const logIndicatesMissingImages =
    /(prepare_images:.*(failed|missing|without images|without image|no images|no image|未提供|缺少)|upload_images:.*(failed|missing|without images|without image|no images|no image|未提供|缺少)|missing_images)/i.test(
      logText,
    );
  if (stageIndicatesMissingImages || executionStage === "missing_images" || textIndicatesMissingImages || logIndicatesMissingImages) {
    return failureStage || executionStage || "prepare_images";
  }
  return null;
}

export async function appendPublishAuditLog(
  input: Omit<PublishAuditLogEntry, "id" | "createdAt">,
): Promise<PublishAuditLogEntry> {
  const entry: PublishAuditLogEntry = {
    id: createRecordId(),
    createdAt: now(),
    ...input,
  };
  await fs.mkdir(path.dirname(AUDIT_LOG_FILE), { recursive: true });
  await fs.appendFile(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function listPublishAuditLog(limit = 200): Promise<PublishAuditLogEntry[]> {
  try {
    const content = await fs.readFile(AUDIT_LOG_FILE, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PublishAuditLogEntry)
      .slice(-limit)
      .reverse();
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") return [];
    throw error;
  }
}

async function countAccountPublishesToday(accountId: string, at: Date) {
  const jobs = await listPublishingJobs();
  return jobs.filter(
    (job) =>
      job.accountId === accountId &&
      (job.status === "published" || job.status === "submitted" || job.status === "pending_review") &&
      isSameLocalDay(job.publishedAt ?? job.submittedAt ?? job.updatedAt, at),
  ).length;
}

async function latestPlatformRun(job: PublishingJobRecord) {
  const jobs = await listPublishingJobs();
  return jobs
    .filter(
      (item) =>
        item.id !== job.id &&
        item.platform === job.platform &&
        item.accountId === job.accountId &&
        (item.status === "published" || item.status === "submitted" || item.status === "pending_review"),
    )
    .sort(
      (left, right) =>
        new Date(right.publishedAt ?? right.submittedAt ?? right.updatedAt).getTime() -
        new Date(left.publishedAt ?? left.submittedAt ?? left.updatedAt).getTime(),
    )[0];
}

export async function evaluatePublishingJobReadiness(job: PublishingJobRecord, at = new Date()) {
  if (job.status !== "queued") {
    return { runnable: false, reason: `job_status_${job.status}` };
  }
  if (hasActiveScheduledNextRun(job, at)) {
    return { runnable: false, reason: "job_scheduled_for_later", nextRunAt: job.nextRunAt };
  }
  if (job.plannedPublishTime && new Date(job.plannedPublishTime).getTime() > at.getTime()) {
    return { runnable: false, reason: "job_scheduled_for_later", nextRunAt: job.plannedPublishTime };
  }
  if (job.backoffUntil && new Date(job.backoffUntil).getTime() > at.getTime()) {
    return { runnable: false, reason: "retry_backoff_active", nextRunAt: job.backoffUntil };
  }
  if (!job.accountId) {
    return { runnable: false, reason: "missing_account" };
  }

  const account = await getPlatformAccount(job.accountId);
  if (!account) {
    return { runnable: false, reason: "account_not_found" };
  }

  const riskState = normalizeRiskState(account);
  if (riskState !== "active") {
    return { runnable: false, reason: `account_${riskState}`, account, riskState };
  }
  if (account.cooldownUntil && new Date(account.cooldownUntil).getTime() > at.getTime()) {
    return { runnable: false, reason: "account_cooling_down", nextRunAt: account.cooldownUntil, account, riskState };
  }

  const dailyCap = account.dailyPublishCap ?? DEFAULT_DAILY_CAP;
  const publishedToday = await countAccountPublishesToday(account.id, at);
  if (publishedToday >= dailyCap) {
    const tomorrow = new Date(at);
    tomorrow.setHours(24, 0, 0, 0);
    return {
      runnable: false,
      reason: "account_daily_cap_reached",
      nextRunAt: tomorrow.toISOString(),
      account,
      riskState,
    };
  }

  const latestRun = await latestPlatformRun(job);
  const cooldownMinutes = account.platformCooldownMinutes ?? PLATFORM_COOLDOWN_MINUTES[job.platform];
  const lastRunAt = latestRun?.publishedAt ?? latestRun?.submittedAt ?? latestRun?.updatedAt;
  if (lastRunAt) {
    const nextRunAt = addMinutes(new Date(lastRunAt), cooldownMinutes);
    if (new Date(nextRunAt).getTime() > at.getTime()) {
      return { runnable: false, reason: "platform_cooldown_active", nextRunAt, account, riskState };
    }
  }

  return { runnable: true, account, riskState };
}

async function blockJob(job: PublishingJobRecord, reason: string, nextRunAt?: string) {
  const updated = await updatePublishingJobRecord(job.id, {
    queueBlockedReason: reason,
    nextRunAt,
    executionStage: reason,
  });
  await appendPublishAuditLog({
    eventType: "job_blocked",
    jobId: job.id,
    taskId: job.taskId,
    platform: job.platform,
    accountId: job.accountId,
    accountName: job.accountName,
    status: updated.status,
    reason,
    details: { nextRunAt },
  });
  return updated;
}

async function scheduleRetry(job: PublishingJobRecord, result: PublishingJobRecord) {
  const retryCount = (job.retryCount ?? 0) + 1;
  const maxRetries = job.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (retryCount > maxRetries) {
    await appendPublishAuditLog({
      eventType: "job_result",
      jobId: result.id,
      taskId: result.taskId,
      platform: result.platform,
      accountId: result.accountId,
      accountName: result.accountName,
      status: result.status,
      reason: "max_retries_exhausted",
    });
    return result;
  }

  const backoffUntil = addMinutes(new Date(), BASE_BACKOFF_MINUTES * 2 ** (retryCount - 1));
  const queued = await updatePublishingJobRecord(result.id, {
    status: "queued",
    retryCount,
    maxRetries,
    backoffUntil,
    nextRunAt: backoffUntil,
    queueBlockedReason: "retry_backoff_active",
  });
  await appendPublishAuditLog({
    eventType: "job_retry_scheduled",
    jobId: queued.id,
    taskId: queued.taskId,
    platform: queued.platform,
    accountId: queued.accountId,
    accountName: queued.accountName,
    status: queued.status,
    reason: "retry_backoff_active",
    details: { retryCount, maxRetries, backoffUntil },
  });
  return queued;
}

export async function pauseAccountForPublishingRisk(
  accountId: string,
  state: PlatformAccountRiskState,
  reason: string,
  job?: PublishingJobRecord,
) {
  const account = await updatePlatformAccountRecord(accountId, {
    status: state,
    riskState: state,
    riskReason: reason,
    riskUpdatedAt: now(),
    cooldownUntil: state === "cooling_down" ? addMinutes(new Date(), 180) : undefined,
    lastPublishError: reason,
  });
  await appendPublishAuditLog({
    eventType: "account_paused",
    jobId: job?.id,
    taskId: job?.taskId,
    platform: account.platform,
    accountId: account.id,
    accountName: resolveAccountIdentifier(account, account.id),
    reason,
    details: { state },
  });
  return account;
}

export async function resumePlatformAccount(accountId: string) {
  const account = await updatePlatformAccountRecord(accountId, {
    status: "active",
    riskState: "active",
    riskReason: undefined,
    cooldownUntil: undefined,
    manualResumeAt: now(),
    lastError: undefined,
    lastPublishError: undefined,
  });
  await appendPublishAuditLog({
    eventType: "account_resumed",
    platform: account.platform,
    accountId: account.id,
    accountName: resolveAccountIdentifier(account, account.id),
    reason: "manual_resume",
  });
  return account;
}

export async function runDuePublishingJob(jobId: string) {
  const job = await getPublishingJob(jobId);
  if (!job) {
    throw new Error("发布任务不存在。");
  }

  const readiness = await evaluatePublishingJobReadiness(job);
  if (!readiness.runnable) {
    return blockJob(job, readiness.reason ?? "queue_not_ready", readiness.nextRunAt);
  }

  await appendPublishAuditLog({
    eventType: "job_started",
    jobId: job.id,
    taskId: job.taskId,
    platform: job.platform,
    accountId: job.accountId,
    accountName: job.accountName,
    status: job.status,
  });
  await updatePublishingJobRecord(job.id, {
    queueBlockedReason: undefined,
    accountRiskState: readiness.riskState,
  });

  const result = await runQueuedPublishingJob(job.id);
  await appendPublishAuditLog({
    eventType: "job_result",
    jobId: result.id,
    taskId: result.taskId,
    platform: result.platform,
    accountId: result.accountId,
    accountName: result.accountName,
    status: result.status,
    reason: result.errorMessage ?? result.externalStatus,
  });

  if (result.status === "published" && result.accountId) {
    const cooldownUntil = addMinutes(new Date(), PLATFORM_COOLDOWN_MINUTES[result.platform]);
    await updatePlatformAccountRecord(result.accountId, {
      status: "active",
      riskState: "active",
      cooldownUntil,
      lastPublishCompletedAt: now(),
      lastPublishError: undefined,
    });
    return result;
  }

  const materialReason = materialReasonFromJob(result);
  if (materialReason) {
    return recordPublishingJobResult({
      jobId: result.id,
      status: "manual_pending",
      failureStage: materialReason,
      errorMessage: result.errorMessage ?? "发布素材缺失，需要补充图片后再继续发布。",
      executionLog: result.executionLog,
      verificationEvidence: result.verificationEvidence,
      verificationAttempts: result.verificationAttempts,
      notes: "发布素材缺失，账号会话正常；请补充图片素材后再继续发布。",
    });
  }

  const risk = riskReasonFromJob(result);
  if (risk && result.accountId) {
    await pauseAccountForPublishingRisk(result.accountId, risk.state, risk.reason, result);
    return recordPublishingJobResult({
      jobId: result.id,
      status: "manual_pending",
      failureStage: risk.reason,
      errorMessage: result.errorMessage ?? risk.reason,
      executionLog: result.executionLog,
      verificationEvidence: result.verificationEvidence,
      verificationAttempts: result.verificationAttempts,
      notes: "Account paused automatically because the platform reported login, verification, captcha, or risk blocking.",
    });
  }

  if (result.status === "failed") {
    return scheduleRetry(job, result);
  }

  return result;
}

export async function runDuePublishingJobs(at = new Date()) {
  const jobs = (await listPublishingJobs()).filter((job) => job.status === "queued");
  const results: Array<{ jobId: string; status: PublishingJobRecord["status"] }> = [];
  const blocked: Array<{ jobId: string; reason: string; nextRunAt?: string }> = [];
  let runnable = 0;
  let skipped = 0;

  for (const job of jobs) {
    const readiness = await evaluatePublishingJobReadiness(job, at);
    if (!readiness.runnable) {
      skipped += 1;
      const plannedTimeReached = !job.plannedPublishTime || new Date(job.plannedPublishTime).getTime() <= at.getTime();
      if (plannedTimeReached && readiness.reason && readiness.reason !== "job_scheduled_for_later") {
        const updated = await blockJob(job, readiness.reason, readiness.nextRunAt);
        blocked.push({
          jobId: updated.id,
          reason: readiness.reason,
          nextRunAt: readiness.nextRunAt,
        });
      }
      continue;
    }
    runnable += 1;
    const result = await runDuePublishingJob(job.id);
    results.push({ jobId: result.id, status: result.status });
  }

  return {
    checked: jobs.length,
    runnable,
    executed: results.length,
    skipped,
    blocked,
    results,
  };
}
