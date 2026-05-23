import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { reviewDraft } from "@/lib/review/service";
import { getTaskBundle } from "@/lib/tasks/service";

export default async function PreviewPage({ params }: { params: { taskId: string } }) {
  const bundle = await getTaskBundle(params.taskId);
  if (!bundle) {
    notFound();
  }

  const review = reviewDraft(bundle.content, bundle.image);

  return (
    <AppShell title="内容与图片预览" description="生成内容主稿和封面图，查看基础风险提示，并在进入社媒发布前进行轻量调整。">
      <PreviewPanel taskId={params.taskId} initialContent={bundle.content} initialImage={bundle.image} review={review} />
    </AppShell>
  );
}
