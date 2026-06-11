import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ContentPoolWorkbench } from "@/components/content/content-pool";

export default function ContentPoolPage() {
  return (
    <AppShell
      title="生成结果中心"
      description="查看当前任务的文章生成进度、最终结果和发布准备状态；正文与图片进入详情页查看。"
    >
      <Suspense fallback={<section className="section-card text-sm text-muted">正在读取生成结果。</section>}>
        <ContentPoolWorkbench />
      </Suspense>
    </AppShell>
  );
}
