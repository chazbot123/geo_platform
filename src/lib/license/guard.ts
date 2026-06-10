import { checkLicenseStatus, type LicenseStatus } from "@/lib/license/client";

export const LICENSE_BLOCKED_MESSAGE = "当前设备未授权，请先在设置中激活授权码。";

export type LicensedAction =
  | "browse"
  | "activate_license"
  | "submit_feedback"
  | "check_update"
  | "save_enterprise"
  | "save_keywords"
  | "create_task"
  | "import_files"
  | "generate_content"
  | "mutate_content_pool"
  | "manage_publish_account"
  | "execute_publish"
  | "save_model_settings"
  | "download_update";

export interface LicenseGuardResult {
  allowed: boolean;
  message?: string;
}

const publicActions = new Set<LicensedAction>(["browse", "activate_license", "submit_feedback", "check_update"]);

export function canUseLicensedAction(status: LicenseStatus | null | undefined, action: LicensedAction): LicenseGuardResult {
  if (publicActions.has(action) || status === "active") {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: LICENSE_BLOCKED_MESSAGE,
  };
}

export async function requireLicensedAction(action: LicensedAction): Promise<LicenseGuardResult> {
  try {
    const status = await checkLicenseStatus();
    return canUseLicensedAction(status.status, action);
  } catch {
    return canUseLicensedAction("inactive", action);
  }
}
