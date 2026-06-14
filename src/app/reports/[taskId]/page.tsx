import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ReportWorkbench } from "@/components/content/report-workbench";
import { reviewDraft } from "@/lib/review/service";
import { getTaskBundle } from "@/lib/tasks/service";

export default async function ReportsPage({ params }: { params: { taskId: string } }) {
  const bundle = await getTaskBundle(params.taskId);
  if (!bundle) {
    notFound();
  }

  const review = reviewDraft(bundle.content, bundle.image, bundle.task.expectedImageCount);

  return (
    <AppShell title="第二阶段报告工作台" description="围绕已确认的 5 条提问句生成权威报告与可选数量的文章配图，并直接在文章流中完成图文预览与编辑。">
      <ReportWorkbench bundle={bundle} review={review} />
    </AppShell>
  );
}
