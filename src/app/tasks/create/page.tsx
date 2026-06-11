import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { TaskPlanningWorkbench } from "@/components/tasks/task-planning-workbench";

export default function CreateTaskPage() {
  return (
    <AppShell title="创建任务" description="选择 GEO AI 平台，确认发布平台和可用账号，生成可执行的发布计划。">
      <div className="space-y-5">
        <div className="flex justify-end">
          <Link className="inline-flex rounded-md border border-line px-4 py-2 text-sm font-medium text-ink" href="/tasks">
            查看任务中心
          </Link>
        </div>
        <TaskPlanningWorkbench />
      </div>
    </AppShell>
  );
}
