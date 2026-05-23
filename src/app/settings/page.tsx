import { AppShell } from "@/components/layout/app-shell";
import { SettingsForm } from "@/components/settings/settings-form";
import { getAppConfig } from "@/lib/config/service";

export default async function SettingsPage() {
  const config = await getAppConfig();

  return (
    <AppShell title="本地配置" description="管理第一阶段、内容、图片和发布等本地 API 配置；未配置真实接口时仍可使用 Mock 模式。">
      <SettingsForm initialConfig={config} />
    </AppShell>
  );
}