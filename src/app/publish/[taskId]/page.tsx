import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PublishWorkbench } from "@/components/publish/publish-workbench";
import { getWorkbenchData, listWorkbenchTasks } from "@/lib/publish/workbench-service";

export default async function PublishPage({ params }: { params: { taskId: string } }) {
  const [data, bundles] = await Promise.all([getWorkbenchData(params.taskId), listWorkbenchTasks()]);
  if (!data) {
    notFound();
  }

  const tasks = bundles.map((bundle) => ({
    id: bundle.task.id,
    title: bundle.content?.title ?? bundle.product.productName,
    status: bundle.task.status,
    updatedAt: bundle.task.updatedAt,
  }));

  return (
    <AppShell title="多平台发布工作台" description="从当前任务进入板块驱动的发布工作台，查看平台组合、账号级发布稿和发布任务执行状态。">
      <PublishWorkbench tasks={tasks} initialTaskId={params.taskId} initialData={data} />
    </AppShell>
  );
}
