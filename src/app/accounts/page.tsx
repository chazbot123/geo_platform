import { AppShell } from "@/components/layout/app-shell";
import { PlatformAccountCenter } from "@/components/publish/platform-account-center";
import { getAllPlatformAccounts, getPublishedJobsByAccount } from "@/lib/publish/accounts-service";

export default async function AccountsPage() {
  const [accounts, publishedByAccount] = await Promise.all([
    getAllPlatformAccounts(),
    getPublishedJobsByAccount(),
  ]);

  return (
    <AppShell
      title="多平台账号中心"
      description="按发布平台管理账号记录、登录状态和发布历史。已自动化平台可走桌面登录桥，计划接入平台先支持手动发布记录。"
    >
      <PlatformAccountCenter initialAccounts={accounts} initialPublishedByAccount={publishedByAccount} />
    </AppShell>
  );
}
