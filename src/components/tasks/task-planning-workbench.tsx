"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, RefreshCw, Save, Settings2 } from "lucide-react";
import { getPlatformsBySearchProvider, providerPublishMatrix } from "@/lib/publish/provider-platform-matrix";
import type {
  PlatformAccountDetectionItem,
  ProductProfile,
  PublishTaskPlan,
  SearchProvider,
  SocialPlatform,
  ThemeSet,
} from "@/lib/types";

const providerOrder: SearchProvider[] = ["doubao", "deepseek", "yuanbao", "tongyi"];
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

function formatTime(value?: string) {
  if (!value) return "未检测";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function platformSummary(plan?: PublishTaskPlan) {
  if (!plan) return "尚未保存任务";
  const enabled = plan.enabledPlatforms.filter((item) => item.enabled);
  if (!enabled.length) return "暂无可发布账号";
  return enabled.map((item) => `${platformLabels[item.platform]} ${item.accountCount} 个`).join("，");
}

export function TaskPlanningWorkbench() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prerequisites, setPrerequisites] = useState<PlanningPrerequisites | null>(null);
  const [searchProvider, setSearchProvider] = useState<SearchProvider>("doubao");
  const [enabledPlatforms, setEnabledPlatforms] = useState<SocialPlatform[]>(getPlatformsBySearchProvider("doubao"));
  const [days, setDays] = useState(5);
  const [detectionItems, setDetectionItems] = useState<PlatformAccountDetectionItem[]>([]);

  const mappedPlatforms = useMemo(() => getPlatformsBySearchProvider(searchProvider), [searchProvider]);
  const detectionByPlatform = useMemo(() => new Map(detectionItems.map((item) => [item.platform, item])), [detectionItems]);
  const enabledSet = useMemo(() => new Set(enabledPlatforms), [enabledPlatforms]);
  const normalizedDays = Math.max(5, Number.isFinite(days) ? Math.floor(days) : 5);
  const totalAccounts = mappedPlatforms.reduce((total, platform) => {
    const detection = detectionByPlatform.get(platform);
    return total + (enabledSet.has(platform) ? detection?.accountCount ?? 0 : 0);
  }, 0);
  const totalArticles = totalAccounts * normalizedDays * 2;
  const canSave = Boolean(prerequisites?.enterpriseReady && prerequisites.keywordReady && prerequisites.taskId && totalArticles > 0);
  const enterpriseReady = Boolean(prerequisites?.enterpriseReady);
  const keywordReady = Boolean(prerequisites?.keywordReady);

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
        setEnabledPlatforms(data.savedPlan.enabledPlatforms.filter((item) => item.enabled).map((item) => item.platform));
      }
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
      setNotice(forceRefresh ? "账号检测已刷新。" : "已读取账号检测结果。");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "账号检测失败。");
    } finally {
      setDetecting(false);
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
        }),
      });
      const data = (await response.json()) as { publishPlan?: PublishTaskPlan; error?: string };
      if (!response.ok || !data.publishPlan) throw new Error(data.error || "保存任务规划失败。");
      setPrerequisites((current) => (current ? { ...current, savedPlan: data.publishPlan } : current));
      setNotice("任务已保存，可以进入内容池。");
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
      const next = mappedPlatforms.filter((platform) => currentSet.has(platform));
      return next.length ? next : mappedPlatforms;
    });
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
            <p className="page-section-desc">先选 GEO AI 平台，再确认可自动发布的账号和文章总量。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={enterpriseReady ? "status-pill" : "status-pill opacity-60"}>企业信息</span>
            <span className={keywordReady ? "status-pill" : "status-pill opacity-60"}>5 个客户问题</span>
            <span className="status-pill">9:00-18:00</span>
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
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-accent" />
          <h3 className="page-section-title">GEO AI 平台</h3>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {providerOrder.map((provider) => {
            const bundle = providerPublishMatrix[provider];
            const selected = provider === searchProvider;
            return (
              <button
                key={provider}
                type="button"
                className={`subtle-card text-left transition ${selected ? "border-accent bg-accent/10" : "hover:border-accent/50"}`}
                onClick={() => setSearchProvider(provider)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{bundle.label}</span>
                  {selected && <CheckCircle2 className="h-4 w-4 text-accent" />}
                </span>
                <span className="mt-2 block text-xs leading-5 text-muted">
                  {bundle.platforms.map((platform) => platformLabels[platform]).join("、")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="section-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="page-section-title">发布平台和账号</h3>
            <p className="page-section-desc">只能启用系统映射的平台；未登录、失效、手动发布账号不计入自动文章数。</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={detecting}
            onClick={() => void detectAccounts(true)}
          >
            <RefreshCw className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            手动刷新
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {mappedPlatforms.map((platform) => {
            const detection = detectionByPlatform.get(platform);
            const enabled = enabledSet.has(platform);
            const accountCount = detection?.accountCount ?? 0;
            return (
              <label key={platform} className={`subtle-card flex cursor-pointer gap-3 ${enabled ? "border-accent/70" : ""}`}>
                <input
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) =>
                    setEnabledPlatforms((current) =>
                      event.target.checked ? Array.from(new Set([...current, platform])) : current.filter((item) => item !== platform),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{platformLabels[platform]}</span>
                    <span className="text-xs text-muted">{accountCount} 个可发布账号</span>
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-muted">
                    上次检测：{formatTime(detection?.detectedAt)}
                    {detection?.fromCache ? "（缓存）" : ""}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    不计入：{detection?.ignoredCount ?? 0} 个；本平台文章数：{enabled ? accountCount * normalizedDays * 2 : 0}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="section-card">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-accent" />
            <h3 className="page-section-title">发布节奏</h3>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs text-muted">发布天数</span>
              <input
                className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                min={5}
                type="number"
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </label>
            <div className="subtle-card">
              <p className="text-xs text-muted">每账号每天</p>
              <p className="mt-2 text-lg font-semibold text-ink">2 篇</p>
            </div>
            <div className="subtle-card">
              <p className="text-xs text-muted">发布时间</p>
              <p className="mt-2 text-lg font-semibold text-ink">9:00-18:00</p>
            </div>
          </div>
        </div>

        <aside className="section-card">
          <h3 className="page-section-title">任务总量</h3>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-2xl font-semibold text-ink">{totalAccounts}</p>
              <p className="mt-1 text-xs text-muted">账号</p>
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
          <p className="mt-4 text-xs leading-5 text-muted">公式：启用平台可发布账号数 x 天数 x 2。</p>
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
