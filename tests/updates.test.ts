import { describe, expect, it } from "vitest";
import { compareVersions, verifySha256 } from "@/lib/updates/client";

describe("update helpers", () => {
  it("compares semantic versions with optional v prefix and missing segments", () => {
    expect(compareVersions("v1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.3", "1.10.0")).toBe(-1);
  });

  it("verifies SHA-256 checksums without accepting mismatches", async () => {
    const bytes = new TextEncoder().encode("abc");
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    await expect(verifySha256(bytes.buffer as ArrayBuffer, expected.toUpperCase())).resolves.toEqual({
      actualSha256: expected,
      matches: true,
    });
    await expect(verifySha256(bytes.buffer as ArrayBuffer, "00")).resolves.toMatchObject({ matches: false });
  });
});
