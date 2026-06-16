import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { TaskPlanningWorkbench } from "@/components/tasks/task-planning-workbench";

export default function CreateTaskPage() {
  return (
    <AppShell title="创建任务" description="选择 GEO AI 平台，确认发布平台和可用账号，生成可执行的发布计划。">
      <Suspense fallback={<div className="text-sm text-muted">正在加载任务配置...</div>}>
        <TaskPlanningWorkbench />
      </Suspense>
    </AppShell>
  );
}
