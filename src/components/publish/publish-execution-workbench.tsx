"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
import type {
  ContentPoolItem,
  ContentPoolRecord,
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
  tongyi: "千问",
};

const jobStatusLabels: Record<PublishingJobRecord["status"], string> = {
  drafted: "草稿",
  queued: "待执行",
  running: "执行中",
  submitted: "已提交",
  verifying: "核验中",
  pending_review: "平台处理中",
  verification_failed: "待人工确认",
  manual_pending: "手动待处理",
  published: "已发布",
  failed: "失败",
};

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

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    pending: "等待执行",
    queued: "待执行",
    running: "执行中",
    submitted: "已提交",
    verifying: "核验中",
    pending_review: "平台处理中",
    verification_failed: "待人工确认",
    manual_pending: "手动待处理",
    published: "已发布",
    failed: "失败",
    automation_failed: "自动发布中断",
    account_binding: "账号检查",
    electron_bridge: "桌面桥接",
    prepare_images: "准备图片",
    open_publish_page: "打开创作页",
    fill_title: "填写标题",
    fill_body: "填写正文",
    fill_tags: "填写标签",
    submit: "提交发布",
  };
  return labels[stage] ?? stage.replace(/_/g, " ");
}

function buildBodyPreview(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "暂无正文";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function statusTone(article: ExecutionArticle) {
  if (article.published) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (article.manualPending) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (!article.item.publishable) return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-line bg-surface text-muted";
}

function ArticleRow({
  article,
  busy,
  publishUrl,
  onPublishUrlChange,
  onManualDone,
}: {
  article: ExecutionArticle;
  busy: boolean;
  publishUrl: string;
  onPublishUrlChange: (value: string) => void;
  onManualDone: (jobId: string) => void;
}) {
  const item = article.item;
  const job = article.job;

  return (
    <article className="subtle-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-pill">#{item.sequence}</span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(article)}`}>
              {article.published
                ? "已发布"
                : article.manualPending
                  ? "手动待处理"
                  : item.publishable
                    ? stageLabel(article.stage)
                    : "未通过检查"}
            </span>
            <span className="status-pill">{platformLabels[item.publishPlatform]}</span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-6 text-ink">{item.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{buildBodyPreview(item.body)}</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-xs text-muted lg:w-72">
          <span>AI：{providerLabels[item.aiPlatform]}</span>
          <span>平台：{platformLabels[item.publishPlatform]}</span>
          <span className="truncate">账号：{item.accountName || item.accountId}</span>
          <span>计划：{formatDateTime(item.plannedPublishTime)}</span>
          <span className="col-span-2 truncate">问题：{item.keywordText}</span>
        </div>
      </div>

      {job ? (
        <div className="mt-4 grid gap-3 rounded-md border border-line bg-surface px-3 py-3 text-xs text-muted md:grid-cols-3">
          <span>记录：{job.id.slice(0, 8)}</span>
          <span>阶段：{stageLabel(article.stage)}</span>
          <span>更新：{formatDateTime(job.lastExecutionAt ?? job.updatedAt)}</span>
          <span>状态：{jobStatusLabels[job.status]}</span>
          <span className="truncate">账号：{job.accountName ?? "--"}</span>
          <span>Retry: {job.retryCount ?? 0}/{job.maxRetries ?? 3}</span>
          <span>Next: {formatDateTime(job.nextRunAt ?? job.backoffUntil)}</span>
          <span className="truncate">Risk: {job.accountRiskState ?? "--"}</span>
          <span className="truncate">Queue: {job.queueBlockedReason ?? "--"}</span>
          {job.publishUrl ? (
            <a className="inline-flex items-center gap-1 text-accent hover:underline" href={job.publishUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              发布链接
            </a>
          ) : (
            <span>发布链接：--</span>
          )}
        </div>
      ) : null}

      {article.manualPending && job ? (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-ink">需要手动完成当前文章</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                打开创作入口后检查标题、正文、标签和图片，平台最终发布按钮由人工点击。完成后回填链接并继续后续文章。
              </p>
            </div>
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
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              value={publishUrl}
              onChange={(event) => onPublishUrlChange(event.target.value)}
              placeholder="可选：粘贴平台发布链接"
            />
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => onManualDone(job.id)}
            >
              <CheckCircle2 className="h-4 w-4" />
              标记已发布
            </button>
          </div>
          {job.notes ? <p className="mt-3 whitespace-pre-line text-xs leading-5 text-muted">{job.notes}</p> : null}
        </div>
      ) : null}

      {job?.errorMessage && !article.manualPending ? (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-700 dark:text-red-300">
          {job.errorMessage}
        </p>
      ) : null}
    </article>
  );
}

export function PublishExecutionWorkbench() {
  const [state, setState] = useState<ExecutionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manualUrls, setManualUrls] = useState<Record<string, string>>({});

  const articles = state?.articles ?? [];
  const currentArticle = state?.currentArticle ?? null;
  const progressPercent = useMemo(() => {
    if (!state?.stats.total) return 0;
    return Math.round((state.stats.published / state.stats.total) * 100);
  }, [state]);

  async function loadState() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/publish/execution", { cache: "no-store" });
      const data = (await response.json()) as ExecutionState;
      if (!response.ok) throw new Error(data.error || "读取发布进度失败。");
      setState(data);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取发布进度失败。");
    } finally {
      setLoading(false);
    }
  }

  async function runNext() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_next" }),
      });
      const data = (await response.json()) as ExecutionState;
      if (!response.ok) throw new Error(data.error || "执行发布失败。");
      setState(data);
      setNotice("已记录当前文章执行结果。");
      dispatchWorkflowStatusRefresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "执行发布失败。");
    } finally {
      setBusy(false);
    }
  }

  async function markManualDone(jobId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/publish/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_manual_published",
          jobId,
          publishUrl: manualUrls[jobId]?.trim() || undefined,
        }),
      });
      const data = (await response.json()) as ExecutionState;
      if (!response.ok) throw new Error(data.error || "回填发布结果失败。");
      setState(data);
      setManualUrls((current) => ({ ...current, [jobId]: "" }));
      setNotice("已回填人工发布结果，可以继续执行剩余文章。");
      dispatchWorkflowStatusRefresh();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "回填发布结果失败。");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadState();
  }, []);

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
      <section className="section-card">
        <h2 className="page-section-title">还没有可执行任务</h2>
        <p className="page-section-desc">先完成内容池生成，并确保文章通过风险检查后再进入执行发布。</p>
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
    );
  }

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">第 5 步</p>
            <h2 className="page-section-title mt-2">执行发布</h2>
            <p className="page-section-desc">按文章级进度恢复执行。已发布文章不会重复执行，手动待处理文章会被跳过并保留回填入口。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => void loadState()}
            >
              <RotateCcw className="h-4 w-4" />
              重新读取
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={busy || !currentArticle}
              onClick={() => void runNext()}
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {state.stats.published > 0 || state.stats.manualPending > 0 ? "继续发布" : "开始发布"}
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
            <span className="truncate">账号：{currentArticle?.item.accountName || currentArticle?.item.accountId || "--"}</span>
            <span>文章：{currentArticle ? `#${currentArticle.item.sequence}` : "--"}</span>
            <span>最近执行：{formatDateTime(state.latestExecutionTime)}</span>
          </div>
        </div>

        {!currentArticle && state.stats.remaining > 0 ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            剩余文章需要先完成风险处理或手动回填。
          </p>
        ) : null}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        {notice && <p className="mt-4 text-sm text-accent">{notice}</p>}
      </section>

      <section className="space-y-3">
        {articles.map((article) => (
          <ArticleRow
            key={article.item.id}
            article={article}
            busy={busy}
            publishUrl={article.job ? manualUrls[article.job.id] ?? "" : ""}
            onPublishUrlChange={(value) => {
              if (!article.job) return;
              setManualUrls((current) => ({ ...current, [article.job!.id]: value }));
            }}
            onManualDone={(jobId) => void markManualDone(jobId)}
          />
        ))}
      </section>
    </div>
  );
}
