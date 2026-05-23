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
    <AppShell title="发布工作台" description="围绕当前任务生成社媒平台草稿，绑定平台账号，创建发布任务，并统一查看自动核验与发布记录。">
      <PublishWorkbench tasks={tasks} />
    </AppShell>
  );
}
