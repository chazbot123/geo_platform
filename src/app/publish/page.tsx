import { AppShell } from "@/components/layout/app-shell";
import { PublishWorkbench } from "@/components/publish/publish-workbench";
import { listWorkbenchTasks } from "@/lib/publish/workbench-service";

export default async function PublishWorkbenchPage() {
  const bundles = await listWorkbenchTasks();
  const tasks = bundles.map((bundle) => ({
    id: bundle.task.id,
    title: bundle.content?.title ?? bundle.product.productName,
    status: bundle.task.status,
    updatedAt: bundle.task.updatedAt,
  }));

  return (
    <AppShell title="今日头条发布工作台" description="围绕当前任务生成今日头条草稿，绑定平台账号，创建 Electron 自动发布任务，并统一查看执行与回录记录。">
      <PublishWorkbench tasks={tasks} />
    </AppShell>
  );
}
