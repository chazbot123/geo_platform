import { AppShell } from "@/components/layout/app-shell";
import { FeedbackBox } from "@/components/settings/feedback-box";
import { SettingsForm } from "@/components/settings/settings-form";
import { UpdateCheckBox } from "@/components/settings/update-check-box";
import { getAppConfig } from "@/lib/config/service";
import packageJson from "../../../package.json";

export default async function SettingsPage() {
  const config = await getAppConfig();

  return (
    <AppShell title="模型设置" description="配置文字模型和图片模型。未填写真实接口时，系统仍保留本地模拟回退。">
      <div className="space-y-5">
        <SettingsForm initialConfig={config} />
        <FeedbackBox />
        <UpdateCheckBox currentVersion={packageJson.version} />
      </div>
    </AppShell>
  );
}
