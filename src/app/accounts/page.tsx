import { AppShell } from "@/components/layout/app-shell";
import { PlatformAccountCenter } from "@/components/publish/platform-account-center";
import { getAllPlatformAccounts, getPublishedJobsByAccount } from "@/lib/publish/accounts-service";

export default async function AccountsPage() {
  const [accounts, publishedByAccount] = await Promise.all([
    getAllPlatformAccounts(),
    getPublishedJobsByAccount("toutiao"),
  ]);

  return (
    <AppShell
      title="今日头条账号中心"
      description="集中管理今日头条桌面登录入口、账号状态与备注信息。当前版本只保留 Electron 桌面登录桥，用于保存并校验真实平台会话。"
    >
      <PlatformAccountCenter initialAccounts={accounts} initialPublishedByAccount={publishedByAccount} />
    </AppShell>
  );
}
