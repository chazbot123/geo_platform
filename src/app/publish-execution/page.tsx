import { AppShell } from "@/components/layout/app-shell";
import { PublishExecutionWorkbench } from "@/components/publish/publish-execution-workbench";

export default function PublishExecutionPage() {
  return (
    <AppShell
      title="执行发布"
      description="按文章记录发布进度，支持中断后继续，并保留手动处理入口。"
    >
      <PublishExecutionWorkbench />
    </AppShell>
  );
}
