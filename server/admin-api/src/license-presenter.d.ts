export type LicenseRow = {
  id: number;
  code?: string | null;
  code_hash?: string | null;
  max_devices: number;
  expires_at: string | null;
  status: string;
  issued_to?: string | null;
  created_at: string;
  activated_at: string | null;
};

export type PublicLicense = {
  id: number;
  codeHash: string;
  maxDevices: number;
  expiresAt: string | null;
  status: string;
  issuedTo: string;
  createdAt: string;
  activatedAt: string | null;
};

export type AdminLicense = PublicLicense & {
  code: string;
};

export function hashLicenseCode(code: string): string;
export function publicLicense(row: LicenseRow): PublicLicense;
export function adminLicense(row: LicenseRow): AdminLicense;
