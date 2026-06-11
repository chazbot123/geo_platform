"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, LoaderCircle, LogIn, RefreshCw, Save, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { formatAccountDisplayLabel } from "@/lib/publish/account-label";
import { openPlatformLoginWindow, validatePlatformSessionWindow } from "@/lib/publish/electron-login-client";
import { getPlatformsBySearchProvider, providerPublishMatrix } from "@/lib/publish/provider-platform-matrix";
import { getSearchProviderIcon, getSocialPlatformIcon } from "@/lib/platform-icons";
import type {
  PlatformAccountDetectionItem,
  PlatformAccountRecord,
  ProductProfile,
  PublishTaskPlan,
  SearchProvider,
  SocialPlatform,
  ThemeSet,
} from "@/lib/types";

const providerOrder: SearchProvider[] = ["doubao", "deepseek", "yuanbao", "tongyi"];

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
  if (!value) return "未校验";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function validationFailureText(status: string, reason?: string) {
  if (reason?.trim()) return reason;
  if (status === "expired") return "平台会话已过期，请重新登录。";
  if (status === "missing_session") return "未检测到有效平台会话，请重新登录。";
  if (status === "unsupported") return "当前环境缺少桌面登录桥，请启动 GEO 桌面版。";
  return "平台会话校验未通过，请重新登录。";
}

function buildLoginSuccessPatch(loginResult: Awaited<ReturnType<typeof openPlatformLoginWindow>>) {
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

function AccountAvatar({ account, platform }: { account: PlatformAccountRecord; platform: SocialPlatform }) {
  const fallback = getSocialPlatformIcon(platform);
  return (
    <span className="flex h-11 w-11 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
      <img
        className="h-full w-full object-cover"
        src={account.avatarUrl || fallback}
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [loginKey, setLoginKey] = useState("");
  const [removingKey, setRemovingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prerequisites, setPrerequisites] = useState<PlanningPrerequisites | null>(null);
  const [searchProvider, setSearchProvider] = useState<SearchProvider>("doubao");
  const [enabledPlatforms, setEnabledPlatforms] = useState<SocialPlatform[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<SocialPlatform>("toutiao");
  const [days, setDays] = useState(5);
  const [articlesPerAccountPerDay, setArticlesPerAccountPerDay] = useState(2);
  const [publishStartTime, setPublishStartTime] = useState("09:00");
  const [publishEndTime, setPublishEndTime] = useState("18:00");
  const [detectionItems, setDetectionItems] = useState<PlatformAccountDetectionItem[]>([]);
  const [accounts, setAccounts] = useState<PlatformAccountRecord[]>([]);

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
  const selectedDetection = detectionByPlatform.get(selectedPlatform);
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => account.platform === selectedPlatform),
    [accounts, selectedPlatform],
  );
  const normalizedDays = Math.max(1, Number.isFinite(days) ? Math.floor(days) : 1);
  const normalizedArticlesPerAccountPerDay = Math.max(
    1,
    Number.isFinite(articlesPerAccountPerDay) ? Math.floor(articlesPerAccountPerDay) : 1,
  );
  const isTimeWindowValid =
    isValidTimeValue(publishStartTime) && isValidTimeValue(publishEndTime) && publishStartTime < publishEndTime;
  const totalAccounts = publishableAccounts.length;
  const totalArticles = totalAccounts * normalizedDays * normalizedArticlesPerAccountPerDay;
  const canSave = Boolean(
    prerequisites?.enterpriseReady &&
      prerequisites.keywordReady &&
      prerequisites.taskId &&
      totalArticles > 0 &&
      isTimeWindowValid,
  );
  const enterpriseReady = Boolean(prerequisites?.enterpriseReady);
  const keywordReady = Boolean(prerequisites?.keywordReady);

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
      const response = await fetch("/api/tasks/plan", { cache: "no-store" });
      const data = (await response.json()) as PlanningPrerequisites & { error?: string };
      if (!response.ok) throw new Error(data.error || "读取任务规划失败。");
      setPrerequisites(data);
      if (data.savedPlan) {
        setSearchProvider(data.savedPlan.searchProvider);
        setDays(data.savedPlan.days);
        setArticlesPerAccountPerDay(data.savedPlan.articlesPerAccountPerDay);
        setPublishStartTime(data.savedPlan.timeWindow?.start ?? "09:00");
        setPublishEndTime(data.savedPlan.timeWindow?.end ?? "18:00");
        const savedPlatforms = data.savedPlan.enabledPlatforms.filter((item) => item.enabled).map((item) => item.platform);
        setEnabledPlatforms(savedPlatforms);
        setSelectedPlatform(savedPlatforms[0] ?? getPlatformsBySearchProvider(data.savedPlan.searchProvider)[0]);
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
      setEnabledPlatforms((current) => {
        const next = current.filter((platform) => publishablePlatforms.includes(platform));
        return current.length ? next : publishablePlatforms;
      });
      await loadAccounts();
      setNotice(forceRefresh ? "账号检测已刷新。" : "已读取账号检测结果。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "账号检测失败。");
    } finally {
      setDetecting(false);
    }
  }

  async function patchAccountStatus(accountId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/publish/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error || "更新账号状态失败。");
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
          platform: string;
          title: string;
          loginUrl?: string;
          sessionPartition?: string;
        };
        error?: string;
      };
      if (!response.ok || !payload.account?.id || !payload.loginRequest) {
        throw new Error(payload.error || "发起平台登录失败。");
      }

      const loginResult = await openPlatformLoginWindow(payload.loginRequest);
      if (loginResult.status === "unsupported") {
        throw new Error("当前环境缺少桌面登录桥，请启动 GEO 桌面版。");
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
          await patchAccountStatus(payload.account.id, {
            loginStatus: "authenticated",
            status: "valid",
            lastError: undefined,
          });
          setNotice(`${platformLabels[platform]}账号已登录并通过校验。`);
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

  async function removeAccount(account: PlatformAccountRecord) {
    const accountLabel = formatAccountDisplayLabel(account, account.id) || account.id;
    const confirmed = window.confirm(`确定将 ${platformLabels[account.platform]} 账号「${accountLabel}」下号并移除吗？移除后会从已保存任务和草稿绑定中摘除，不再计入任务。`);
    if (!confirmed) return;

    setRemovingKey(account.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/publish/accounts/${account.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "移除账号失败。");
      setNotice(`${platformLabels[account.platform]}账号已下号并移除。`);
      await loadAccounts();
      await detectAccounts(true);
      window.dispatchEvent(new Event("geo-workflow-status-refresh"));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "移除账号失败。");
    } finally {
      setRemovingKey("");
    }
  }

  async function savePlan() {
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
          timeWindow: {
            start: publishStartTime,
            end: publishEndTime,
          },
          forceRefreshAccounts: true,
        }),
      });
      const data = (await response.json()) as { publishPlan?: PublishTaskPlan; error?: string };
      if (!response.ok || !data.publishPlan) throw new Error(data.error || "保存任务规划失败。");
      setPrerequisites((current) => (current ? { ...current, savedPlan: data.publishPlan } : current));
      window.dispatchEvent(new Event("geo-workflow-status-refresh"));
      setNotice("任务已保存，正在进入内容池。");
      router.push("/content-pool");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "保存任务规划失败。");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadPrerequisites();
  }, []);

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

  if (loading) {
    return <div className="section-card text-sm text-muted">正在读取企业信息和客户问题。</div>;
  }

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">第 3 步</p>
            <h2 className="page-section-title mt-2">创建任务</h2>
            <p className="page-section-desc">先选 GEO AI 平台，再确认映射发布平台、账号登录状态和文章总量。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={enterpriseReady ? "status-pill" : "status-pill opacity-60"}>企业信息</span>
            <span className={keywordReady ? "status-pill" : "status-pill opacity-60"}>5 个客户问题</span>
            <span className="status-pill">{formatTimeWindow(publishStartTime, publishEndTime)}</span>
            <span className="status-pill">间隔 3 小时</span>
          </div>
        </div>

        {(!enterpriseReady || !keywordReady) && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {!enterpriseReady && (
              <Link className="subtle-card block border-dashed" href="/enterprise">
                <p className="text-sm font-medium text-ink">先保存企业信息</p>
                <p className="mt-2 text-xs leading-5 text-muted">公司名称、品牌简称、产品服务和地区完整后才能创建任务。</p>
              </Link>
            )}
            {!keywordReady && (
              <Link className="subtle-card block border-dashed" href="/customer-keywords">
                <p className="text-sm font-medium text-ink">先保存 5 个客户问题</p>
                <p className="mt-2 text-xs leading-5 text-muted">任务需要已确认的 5 个核心问题作为内容生产输入。</p>
              </Link>
            )}
          </div>
        )}
      </section>

      <section className="section-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-accent" />
            <div>
              <h3 className="page-section-title">平台与账号</h3>
              <p className="page-section-desc">发布平台只来自当前 GEO AI 平台的默认映射，小红书本轮仅归入通义千问。</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={detecting}
            onClick={() => void detectAccounts(true)}
          >
            <RefreshCw className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            手动刷新检测
          </button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[190px_230px_minmax(0,1fr)]">
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
                  <p className="mt-1 text-xs leading-5 text-muted">
                    上次检测：{formatTime(selectedDetection?.detectedAt)}
                    {selectedDetection?.fromCache ? "（30 分钟缓存）" : ""}
                  </p>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink">
                <input
                  className="h-4 w-4 accent-[var(--accent)]"
                  type="checkbox"
                  disabled={(selectedDetection?.accountCount ?? 0) === 0}
                  checked={enabledSet.has(selectedPlatform)}
                  onChange={(event) =>
                    setEnabledPlatforms((current) =>
                      event.target.checked
                        ? Array.from(new Set([...current, selectedPlatform]))
                        : current.filter((item) => item !== selectedPlatform),
                    )
                  }
                />
                计入任务
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
                    <span className="block text-sm font-semibold text-ink">登录新的{platformLabels[selectedPlatform]}账号</span>
                    <span className="mt-1 block text-xs text-muted">复用账号中心的桌面登录窗口和会话校验。</span>
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
                          <p className="mt-1 break-all font-mono text-xs text-muted">ID：{account.accountName || account.id}</p>
                          <p className="mt-1 break-all font-mono text-xs text-muted">本地记录：{account.id}</p>
                          <p className="mt-1 text-xs text-muted">最近校验：{formatTime(account.lastValidatedAt || account.lastLoginCompletedAt || account.updatedAt)}</p>
                          {account.lastError ? <p className="mt-2 text-xs leading-5 text-red-500">{account.lastError}</p> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={Boolean(loginKey) || Boolean(removingKey)}
                          onClick={() => void startLogin(account.platform, account.id)}
                        >
                          {loginKey === account.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                          {account.loginStatus === "authenticated" ? "重新上号/校验" : "上号"}
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:text-red-300 dark:hover:border-red-400 dark:hover:bg-red-500/10"
                          disabled={Boolean(loginKey) || Boolean(removingKey)}
                          onClick={() => void removeAccount(account)}
                        >
                          {removingKey === account.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          下号
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
              <p>可发布账号：{selectedDetection?.accountCount ?? 0}</p>
              <p>未计入账号：{selectedDetection?.ignoredCount ?? 0}</p>
              <p>
                本平台文章：
                {enabledSet.has(selectedPlatform)
                  ? (selectedDetection?.accountCount ?? 0) * normalizedDays * normalizedArticlesPerAccountPerDay
                  : 0}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="section-card">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent" />
            <h3 className="page-section-title">发布节奏</h3>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <label className="block">
              <span className="text-xs text-muted">发布天数</span>
              <input
                className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                min={1}
                type="number"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">每账号每天</span>
              <input
                className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                min={1}
                type="number"
                value={articlesPerAccountPerDay}
                onChange={(event) => setArticlesPerAccountPerDay(Number(event.target.value))}
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
          {!isTimeWindowValid ? <p className="mt-2 text-xs text-red-500">结束时间必须晚于开始时间。</p> : null}
        </div>

        <aside className="section-card">
          <h3 className="page-section-title">任务总量</h3>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-2xl font-semibold text-ink">{totalAccounts}</p>
              <p className="mt-1 text-xs text-muted">已登录账号</p>
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
          <p className="mt-4 text-xs leading-5 text-muted">公式：已登录可发布账号总数 x 天数 x 每账号每天发布篇数。</p>
          <p className="mt-2 text-xs leading-5 text-muted">{platformSummary(prerequisites?.savedPlan)}</p>
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
          {notice && <p className="mt-4 text-sm text-accent">{notice}</p>}
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canSave || saving}
              onClick={() => void savePlan()}
            >
              <Save className="h-4 w-4" />
              {saving ? "保存中" : "保存任务"}
            </button>
            <Link
              className={`inline-flex justify-center rounded-md border border-line px-4 py-2 text-sm font-medium ${
                prerequisites?.savedPlan ? "text-ink hover:border-accent" : "pointer-events-none text-muted opacity-60"
              }`}
              href="/content-pool"
            >
              进入内容池
            </Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
