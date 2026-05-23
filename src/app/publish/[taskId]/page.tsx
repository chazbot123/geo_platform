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
    <AppShell title="发布工作台" description="从当前任务直接进入发布工作台，继续完成社媒草稿编辑、账号绑定、自动发布和人工补录。">
      <PublishWorkbench tasks={tasks} initialTaskId={params.taskId} initialData={data} />
    </AppShell>
  );
}
