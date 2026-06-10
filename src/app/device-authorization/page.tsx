import { AppShell } from "@/components/layout/app-shell";
import { LicenseStatusBox } from "@/components/settings/license-status-box";

export default function DeviceAuthorizationPage() {
  return (
    <AppShell title="设备授权" description="激活授权码并查看当前设备的绑定状态。">
      <LicenseStatusBox />
    </AppShell>
  );
}
