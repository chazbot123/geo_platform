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
    <AppShell title="多平台发布工作台" description="按板块映射展示目标平台和账号级发布稿；已接入脚本的平台走自动发布，未接入脚本的平台按手动交付处理。">
      <PublishWorkbench tasks={tasks} />
    </AppShell>
  );
}
