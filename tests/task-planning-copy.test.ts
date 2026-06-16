import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("task planning copy", () => {
  it("uses an in-page confirmation dialog before removing platform accounts", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "tasks", "task-planning-workbench.tsx"), "utf8");

    expect(source).not.toContain("window.confirm");
    expect(source).toContain("pendingRemovalAccount");
    expect(source).toContain("确认移除账号");
    expect(source).toContain("移除后会从已保存任务和内容绑定中摘除");
    expect(source).toContain("确认移除");
    expect(source).toContain("取消");
  });
});
