const publishStageLabels: Record<string, string> = {
  job_scheduled_for_later: "等待计划时间",
};

const publishQueueReasonLabels: Record<string, string> = {
  job_scheduled_for_later: "未到计划发布时间",
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
