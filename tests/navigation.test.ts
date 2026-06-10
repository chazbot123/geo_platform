import { describe, expect, it } from "vitest";
import { settingsItems } from "@/components/layout/navigation-items";

describe("system settings navigation", () => {
  it("shows device authorization above model settings", () => {
    expect(settingsItems.map((item) => item.label)).toEqual(["设备授权", "模型设置", "意见反馈", "检查更新"]);
    expect(settingsItems[0]?.href).toBe("/device-authorization");
  });
});
