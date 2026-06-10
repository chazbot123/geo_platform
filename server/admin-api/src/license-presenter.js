import crypto from "node:crypto";

export function hashLicenseCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function publicLicense(row) {
  return {
    id: row.id,
    codeHash: row.code_hash ?? hashLicenseCode(row.code ?? ""),
    maxDevices: row.max_devices,
    expiresAt: row.expires_at,
    status: row.status,
    issuedTo: row.issued_to ?? "",
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  };
}

export function adminLicense(row) {
  return {
    ...publicLicense(row),
    code: row.code ?? "",
  };
}
