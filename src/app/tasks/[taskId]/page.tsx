import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TaskDetailOverview } from "@/components/tasks/task-detail-overview";
import { getContentPool, getPublishingJobsByTask } from "@/lib/storage/data-store";
import { getTaskBundle } from "@/lib/tasks/service";

export default async function TaskDetailPage({ params }: { params: { taskId: string } }) {
  const bundle = await getTaskBundle(params.taskId);
  if (!bundle) {
    notFound();
  }

  const [contentPool, publishingJobs] = await Promise.all([
    getContentPool(params.taskId),
    getPublishingJobsByTask(params.taskId),
  ]);

  return (
    <AppShell title="任务详情" description="按任务查看计划信息、生成结果和发布进度。">
      <TaskDetailOverview bundle={bundle} contentPool={contentPool} publishingJobs={publishingJobs} />
    </AppShell>
  );
}
