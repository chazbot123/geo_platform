import { AppShell } from "@/components/layout/app-shell";
import { UpdateCheckBox } from "@/components/settings/update-check-box";
import packageJson from "../../../package.json";

export default function UpdatesPage() {
  return (
    <AppShell title="检查更新" description="检查桌面版最新版本和升级说明。">
      <UpdateCheckBox currentVersion={packageJson.version} />
    </AppShell>
  );
}
