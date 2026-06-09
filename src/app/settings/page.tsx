import { AppShell } from "@/components/layout/app-shell";
import { LicenseStatusBox } from "@/components/settings/license-status-box";
import { SettingsForm } from "@/components/settings/settings-form";
import { getAppConfig } from "@/lib/config/service";

export default async function SettingsPage() {
  const config = await getAppConfig();

  return (
    <AppShell title="模型设置" description="配置文字模型和图片模型。默认服务商为 GPT，文字模型为 gpt5.5，图片模型为 gpt-image-2。">
      <div className="space-y-5">
        <SettingsForm initialConfig={config} />
        <LicenseStatusBox />
      </div>
    </AppShell>
  );
}
