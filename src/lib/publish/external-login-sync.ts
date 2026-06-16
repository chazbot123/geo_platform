import type { PlatformAccountRecord } from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 1500;

function isSyncedLoginAccount(account: PlatformAccountRecord) {
  return (
    account.loginStatus === "authenticated" &&
    (account.status === "valid" || account.status === "active")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForExternalLoginSync(input: {
  accountId: string;
  sessionToken?: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const sessionToken = String(input.sessionToken || "").trim();

  while (Date.now() <= deadline) {
    const response = await fetch("/api/publish/accounts", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as {
      items?: PlatformAccountRecord[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "读取账号状态失败。");
    }

    const accounts = payload.items ?? [];
    const matched = accounts.find((account) => {
      if (!isSyncedLoginAccount(account)) {
        return false;
      }
      if (sessionToken && account.loginSessionToken === sessionToken) {
        return true;
      }
      return account.id === input.accountId;
    });
    if (matched) {
      return matched;
    }

    await sleep(intervalMs);
  }

  return null;
}
