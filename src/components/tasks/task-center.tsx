"use client";

import { HistoryTasksPanel } from "@/components/tasks/history-tasks-panel";
import type { HistoricalTaskSummary } from "@/lib/tasks/history-service";

export function TaskCenter({ tasks }: { tasks: HistoricalTaskSummary[] }) {
  return (
    <div className="space-y-5">
      <HistoryTasksPanel tasks={tasks} showHeaderAction={false} />
    </div>
  );
}
