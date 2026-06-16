import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("publish execution progress ui", () => {
  it("polls Electron publish progress by session token while automatic windows stay hidden", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "components", "publish", "publish-execution-workbench.tsx"), "utf8");

    expect(source).toContain("getPlatformPublishProgressWindow");
    expect(source).toContain("liveProgress");
    expect(source).toContain("job.sessionToken");
    expect(source).toContain("progress.stageTimeline");
  });
});
