import { describe, expect, it } from "vitest";
import {
  canUseLicensedAction,
  LICENSE_BLOCKED_MESSAGE,
  type LicensedAction,
} from "@/lib/license/guard";

describe("license guard", () => {
  it("allows browsing, feedback submission, and update checks without activation", () => {
    const allowedActions: LicensedAction[] = ["browse", "submit_feedback", "check_update", "activate_license"];

    for (const action of allowedActions) {
      expect(canUseLicensedAction("inactive", action)).toEqual({ allowed: true });
    }
  });

  it("blocks write, generation, publishing, account, settings, and update download actions without activation", () => {
    const blockedActions: LicensedAction[] = [
      "save_enterprise",
      "save_keywords",
      "create_task",
      "import_files",
      "generate_content",
      "mutate_content_pool",
      "manage_publish_account",
      "execute_publish",
      "save_model_settings",
      "download_update",
    ];

    for (const action of blockedActions) {
      expect(canUseLicensedAction("inactive", action)).toEqual({
        allowed: false,
        message: LICENSE_BLOCKED_MESSAGE,
      });
    }
  });

  it("allows licensed actions when the current device is active", () => {
    expect(canUseLicensedAction("active", "execute_publish")).toEqual({ allowed: true });
    expect(canUseLicensedAction("active", "download_update")).toEqual({ allowed: true });
  });
});
