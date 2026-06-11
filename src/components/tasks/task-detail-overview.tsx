"use client";

import Link from "next/link";
import type { ContentPoolRecord, PublishingJobRecord, TaskBundle, TaskStatus } from "@/lib/types";

const taskStatusLabels: Record<TaskStatus, string> = {
  created: "待开始",
  keyword_generated: "问题已生成",
  keyword_selected: "问题已确认",
  task_planned: "计划已保存",
  generation_queued: "等待生成",
  generation_running: "生成中",
  generation_completed: "生成完成",
  content_generated: "内容已生成",
  image_generated: "图片已生成",
  publishing: "发布中",
  published: "已发布",
  failed: "失败",
};

const providerLabels = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "元宝",
  tongyi: "千问",
} as const;

const platformLabels = {
  toutiao: "今日头条",
  baijiahao: "百家号",
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信公众号",
  videohao: "视频号",
  zhihu: "知乎",
  weibo: "微博",
  csdn: "CSDN",
} as const;

function formatDateTime(value?: string) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function countPublished(jobs: PublishingJobRecord[]) {
  return jobs.filter((job) => job.status === "published").length;
}

function statusTone(status: TaskStatus) {
  if (status === "failed") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "generation_running" || status === "generation_queued" || status === "publishing") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  if (status === "generation_completed" || status === "published" || status === "task_planned") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-line bg-surface text-muted";
}

export function TaskDetailOverview({
  bundle,
  contentPool,
  publishingJobs,
}: {
  bundle: TaskBundle;
  contentPool: ContentPoolRecord | null;
  publishingJobs: PublishingJobRecord[];
}) {
  const plan = bundle.task.publishPlan;
  const latestItems = [...(contentPool?.items ?? [])].sort((left, right) => left.sequence - right.sequence).slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link className="text-sm font-medium text-muted hover:text-ink" href="/tasks">
                返回任务中心
              </Link>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(bundle.task.status)}`}>
                {taskStatusLabels[bundle.task.status]}
              </span>
              <span className="status-pill">{providerLabels[bundle.task.searchProvider ?? "doubao"]}</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
              {bundle.product.productName || bundle.product.category || `任务 ${bundle.task.id.slice(0, 8)}`}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              {bundle.product.sellingPoints || bundle.product.targetAudience || bundle.product.scenarios || "当前任务已保存计划，可以继续查看生成结果和发布进度。"}
            </p>
          </div>

          <div className="grid gap-1 text-sm text-muted lg:w-72">
            <span>任务编号：{bundle.task.id}</span>
            <span>创建时间：{formatDateTime(bundle.task.createdAt)}</span>
            <span>更新时间：{formatDateTime(bundle.task.updatedAt)}</span>
            <span>最近开始生成：{formatDateTime(bundle.task.generationStartedAt)}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href={`/content-pool?taskId=${encodeURIComponent(bundle.task.id)}`}>
            查看生成结果
          </Link>
          <Link className="inline-flex rounded-md border border-line px-4 py-2 text-sm font-medium text-ink" href="/tasks/create">
            返回创建任务
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="subtle-card">
          <p className="text-xs text-muted">计划总篇数</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{plan?.totalArticleCount ?? 0}</p>
        </div>
        <div className="subtle-card">
          <p className="text-xs text-muted">已生成</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{contentPool?.generatedArticleCount ?? 0}</p>
        </div>
        <div className="subtle-card">
          <p className="text-xs text-muted">失败</p>
          <p className="mt-2 text-2xl font-semibold text-red-600">{contentPool?.failedArticleCount ?? 0}</p>
        </div>
        <div className="subtle-card">
          <p className="text-xs text-muted">已发布</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{countPublished(publishingJobs)}</p>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <article className="section-card">
          <h3 className="page-section-title">计划信息</h3>
          {plan ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="subtle-card">
                  <p className="text-xs text-muted">发布天数</p>
                  <p className="mt-2 text-lg font-semibold text-ink">{plan.days} 天</p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs text-muted">每账号每天</p>
                  <p className="mt-2 text-lg font-semibold text-ink">{plan.articlesPerAccountPerDay} 篇</p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs text-muted">时间窗</p>
                  <p className="mt-2 text-lg font-semibold text-ink">
                    {plan.timeWindow.start} - {plan.timeWindow.end}
                  </p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs text-muted">可用账号</p>
                  <p className="mt-2 text-lg font-semibold text-ink">{plan.totalAccountCount}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-line">
                <div className="grid grid-cols-[160px_120px_120px_minmax(0,1fr)] bg-surface px-4 py-2 text-xs font-medium text-muted">
                  <span>发布平台</span>
                  <span>账号数</span>
                  <span>篇数</span>
                  <span>状态</span>
                </div>
                {plan.enabledPlatforms.map((platformPlan) => (
                  <div
                    key={platformPlan.platform}
                    className="grid grid-cols-[160px_120px_120px_minmax(0,1fr)] border-t border-line px-4 py-3 text-sm text-muted"
                  >
                    <span className="font-medium text-ink">{platformLabels[platformPlan.platform]}</span>
                    <span>{platformPlan.accountCount}</span>
                    <span>{platformPlan.articleCount}</span>
                    <span>{platformPlan.enabled ? "已纳入当前任务" : "未启用或暂无可发布账号"}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">当前任务还没有保存发布计划。</p>
          )}
        </article>

        <aside className="space-y-5">
          <section className="section-card">
            <h3 className="page-section-title">生成概况</h3>
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p>当前进度：{bundle.task.generationProgress ?? 0}%</p>
              <p>待发布：{contentPool?.pendingPublishArticleCount ?? 0}</p>
              <p>最近完成：{formatDateTime(contentPool?.updatedAt)}</p>
              <p>文章记录：{contentPool?.items.length ?? 0}</p>
            </div>
          </section>

          <section className="section-card">
            <h3 className="page-section-title">发布概况</h3>
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p>发布记录：{publishingJobs.length}</p>
              <p>已发布：{countPublished(publishingJobs)}</p>
              <p>最近执行：{formatDateTime(publishingJobs[0]?.updatedAt)}</p>
            </div>
          </section>
        </aside>
      </section>

      <section className="section-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="page-section-title">最近文章</h3>
            <p className="page-section-desc">先看当前任务已经生成出来的文章记录。</p>
          </div>
          <Link className="text-sm font-medium text-accent hover:underline" href={`/content-pool?taskId=${encodeURIComponent(bundle.task.id)}`}>
            查看全部
          </Link>
        </div>

        {latestItems.length ? (
          <div className="mt-4 overflow-hidden rounded-md border border-line">
            <div className="hidden grid-cols-[64px_minmax(0,1.4fr)_140px_140px_150px] bg-surface px-4 py-2 text-xs font-medium text-muted lg:grid">
              <span>序号</span>
              <span>标题</span>
              <span>平台</span>
              <span>状态</span>
              <span>更新时间</span>
            </div>
            {latestItems.map((item) => (
              <Link
                key={item.id}
                href={`/content-pool/${encodeURIComponent(item.id)}?taskId=${encodeURIComponent(bundle.task.id)}`}
                className="grid gap-2 border-t border-line px-4 py-3 text-sm transition hover:bg-panelSoft lg:grid-cols-[64px_minmax(0,1.4fr)_140px_140px_150px]"
              >
                <span className="text-muted">#{item.sequence}</span>
                <span className="truncate font-medium text-ink">{item.title || item.stageMessage || "等待生成结果"}</span>
                <span className="text-muted">{platformLabels[item.publishPlatform]}</span>
                <span className="text-muted">{item.status}</span>
                <span className="text-muted">{formatDateTime(item.updatedAt)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">当前任务还没有文章记录。</p>
        )}
      </section>
    </div>
  );
}
