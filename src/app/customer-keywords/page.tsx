import { AppShell } from "@/components/layout/app-shell";
import { CustomerKeywordWorkbench } from "@/components/keywords/customer-keyword-workbench";

export default function CustomerKeywordsPage() {
  return (
    <AppShell title="客户关键词" description="从企业信息生成客户会向 AI 提出的真实问题，并保存 5 个核心问题。">
      <CustomerKeywordWorkbench />
    </AppShell>
  );
}
