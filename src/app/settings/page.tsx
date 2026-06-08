import { AppShell } from "@/components/layout/app-shell";
import { SettingsForm } from "@/components/settings/settings-form";
import { getAppConfig } from "@/lib/config/service";

export default async function SettingsPage() {
  const config = await getAppConfig();

  return (
    <AppShell title="模型设置" description="只配置文字模型和图片模型。未填写真实接口时，系统仍保留本地模拟回退。">
      <SettingsForm initialConfig={config} />
    </AppShell>
  );
}
