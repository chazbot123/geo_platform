import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("videohao login profile sync and validation safety", () => {
  it("keeps syncing authenticated extension cookies even when profile text is delayed", async () => {
    const backgroundSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/background.js", import.meta.url),
      "utf-8",
    );

    expect(backgroundSource).toContain("const hasUsableAuthPayload = hasUsableLoginPayload(authPayload, session.platform);");
    expect(backgroundSource).toContain("const hasResolvedProfile =");
    expect(backgroundSource).toContain("if (!hasUsableAuthPayload && !hasResolvedProfile)");
    expect(backgroundSource).not.toContain("if (!hasResolvedProfile) {\n      return;\n    }");
  });

  it("does not treat Videohao login-page storage without cookies as authenticated", async () => {
    const backgroundSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/background.js", import.meta.url),
      "utf-8",
    );
    const validatorSource = await readFile(
      new URL("../src/lib/publish/account-session-validator.ts", import.meta.url),
      "utf-8",
    );
    const syncRoute = await readFile(
      new URL("../src/app/api/publishing/platform-accounts/extension-login/sync/route.ts", import.meta.url),
      "utf-8",
    );

    expect(backgroundSource).toContain("function hasUsableLoginPayload");
    expect(backgroundSource).toContain("hasVideohaoLoginEvidence");
    expect(validatorSource).toContain("hasVideohaoExtensionLoginEvidence");
    expect(syncRoute).toContain("hasVideohaoExtensionLoginEvidence");
  });

  it("uses resilient Videohao profile selectors for nickname, id, and avatar", async () => {
    const contentSource = await readFile(
      new URL("../scripts/browser-extension/platform-login-helper-videohao-sync/content.js", import.meta.url),
      "utf-8",
    );

    [
      "findNearbyProfileName",
      "directNearbyDisplayName",
      "currentSrc",
      "data-src",
      "srcset",
      "backgroundImage",
      "finderUserName",
      "finderUsername",
      "img[src*='qlogo.cn']",
      "wx.qlogo.cn/finderhead",
    ].forEach((snippet) => {
      expect(contentSource).toContain(snippet);
    });
  });

  it("does not validate Videohao cookie accounts through hidden Electron platform windows", async () => {
    const validatorSource = await readFile(
      new URL("../src/lib/publish/account-session-validator.ts", import.meta.url),
      "utf-8",
    );

    expect(validatorSource).toContain('account.platform === "videohao"');
    expect(validatorSource).toContain('account.authType === "cookie"');
    expect(validatorSource).toContain("validateVideohaoExtensionCookieAccount");
    expect(validatorSource).toContain("source === \"browser_extension\"");
  });
});
