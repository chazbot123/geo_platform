import { AppShell } from "@/components/layout/app-shell";
import { EnterpriseProfileWorkbench } from "@/components/enterprise/enterprise-profile-workbench";

export default function EnterprisePage() {
  return (
    <AppShell title="企业信息" description="录入公司、品牌、产品和素材信息，作为后续客户关键词、内容和发布任务的基础。">
      <EnterpriseProfileWorkbench />
    </AppShell>
  );
}
