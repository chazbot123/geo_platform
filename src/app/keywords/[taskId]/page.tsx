import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KeywordWorkbench } from "@/components/keywords/keyword-workbench";
import { getTaskBundle } from "@/lib/tasks/service";

export default async function KeywordPage({ params }: { params: { taskId: string } }) {
  const bundle = await getTaskBundle(params.taskId);
  if (!bundle) {
    notFound();
  }

  return (
    <AppShell title="AI 提问工作台" description="按所选检索平台直接生成 10 条 AI 用户提问句，确认最多 5 条后进入第二阶段权威报告文章生成。">
      <KeywordWorkbench taskId={params.taskId} task={bundle.task} initialTheme={bundle.theme} />
    </AppShell>
  );
}
