import { createRecordId, deletePlatformAccount, getPlatformAccount, listPlatformAccounts, savePlatformAccount } from "@/lib/storage/data-store";
import type { PlatformAccountLoginStatus, PlatformAccountRecord, PlatformAccountStatus, SocialPlatform } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

function buildSessionPartition(accountId: string) {
  return `persist:geo-platform-${accountId}`;
}

function buildAuthPayloadPreview(authPayload?: string) {
  const normalized = String(authPayload || "").trim();
  if (!normalized) return undefined;
  const preview = normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
  return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
}

export async function getAllPlatformAccounts() {
  const items = await listPlatformAccounts();
  return items.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export async function listAuthenticatedPlatformAccounts(platform?: SocialPlatform) {
  const items = await getAllPlatformAccounts();
  return items.filter(
    (item) =>
      item.loginStatus === "authenticated" &&
      item.status !== "disabled" &&
      (!platform || item.platform === platform),
  );
}

export async function getUniqueAuthenticatedPlatformAccount(platform: SocialPlatform) {
  const items = await listAuthenticatedPlatformAccounts(platform);
  return items.length === 1 ? items[0] : null;
}

export async function createPlatformAccount(input: {
  platform: SocialPlatform;
  accountName: string;
  displayName?: string;
  remark?: string;
  loginUrl?: string;
  loginStatus?: PlatformAccountLoginStatus;
  status?: PlatformAccountStatus;
}) {
  const id = createRecordId();
  const record: PlatformAccountRecord = {
    id,
    platform: input.platform,
    provider: "extension",
    authType: "cookie",
    source: "browser_extension",
    accountName: input.accountName.trim(),
    displayName: input.displayName?.trim() || input.accountName.trim(),
    loginUrl: input.loginUrl?.trim(),
    sessionPartition: buildSessionPartition(id),
    loginStatus: input.loginStatus ?? "idle",
    status: input.status ?? "saved",
    remark: input.remark?.trim(),
    createdAt: now(),
    updatedAt: now(),
  };
  return savePlatformAccount(record);
}

export async function updatePlatformAccountRecord(accountId: string, patch: Partial<PlatformAccountRecord>) {
  const current = await getPlatformAccount(accountId);
  if (!current) {
    throw new Error("账号不存在");
  }

  const next: PlatformAccountRecord = {
    ...current,
    ...patch,
    authPayloadPreview: typeof patch.authPayload !== "undefined" ? buildAuthPayloadPreview(patch.authPayload) : patch.authPayloadPreview ?? current.authPayloadPreview,
    updatedAt: now(),
  };
  return savePlatformAccount(next);
}

export async function removePlatformAccount(accountId: string) {
  await deletePlatformAccount(accountId);
}

export async function markPlatformAccountLoginStarted(accountId: string) {
  return updatePlatformAccountRecord(accountId, {
    loginStatus: "pending",
    status: "saved",
    lastLoginStartedAt: now(),
    lastError: undefined,
  });
}

export async function markPlatformAccountLoginResult(
  accountId: string,
  result: {
    loginStatus: PlatformAccountLoginStatus;
    status?: PlatformAccountStatus;
    lastError?: string;
  },
) {
  return updatePlatformAccountRecord(accountId, {
    loginStatus: result.loginStatus,
    status: result.status ?? (result.loginStatus === "authenticated" ? "valid" : "saved"),
    lastError: result.lastError,
    lastLoginCompletedAt: now(),
    lastValidatedAt: result.loginStatus === "authenticated" ? now() : undefined,
  });
}

export function getPlatformAccountSessionPartition(account: Pick<PlatformAccountRecord, "id" | "sessionPartition">) {
  return account.sessionPartition?.trim() || buildSessionPartition(account.id);
}
