"use client";

import Link from "next/link";
import { HistoryTasksPanel } from "@/components/tasks/history-tasks-panel";
import type { HistoricalTaskSummary } from "@/lib/tasks/history-service";

export function TaskCenter({ tasks }: { tasks: HistoricalTaskSummary[] }) {
  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">任务操作</p>
            <h2 className="page-section-title mt-2">继续处理历史任务</h2>
            <p className="page-section-desc">找回之前生成过的内容池和发布记录，继续完成未发布文章。</p>
          </div>
          <Link className="inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/tasks/create">
            新建或继续规划
          </Link>
        </div>
      </section>

      <HistoryTasksPanel tasks={tasks} showHeaderAction={false} />
    </div>
  );
}
