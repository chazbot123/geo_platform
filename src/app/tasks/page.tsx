import { AppShell } from "@/components/layout/app-shell";
import { TaskCenter } from "@/components/tasks/task-center";
import { getContentPool, getPublishingJobsByTask } from "@/lib/storage/data-store";
import { listTaskBundles } from "@/lib/tasks/service";

export default async function TasksPage() {
  const bundles = await listTaskBundles();
  const tasks = await Promise.all(
    bundles.map(async (bundle) => ({
      bundle,
      contentPool: await getContentPool(bundle.task.id),
      publishingJobs: await getPublishingJobsByTask(bundle.task.id),
    })),
  );

  return (
    <AppShell title="任务中心" description="查看当前任务和历史任务的计划、生成进度与发布进度。">
      <TaskCenter tasks={tasks} />
    </AppShell>
  );
}
