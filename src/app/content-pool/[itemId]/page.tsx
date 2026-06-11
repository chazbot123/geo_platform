import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ContentItemDetail } from "@/components/content/content-item-detail";

export default function ContentPoolItemPage({ params }: { params: { itemId: string } }) {
  return (
    <AppShell title="文章详情" description="查看最终成稿、图片提示、风险结果和发布准备信息。">
      <Suspense fallback={<section className="section-card text-sm text-muted">正在读取文章详情。</section>}>
        <ContentItemDetail itemId={params.itemId} />
      </Suspense>
    </AppShell>
  );
}
