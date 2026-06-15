import { describe, expect, it } from "vitest";
import { publishQueueReasonLabel, publishStageLabel } from "@/lib/publish/status-labels";

describe("publish status labels", () => {
  it("localizes scheduled-for-later queue state", () => {
    expect(publishStageLabel("job_scheduled_for_later")).toBe("等待计划时间");
    expect(publishQueueReasonLabel("job_scheduled_for_later")).toBe("未到计划发布时间");
  });
});
