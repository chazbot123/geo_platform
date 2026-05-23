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
    <AppShell title="关键词工作台" description="生成主冷门词，查看备选词，并确认当前任务后续内容与社媒发布使用的最终主题。">
      <KeywordWorkbench taskId={params.taskId} task={bundle.task} initialTheme={bundle.theme} />
    </AppShell>
  );
}
