import { AppShell } from "@/components/layout/app-shell";
import { PublishExecutionWorkbench } from "@/components/publish/publish-execution-workbench";

export default function PublishExecutionPage() {
  return (
    <AppShell
      title="发布结果"
      description="系统按计划时间自动发布，用户查看结果并处理需要人工介入的文章。"
    >
      <PublishExecutionWorkbench />
    </AppShell>
  );
}
