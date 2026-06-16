import { describe, expect, it } from "vitest";
import { publishQueueReasonLabel, publishStageLabel } from "@/lib/publish/status-labels";

describe("publish status labels", () => {
  it("localizes scheduled-for-later queue state", () => {
    expect(publishStageLabel("job_scheduled_for_later")).toBe("等待计划时间");
    expect(publishQueueReasonLabel("job_scheduled_for_later")).toBe("未到计划发布时间");
  });

  it("localizes account and queue blocking reasons", () => {
    expect(publishStageLabel("account_daily_cap_reached")).toBe("今日账号发布上限已满");
    expect(publishQueueReasonLabel("account_daily_cap_reached")).toBe("今日账号发布上限已满，明天继续执行");
    expect(publishQueueReasonLabel("platform_cooldown_active")).toBe("平台发布间隔冷却中，稍后继续执行");
    expect(publishQueueReasonLabel("account_verification_blocked")).toBe("账号需要完成验证或风控处理");
  });
});
