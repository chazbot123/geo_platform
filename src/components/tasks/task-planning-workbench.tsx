"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2, LoaderCircle, LogIn, PlayCircle, RefreshCw, Save, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { requireLicensedAction } from "@/lib/license/guard";
import { formatAccountDisplayLabel, resolveAccountIdentifier } from "@/lib/publish/account-label";
import {
  auditPlatformAccountSession,
  buildDesktopSessionFailureReason,
  PLATFORM_SESSION_AUDIT_INTERVAL_MS,
} from "@/lib/publish/account-session-validator";
import { openPlatformLoginWindow, validatePlatformSessionWindow } from "@/lib/publish/electron-login-client";
import { waitForExternalLoginSync } from "@/lib/publish/external-login-sync";
import { getPlatformsBySearchProvider, providerPublishMatrix } from "@/lib/publish/provider-platform-matrix";
import { getSearchProviderIcon, getSocialPlatformIcon } from "@/lib/platform-icons";
import { DEFAULT_EXPECTED_IMAGE_COUNT, MAX_EXPECTED_IMAGE_COUNT, normalizeExpectedImageCount } from "@/lib/tasks/constants";
import type {
  PlatformAccountDetectionItem,
  PlatformAccountRecord,
  ProductProfile,
  PublishTaskPlan,
  SearchProvider,
  SocialPlatform,
  ThemeSet,
} from "@/lib/types";

const providerOrder: SearchProvider[] = ["doubao", "yuanbao", "deepseek", "tongyi"];
const ACCOUNT_DELETE_TIMEOUT_MS = 15000;

const providerLabels: Record<SearchProvider, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "腾讯元宝",
  tongyi: "通义千问",
};

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
const DEBUG_SERVER_URL = "http://127.0.0.1:7778/event";
const DEBUG_SESSION_ID = "account-info-fetch";

function shouldEmitDebugEvents() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("geo-debug-events") === "1";
  } catch {
    return false;
  }
}

function emitDebug(hypothesisId: string, location: string, msg: string, data: Record<string, unknown>) {
  // #region debug-point shared:emit
  if (!shouldEmitDebugEvents()) return;
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

interface PlanningPrerequisites {
  enterpriseReady: boolean;
  keywordReady: boolean;
  enterpriseTaskId?: string;
  keywordTaskId?: string;
  taskId?: string;
  product?: ProductProfile;
  theme?: ThemeSet;
  selectedQuestions: string[];
  savedPlan?: PublishTaskPlan;
  expectedImageCount?: number;
}

interface DetectionResponse {
  items: PlatformAccountDetectionItem[];
  cacheTtlMinutes: number;
}

interface AccountsResponse {
  items: PlatformAccountRecord[];
  error?: string;
}

function formatTimeWindow(start: string, end: string) {
  return `${start}-${end}`;
}

function isValidTimeValue(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function formatTime(value?: string) {
  if (!value) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getRecentValidationTime(account: PlatformAccountRecord) {
  return account.lastValidatedAt ?? account.lastLoginCompletedAt;
}

function normalizePositiveInteger(value: string, fallback: number, min = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function sanitizePositiveIntegerInput(raw: string) {
  return raw.replace(/[^\d]/g, "");
}

function statusText(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated" && account.status === "valid") return "可发布";
  if (account.loginStatus === "authenticated") return "已登录";
  if (account.loginStatus === "pending") return "待确认";
  if (account.loginStatus === "failed") return "已失效";
  if (account.loginStatus === "cancelled") return "已取消";
  return "未登录";
}

function statusClassName(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated" && account.status === "valid") return "text-emerald-500";
  if (account.loginStatus === "failed" || account.status === "invalid") return "text-red-500";
  if (account.loginStatus === "pending") return "text-amber-500";
  return "text-muted";
}

function platformSummary(plan?: PublishTaskPlan) {
  if (!plan) return "尚未保存任务";
  const enabled = plan.enabledPlatforms.filter((item) => item.enabled);
  if (!enabled.length) return "暂无可发布账号";
  return enabled.map((item) => `${platformLabels[item.platform]} ${item.accountCount} 个`).join("，");
}

function normalizePlatformSelection(platforms: SocialPlatform[]) {
  return Array.from(new Set(platforms)).sort();
}

function areSamePlatformSelections(left: SocialPlatform[], right: SocialPlatform[]) {
  const normalizedLeft = normalizePlatformSelection(left);
  const normalizedRight = normalizePlatformSelection(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((platform, index) => platform === normalizedRight[index]);
}

function validationFailureText(status: string, reason?: string) {
  if (status === "unsupported") return "当前环境无法打开桌面登录，请启动 GEO 桌面版。";
  return buildDesktopSessionFailureReason(status, reason);
}

function buildLoginSuccessPatch(loginResult: Awaited<ReturnType<typeof openPlatformLoginWindow>>) {
  const patch: Record<string, unknown> = {
    loginStatus: "authenticated" as const,
    status: "valid" as const,
    lastError: undefined,
    accountName: loginResult.profile?.accountName,
    displayName: loginResult.profile?.displayName,
    platformAccountId: loginResult.profile?.platformAccountId,
    avatarUrl: loginResult.profile?.avatarUrl,
  };
  if (typeof loginResult.authPayload === "string" && loginResult.authPayload.trim()) {
    patch.authPayload = loginResult.authPayload.trim();
    patch.authPayloadUpdatedAt = loginResult.authPayloadUpdatedAt ?? loginResult.validatedAt;
  }
  if (loginResult.validatedAt) {
    patch.lastValidatedAt = loginResult.validatedAt;
  }
  return patch;
}

function buildValidatedSessionPatch(result: Awaited<ReturnType<typeof validatePlatformSessionWindow>>) {
  const patch: Record<string, unknown> = {
    loginStatus: "authenticated" as const,
    status: "valid" as const,
    lastError: undefined,
  };
  if (typeof result.authPayload === "string" && result.authPayload.trim()) {
    patch.authPayload = result.authPayload.trim();
    patch.authPayloadUpdatedAt = result.authPayloadUpdatedAt ?? result.validatedAt;
  }
  if (result.validatedAt) {
    patch.lastValidatedAt = result.validatedAt;
  }
  return patch;
}

function accountActionLabel(account: PlatformAccountRecord) {
  if (account.loginStatus === "authenticated" && account.status === "valid") {
    return "校验";
  }
  if (account.loginStatus === "failed" || account.status === "invalid") {
    return "重新登录";
  }
  return "登录";
}

function resolveInlineAvatarSrc(avatarUrl: string | undefined, fallback: string) {
  const normalized = String(avatarUrl || "").trim();
  if (!normalized) return fallback;
  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
    return /(\.|^)sinaimg\.cn$/i.test(parsed.hostname) ? fallback : normalized;
  } catch {
    return fallback;
  }
}

function AccountAvatar({ account, platform }: { account: PlatformAccountRecord; platform: SocialPlatform }) {
  const fallback = getSocialPlatformIcon(platform);
  return (
    <span className="flex h-11 w-11 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
      <img
        className="h-full w-full object-cover"
        src={resolveInlineAvatarSrc(account.avatarUrl, fallback)}
        alt={`${formatAccountDisplayLabel(account, account.id) || account.id} 头像`}
        onError={(event) => {
          event.currentTarget.src = fallback;
        }}
      />
    </span>
  );
}

function EmptyAvatar({ platform }: { platform: SocialPlatform }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-surface">
      <img className="h-6 w-6 object-contain" src={getSocialPlatformIcon(platform)} alt="" />
    </span>
  );
}

export function TaskPlanningWorkbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTaskId = searchParams.get("taskId")?.trim() ?? "";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [loginKey, setLoginKey] = useState("");
  const [removingKey, setRemovingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prerequisites, setPrerequisites] = useState<PlanningPrerequisites | null>(null);
  const [searchProvider, setSearchProvider] = useState<SearchProvider>("doubao");
  const [enabledPlatforms, setEnabledPlatforms] = useState<SocialPlatform[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<SocialPlatform>("toutiao");
  const [daysInput, setDaysInput] = useState("5");
  const [articlesPerAccountPerDayInput, setArticlesPerAccountPerDayInput] = useState("2");
  const [expectedImageCountInput, setExpectedImageCountInput] = useState(String(DEFAULT_EXPECTED_IMAGE_COUNT));
  const [publishStartTime, setPublishStartTime] = useState("09:00");
  const [publishEndTime, setPublishEndTime] = useState("18:00");
  const [detectionItems, setDetectionItems] = useState<PlatformAccountDetectionItem[]>([]);
  const [accounts, setAccounts] = useState<PlatformAccountRecord[]>([]);
  const accountsRef = useRef<PlatformAccountRecord[]>([]);
  const sessionAuditRunningRef = useRef(false);
  const initialSessionAuditDoneRef = useRef(false);

  const mappedPlatforms = useMemo(() => getPlatformsBySearchProvider(searchProvider), [searchProvider]);
  const detectionByPlatform = useMemo(() => new Map(detectionItems.map((item) => [item.platform, item])), [detectionItems]);
  const enabledSet = useMemo(() => new Set(enabledPlatforms), [enabledPlatforms]);
  const publishableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.loginStatus === "authenticated" &&
          (account.status === "valid" || account.status === "active") &&
          (!account.riskState || account.riskState === "active") &&
          account.provider === "electron" &&
          account.authType !== "manual",
      ),
    [accounts],
  );
  const publishableAccountCountByPlatform = useMemo(() => {
    const counts = new Map<SocialPlatform, number>();
    for (const account of publishableAccounts) {
      counts.set(account.platform, (counts.get(account.platform) ?? 0) + 1);
    }
    return counts;
  }, [publishableAccounts]);
  const selectedDetection = detectionByPlatform.get(selectedPlatform);
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => account.platform === selectedPlatform),
    [accounts, selectedPlatform],
  );
  const normalizedDays = normalizePositiveInteger(daysInput, 5, 1);
  const normalizedArticlesPerAccountPerDay = normalizePositiveInteger(articlesPerAccountPerDayInput, 2, 1);
  const normalizedExpectedImageCount = normalizeExpectedImageCount(Number.parseInt(expectedImageCountInput, 10));
  const isTimeWindowValid =
    isValidTimeValue(publishStartTime) && isValidTimeValue(publishEndTime) && publishStartTime < publishEndTime;
  const taskScopedAccountCount = enabledPlatforms.reduce(
    (total, platform) => total + (publishableAccountCountByPlatform.get(platform) ?? 0),
    0,
  );
  const totalAccounts = publishableAccounts.length;
  const totalArticles = totalAccounts * normalizedDays * normalizedArticlesPerAccountPerDay;
  const taskScopedArticles = taskScopedAccountCount * normalizedDays * normalizedArticlesPerAccountPerDay;
  const canSave = Boolean(
    prerequisites?.enterpriseReady &&
      prerequisites.keywordReady &&
      prerequisites.taskId &&
      taskScopedAccountCount > 0 &&
      isTimeWindowValid,
  );
  const hasPlanChanges = useMemo(() => {
    const savedPlan = prerequisites?.savedPlan;
    if (!savedPlan) {
      return false;
    }
    const savedEnabledPlatforms = savedPlan.enabledPlatforms.filter((item) => item.enabled).map((item) => item.platform);
    return !(
      savedPlan.searchProvider === searchProvider &&
      savedPlan.days === normalizedDays &&
      savedPlan.articlesPerAccountPerDay === normalizedArticlesPerAccountPerDay &&
      normalizeExpectedImageCount(prerequisites?.expectedImageCount) === normalizedExpectedImageCount &&
      (savedPlan.timeWindow?.start ?? "09:00") === publishStartTime &&
      (savedPlan.timeWindow?.end ?? "18:00") === publishEndTime &&
      areSamePlatformSelections(savedEnabledPlatforms, enabledPlatforms)
    );
  }, [
    articlesPerAccountPerDayInput,
    enabledPlatforms,
    normalizedArticlesPerAccountPerDay,
    normalizedExpectedImageCount,
    normalizedDays,
    prerequisites?.expectedImageCount,
    prerequisites?.savedPlan,
    publishEndTime,
    publishStartTime,
    searchProvider,
  ]);
  const savedPlanReady = Boolean(prerequisites?.savedPlan && !hasPlanChanges && (prerequisites.savedPlan.totalArticleCount ?? 0) > 0);
  const hasSavedPlan = Boolean(prerequisites?.savedPlan);
  const enterpriseReady = Boolean(prerequisites?.enterpriseReady);
  const keywordReady = Boolean(prerequisites?.keywordReady);
  const auditableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.loginStatus === "authenticated" &&
          account.provider === "electron" &&
          account.authType !== "manual" &&
          Boolean(account.sessionPartition),
      ),
    [accounts],
  );

  async function loadAccounts() {
    const response = await fetch("/api/publish/accounts", { cache: "no-store" });
    const data = (await response.json()) as AccountsResponse;
    if (!response.ok) throw new Error(data.error || "读取账号失败。");
    setAccounts(data.items ?? []);
  }

  async function loadPrerequisites() {
    setLoading(true);
    setError("");
    try {
      const query = requestedTaskId ? `?taskId=${encodeURIComponent(requestedTaskId)}` : "";
      const response = await fetch(`/api/tasks/plan${query}`, { cache: "no-store" });
      const data = (await response.json()) as PlanningPrerequisites & { error?: string };
      if (!response.ok) throw new Error(data.error || "读取任务规划失败。");
      setPrerequisites(data);
      if (data.savedPlan) {
        setSearchProvider(data.savedPlan.searchProvider);
        setDaysInput(String(data.savedPlan.days));
        setArticlesPerAccountPerDayInput(String(data.savedPlan.articlesPerAccountPerDay));
        setExpectedImageCountInput(String(normalizeExpectedImageCount(data.expectedImageCount)));
        setPublishStartTime(data.savedPlan.timeWindow?.start ?? "09:00");
        setPublishEndTime(data.savedPlan.timeWindow?.end ?? "18:00");
        const savedPlatforms = data.savedPlan.enabledPlatforms.filter((item) => item.enabled).map((item) => item.platform);
        setEnabledPlatforms(savedPlatforms);
        setSelectedPlatform(savedPlatforms[0] ?? getPlatformsBySearchProvider(data.savedPlan.searchProvider)[0]);
      } else {
        setExpectedImageCountInput(String(normalizeExpectedImageCount(data.expectedImageCount)));
      }
      await loadAccounts();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取任务规划失败。");
    } finally {
      setLoading(false);
    }
  }

  async function detectAccounts(forceRefresh = false) {
    setDetecting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/accounts/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchProvider, platforms: mappedPlatforms, forceRefresh }),
      });
      const data = (await response.json()) as DetectionResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "账号检测失败。");
      setDetectionItems(data.items);
      const publishablePlatforms = mappedPlatforms.filter((platform) => {
        const item = data.items.find((current) => current.platform === platform);
        return (item?.accountCount ?? 0) > 0;
      });
      setEnabledPlatforms(publishablePlatforms);
      await loadAccounts();
      setNotice(forceRefresh ? "账号状态已刷新。" : "已同步账号状态。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "账号检测失败。");
    } finally {
      setDetecting(false);
    }
  }

  async function patchAccountStatus(accountId: string, patch: Record<string, unknown>) {
    // #region debug-point B:task-send-patch
    emitDebug("B", "task-planning-workbench.tsx:patchAccountStatus:before", "任务页发送账号 patch", {
      accountId,
      loginStatus: patch.loginStatus ?? null,
      status: patch.status ?? null,
      accountName: typeof patch.accountName === "string" ? patch.accountName : null,
      displayName: typeof patch.displayName === "string" ? patch.displayName : null,
      platformAccountId: typeof patch.platformAccountId === "string" ? patch.platformAccountId : null,
      avatarUrl: typeof patch.avatarUrl === "string" ? patch.avatarUrl : null,
      lastError: typeof patch.lastError === "string" ? patch.lastError : null,
    });
    // #endregion
    const response = await fetch(`/api/publish/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error || "更新账号状态失败。");
    // #region debug-point C:task-patch-response
    emitDebug("C", "task-planning-workbench.tsx:patchAccountStatus:after", "任务页收到账号 patch 返回", {
      accountId,
      responseOk: response.ok,
    });
    // #endregion
  }

  async function runSilentSessionAudit(trigger: "initial" | "interval") {
    if (sessionAuditRunningRef.current) {
      return;
    }
    const currentAccounts = accountsRef.current.filter(
      (account) =>
        account.loginStatus === "authenticated" &&
        account.provider === "electron" &&
        account.authType !== "manual" &&
        Boolean(account.sessionPartition),
    );
    if (!currentAccounts.length) {
      return;
    }

    sessionAuditRunningRef.current = true;
    try {
      let verifiedCount = 0;
      let downgradedCount = 0;

      for (const account of currentAccounts) {
        const audit = await auditPlatformAccountSession(account);
        if (!audit.canAutoValidate || !audit.patch) {
          continue;
        }
        await patchAccountStatus(account.id, {
          action: "session_audit",
          ...audit.patch,
        });
        if (audit.validationStatus === "authenticated") {
          verifiedCount += 1;
        } else {
          downgradedCount += 1;
        }
      }

      if (!verifiedCount && !downgradedCount) {
        return;
      }

      await loadAccounts();
      dispatchWorkflowStatusRefresh();
      if (downgradedCount > 0) {
        setNotice(`已静默检查账号状态：${verifiedCount} 个仍在线，${downgradedCount} 个已掉线，请重新登录。`);
        return;
      }
      if (trigger === "initial") {
        setNotice(`已静默检查账号状态：${verifiedCount} 个账号仍在线，会话时间已同步。`);
      }
    } catch (currentError) {
      if (trigger === "initial") {
        setError(currentError instanceof Error ? currentError.message : "静默检查账号状态失败。");
      }
    } finally {
      sessionAuditRunningRef.current = false;
    }
  }

  async function startLogin(platform: SocialPlatform, accountId?: string) {
    setLoginKey(accountId ?? platform);
    setError("");
    setNotice("");
    let loginSucceeded = false;
    try {
      const response = await fetch("/api/publish/accounts/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, accountId }),
      });
      const payload = (await response.json()) as {
        account?: PlatformAccountRecord;
        loginRequest?: {
          accountId?: string;
          platform: string;
          title: string;
          loginUrl?: string;
          sessionPartition?: string;
          loginSessionToken?: string;
        };
        error?: string;
      };
      if (!response.ok || !payload.account?.id || !payload.loginRequest) {
        throw new Error(payload.error || "发起平台登录失败。");
      }

      const loginResult = await openPlatformLoginWindow(payload.loginRequest);
      // #region debug-point A:task-login-result
      emitDebug("A", "task-planning-workbench.tsx:startLogin:loginResult", "任务页收到桌面登录结果", {
        accountId: payload.account.id,
        platform,
        status: loginResult.status,
        reason: loginResult.reason ?? null,
        accountName: loginResult.profile?.accountName ?? null,
        displayName: loginResult.profile?.displayName ?? null,
        platformAccountId: loginResult.profile?.platformAccountId ?? null,
        avatarUrl: loginResult.profile?.avatarUrl ?? null,
        sourceUrl: loginResult.profile?.sourceUrl ?? null,
      });
      // #endregion
      if (loginResult.status === "unsupported") {
        throw new Error("当前环境缺少桌面登录桥，请启动 GEO 桌面版。");
      }
      if (loginResult.status === "opened") {
        setNotice(loginResult.reason ?? `${platformLabels[platform]}已在外部浏览器打开，正在等待自动同步账号信息。`);
        const syncedAccount = await waitForExternalLoginSync({
          accountId: payload.account.id,
          sessionToken: payload.loginRequest.loginSessionToken,
        });
        if (syncedAccount) {
          await detectAccounts(true);
          setEnabledPlatforms((current) => (current.includes(platform) ? current : [...current, platform]));
          setNotice(`${platformLabels[platform]}账号已登录，已自动同步账号信息。`);
          window.dispatchEvent(new Event("geo-workflow-status-refresh"));
          return;
        }
        setNotice(`${platformLabels[platform]}已在外部浏览器完成登录，但暂未同步到系统。请刷新账号状态后再继续。`);
        return;
      }

      if (loginResult.status === "authenticated") {
        await patchAccountStatus(payload.account.id, buildLoginSuccessPatch(loginResult));
        setNotice(`${platformLabels[platform]}账号已登录，已自动同步账号信息。`);
        loginSucceeded = true;
      } else {
        const validation = await validatePlatformSessionWindow({
          platform,
          publishUrl: payload.loginRequest.loginUrl,
          sessionPartition: payload.loginRequest.sessionPartition,
        });

        if (validation.status === "authenticated") {
          await patchAccountStatus(payload.account.id, buildValidatedSessionPatch(validation));
          setNotice(`${platformLabels[platform]}账号已登录，可用于发布。`);
          loginSucceeded = true;
        } else {
          const lastError = validationFailureText(validation.status, validation.reason);
          await patchAccountStatus(payload.account.id, {
            loginStatus: "failed",
            status: "invalid",
            lastError,
          });
          setError(`${platformLabels[platform]}登录未完成：${lastError}`);
        }
      }

      await detectAccounts(true);
      if (loginSucceeded) {
        setEnabledPlatforms((current) => (current.includes(platform) ? current : [...current, platform]));
      }
      window.dispatchEvent(new Event("geo-workflow-status-refresh"));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "发起平台登录失败。");
      await loadAccounts().catch(() => undefined);
    } finally {
      setLoginKey("");
    }
  }

  async function verifyAccountSession(account: PlatformAccountRecord) {
    setLoginKey(account.id);
    setError("");
    setNotice("");
    try {
      const audit = await auditPlatformAccountSession(account);
      if (!audit.canAutoValidate || !audit.patch) {
        throw new Error(audit.summary || "当前无法校验账号会话。");
      }
      await patchAccountStatus(account.id, {
        action: "session_audit",
        ...audit.patch,
      });
      await loadAccounts();
      dispatchWorkflowStatusRefresh();
      if (audit.validationStatus === "authenticated") {
        setNotice(`${platformLabels[account.platform]}账号会话校验通过。`);
        return;
      }
      setNotice(`${platformLabels[account.platform]}账号已失效，请重新登录。`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "账号会话校验失败。");
    } finally {
      setLoginKey("");
    }
  }

  async function removeAccount(account: PlatformAccountRecord) {
    const accountLabel = formatAccountDisplayLabel(account, account.id) || account.id;
    const confirmed = window.confirm(`确定移除 ${platformLabels[account.platform]} 账号「${accountLabel}」吗？移除后会从已保存任务和内容绑定中摘除，不再加入当前任务。`);
    if (!confirmed) return;

    setRemovingKey(account.id);
    setError("");
    setNotice("");
    try {
      const response = await fetchWithTimeout(
        `/api/publish/accounts/${account.id}`,
        {
        method: "DELETE",
        },
        ACCOUNT_DELETE_TIMEOUT_MS,
        `${platformLabels[account.platform]}账号删除超时，请稍后重试。若该账号绑定的任务较多，请刷新后确认是否已删除。`,
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "移除账号失败。");
      setNotice(`${platformLabels[account.platform]}账号已移除。`);
      await loadAccounts();
      await detectAccounts(true);
      window.dispatchEvent(new Event("geo-workflow-status-refresh"));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "移除账号失败。");
    } finally {
      setRemovingKey("");
    }
  }

  async function savePlan(options?: { startGenerationAfterSave?: boolean }) {
    if (!prerequisites?.taskId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/tasks/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: prerequisites.taskId,
          searchProvider,
          enabledPlatforms,
          days: normalizedDays,
          articlesPerAccountPerDay: normalizedArticlesPerAccountPerDay,
          expectedImageCount: normalizedExpectedImageCount,
          timeWindow: {
            start: publishStartTime,
            end: publishEndTime,
          },
          forceRefreshAccounts: true,
        }),
      });
      const data = (await response.json()) as { publishPlan?: PublishTaskPlan; error?: string };
      if (!response.ok || !data.publishPlan) throw new Error(data.error || "保存任务规划失败。");
      setPrerequisites((current) =>
        current ? { ...current, savedPlan: data.publishPlan, expectedImageCount: normalizedExpectedImageCount } : current,
      );
      dispatchWorkflowStatusRefresh();
      if (options?.startGenerationAfterSave) {
        setNotice("计划已更新，正在开始生成并按计划发布。");
        await startGeneration(data.publishPlan.taskId);
        return;
      }
      setNotice("计划已保存，可以开始生成并按计划发布。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "保存任务规划失败。");
    } finally {
      setSaving(false);
    }
  }

  async function startGeneration(taskId = prerequisites?.savedPlan?.taskId) {
    if (!taskId) return;
    const licenseGuard = await requireLicensedAction("generate_content");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setStartingGeneration(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/content/generation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "启动生成失败。");
      dispatchWorkflowStatusRefresh();
      setNotice("已开始生成，系统会按计划时间自动发布，正在进入生成结果中心。");
      router.push(`/content-pool?taskId=${encodeURIComponent(taskId)}`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "启动生成失败。");
    } finally {
      setStartingGeneration(false);
    }
  }

  useEffect(() => {
    void loadPrerequisites();
  }, [requestedTaskId]);

  useEffect(() => {
    setEnabledPlatforms((current) => {
      const currentSet = new Set(current);
      return mappedPlatforms.filter((platform) => currentSet.has(platform));
    });
    setSelectedPlatform((current) => (mappedPlatforms.includes(current) ? current : mappedPlatforms[0]));
  }, [mappedPlatforms]);

  useEffect(() => {
    void detectAccounts(false);
  }, [searchProvider]);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    if (initialSessionAuditDoneRef.current || loading) {
      return;
    }
    initialSessionAuditDoneRef.current = true;
    if (auditableAccounts.length) {
      void runSilentSessionAudit("initial");
    }
  }, [auditableAccounts.length, loading]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void runSilentSessionAudit("interval");
    }, PLATFORM_SESSION_AUDIT_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const refreshAccountsView = () => {
      void detectAccounts(true);
    };
    window.addEventListener("geo-platform-accounts-refresh", refreshAccountsView);
    return () => {
      window.removeEventListener("geo-platform-accounts-refresh", refreshAccountsView);
    };
  }, [searchProvider]);

  if (loading) {
    return <div className="section-card text-sm text-muted">正在读取企业信息和客户问题。</div>;
  }

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-accent" />
            <div>
              <h3 className="page-section-title">平台与账号</h3>
              <p className="page-section-desc">这里会展示当前 GEO AI 平台对应的发布平台，以及每个平台已登录的可用账号。</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={detecting}
            onClick={() => void detectAccounts(true)}
          >
            <RefreshCw className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            刷新账号状态
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[190px_230px_minmax(0,1fr)]">
          <nav className="grid content-start gap-2" aria-label="GEO AI 平台">
            {providerOrder.map((provider) => {
              const bundle = providerPublishMatrix[provider];
              const selected = provider === searchProvider;
              return (
                <button
                  key={provider}
                  type="button"
                  className={`flex min-h-[68px] items-center gap-3 rounded-md border px-3 py-3 text-left transition ${
                    selected ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/50"
                  }`}
                  onClick={() => setSearchProvider(provider)}
                >
                  <img className="h-8 w-8 shrink-0 object-contain" src={getSearchProviderIcon(provider)} alt="" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{providerLabels[provider]}</span>
                    <span className="mt-1 block truncate text-xs text-muted">{bundle.platforms.map((platform) => platformLabels[platform]).join(" / ")}</span>
                  </span>
                  {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              );
            })}
          </nav>

          <nav className="grid content-start gap-2" aria-label="发布平台">
            {mappedPlatforms.map((platform) => {
              const detection = detectionByPlatform.get(platform);
              const enabled = enabledSet.has(platform);
              const selected = selectedPlatform === platform;
              const accountCount = detection?.accountCount ?? 0;
              return (
                <button
                  key={platform}
                  type="button"
                  className={`rounded-md border px-3 py-3 text-left transition ${
                    selected ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/50"
                  }`}
                  onClick={() => setSelectedPlatform(platform)}
                >
                  <span className="flex items-center gap-3">
                    <img className="h-7 w-7 shrink-0 object-contain" src={getSocialPlatformIcon(platform)} alt="" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{platformLabels[platform]}</span>
                      <span className="mt-1 block text-xs text-muted">{accountCount} 个可发布账号</span>
                    </span>
                    <span
                      className={`h-3.5 w-3.5 rounded border ${
                        enabled ? "border-accent bg-accent" : "border-line bg-panel"
                      }`}
                      aria-hidden
                    />
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 rounded-md border border-line bg-surface p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <img className="h-9 w-9 shrink-0 object-contain" src={getSocialPlatformIcon(selectedPlatform)} alt="" />
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-ink">{platformLabels[selectedPlatform]}账号</h4>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink">
                <input
                  className="h-4 w-4 accent-[var(--accent)]"
                  type="checkbox"
                  disabled
                  checked={enabledSet.has(selectedPlatform)}
                  onChange={() => undefined}
                />
                自动加入任务
              </label>
            </div>

            <div className="mt-4 grid gap-3">
              <button
                type="button"
                className="flex items-center justify-between gap-3 rounded-md border border-dashed border-line bg-panel px-4 py-3 text-left transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(loginKey)}
                onClick={() => void startLogin(selectedPlatform)}
              >
                <span className="flex items-center gap-3">
                  <EmptyAvatar platform={selectedPlatform} />
                  <span>
                    <span className="block text-sm font-semibold text-ink">添加{platformLabels[selectedPlatform]}账号</span>
                    <span className="mt-1 block text-xs text-muted">打开桌面登录窗口完成登录，登录成功后会自动同步到这里。</span>
                  </span>
                </span>
                {loginKey === selectedPlatform ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" /> : <LogIn className="h-4 w-4 text-accent" />}
              </button>

              {selectedAccounts.length ? (
                selectedAccounts.map((account) => (
                  <div key={account.id} className="rounded-md border border-line bg-panel px-4 py-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <AccountAvatar account={account} platform={selectedPlatform} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-ink">{formatAccountDisplayLabel(account, account.id) || account.id}</p>
                            <span className={`text-xs font-medium ${statusClassName(account)}`}>{statusText(account)}</span>
                          </div>
                          {account.accountName || account.platformAccountId ? (
                            <p className="mt-1 break-all text-xs text-muted">登录账号：{resolveAccountIdentifier(account, account.id)}</p>
                          ) : null}
                          {getRecentValidationTime(account) ? (
                            <p className="mt-1 text-xs text-muted">最近校验时间：{formatTime(getRecentValidationTime(account))}</p>
                          ) : null}
                          {account.lastError ? <p className="mt-2 text-xs leading-5 text-red-500">{account.lastError}</p> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={Boolean(loginKey) || Boolean(removingKey)}
                          onClick={() =>
                            void (account.loginStatus === "authenticated" && account.status === "valid"
                              ? verifyAccountSession(account)
                              : startLogin(account.platform, account.id))
                          }
                        >
                          {loginKey === account.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                          {accountActionLabel(account)}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:text-red-300 dark:hover:border-red-400 dark:hover:bg-red-500/10"
                          disabled={Boolean(loginKey) || Boolean(removingKey)}
                          onClick={() => void removeAccount(account)}
                        >
                          {removingKey === account.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          移除
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                  当前平台暂无账号记录，请先登录一个账号。
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-2 border-t border-line pt-4 text-xs leading-5 text-muted sm:grid-cols-3">
              <p>可用账号：{selectedDetection?.accountCount ?? 0}</p>
              <p>未加入任务：{selectedDetection?.ignoredCount ?? 0}</p>
              <p>
                预计文章数：
                {enabledSet.has(selectedPlatform)
                  ? (selectedDetection?.accountCount ?? 0) * normalizedDays * normalizedArticlesPerAccountPerDay
                  : 0}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-accent" />
          <h3 className="page-section-title">发布节奏与文章总量</h3>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mt-4 grid gap-4 sm:grid-cols-5">
              <label className="block">
                <span className="text-xs text-muted">发布天数</span>
                <input
                  className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  min={1}
                  type="number"
                  inputMode="numeric"
                  value={daysInput}
                  onChange={(event) => setDaysInput(sanitizePositiveIntegerInput(event.target.value))}
                  onBlur={() => setDaysInput(String(normalizedDays))}
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">每账号每天</span>
                <input
                  className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  min={1}
                  type="number"
                  inputMode="numeric"
                  value={articlesPerAccountPerDayInput}
                  onChange={(event) => setArticlesPerAccountPerDayInput(sanitizePositiveIntegerInput(event.target.value))}
                  onBlur={() => setArticlesPerAccountPerDayInput(String(normalizedArticlesPerAccountPerDay))}
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">每篇图片数量</span>
                <input
                  className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  min={1}
                  max={MAX_EXPECTED_IMAGE_COUNT}
                  type="number"
                  inputMode="numeric"
                  value={expectedImageCountInput}
                  onChange={(event) => setExpectedImageCountInput(sanitizePositiveIntegerInput(event.target.value))}
                  onBlur={() => setExpectedImageCountInput(String(normalizedExpectedImageCount))}
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">开始时间</span>
                <input
                  className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  type="time"
                  value={publishStartTime}
                  onChange={(event) => setPublishStartTime(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">结束时间</span>
                <input
                  className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  type="time"
                  value={publishEndTime}
                  onChange={(event) => setPublishEndTime(event.target.value)}
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-muted">默认发布时间为 {formatTimeWindow("09:00", "18:00")}，你也可以按任务节奏自行调整。</p>
            <p className="mt-2 text-xs text-muted">开始生成前锁定每篇图片数量，生成完成后系统会按计划时间自动发布。</p>
            {!isTimeWindowValid ? <p className="mt-2 text-xs text-red-500">结束时间必须晚于开始时间。</p> : null}
          </div>

          <aside className="rounded-md border border-line bg-panel p-4">
            <h4 className="text-sm font-semibold text-ink">文章总量</h4>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-semibold text-ink">{totalAccounts}</p>
                <p className="mt-1 text-xs text-muted">可用账号</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-ink">{normalizedDays}</p>
                <p className="mt-1 text-xs text-muted">天</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-accent">{totalArticles}</p>
                <p className="mt-1 text-xs text-muted">篇</p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">预计总篇数 = 全部已登录可发布账号数 x 发布天数 x 每个账号每天篇数。</p>
            <p className="mt-2 text-xs leading-5 text-muted">当前计划已锁定每篇 {normalizedExpectedImageCount} 张图片。</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              当前全局已登录可发布账号 {totalAccounts} 个；其中当前 AI 平台可自动加入任务的账号 {taskScopedAccountCount} 个，当前 AI 平台预计 {taskScopedArticles} 篇。
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              {savedPlanReady
                ? `计划已保存：${platformSummary(prerequisites?.savedPlan)}`
                : hasSavedPlan && hasPlanChanges
                  ? `当前修改未保存，请先更新计划。已保存计划：${platformSummary(prerequisites?.savedPlan)}`
                  : platformSummary(prerequisites?.savedPlan)}
            </p>
            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            {notice && <p className="mt-4 text-sm text-accent">{notice}</p>}
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                disabled={savedPlanReady ? startingGeneration : !canSave || saving}
                onClick={() =>
                  savedPlanReady
                    ? void startGeneration()
                    : hasSavedPlan && hasPlanChanges
                      ? void savePlan({ startGenerationAfterSave: true })
                      : void savePlan()
                }
              >
                {savedPlanReady ? <PlayCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {savedPlanReady
                  ? startingGeneration
                    ? "启动中"
                    : "开始生成并按计划发布"
                  : saving
                    ? hasSavedPlan
                      ? hasPlanChanges
                        ? "更新并启动中"
                        : "更新中"
                      : "保存中"
                    : hasSavedPlan && hasPlanChanges
                      ? "更新计划后生成并发布"
                      : "保存计划"}
              </button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
