import type { PlatformAccountRecord } from "@/lib/types";

type AccountLabelInput = Pick<PlatformAccountRecord, "displayName" | "accountName" | "platformAccountId" | "platform">;

function normalizeLabel(value?: string) {
  const text = String(value || "").trim();
  return text || "";
}

export function formatAccountDisplayLabel(account: AccountLabelInput, fallback = "") {
  return (
    normalizeLabel(account.displayName) ||
    normalizeLabel(account.accountName) ||
    normalizeLabel(account.platformAccountId) ||
    normalizeLabel(fallback) ||
    normalizeLabel(account.platform)
  );
}
