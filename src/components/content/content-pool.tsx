"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clock3, ImageOff, RefreshCw, Search, UserCircle2, X } from "lucide-react";
import { formatAccountDisplayLabel } from "@/lib/publish/account-label";
import type { ContentPoolItem, ContentPoolItemStatus, ContentPoolRecord, PlatformAccountRecord, SearchProvider, SocialPlatform, TaskRecord } from "@/lib/types";

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
  tongyi: "千问",
};

const statusLabels: Record<ContentPoolItemStatus, string> = {
  pending_generation: "待生成",
  generating: "生成中",
  ready: "已完成",
  sample: "已完成",
  pending_publish: "待发布",
  publishing: "发布中",
  submitted: "已提交待确认",
  pending_review: "平台审核中",
  published: "已发布",
  failed: "失败",
  manual_pending: "待处理",
};

interface ContentGenerationStatusResponse {
  current: ContentPoolRecord | null;
  task?: TaskRecord | null;
  error?: string;
}

type StatusFilter = "all" | ContentPoolItemStatus;
const articleTableGridClass = "lg:grid-cols-[56px_minmax(220px,1.4fr)_88px_88px_130px_minmax(150px,1fr)_118px_88px_110px]";
const articleTableMinWidthClass = "lg:min-w-[1180px]";

function formatDateTime(value?: string) {
  if (!value) return "未开始";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function countBy(items: ContentPoolItem[], predicate: (item: ContentPoolItem) => boolean) {
  return items.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function statusClassName(status: ContentPoolItemStatus) {
  if (status === "failed") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "publishing" || status === "generating") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (status === "published" || status === "pending_publish" || status === "ready" || status === "sample") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "submitted" || status === "pending_review") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-line bg-surface text-muted";
}

function progressPercent(record: ContentPoolRecord | null) {
  if (!record?.items.length) return 0;
  const finished = countBy(
    record.items,
    (item) =>
      item.status === "pending_publish" ||
      item.status === "ready" ||
      item.status === "sample" ||
      item.status === "submitted" ||
      item.status === "pending_review" ||
      item.status === "published" ||
      item.status === "failed",
  );
  return Math.round((finished / record.items.length) * 100);
}

function failedImageCount(item: ContentPoolItem) {
  return item.imageList.filter((image) => image.status === "failed").length;
}

function matchesGenerationResultSearch(item: ContentPoolItem, account: PlatformAccountRecord | undefined, searchQuery: string) {
  const keyword = searchQuery.trim().toLowerCase();
  if (!keyword) return true;
  const searchText = [
    item.title,
    item.summary,
    item.body,
    item.keywordText,
    item.stageMessage,
    item.accountName,
    item.accountId,
    platformLabels[item.publishPlatform],
    providerLabels[item.aiPlatform],
    statusLabels[item.status],
    account ? formatAccountDisplayLabel(account, item.accountName || item.accountId) : "",
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
  const label = account ? formatAccountDisplayLabel(account, fallback) : fallback || "--";
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

function ArticleRow({ item, taskId, account }: { item: ContentPoolItem; taskId: string; account?: PlatformAccountRecord }) {
  const failedImages = failedImageCount(item);
  return (
    <Link
      className={`grid gap-3 border-b border-line px-4 py-3 text-sm transition hover:bg-panelSoft lg:items-center ${articleTableGridClass} ${articleTableMinWidthClass}`}
      href={`/content-pool/${encodeURIComponent(item.id)}?taskId=${encodeURIComponent(taskId)}`}
    >
      <span className="text-muted">#{item.sequence}</span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="block truncate font-medium text-ink">{item.title || item.stageMessage || "等待生成结果"}</span>
          {failedImages > 0 ? (
            <span
              className="inline-flex shrink-0 items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-amber-700 dark:text-amber-300"
              title={`有 ${failedImages} 张图片生成失败`}
            >
              <ImageOff className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-xs text-muted">{item.summary || item.stageMessage || "系统会在完成后写入最终成稿。"}</span>
      </span>
      <span className="truncate whitespace-nowrap text-muted">{providerLabels[item.aiPlatform]}</span>
      <span className="truncate whitespace-nowrap text-muted">{platformLabels[item.publishPlatform]}</span>
      <AccountIdentity account={account} fallback={item.accountName || item.accountId} />
      <span className="truncate text-muted">{item.keywordText}</span>
      <span className="whitespace-nowrap text-muted">{formatDateTime(item.plannedPublishTime)}</span>
      <span className="whitespace-nowrap">
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClassName(item.status)}`}>
          {statusLabels[item.status]}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-muted">{formatDateTime(item.createdAt)}</span>
        <span className="mt-1 block truncate text-xs text-muted">生成时间</span>
      </span>
    </Link>
  );
}

export function ContentPoolWorkbench() {
  const searchParams = useSearchParams();
  const requestedTaskId = searchParams.get("taskId") || "";
  const [current, setCurrent] = useState<ContentPoolRecord | null>(null);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [accounts, setAccounts] = useState<PlatformAccountRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resultSearchQuery, setResultSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [retryingImages, setRetryingImages] = useState(false);

  const visibleRecord = current;
  const items = visibleRecord?.items ?? [];
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const retryableFailedItems = items.filter((item) => item.status === "failed" || item.riskLevel === "high");
  const failedImageTotal = items.reduce((total, item) => total + failedImageCount(item), 0);
  const statusFilteredItems = statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter);
  const searchFilteredItems = statusFilteredItems.filter((item) => matchesGenerationResultSearch(item, accountsById.get(item.accountId), resultSearchQuery));
  const filteredItems = searchFilteredItems;
  const hasResultSearch = resultSearchQuery.trim().length > 0;
  const stats = {
    total: visibleRecord?.totalArticleCount ?? items.length,
    generated:
      visibleRecord?.generatedArticleCount ??
      countBy(
        items,
        (item) =>
          item.status === "pending_publish" ||
          item.status === "ready" ||
          item.status === "sample" ||
          item.status === "submitted" ||
          item.status === "pending_review" ||
          item.status === "published",
      ),
    generating: visibleRecord?.generatingArticleCount ?? countBy(items, (item) => item.status === "generating"),
    failed: visibleRecord?.failedArticleCount ?? countBy(items, (item) => item.status === "failed"),
    pendingPublish: visibleRecord?.pendingPublishArticleCount ?? countBy(items, (item) => item.status === "pending_publish"),
  };

  async function loadStatus(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    setError("");
    try {
      const query = requestedTaskId ? `?taskId=${encodeURIComponent(requestedTaskId)}` : "";
      const [response, accountsResponse] = await Promise.all([
        fetch(`/api/content/generation/status${query}`, { cache: "no-store" }),
        fetch("/api/publish/accounts", { cache: "no-store" }),
      ]);
      const data = (await response.json()) as ContentGenerationStatusResponse;
      const accountsData = (await accountsResponse.json()) as { items?: PlatformAccountRecord[] };
      if (!response.ok) throw new Error(data.error || "读取生成结果失败。");
      setCurrent(data.current);
      setTask(data.task ?? null);
      setAccounts(accountsResponse.ok ? accountsData.items ?? [] : []);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取生成结果失败。");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [requestedTaskId]);

  const shouldAutoRefresh = Boolean(
    task?.status === "generation_queued" ||
      task?.status === "generation_running" ||
      current?.items.some((item) => item.status === "pending_generation" || item.status === "generating"),
  );

  useEffect(() => {
    if (!shouldAutoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadStatus({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [shouldAutoRefresh, requestedTaskId]);

  async function retryFailedItems() {
    if (!visibleRecord || !retryableFailedItems.length) {
      return;
    }

    setRetryingFailed(true);
    setError("");
    try {
      const response = await fetch("/api/content/pool/retry-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: visibleRecord.taskId,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "批量重试失败项时出错。");
      }
      await loadStatus({ silent: true });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "批量重试失败项时出错。");
    } finally {
    setRetryingFailed(false);
    }
  }

  async function retryFailedImages() {
    if (!visibleRecord || failedImageTotal <= 0) {
      return;
    }

    setRetryingImages(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/content/pool/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: visibleRecord.taskId,
          action: "retry_all_failed_images",
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        totalFailedImages?: number;
        retriedImages?: number;
        remainingFailedImages?: number;
      };
      if (!response.ok) {
        throw new Error(data.error || "重生失败图片时出错。");
      }
      setNotice(`已重生 ${data.retriedImages ?? 0}/${data.totalFailedImages ?? failedImageTotal} 张失败图片，剩余 ${data.remainingFailedImages ?? 0} 张。`);
      await loadStatus({ silent: true });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "重生失败图片时出错。");
    } finally {
      setRetryingImages(false);
    }
  }

  if (loading) {
    return <section className="section-card text-sm text-muted">正在读取生成结果。</section>;
  }

  if (!current) {
    return (
      <section className="section-card">
        <h2 className="page-section-title">还没有生成结果</h2>
        <p className="page-section-desc">保存计划后回到登录账号页点击“开始生成并按计划发布”，系统会把最终文章写入这里并自动进入发布队列。</p>
        <Link className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/tasks/create">
          返回创建任务
        </Link>
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">第 4 步</p>
            <h2 className="page-section-title mt-2">生成结果</h2>
            <p className="page-section-desc">查看当前任务的文章生成进度和最终结果；生成完成后系统会按计划时间自动发布。</p>
            {shouldAutoRefresh ? <p className="mt-2 text-xs text-blue-600">后台正在持续生成，列表会自动刷新。</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent"
              onClick={() => void loadStatus()}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            {failedImageTotal > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-amber-500/30 px-3 py-2 text-sm font-medium text-amber-700 hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300"
                disabled={retryingImages || shouldAutoRefresh}
                onClick={() => void retryFailedImages()}
              >
                <ImageOff className="h-4 w-4" />
                {retryingImages ? "正在重生失败图片..." : `重生失败图片（${failedImageTotal}）`}
              </button>
            ) : null}
            {retryableFailedItems.length > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                disabled={retryingFailed || shouldAutoRefresh}
                onClick={() => void retryFailedItems()}
              >
                <RefreshCw className={`h-4 w-4 ${retryingFailed ? "animate-spin" : ""}`} />
                {retryingFailed ? "正在重试失败项" : `批量重试失败项 (${retryableFailedItems.length})`}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="subtle-card">
            <p className="text-xs text-muted">总篇数</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{stats.total}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">已生成</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.generated}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">生成中</p>
            <p className="mt-2 text-2xl font-semibold text-blue-600">{stats.generating}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">失败</p>
            <p className="mt-2 text-2xl font-semibold text-red-600">{stats.failed}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">待发布</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{stats.pendingPublish}</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPercent(visibleRecord)}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              {task?.generationStartedAt ? `开始：${formatDateTime(task.generationStartedAt)}` : `更新：${formatDateTime(visibleRecord?.updatedAt)}`}
            </span>
            <span>进度 {progressPercent(visibleRecord)}%</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {(["all", "pending_publish", "submitted", "pending_review", "generating", "failed", "published"] as StatusFilter[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                statusFilter === status ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:border-accent"
              }`}
              onClick={() => setStatusFilter(status)}
            >
              {status === "all" ? "全部" : statusLabels[status]}
            </button>
          ))}
        </div>
        {notice && <p className="mt-4 text-sm text-emerald-600">{notice}</p>}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </section>

      <section className="overflow-x-auto rounded-md border border-line bg-panel">
        <div className="border-b border-line bg-panelSoft p-3">
          <label className="relative block max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={resultSearchQuery}
              onChange={(event) => setResultSearchQuery(event.target.value)}
              placeholder="搜索标题、摘要、关键词、平台、账号"
              className="h-10 w-full rounded-md border border-line bg-panel px-9 text-sm text-ink outline-none transition focus:border-accent"
            />
            {hasResultSearch ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink"
                aria-label="清空生成结果搜索"
                onClick={() => setResultSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>
        <div className={`hidden border-b border-line bg-surface px-4 py-2 text-xs font-medium text-muted lg:grid lg:items-center ${articleTableGridClass} ${articleTableMinWidthClass}`}>
          <span>序号</span>
          <span>标题</span>
          <span>AI 平台</span>
          <span>发布平台</span>
          <span>账号</span>
          <span>关键词</span>
          <span>计划发布时间</span>
          <span>状态</span>
          <span>生成时间</span>
        </div>
        {filteredItems.length ? (
          filteredItems.map((item) => (
            <ArticleRow key={item.id} item={item} taskId={visibleRecord?.taskId ?? item.taskId} account={accountsById.get(item.accountId)} />
          ))
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted">
            {hasResultSearch ? "没有匹配的生成结果，请调整搜索关键词或筛选条件。" : "当前筛选下没有文章。"}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Link
          className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          href={`/publish-execution${visibleRecord ? `?taskId=${encodeURIComponent(visibleRecord.taskId)}` : ""}`}
        >
          查看发布结果
        </Link>
      </div>
    </div>
  );
}
