import { AppShell } from "@/components/layout/app-shell";
import { ContentPoolWorkbench } from "@/components/content/content-pool";

export default function ContentPoolPage() {
  return (
    <AppShell
      title="内容池"
      description="管理当前任务的文章、风险处理、平台适配和图片提示；历史任务通过筛选入口查看。"
    >
      <ContentPoolWorkbench />
    </AppShell>
  );
}
