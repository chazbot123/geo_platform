"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  LogIn,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  UserCircle2,
  X,
} from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
import { requireLicensedAction } from "@/lib/license/guard";
import { formatAccountDisplayLabel } from "@/lib/publish/account-label";
import {
  getPlatformPublishProgressWindow,
  openPlatformLoginWindow,
  validatePlatformSessionWindow,
} from "@/lib/publish/electron-login-client";
import { waitForExternalLoginSync } from "@/lib/publish/external-login-sync";
import { publishQueueReasonLabel, publishStageLabel } from "@/lib/publish/status-labels";
import type {
  ContentPoolItem,
  ContentPoolRecord,
  PlatformAccountRecord,
  PublishProgressSnapshot,
  PublishingJobRecord,
  SearchProvider,
  SocialPlatform,
} from "@/lib/types";

const platformLabels: Record<SocialPlatform, string> = {
  toutiao: "今日头条",
  baijiahao: "百家号",
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信公众号",
  videohao: "视频号",
  zhihu: "知乎",
  weibo: "微博",
  csdn: "CSDN",
};

const providerLabels: Record<SearchProvider, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "元宝",
  tongyi: "通义",
};

const stageLabels: Record<string, string> = {
  pending: "等待执行",
  queued: "待执行",
  running: "执行中",
  submitted: "已提交",
  verifying: "核验中",
  pending_review: "平台审核中",
  verification_failed: "待人工确认",
  manual_pending: "手动待处理",
  published: "已发布",
  failed: "失败",
  automation_failed: "自动发布中断",
  account_binding: "账号检查",
  login_or_session_invalid: "登录或会话失效",
  verification_or_captcha_detected: "平台验证或验证码阻断",
  platform_risk_block_detected: "平台风控阻断",
  missing_images: "图片素材缺失",
  electron_bridge: "桌面桥接",
  prepare_images: "准备图片",
  upload_images: "上传图片",
  open_publish_page: "打开创作页",
  fill_title: "填写标题",
  fill_body: "填写正文",
  fill_tags: "填写标签",
  submit: "提交发布",
};

const riskLabels: Record<string, string> = {
  active: "正常",
  needs_login: "需要重新登录",
  verification_blocked: "需要验证/风控处理",
  cooling_down: "冷却中",
  disabled: "已停用",
  invalid: "无效",
};

const queueReasonLabels: Record<string, string> = {
  account_needs_login: "账号需要重新登录",
  account_verification_blocked: "账号需要验证/风控处理",
  account_disabled: "账号已停用",
  account_cooling_down: "账号冷却中",
  account_daily_cap_reached: "账号今日发布上限",
  platform_cooldown_active: "平台发布间隔冷却中",
  retry_backoff_active: "重试等待中",
  missing_account: "缺少账号",
  account_not_found: "账号不存在",
};

const executionTableGridClass =
  "lg:grid-cols-[52px_minmax(320px,1.7fr)_88px_96px_minmax(130px,0.8fr)_112px_112px_112px]";
const executionTableMinWidthClass = "lg:min-w-[1120px]";

interface ExecutionArticle {
  item: ContentPoolItem;
  job?: PublishingJobRecord;
  stage: string;
  published: boolean;
  manualPending: boolean;
  canRun: boolean;
}

interface ExecutionState {
  current: ContentPoolRecord | null;
  articles: ExecutionArticle[];
  stats: {
    total: number;
    published: number;
    remaining: number;
    manualPending: number;
    publishable: number;
  };
  currentArticle: ExecutionArticle | null;
  latestExecutionTime: string | null;
  error?: string;
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPlannedTime(value?: string | null) {
  if (!value) return "--";
  const planned = new Date(value);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (planned.getTime() < todayStart.getTime()) return "待重新排期";
  return formatDateTime(value);
}

function stageLabel(stage?: string) {
  if (!stage) return "--";
  return stageLabels[stage] ?? publishStageLabel(stage);
}

function riskLabel(value?: string) {
  if (!value) return "--";
  return riskLabels[value] ?? stageLabel(value);
}

function queueLabel(value?: string) {
  if (!value) return "--";
  return publishQueueReasonLabel(value) ?? queueReasonLabels[value] ?? value;
}

const queueStageLabels: Record<string, string> = {
  account_daily_cap_reached: "今日上限",
  platform_cooldown_active: "冷却中",
  account_cooling_down: "账号冷却",
  account_needs_login: "需登录",
  account_verification_blocked: "需验证",
  account_disabled: "已停用",
  retry_backoff_active: "重试等待",
  missing_account: "账号异常",
  account_not_found: "账号异常",
};

function queueStageLabel(value?: string) {
  if (!value) return "--";
  return queueStageLabels[value] ?? publishStageLabel(value);
}

function translateMessage(value?: string) {
  if (!value) return "";
  return value
    .replace(
      "Account paused automatically because the platform reported login, verification, captcha, or risk blocking.",
      "平台返回登录失效、验证码、验证或风控阻断，系统已暂停该账号，请重新登录或人工处理后再继续发布。",
    )
    .replace("login_or_session_invalid", "登录或会话失效")
    .replace("verification_or_captcha_detected", "平台验证或验证码阻断")
    .replace("platform_risk_block_detected", "平台风控阻断");
}

function buildBodyPreview(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无正文";
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function statusTone(article: ExecutionArticle) {
  if (article.published) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (article.manualPending) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (!article.item.publishable) return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-line bg-surface text-muted";
}

function needsManualConfirmation(job?: PublishingJobRecord) {
  const errorText = [job?.errorMessage, job?.verificationEvidence, job?.notes].filter(Boolean).join(" ").toLowerCase();
  return (
    job?.status === "verification_failed" ||
    ((job?.status === "manual_pending" || job?.status === "failed") &&
      (job?.failureStage === "submit" ||
        /验证|审核|风控|captcha|verification|blocking|pending_review|submitted|success_then_blocking/.test(errorText)))
  );
}

function statusText(article: ExecutionArticle) {
  if (article.published) return "已发布";
  if (needsManualConfirmation(article.job)) return "待人工确认";
  if (article.manualPending) return "手动待处理";
  if (!article.item.publishable) return "未通过检查";
  if (article.job?.queueBlockedReason) return queueStageLabel(article.job.queueBlockedReason);
  return stageLabel(article.stage);
}

function accountDisplayName(account: PlatformAccountRecord | undefined, fallback?: string) {
  if (!account) return fallback || "--";
  return formatAccountDisplayLabel(account, fallback);
}

function matchesPublishResultSearch(article: ExecutionArticle, account: PlatformAccountRecord | undefined, searchQuery: string) {
  const keyword = searchQuery.trim().toLowerCase();
  if (!keyword) return true;
  const item = article.item;
  const job = article.job;
  const searchText = [
    item.title,
    item.body,
    item.summary,
    item.keywordText,
    item.stageMessage,
    item.accountName,
    item.accountId,
    job?.accountName,
    job?.accountId,
    platformLabels[item.publishPlatform],
    providerLabels[item.aiPlatform],
    statusText(article),
    articleStageText(article, job),
    queueLabel(job?.queueBlockedReason),
    accountDisplayName(account, job?.accountName || item.accountName || item.accountId),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchText.includes(keyword);
}

function canRenderInlineAvatar(url?: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
    return !/(\.|^)sinaimg\.cn$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function AccountIdentity({ account, fallback }: { account?: PlatformAccountRecord; fallback?: string }) {
  const label = accountDisplayName(account, fallback);
  return (
    <span className="flex min-w-0 items-center gap-2 text-muted">
      {account && canRenderInlineAvatar(account.avatarUrl) ? (
        <img
          src={account.avatarUrl}
          alt={`${label} 头像`}
          className="h-6 w-6 shrink-0 rounded-full border border-line bg-surface object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted">
          <UserCircle2 className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

function findBlockingReason(state?: ExecutionState | null) {
  const blockedArticle =
    state?.currentArticle?.job?.queueBlockedReason
      ? state.currentArticle
      : state?.articles.find((article) => article.job?.queueBlockedReason);
  const reason = blockedArticle?.job?.queueBlockedReason;
  return reason ? queueLabel(reason) : "";
}

function isMaterialIssue(job?: PublishingJobRecord) {
  const failureStage = String(job?.failureStage || "").toLowerCase();
  const executionStage = String(job?.executionStage || "").toLowerCase();
  const errorText = [job?.errorMessage, job?.verificationEvidence].filter(Boolean).join(" ").toLowerCase();
  const logText = (job?.executionLog ?? []).join(" ").toLowerCase();
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
  return stageIndicatesMissingImages || executionStage === "missing_images" || textIndicatesMissingImages || logIndicatesMissingImages;
}

function accountNeedsLogin(article: ExecutionArticle, account?: PlatformAccountRecord) {
  const job = article.job;
  if (isMaterialIssue(job)) return false;
  const accountInvalid = Boolean(
    account?.status === "needs_login" ||
      account?.status === "invalid" ||
      account?.loginStatus === "failed" ||
      account?.riskState === "needs_login",
  );
  if (accountInvalid) return true;
  return Boolean(job?.queueBlockedReason === "account_needs_login" && !account);
}

function articleStageText(article: ExecutionArticle, job?: PublishingJobRecord) {
  if (isMaterialIssue(job)) return "图片素材缺失";
  return stageLabel(article.stage);
}

function buildLoginPatch(loginResult: Awaited<ReturnType<typeof openPlatformLoginWindow>>) {
  return {
    loginStatus: "authenticated" as const,
    status: "valid" as const,
    lastError: undefined,
    accountName: loginResult.profile?.accountName,
    displayName: loginResult.profile?.displayName,
    platformAccountId: loginResult.profile?.platformAccountId,
    avatarUrl: loginResult.profile?.avatarUrl,
  };
}

function ArticleRow({
  article,
  account,
  busy,
  loginBusy,
  publishUrl,
  onPublishUrlChange,
  onManualDone,
  onManualNotPublished,
  onLogin,
  progress,
}: {
  article: ExecutionArticle;
  account?: PlatformAccountRecord;
  busy: boolean;
  loginBusy: boolean;
  publishUrl: string;
  onPublishUrlChange: (value: string) => void;
  onManualDone: (jobId: string) => void;
  onManualNotPublished: (jobId: string) => void;
  onLogin: (article: ExecutionArticle) => void;
  progress?: PublishProgressSnapshot;
}) {
  const item = article.item;
  const job = article.job;
  const needsLogin = accountNeedsLogin(article, account);
  const materialIssue = isMaterialIssue(job);
  const manualConfirmation = needsManualConfirmation(job);
  const canManualConfirm = Boolean(job && !article.published && !needsLogin && !materialIssue);

  return (
    <article className={`border-b border-line last:border-b-0 ${executionTableMinWidthClass}`}>
      <div className={`grid gap-3 px-4 py-4 text-sm lg:items-center ${executionTableGridClass}`}>
        <span className="text-muted">#{item.sequence}</span>
        <span className="min-w-0 pr-4">
          <span className="block truncate font-semibold leading-6 text-ink">{item.title || item.stageMessage || "等待发布内容"}</span>
          <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{buildBodyPreview(item.body)}</span>
        </span>
        <span className="truncate whitespace-nowrap text-muted">{providerLabels[item.aiPlatform]}</span>
        <span className="truncate whitespace-nowrap text-muted">{platformLabels[item.publishPlatform]}</span>
        <AccountIdentity account={account} fallback={job?.accountName || item.accountName || item.accountId} />
        <span className="whitespace-nowrap text-muted">{formatPlannedTime(job?.plannedPublishTime ?? item.plannedPublishTime)}</span>
        <span className="whitespace-nowrap">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(article)}`}>
            {statusText(article)}
          </span>
        </span>
        <span className="text-muted">{formatDateTime(job?.lastExecutionAt ?? job?.updatedAt ?? item.updatedAt)}</span>
      </div>

      {job && (article.manualPending || job.queueBlockedReason || job.errorMessage || job.publishUrl) ? (
        <div className="mx-4 mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
          <span>记录：{job.id.slice(0, 8)}</span>
          <span>阶段：{articleStageText(article, job)}</span>
          <span>
            重试：{job.retryCount ?? 0}/{job.maxRetries ?? 3}
          </span>
          {job.queueBlockedReason ? <span>队列：{queueLabel(job.queueBlockedReason)}</span> : null}
          {job.queueBlockedReason && job.nextRunAt ? <span>下次执行：{formatDateTime(job.nextRunAt)}</span> : null}
          <span>账号风险：{riskLabel(account?.riskState ?? account?.status ?? job.accountRiskState)}</span>
          {job.publishUrl ? (
            <a className="inline-flex items-center gap-1 text-accent hover:underline" href={job.publishUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              发布链接
            </a>
          ) : null}
        </div>
      ) : null}

      {job && (article.manualPending || canManualConfirm) ? (
        <div className="mx-4 mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-ink">
                {needsLogin ? "账号登录已失效" : materialIssue ? "发布素材缺失" : manualConfirmation ? "平台疑似已发布，等待人工确认" : "待人工处理"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {needsLogin
                  ? "该账号当前不能继续自动发布。请先重新登录账号，登录完成后再继续发布。"
                  : materialIssue
                    ? "账号会话正常，不需要重新登录。当前文章缺少可上传图片，请先在生成结果中补图或改为支持纯文本的发布方式。"
                    : manualConfirmation
                      ? "平台侧可能已经完成发布，但系统未能在限定时间内自动核验成功。人工确认后即可记录发布结果，链接可选填。"
                      : "当前文章需要先完成人工处理后，才能继续后续发布。"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {needsLogin ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  disabled={busy || loginBusy}
                  onClick={() => onLogin(article)}
                >
                  {loginBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  重新登录账号
                </button>
              ) : null}
              {job.publishEntryUrl ? (
                <a
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent"
                  href={job.publishEntryUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  打开创作页
                </a>
              ) : null}
            </div>
          </div>
          {canManualConfirm ? (
            <div className="mt-3 flex flex-col gap-2 lg:flex-row">
              <input
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                value={publishUrl}
                onChange={(event) => onPublishUrlChange(event.target.value)}
                placeholder="选填：粘贴平台已发布文章链接，便于后续追踪"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() => onManualNotPublished(job.id)}
                >
                  <RotateCcw className="h-4 w-4" />
                  确认未发布，重新发布
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  disabled={busy}
                  onClick={() => onManualDone(job.id)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  人工确认已发布
                </button>
              </div>
            </div>
          ) : null}
          {job.notes ? <p className="mt-3 whitespace-pre-line text-xs leading-5 text-muted">{translateMessage(job.notes)}</p> : null}
        </div>
      ) : null}

      {job?.errorMessage && !article.manualPending ? (
        <p className="mx-4 mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-700 dark:text-red-300">
          {translateMessage(job.errorMessage)}
        </p>
      ) : null}

      {progress ? (
        <div className="mx-4 mb-4 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink">当前阶段：{stageLabel(progress.currentStage)}</span>
            <span>最后更新：{formatDateTime(progress.lastUpdatedAt)}</span>
          </div>
          {progress.stageTimeline?.length ? (
            <div className="mt-2 grid gap-1">
              {progress.stageTimeline.slice(-3).map((entry, index) => (
                <p key={`${entry.stage}-${entry.at}-${index}`}>
                  {entry.label}：{entry.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function PublishExecutionWorkbench() {
  const searchParams = useSearchParams();
  const requestedTaskId = searchParams.get("taskId") || "";
  const [state, setState] = useState<ExecutionState | null>(null);
  const [accounts, setAccounts] = useState<PlatformAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginBusyAccountId, setLoginBusyAccountId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualUrls, setManualUrls] = useState<Record<string, string>>({});
  const [pendingNotPublishedJobId, setPendingNotPublishedJobId] = useState("");
  const [liveProgress, setLiveProgress] = useState<Record<string, PublishProgressSnapshot>>({});
  const [resultSearchQuery, setResultSearchQuery] = useState("");

  const articles = state?.articles ?? [];
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const filteredArticles = articles.filter((article) =>
    matchesPublishResultSearch(article, article.job?.accountId ? accountsById.get(article.job.accountId) : accountsById.get(article.item.accountId), resultSearchQuery),
  );
  const hasResultSearch = resultSearchQuery.trim().length > 0;
  const currentArticle = state?.currentArticle ?? null;
  const pendingNotPublishedArticle = pendingNotPublishedJobId
    ? articles.find((article) => article.job?.id === pendingNotPublishedJobId)
    : null;
  const loginRequiredArticle =
    articles.find((article) => accountNeedsLogin(article, article.job?.accountId ? accountsById.get(article.job.accountId) : undefined)) ??
    null;
  const progressPercent = useMemo(() => {
    if (!state?.stats.total) return 0;
    return Math.round((state.stats.published / state.stats.total) * 100);
  }, [state]);

  const runningJobs = useMemo(
    () => articles.map((article) => article.job).filter((job): job is PublishingJobRecord => Boolean(job?.sessionToken && job.status === "running")),
    [articles],
  );

  async function loadState(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true);
    setError("");
    try {
      const [executionResponse, accountsResponse] = await Promise.all([
        fetch(`/api/publish/execution${requestedTaskId ? `?taskId=${encodeURIComponent(requestedTaskId)}` : ""}`, { cache: "no-store" }),
        fetch("/api/publish/accounts", { cache: "no-store" }),
      ]);
      const executionData = (await executionResponse.json()) as ExecutionState;
      const accountsData = (await accountsResponse.json()) as { items?: PlatformAccountRecord[]; error?: string };
      if (!executionResponse.ok) throw new Error(executionData.error || "读取发布进度失败。");
      if (!accountsResponse.ok) throw new Error(accountsData.error || "读取账号状态失败。");
      setState(executionData);
      setAccounts(accountsData.items ?? []);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取发布进度失败。");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  async function patchAccount(accountId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/publish/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = (await response.json()) as { account?: PlatformAccountRecord; error?: string };
    if (!response.ok) throw new Error(payload.error || "更新账号状态失败。");
    return payload.account;
  }

  async function startAccountLogin(article: ExecutionArticle) {
    const accountId = article.job?.accountId || article.item.accountId;
    if (!accountId) {
      setError("当前文章没有绑定发布账号，请先回到账号中心检查。");
      return;
    }

    const licenseGuard = await requireLicensedAction("manage_publish_account");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setLoginBusyAccountId(accountId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/accounts/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: article.item.publishPlatform, accountId }),
      });
      const payload = (await response.json()) as {
        error?: string;
        loginRequest?: {
          accountId?: string;
          platform: string;
          title: string;
          loginUrl?: string;
          sessionPartition?: string;
          loginSessionToken?: string;
        };
      };
      if (!response.ok || !payload.loginRequest) throw new Error(payload.error || "发起账号登录失败。");

      const loginResult = await openPlatformLoginWindow(payload.loginRequest);
      if (loginResult.status === "unsupported") {
        throw new Error("当前未检测到可用桌面桥，请先启动 GEO 桌面版后再登录账号。");
      }
      if (loginResult.status === "opened") {
        setNotice(loginResult.reason ?? `${platformLabels[article.item.publishPlatform]}已在外部浏览器打开，正在等待自动同步账号信息。`);
        const syncedAccount = await waitForExternalLoginSync({
          accountId,
          sessionToken: payload.loginRequest.loginSessionToken,
        });
        if (syncedAccount) {
          setNotice(`${platformLabels[article.item.publishPlatform]}账号已重新登录，已自动同步账号信息。`);
          await loadState({ silent: true });
          dispatchWorkflowStatusRefresh();
          return;
        }
        setNotice(`${platformLabels[article.item.publishPlatform]}已在外部浏览器完成登录，但暂未同步到系统。请重新读取后再继续。`);
        return;
      }

      if (loginResult.status === "authenticated") {
        await patchAccount(accountId, buildLoginPatch(loginResult));
      } else {
        const validation = await validatePlatformSessionWindow({
          platform: article.item.publishPlatform,
          publishUrl: payload.loginRequest.loginUrl,
          sessionPartition: payload.loginRequest.sessionPartition,
        });
        if (validation.status !== "authenticated") {
          throw new Error(validation.reason || "账号登录未完成或会话仍不可用。");
        }
        await patchAccount(accountId, {
          loginStatus: "authenticated",
          status: "valid",
          lastError: undefined,
        });
      }

      setNotice(`${platformLabels[article.item.publishPlatform]}账号已重新登录，请继续执行发布。`);
      await loadState({ silent: true });
      dispatchWorkflowStatusRefresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "账号登录失败。");
    } finally {
      setLoginBusyAccountId("");
    }
  }

  async function runNext() {
    const targetLoginArticle = currentArticle
      ? accountNeedsLogin(currentArticle, currentArticle.job?.accountId ? accountsById.get(currentArticle.job.accountId) : undefined)
        ? currentArticle
        : null
      : loginRequiredArticle;

    if (targetLoginArticle) {
      const confirmed = window.confirm("当前发布账号登录已失效，需要先重新登录。是否现在打开登录窗口？");
      if (confirmed) await startAccountLogin(targetLoginArticle);
      return;
    }

    const licenseGuard = await requireLicensedAction("execute_publish");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_next", taskId: state?.current?.taskId || requestedTaskId || undefined }),
      });
      const data = (await response.json()) as ExecutionState;
      if (!response.ok) throw new Error(data.error || "执行发布失败。");
      setState(data);
      const blockingReason = findBlockingReason(data);
      setNotice(blockingReason ? `本次未执行：${blockingReason}` : "已记录当前文章执行结果。");
      dispatchWorkflowStatusRefresh();
      await loadState({ silent: true });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "执行发布失败。");
    } finally {
      setBusy(false);
    }
  }

  async function markManualDone(jobId: string) {
    const licenseGuard = await requireLicensedAction("execute_publish");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_manual_published",
          taskId: state?.current?.taskId || requestedTaskId || undefined,
          jobId,
          publishUrl: manualUrls[jobId]?.trim() || undefined,
        }),
      });
      const data = (await response.json()) as ExecutionState;
      if (!response.ok) throw new Error(data.error || "回填发布结果失败。");
      setState(data);
      setManualUrls((current) => ({ ...current, [jobId]: "" }));
      setNotice("已人工确认发布结果，可以继续执行剩余文章。");
      dispatchWorkflowStatusRefresh();
      await loadState({ silent: true });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "回填发布结果失败。");
    } finally {
      setBusy(false);
    }
  }

  async function markManualNotPublished(jobId: string) {
    const licenseGuard = await requireLicensedAction("execute_publish");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_manual_not_published",
          taskId: state?.current?.taskId || requestedTaskId || undefined,
          jobId,
        }),
      });
      const data = (await response.json()) as ExecutionState;
      if (!response.ok) throw new Error(data.error || "重新加入发布队列失败。");
      setState(data);
      setManualUrls((current) => ({ ...current, [jobId]: "" }));
      setNotice("已确认平台未发布，文章已重新进入发布队列。");
      dispatchWorkflowStatusRefresh();
      await loadState({ silent: true });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "重新加入发布队列失败。");
    } finally {
      setBusy(false);
      setPendingNotPublishedJobId("");
    }
  }

  useEffect(() => {
    void loadState();
  }, [requestedTaskId]);

  useEffect(() => {
    if (!runningJobs.length) {
      return;
    }

    let cancelled = false;
    async function pollProgress() {
      const entries = await Promise.all(
        runningJobs.map(async (job) => {
          if (!job.sessionToken) return null;
          const progress = await getPlatformPublishProgressWindow({ sessionToken: job.sessionToken });
          return progress ? [job.id, progress] as const : null;
        }),
      );
      if (cancelled) return;
      setLiveProgress((current) => {
        const next = { ...current };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
      await loadState({ silent: true });
    }

    void pollProgress();
    const timer = window.setInterval(() => {
      void pollProgress();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runningJobs]);

  if (loading) {
    return (
      <section className="section-card text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在读取发布进度
        </span>
      </section>
    );
  }

  if (!state?.current) {
    return (
      <div className="space-y-5">
        <section className="section-card">
          <h2 className="page-section-title">还没有发布结果</h2>
          <p className="page-section-desc">先完成内容生成；系统会按计划时间自动创建发布任务并执行。</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/content-pool">
              去内容池
            </Link>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-medium text-ink"
              onClick={() => void loadState()}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </section>
      </div>
    );
  }

  const hasManualConfirmationPending = articles.some((article) => article.job?.status === "verification_failed");
  const allPublished = state.stats.total > 0 && state.stats.remaining === 0;
  const primaryButtonText = loginRequiredArticle && !currentArticle
    ? "重新登录账号"
    : currentArticle
      ? "立即执行到点任务"
      : allPublished
        ? "已全部发布"
        : state.stats.manualPending > 0
          ? "待人工处理"
          : "等待计划时间";

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">第 5 步</p>
            <h2 className="page-section-title mt-2">发布结果</h2>
            <p className="page-section-desc">系统按计划时间自动执行发布；你只需要查看结果，处理需要人工介入的文章。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent disabled:opacity-60"
              disabled={busy || Boolean(loginBusyAccountId)}
              onClick={() => void loadState()}
            >
              <RotateCcw className="h-4 w-4" />
              重新读取
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy || Boolean(loginBusyAccountId) || (!currentArticle && !loginRequiredArticle)}
              onClick={() => void runNext()}
            >
              {busy || loginBusyAccountId ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : loginRequiredArticle && !currentArticle ? (
                <LogIn className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {primaryButtonText}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="subtle-card">
            <p className="text-xs text-muted">总文章</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{state.stats.total}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">已发布</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{state.stats.published}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">剩余未发布</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{state.stats.remaining}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">手动待处理</p>
            <p className="mt-2 text-2xl font-semibold text-amber-600">{state.stats.manualPending}</p>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-ink">当前进度</span>
            <span className="text-muted">{progressPercent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="mt-4 grid gap-3 text-sm text-muted md:grid-cols-4">
            <span>平台：{currentArticle ? platformLabels[currentArticle.item.publishPlatform] : "--"}</span>
            <span className="min-w-0">
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className="shrink-0">账号：</span>
                {currentArticle?.job?.accountId ? (
                  <AccountIdentity account={accountsById.get(currentArticle.job.accountId)} fallback={currentArticle.item.accountName} />
                ) : (
                  "--"
                )}
              </span>
            </span>
            <span>文章：{currentArticle ? `#${currentArticle.item.sequence}` : "--"}</span>
            <span>最近处理：{formatDateTime(state.latestExecutionTime)}</span>
          </div>
        </div>

        {!currentArticle && state.stats.remaining > 0 ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {loginRequiredArticle
              ? "剩余文章需要先重新登录发布账号。"
              : hasManualConfirmationPending
                ? "有文章在平台疑似已发布，等待人工确认。"
                : state.stats.manualPending > 0
                  ? "剩余文章需要先完成人工处理。"
                  : "剩余文章需要先完成风险处理后再继续发布。"}
          </p>
        ) : null}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        {notice && <p className="mt-4 text-sm text-accent">{notice}</p>}
      </section>

      <section className="overflow-x-auto rounded-md border border-line bg-panel">
        <div className="flex flex-col gap-2 border-b border-line bg-panelSoft p-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={resultSearchQuery}
              onChange={(event) => setResultSearchQuery(event.target.value)}
              placeholder="搜索标题、正文、平台、账号、状态"
              className="h-10 w-full rounded-md border border-line bg-panel px-9 text-sm text-ink outline-none transition focus:border-accent"
            />
            {hasResultSearch ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink"
                aria-label="清空发布结果搜索"
                onClick={() => setResultSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <span className="text-xs text-muted">
            {hasResultSearch ? `已筛选 ${filteredArticles.length}/${articles.length} 篇` : `共 ${articles.length} 篇发布结果`}
          </span>
        </div>
        <div className={`hidden border-b border-line bg-surface px-4 py-2 text-xs font-medium text-muted lg:grid lg:items-center ${executionTableGridClass} ${executionTableMinWidthClass}`}>
          <span>序号</span>
          <span>标题</span>
          <span>AI 平台</span>
          <span>发布平台</span>
          <span>账号</span>
          <span>计划时间</span>
          <span>状态</span>
          <span>最近处理</span>
        </div>
        {filteredArticles.map((article) => (
          <ArticleRow
            key={article.item.id}
            article={article}
            account={article.job?.accountId ? accountsById.get(article.job.accountId) : accountsById.get(article.item.accountId)}
            busy={busy}
            loginBusy={Boolean(loginBusyAccountId && loginBusyAccountId === (article.job?.accountId || article.item.accountId))}
            publishUrl={article.job ? manualUrls[article.job.id] ?? "" : ""}
            onPublishUrlChange={(value) => {
              if (!article.job) return;
              setManualUrls((current) => ({ ...current, [article.job!.id]: value }));
            }}
            onManualDone={(jobId) => void markManualDone(jobId)}
            onManualNotPublished={(jobId) => setPendingNotPublishedJobId(jobId)}
            onLogin={(target) => void startAccountLogin(target)}
            progress={article.job ? liveProgress[article.job.id] : undefined}
          />
        ))}
        {filteredArticles.length === 0 ? (
          <div className={`${executionTableMinWidthClass} px-4 py-8 text-center text-sm text-muted`}>
            没有匹配的发布结果，请调整搜索关键词。
          </div>
        ) : null}
      </section>
      {pendingNotPublishedJobId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
          <div className="w-full max-w-md rounded-md border border-line bg-panel p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600">
                <RotateCcw className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink">确认未发布并重新发布</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  请先确认该平台账号后台没有这篇文章。确认后系统会清理本次不确定发布记录，并把文章重新放回发布队列。
                </p>
                {pendingNotPublishedArticle ? (
                  <p className="mt-3 truncate rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
                    {pendingNotPublishedArticle.item.title || `文章 #${pendingNotPublishedArticle.item.sequence}`}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent disabled:opacity-60"
                disabled={busy}
                onClick={() => setPendingNotPublishedJobId("")}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={busy}
                onClick={() => void markManualNotPublished(pendingNotPublishedJobId)}
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                确认重新发布
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
