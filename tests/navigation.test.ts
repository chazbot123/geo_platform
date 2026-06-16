import { describe, expect, it } from "vitest";
import { settingsItems } from "@/components/layout/navigation-items";

describe("system settings navigation", () => {
  it("shows help center as the last settings module", () => {
    expect(settingsItems.map((item) => item.label)).toEqual(["设备授权", "模型设置", "意见反馈", "检查更新", "帮助中心"]);
    expect(settingsItems[0]?.href).toBe("/device-authorization");
    expect(settingsItems.at(-1)?.href).toBe("/help");
  });
});
