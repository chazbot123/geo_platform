import { AppShell } from "@/components/layout/app-shell";
import { TaskCenter } from "@/components/tasks/task-center";
import { listHistoricalTaskSummaries } from "@/lib/tasks/history-service";

export default async function TasksPage() {
  const tasks = await listHistoricalTaskSummaries();

  return (
    <AppShell title="历史任务" description="查看历史任务的内容池与发布结果，继续处理未完成发布。" eyebrow="历史任务">
      <TaskCenter tasks={tasks} />
    </AppShell>
  );
}
