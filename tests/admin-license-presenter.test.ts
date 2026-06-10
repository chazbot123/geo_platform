import { describe, expect, it } from "vitest";
import { adminLicense, publicLicense } from "../server/admin-api/src/license-presenter.js";

const row = {
  id: 7,
  code: "GEO-DEVICE-123",
  code_hash: "stored-hash",
  max_devices: 2,
  expires_at: null,
  status: "available",
  issued_to: "客户 A",
  created_at: "2026-06-10T00:00:00.000Z",
  activated_at: null,
};

describe("license presenters", () => {
  it("keeps public license responses hashed while admin responses include the full code", () => {
    expect(publicLicense(row)).not.toHaveProperty("code");
    expect(adminLicense(row)).toMatchObject({
      code: "GEO-DEVICE-123",
      codeHash: "stored-hash",
      maxDevices: 2,
      issuedTo: "客户 A",
    });
  });
});
