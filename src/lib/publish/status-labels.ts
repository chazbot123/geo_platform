const publishStageLabels: Record<string, string> = {
  job_scheduled_for_later: "等待计划时间",
  account_daily_cap_reached: "今日账号发布上限已满",
  platform_cooldown_active: "平台发布间隔冷却中",
  account_cooling_down: "账号冷却中",
  account_needs_login: "账号需要重新登录",
  account_verification_blocked: "账号需要验证或风控处理",
  account_disabled: "账号已停用",
  retry_backoff_active: "重试等待中",
  missing_account: "缺少发布账号",
  account_not_found: "发布账号不存在",
};

const publishQueueReasonLabels: Record<string, string> = {
  job_scheduled_for_later: "未到计划发布时间",
  account_daily_cap_reached: "今日账号发布上限已满，明天继续执行",
  platform_cooldown_active: "平台发布间隔冷却中，稍后继续执行",
  account_cooling_down: "账号冷却中，稍后继续执行",
  account_needs_login: "账号需要重新登录后继续发布",
  account_verification_blocked: "账号需要完成验证或风控处理",
  account_disabled: "账号已停用，无法继续自动发布",
  retry_backoff_active: "失败重试等待中，稍后继续执行",
  missing_account: "缺少发布账号，请先检查账号绑定",
  account_not_found: "发布账号不存在，请先重新绑定账号",
};

function fallbackLabel(value?: string) {
  if (!value) return "--";
  return value.replace(/_/g, " ");
}

export function publishStageLabel(value?: string) {
  if (!value) return "--";
  return publishStageLabels[value] ?? fallbackLabel(value);
}

export function publishQueueReasonLabel(value?: string) {
  if (!value) return "--";
  return publishQueueReasonLabels[value] ?? publishStageLabels[value] ?? fallbackLabel(value);
}
