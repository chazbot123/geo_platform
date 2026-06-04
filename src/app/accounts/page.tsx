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
      description="按发布平台管理账号登录状态和发布历史。支持登录的平台统一走桌面登录桥，发布统一优先走 Electron 脚本自动化。"
    >
      <PlatformAccountCenter initialAccounts={accounts} initialPublishedByAccount={publishedByAccount} />
    </AppShell>
  );
}
