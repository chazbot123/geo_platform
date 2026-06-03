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
      description="按发布平台管理账号登录状态和发布历史。支持登录的平台统一走桌面登录桥；未接入发布脚本的平台先按手动交付处理。"
    >
      <PlatformAccountCenter initialAccounts={accounts} initialPublishedByAccount={publishedByAccount} />
    </AppShell>
  );
}
