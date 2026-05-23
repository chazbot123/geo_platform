import { AppShell } from "@/components/layout/app-shell";
import { PlatformAccountCenter } from "@/components/publish/platform-account-center";
import { getAllPlatformAccounts } from "@/lib/publish/accounts-service";

export default async function AccountsPage() {
  const accounts = await getAllPlatformAccounts();

  return (
    <AppShell
      title="平台账号中心"
      description="集中管理社媒平台登录入口、账号状态与备注信息。账号中心会根据当前宿主自动选择浏览器扩展桥或桌面登录桥，保存并校验真实平台会话。"
    >
      <PlatformAccountCenter initialAccounts={accounts} />
    </AppShell>
  );
}
