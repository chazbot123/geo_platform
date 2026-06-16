"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, LoaderCircle, RotateCw, Search, X } from "lucide-react";
import type { HistoricalTaskSummary } from "@/lib/tasks/history-service";

const historyPageSize = 10;

const providerLabels: Record<string, string> = {
  doubao: "豆包",
  deepseek: "DeepSeek",
  yuanbao: "元宝",
  tongyi: "通义",
};

const statusFilterOptions = [
  { value: "all", label: "全部" },
  { value: "current", label: "当前任务" },
  { value: "archived", label: "历史任务" },
  { value: "pending", label: "有待发布" },
  { value: "manual", label: "有人工处理" },
  { value: "published", label: "已发布" },
] as const;

type StatusFilter = (typeof statusFilterOptions)[number]["value"];

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

function hasPendingPublishWork(task: HistoricalTaskSummary) {
  return task.manualPendingCount > 0 || task.publishedArticleCount < task.generatedArticleCount;
}

function taskProviderKeys(task: HistoricalTaskSummary) {
  const providers = task.searchProviders?.length ? task.searchProviders : task.searchProvider ? [task.searchProvider] : [];
  return Array.from(new Set(providers.filter(Boolean)));
}

function formatProviderLabels(task: HistoricalTaskSummary) {
  const labels = taskProviderKeys(task).map((provider) => providerLabels[provider] ?? provider);
  return labels.length ? labels.join("、") : "--";
}

function matchesStatusFilter(task: HistoricalTaskSummary, statusFilter: StatusFilter) {
  if (statusFilter === "current") return !task.archived;
  if (statusFilter === "archived") return task.archived;
  if (statusFilter === "pending") return hasPendingPublishWork(task);
  if (statusFilter === "manual") return task.manualPendingCount > 0;
  if (statusFilter === "published") return task.publishedArticleCount > 0;
  return true;
}

function matchesSearchQuery(task: HistoricalTaskSummary, searchQuery: string) {
  const keyword = searchQuery.trim().toLowerCase();
  if (!keyword) return true;
  const searchText = [
    task.title,
    task.enterpriseName,
    task.productName,
    task.searchProvider,
    ...taskProviderKeys(task),
    ...taskProviderKeys(task).map((provider) => providerLabels[provider]),
    ...task.selectedQuestions,
    ...task.enabledPlatforms,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchText.includes(keyword);
}

function HistoryTaskCard({
  task,
  active,
  activeLabel,
  reusing,
  expanded,
  onToggleQuestions,
  onReuse,
}: {
  task: HistoricalTaskSummary;
  active: boolean;
  activeLabel: string;
  reusing: boolean;
  expanded: boolean;
  onToggleQuestions: (taskId: string) => void;
  onReuse: (task: HistoricalTaskSummary) => void;
}) {
  const hasPendingPublish = hasPendingPublishWork(task);
  const publishActionLabel = hasPendingPublish ? "继续发布" : "查看发布结果";
  const compactQuestionCount = 3;
  const hasHiddenQuestions = task.selectedQuestions.length > compactQuestionCount;
  const visibleQuestions = expanded ? task.selectedQuestions : task.selectedQuestions.slice(0, compactQuestionCount);

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
            {task.enterpriseName} · {formatProviderLabels(task)} · 更新 {formatDateTime(task.updatedAt)}
          </p>
          <div className="mt-3 text-sm leading-6 text-ink">
            <div className="flex flex-wrap items-center gap-2">
              {hasHiddenQuestions && expanded ? (
                <button
                  type="button"
                  className="inline-flex w-fit rounded-md border border-line px-3 py-1.5 text-xs font-medium text-accent hover:border-accent"
                  onClick={() => onToggleQuestions(task.taskId)}
                >
                  收起
                </button>
              ) : null}
              <p className="font-medium">本次任务问题：</p>
            </div>
            {task.selectedQuestions.length ? (
              <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {visibleQuestions.map((question, index) => (
                  <div
                    key={`${task.taskId}-question-${index}`}
                    className="flex min-w-0 items-start gap-2 rounded-md bg-panelSoft px-3 py-2 text-sm leading-6 text-ink"
                    title={question}
                  >
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent">
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words">{question}</span>
                  </div>
                ))}
                {hasHiddenQuestions && !expanded ? (
                  <button
                    type="button"
                    className="flex min-h-[40px] items-center justify-center rounded-md border border-dashed border-line px-3 py-2 text-sm font-medium leading-6 text-accent hover:border-accent"
                    aria-label="展开查看全部关键词"
                    title="展开查看全部关键词"
                    onClick={() => onToggleQuestions(task.taskId)}
                  >
                    ...
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-muted">暂无已保存问题</p>
            )}
          </div>
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
              hasPendingPublish
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
  const [expandedQuestionTaskId, setExpandedQuestionTaskId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const hasListControls = typeof limit !== "number";
  const filteredTasks = useMemo(
    () => tasks.filter((task) => matchesSearchQuery(task, searchQuery) && matchesStatusFilter(task, statusFilter)),
    [searchQuery, statusFilter, tasks],
  );
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / historyPageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTasks = filteredTasks.slice((currentPage - 1) * historyPageSize, currentPage * historyPageSize);
  const embeddedTasks = typeof limit === "number" ? tasks.slice(0, limit) : tasks;
  const visibleTasks = hasListControls ? pagedTasks : embeddedTasks;
  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== "all";

  function updateSearchQuery(value: string) {
    setSearchQuery(value);
    setPage(1);
  }

  function updateStatusFilter(value: StatusFilter) {
    setStatusFilter(value);
    setPage(1);
  }

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setPage(1);
  }

  function toggleTaskQuestions(taskId: string) {
    setExpandedQuestionTaskId((current) => (current === taskId ? "" : taskId));
  }

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
      {hasListControls ? (
        <div className="mt-5 rounded-md border border-line bg-panelSoft p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => updateSearchQuery(event.target.value)}
                placeholder="搜索任务名称、企业、产品、关键词"
                className="h-10 w-full rounded-md border border-line bg-panel px-9 text-sm text-ink outline-none transition focus:border-accent"
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-ink"
                  aria-label="清空搜索"
                  onClick={() => updateSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            <div className="flex flex-wrap gap-2">
              {statusFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                    statusFilter === option.value ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink hover:border-accent"
                  }`}
                  onClick={() => updateStatusFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <span>
              共 {filteredTasks.length} 条，当前显示 {visibleTasks.length} 条
            </span>
            {hasActiveFilters ? (
              <button type="button" className="inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/10" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                清空筛选
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mt-5 grid gap-3">
        {visibleTasks.length ? (
          visibleTasks.map((task) => (
            <HistoryTaskCard
              key={task.taskId}
              task={task}
              active={Boolean(activeTaskId && task.taskId === activeTaskId)}
              activeLabel={activeLabel}
              reusing={reusingTaskId === task.taskId}
              expanded={expandedQuestionTaskId === task.taskId}
              onToggleQuestions={toggleTaskQuestions}
              onReuse={reuseHistoricalKeywords}
            />
          ))
        ) : (
          <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            {hasActiveFilters ? "没有匹配的历史任务，请调整关键词或筛选条件。" : "暂无任务记录。保存客户问题、生成内容或执行发布后会自动保留在这里。"}
          </div>
        )}
      </div>
      {hasListControls && filteredTasks.length > historyPageSize ? (
        <div className="mt-4 flex flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            第 {currentPage} / {pageCount} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={currentPage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={currentPage >= pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
