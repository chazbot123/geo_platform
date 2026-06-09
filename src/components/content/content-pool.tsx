"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, History, ImageIcon, RefreshCw, Repeat2, ShieldCheck, Wand2 } from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
import type {
  ContentPoolItem,
  ContentPoolItemStatus,
  ContentPoolRecord,
  ContentPoolRiskLevel,
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
  tongyi: "千问",
};

const statusLabels: Record<ContentPoolItemStatus, string> = {
  pending_generation: "待生成",
  sample: "样文",
  pending_publish: "待发布",
  publishing: "发布中",
  published: "已发布",
  failed: "失败",
  manual_pending: "手动待处理",
};

const riskLabels: Record<ContentPoolRiskLevel, string> = {
  low: "可发布",
  medium: "需确认",
  high: "需改写",
};

interface ContentPoolResponse {
  current: ContentPoolRecord | null;
  history: ContentPoolRecord[];
  error?: string;
}

type ViewMode = "current" | "history";

function formatDateTime(value: string) {
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

function riskClass(level: ContentPoolRiskLevel) {
  if (level === "low") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (level === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
}

function PipelineLine({ item }: { item: ContentPoolItem }) {
  const checks = [
    { label: "检查风险", done: item.pipeline.riskReview.status === "passed", blocked: item.pipeline.riskReview.status === "blocked" },
    { label: "样文质检", done: item.pipeline.sampleDraft.passed, blocked: item.pipeline.sampleDraft.status === "blocked" },
    { label: "平台适配", done: item.pipeline.styleAdaptation.status === "passed", blocked: false },
    { label: "降低重复", done: item.pipeline.dispersion.status === "passed", blocked: false },
    { label: "图片提示", done: item.pipeline.imageGeneration.status !== "blocked", blocked: false },
  ];
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-5">
      {checks.map((check) => (
        <div key={check.label} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs text-muted">
          {check.blocked ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          ) : check.done ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 text-muted" />
          )}
          <span className="truncate">{check.label}</span>
        </div>
      ))}
    </div>
  );
}

function ItemCard({
  item,
  busy,
  onAction,
}: {
  item: ContentPoolItem;
  busy: boolean;
  onAction: (itemId: string, action: "rewrite" | "confirm_medium" | "disperse") => void;
}) {
  const negativeHits = item.pipeline.negativeCheck.hits;
  const canConfirm = item.riskLevel === "medium" && negativeHits.length === 0;
  const mustRewrite = item.riskLevel === "high" || negativeHits.length > 0;

  return (
    <article className="subtle-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-pill">#{item.sequence}</span>
            <span className="status-pill">{statusLabels[item.status]}</span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${riskClass(item.riskLevel)}`}>
              {riskLabels[item.riskLevel]}
            </span>
            {item.publishable && <span className="status-pill">可进入发布</span>}
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-ink">{item.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{item.summary}</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-xs text-muted lg:w-64">
          <span>{providerLabels[item.aiPlatform]}</span>
          <span>{platformLabels[item.publishPlatform]}</span>
          <span className="truncate">{item.accountName || item.accountId}</span>
          <span>{formatDateTime(item.plannedPublishTime)}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-md border border-line bg-surface px-3 py-3">
          <p className="text-xs font-medium text-muted">客户问题 K{item.keywordSequence}，账号错位 {item.accountKeywordOffset + 1}/5</p>
          <p className="mt-2 text-sm leading-6 text-ink">{item.keywordText}</p>
          <p className="mt-3 line-clamp-4 whitespace-pre-line text-xs leading-5 text-muted">{item.body}</p>
        </div>
        <div className="rounded-md border border-line bg-surface px-3 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <ImageIcon className="h-3.5 w-3.5" />
            图片提示
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">{item.imagePrompt}</p>
          <p className="mt-2 text-xs text-muted">图片：{item.imageList.length} 张</p>
        </div>
      </div>

      <PipelineLine item={item} />

      {(negativeHits.length > 0 || item.pipeline.riskReview.message) && (
        <p className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-xs leading-5 text-muted">
          {negativeHits.length > 0 ? `命中：${negativeHits.join("、")}。必须改写并复检后才能发布。` : item.pipeline.riskReview.message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {mustRewrite && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => onAction(item.id, "rewrite")}
          >
            <Wand2 className="h-3.5 w-3.5" />
            自动改写
          </button>
        )}
        {canConfirm && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:border-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => onAction(item.id, "confirm_medium")}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            确认可发布
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:border-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => onAction(item.id, "disperse")}
        >
          <Repeat2 className="h-3.5 w-3.5" />
          重新降重
        </button>
      </div>
    </article>
  );
}

export function ContentPoolWorkbench() {
  const [current, setCurrent] = useState<ContentPoolRecord | null>(null);
  const [history, setHistory] = useState<ContentPoolRecord[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("current");
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const visibleRecord = useMemo(() => {
    if (viewMode === "current") return current;
    return history.find((record) => record.taskId === selectedHistoryTaskId) ?? history[0] ?? null;
  }, [current, history, selectedHistoryTaskId, viewMode]);

  const items = visibleRecord?.items ?? [];
  const stats = {
    total: items.length,
    publishable: countBy(items, (item) => item.publishable),
    needsAction: countBy(items, (item) => item.riskLevel !== "low" || item.pipeline.negativeCheck.hits.length > 0),
    imagesPending: countBy(items, (item) => item.pipeline.imageGeneration.status === "pending"),
  };

  async function loadPool() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/content/pool", { cache: "no-store" });
      const data = (await response.json()) as ContentPoolResponse;
      if (!response.ok) throw new Error(data.error || "读取内容池失败。");
      setCurrent(data.current);
      setHistory(data.history);
      setSelectedHistoryTaskId(data.history[0]?.taskId ?? "");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取内容池失败。");
    } finally {
      setLoading(false);
    }
  }

  async function regeneratePool() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/content/pool", { method: "POST" });
      const data = (await response.json()) as { current?: ContentPoolRecord; error?: string };
      if (!response.ok || !data.current) throw new Error(data.error || "生成内容池失败。");
      setCurrent(data.current);
      setViewMode("current");
      setNotice("内容池已按当前任务重新生成。");
      dispatchWorkflowStatusRefresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "生成内容池失败。");
    } finally {
      setBusy(false);
    }
  }

  async function runItemAction(itemId: string, action: "rewrite" | "confirm_medium" | "disperse") {
    if (!visibleRecord) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/content/pool/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: visibleRecord.taskId, itemId, action }),
      });
      const data = (await response.json()) as { current?: ContentPoolRecord; error?: string };
      if (!response.ok || !data.current) throw new Error(data.error || "内容处理失败。");
      if (current?.taskId === data.current.taskId) {
        setCurrent(data.current);
      } else {
        setHistory((records) => records.map((record) => (record.taskId === data.current?.taskId ? data.current : record)));
      }
      setNotice(action === "rewrite" ? "已完成改写和复检。" : action === "disperse" ? "已重新处理差异点。" : "已确认进入发布准备。");
      dispatchWorkflowStatusRefresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "内容处理失败。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadPool();
  }, []);

  if (loading) {
    return <section className="section-card text-sm text-muted">正在读取内容池。</section>;
  }

  if (!current && !history.length) {
    return (
      <section className="section-card">
        <h2 className="page-section-title">还没有可用任务</h2>
        <p className="page-section-desc">先保存创建任务中的发布计划，再进入内容池生成文章。</p>
        <Link className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/tasks/create">
          去创建任务
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
            <h2 className="page-section-title mt-2">当前任务内容</h2>
            <p className="page-section-desc">默认只看当前任务。历史内容从右侧入口切换，避免和本次生产混在一起。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-medium ${viewMode === "current" ? "bg-accent text-white" : "border border-line text-ink"}`}
              onClick={() => setViewMode("current")}
            >
              当前任务
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${viewMode === "history" ? "bg-accent text-white" : "border border-line text-ink"}`}
              onClick={() => setViewMode("history")}
            >
              <History className="h-4 w-4" />
              历史
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => void regeneratePool()}
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              重新生成
            </button>
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

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="subtle-card">
            <p className="text-xs text-muted">总文章</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{stats.total}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">可发布</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.publishable}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">需处理</p>
            <p className="mt-2 text-2xl font-semibold text-amber-600">{stats.needsAction}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">待生成图片</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{stats.imagesPending}</p>
          </div>
        </div>
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        {notice && <p className="mt-4 text-sm text-accent">{notice}</p>}
      </section>

      <section className="space-y-3">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} busy={busy} onAction={runItemAction} />
        ))}
      </section>

      <div className="flex justify-end">
        <Link className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/publish-execution">
          执行发布
        </Link>
      </div>
    </div>
  );
}
