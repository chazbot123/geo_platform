"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clock3, History, RefreshCw } from "lucide-react";
import type { ContentPoolItem, ContentPoolItemStatus, ContentPoolRecord, SearchProvider, SocialPlatform, TaskRecord } from "@/lib/types";

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
  published: "已发布",
  failed: "失败",
  manual_pending: "待处理",
};

interface ContentGenerationStatusResponse {
  current: ContentPoolRecord | null;
  history: ContentPoolRecord[];
  task?: TaskRecord | null;
  error?: string;
}

type ViewMode = "current" | "history";
type StatusFilter = "all" | ContentPoolItemStatus;
const articleTableGridClass = "lg:grid-cols-[56px_minmax(220px,1.4fr)_96px_96px_150px_minmax(160px,1fr)_88px_120px]";

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
  return "border-line bg-surface text-muted";
}

function progressPercent(record: ContentPoolRecord | null) {
  if (!record?.items.length) return 0;
  const finished = countBy(record.items, (item) => item.status === "pending_publish" || item.status === "ready" || item.status === "sample" || item.status === "published" || item.status === "failed");
  return Math.round((finished / record.items.length) * 100);
}

function latestStageAt(item: ContentPoolItem) {
  return item.stageLog?.[item.stageLog.length - 1]?.at;
}

function resolveStatusTime(item: ContentPoolItem, task?: TaskRecord | null) {
  const stageAt = latestStageAt(item);
  if ((item.status === "pending_generation" || item.status === "generating") && task?.generationStartedAt) {
    return {
      label: item.status === "generating" ? "本轮生成" : "本轮待生成",
      value: stageAt || task.generationStartedAt,
    };
  }

  if (stageAt) {
    return {
      label: "最近状态",
      value: stageAt,
    };
  }

  return {
    label: "上次改动",
    value: item.updatedAt,
  };
}

function ArticleRow({ item, taskId, task }: { item: ContentPoolItem; taskId: string; task?: TaskRecord | null }) {
  const statusTime = resolveStatusTime(item, task);
  return (
    <Link
      className={`grid gap-3 border-b border-line px-4 py-3 text-sm transition hover:bg-panelSoft lg:items-center ${articleTableGridClass}`}
      href={`/content-pool/${encodeURIComponent(item.id)}?taskId=${encodeURIComponent(taskId)}`}
    >
      <span className="text-muted">#{item.sequence}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{item.title || item.stageMessage || "等待生成结果"}</span>
        <span className="mt-1 block truncate text-xs text-muted">{item.summary || item.stageMessage || "系统会在完成后写入最终成稿。"}</span>
      </span>
      <span className="truncate whitespace-nowrap text-muted">{providerLabels[item.aiPlatform]}</span>
      <span className="truncate whitespace-nowrap text-muted">{platformLabels[item.publishPlatform]}</span>
      <span className="truncate text-muted">{item.accountName || item.accountId}</span>
      <span className="truncate text-muted">{item.keywordText}</span>
      <span className="whitespace-nowrap">
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClassName(item.status)}`}>
          {statusLabels[item.status]}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-muted">{formatDateTime(statusTime.value)}</span>
        <span className="mt-1 block truncate text-xs text-muted">{statusTime.label}</span>
      </span>
    </Link>
  );
}

export function ContentPoolWorkbench() {
  const searchParams = useSearchParams();
  const requestedTaskId = searchParams.get("taskId") || "";
  const [current, setCurrent] = useState<ContentPoolRecord | null>(null);
  const [history, setHistory] = useState<ContentPoolRecord[]>([]);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("current");
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryingFailed, setRetryingFailed] = useState(false);

  const visibleRecord = useMemo(() => {
    if (viewMode === "current") return current;
    return history.find((record) => record.taskId === selectedHistoryTaskId) ?? history[0] ?? null;
  }, [current, history, selectedHistoryTaskId, viewMode]);

  const items = visibleRecord?.items ?? [];
  const retryableFailedItems = items.filter((item) => item.status === "failed" || item.riskLevel === "high");
  const filteredItems = statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter);
  const stats = {
    total: visibleRecord?.totalArticleCount ?? items.length,
    generated: visibleRecord?.generatedArticleCount ?? countBy(items, (item) => item.status === "pending_publish" || item.status === "ready" || item.status === "sample" || item.status === "published"),
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
      const response = await fetch(`/api/content/generation/status${query}`, { cache: "no-store" });
      const data = (await response.json()) as ContentGenerationStatusResponse;
      if (!response.ok) throw new Error(data.error || "读取生成结果失败。");
      setCurrent(data.current);
      setHistory(data.history ?? []);
      setTask(data.task ?? null);
      setSelectedHistoryTaskId((currentTaskId) => currentTaskId || data.history?.[0]?.taskId || "");
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

  const shouldAutoRefresh =
    viewMode === "current" &&
    (task?.status === "generation_queued" ||
      task?.status === "generation_running" ||
      current?.items.some((item) => item.status === "pending_generation" || item.status === "generating"));

  useEffect(() => {
    if (!shouldAutoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadStatus({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [shouldAutoRefresh, requestedTaskId, viewMode]);

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

  if (loading) {
    return <section className="section-card text-sm text-muted">正在读取生成结果。</section>;
  }

  if (!current && !history.length) {
    return (
      <section className="section-card">
        <h2 className="page-section-title">还没有生成结果</h2>
        <p className="page-section-desc">保存计划后回到创建任务页点击“开始生成”，系统会把最终文章写入这里。</p>
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
            <h2 className="page-section-title mt-2">生成结果中心</h2>
            <p className="page-section-desc">查看当前任务的文章生成进度和最终结果，正文与图片进入详情页查看。</p>
            {shouldAutoRefresh ? <p className="mt-2 text-xs text-blue-600">后台正在持续生成，列表会自动刷新。</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-medium ${viewMode === "current" ? "bg-accent text-white" : "border border-line text-ink"}`}
              onClick={() => setViewMode("current")}
            >
              本次任务
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${viewMode === "history" ? "bg-accent text-white" : "border border-line text-ink"}`}
              onClick={() => setViewMode("history")}
            >
              <History className="h-4 w-4" />
              历史任务
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent"
              onClick={() => void loadStatus()}
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            {viewMode === "current" && retryableFailedItems.length > 0 ? (
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

        {viewMode === "history" && history.length > 0 && (
          <label className="mt-4 block max-w-sm">
            <span className="text-xs text-muted">历史任务</span>
            <select
              className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={selectedHistoryTaskId || history[0]?.taskId}
              onChange={(event) => setSelectedHistoryTaskId(event.target.value)}
            >
              {history.map((record) => (
                <option key={record.taskId} value={record.taskId}>
                  {record.taskId.slice(0, 8)} · {formatDateTime(record.updatedAt)} · {record.items.length} 篇
                </option>
              ))}
            </select>
          </label>
        )}

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
          {(["all", "pending_publish", "generating", "failed", "published"] as StatusFilter[]).map((status) => (
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
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </section>

      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className={`hidden border-b border-line bg-surface px-4 py-2 text-xs font-medium text-muted lg:grid lg:items-center ${articleTableGridClass}`}>
          <span>序号</span>
          <span>标题</span>
          <span>AI 平台</span>
          <span>发布平台</span>
          <span>账号</span>
          <span>关键词</span>
          <span>状态</span>
          <span>最近状态</span>
        </div>
        {filteredItems.length ? (
          filteredItems.map((item) => <ArticleRow key={item.id} item={item} taskId={visibleRecord?.taskId ?? item.taskId} task={task} />)
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted">当前筛选下没有文章。</div>
        )}
      </section>

      <div className="flex justify-end">
        <Link className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/publish-execution">
          执行发布
        </Link>
      </div>
    </div>
  );
}
