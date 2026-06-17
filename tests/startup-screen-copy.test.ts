import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/landing/startup-screen.tsx", "utf8");

describe("startup screen terms copy", () => {
  it("uses click-to-agree copy instead of a separate checkbox", () => {
    expect(source).toContain("点击「立即使用」即表示你已阅读并同意");
    expect(source).toContain("极EO服务条款");
    expect(source).toContain("href=\"/service-terms\"");
    expect(source).not.toContain('type="checkbox"');
    expect(source).not.toContain("termsAccepted");
  });

  it("still records service terms acceptance when starting", () => {
    expect(source).toContain("window.localStorage.setItem(TERMS_STORAGE_KEY, new Date().toISOString())");
  });
});
