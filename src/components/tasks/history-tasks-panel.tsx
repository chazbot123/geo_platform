"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { History, LoaderCircle, RotateCw } from "lucide-react";
import type { HistoricalTaskSummary } from "@/lib/tasks/history-service";

const providerLabels: Record<string, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "元宝",
  tongyi: "通义",
};

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stepBadge(done: boolean, label: string) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${done ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-surface text-muted"}`}>
      {label}
    </span>
  );
}

function questionPreview(questions: string[]) {
  if (!questions.length) return "暂无已保存问题";
  return questions.slice(0, 3).join(" / ");
}

function HistoryTaskCard({
  task,
  active,
  activeLabel,
  reusing,
  onReuse,
}: {
  task: HistoricalTaskSummary;
  active: boolean;
  activeLabel: string;
  reusing: boolean;
  onReuse: (task: HistoricalTaskSummary) => void;
}) {
  const hasPendingPublishWork = task.manualPendingCount > 0 || task.publishedArticleCount < task.generatedArticleCount;
  const publishActionLabel = hasPendingPublishWork ? "继续发布" : "查看发布结果";

  return (
    <article className={`rounded-md border p-4 ${active ? "border-accent bg-accent/5" : "border-line bg-panel"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">{task.title}</h3>
            {active ? <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">{activeLabel}</span> : null}
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">{task.archived ? "历史任务" : "当前任务"}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {task.enterpriseName} · {providerLabels[task.searchProvider ?? ""] ?? task.searchProvider ?? "--"} · 更新 {formatDateTime(task.updatedAt)}
          </p>
          <p className="mt-2 text-xs leading-5 text-ink">
            本次任务问题：{questionPreview(task.selectedQuestions)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {stepBadge(task.hasKeywords, `${task.selectedQuestionCount} 个问题`)}
            {stepBadge(task.hasPublishPlan, `${task.enabledPlatformCount} 个平台`)}
            {stepBadge(task.hasGeneratedContent, `${task.generatedArticleCount}/${task.plannedArticleCount} 篇内容`)}
            {stepBadge(task.hasPublishExecution, `${task.publishedArticleCount} 已发布`)}
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Link className="rounded-md border border-line px-3 py-2 text-center text-xs font-medium text-ink hover:border-accent" href={task.links.contentPool}>
            查看内容池
          </Link>
          <Link
            className={
              hasPendingPublishWork
                ? "rounded-md bg-accent px-3 py-2 text-center text-xs font-medium text-white"
                : "rounded-md border border-line px-3 py-2 text-center text-xs font-medium text-ink hover:border-accent"
            }
            href={task.links.publishExecution}
          >
            {publishActionLabel}
          </Link>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-center text-xs font-medium text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            disabled={reusing || !task.hasKeywords}
            onClick={() => onReuse(task)}
          >
            {reusing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            复用关键词生成
          </button>
        </div>
      </div>
      {task.manualPendingCount > 0 ? (
        <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          当前任务有 {task.manualPendingCount} 篇发布结果需要人工确认或补充处理，可进入发布结果继续处理。
        </p>
      ) : null}
    </article>
  );
}

export function HistoryTasksPanel({
  tasks,
  activeTaskId,
  limit,
  showHeaderAction = true,
  activeLabel = "当前任务",
}: {
  tasks: HistoricalTaskSummary[];
  activeTaskId?: string;
  limit?: number;
  showHeaderAction?: boolean;
  activeLabel?: string;
}) {
  const router = useRouter();
  const [reusingTaskId, setReusingTaskId] = useState("");
  const visibleTasks = typeof limit === "number" ? tasks.slice(0, limit) : tasks;

  async function reuseHistoricalKeywords(task: HistoricalTaskSummary) {
    setReusingTaskId(task.taskId);
    try {
      const response = await fetch("/api/tasks/history/reuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.taskId }),
      });
      const payload = (await response.json()) as { links?: { taskPlan?: string }; error?: string };
      if (!response.ok || !payload.links?.taskPlan) {
        throw new Error(payload.error || "复用历史任务关键词失败。");
      }
      router.push(payload.links.taskPlan);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "复用历史任务关键词失败。");
    } finally {
      setReusingTaskId("");
    }
  }

  return (
    <section className="section-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-accent" />
            <h2 className="page-section-title">任务记录</h2>
          </div>
          <p className="page-section-desc mt-2">
            保留已做过优化的 5 个客户问题、内容池和发布执行记录，可回到对应任务继续发布。
          </p>
        </div>
        {showHeaderAction ? (
          <Link className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:border-accent" href="/tasks">
            全部记录
          </Link>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3">
        {visibleTasks.length ? (
          visibleTasks.map((task) => (
            <HistoryTaskCard
              key={task.taskId}
              task={task}
              active={Boolean(activeTaskId && task.taskId === activeTaskId)}
              activeLabel={activeLabel}
              reusing={reusingTaskId === task.taskId}
              onReuse={reuseHistoricalKeywords}
            />
          ))
        ) : (
          <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            暂无任务记录。保存客户问题、生成内容或执行发布后会自动保留在这里。
          </div>
        )}
      </div>
    </section>
  );
}
