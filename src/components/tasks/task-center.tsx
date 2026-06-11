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

function formatDateTime(value?: string) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

function buildTaskTitle(bundle: TaskBundle) {
  return bundle.product.productName || bundle.product.category || bundle.task.id.slice(0, 8);
}

function buildTaskSubtitle(bundle: TaskBundle) {
  const values = [
    bundle.product.category,
    bundle.product.targetAudience,
    bundle.product.scenarios,
  ].filter(Boolean);
  return values.join(" / ") || "当前任务尚未补充更多业务说明。";
}

function countPublished(jobs: PublishingJobRecord[]) {
  return jobs.filter((job) => job.status === "published").length;
}

export function TaskCenter({
  tasks,
}: {
  tasks: Array<{
    bundle: TaskBundle;
    contentPool: ContentPoolRecord | null;
    publishingJobs: PublishingJobRecord[];
  }>;
}) {
  if (!tasks.length) {
    return (
      <section className="section-card">
        <h2 className="page-section-title">还没有任务</h2>
        <p className="page-section-desc">先完成企业信息和客户关键词，再到创建任务页保存计划。</p>
        <Link className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/tasks/create">
          去创建任务
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">任务中心</p>
            <h2 className="page-section-title mt-2">当前任务与历史任务</h2>
            <p className="page-section-desc">集中查看计划、生成进度和发布进度，再决定继续生成还是进入发布。</p>
          </div>
          <Link className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/tasks/create">
            新建或继续规划
          </Link>
        </div>
      </section>

      <section className="grid gap-4">
        {tasks.map(({ bundle, contentPool, publishingJobs }) => {
          const generatedCount = contentPool?.generatedArticleCount ?? 0;
          const failedCount = contentPool?.failedArticleCount ?? 0;
          const totalCount = bundle.task.publishPlan?.totalArticleCount ?? 0;
          const publishedCount = countPublished(publishingJobs);

          return (
            <article key={bundle.task.id} className="section-card">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(bundle.task.status)}`}>
                      {taskStatusLabels[bundle.task.status]}
                    </span>
                    <span className="status-pill">{providerLabels[bundle.task.searchProvider ?? "doubao"]}</span>
                    <span className="status-pill">任务 {bundle.task.id.slice(0, 8)}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-ink">{buildTaskTitle(bundle)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{buildTaskSubtitle(bundle)}</p>
                </div>

                <div className="grid gap-1 text-sm text-muted lg:w-72">
                  <span>创建：{formatDateTime(bundle.task.createdAt)}</span>
                  <span>更新：{formatDateTime(bundle.task.updatedAt)}</span>
                  <span>发布时间窗：{bundle.task.publishPlan ? `${bundle.task.publishPlan.timeWindow.start} - ${bundle.task.publishPlan.timeWindow.end}` : "--"}</span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="subtle-card">
                  <p className="text-xs text-muted">总篇数</p>
                  <p className="mt-2 text-2xl font-semibold text-ink">{totalCount}</p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs text-muted">已生成</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-600">{generatedCount}</p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs text-muted">失败</p>
                  <p className="mt-2 text-2xl font-semibold text-red-600">{failedCount}</p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs text-muted">已发布</p>
                  <p className="mt-2 text-2xl font-semibold text-ink">{publishedCount}</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href={`/tasks/${encodeURIComponent(bundle.task.id)}`}>
                  查看详情
                </Link>
                <Link className="inline-flex rounded-md border border-line px-4 py-2 text-sm font-medium text-ink" href={`/content-pool?taskId=${encodeURIComponent(bundle.task.id)}`}>
                  查看生成结果
                </Link>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
