import { getEnterpriseProfile, validateEnterpriseProfile } from "@/lib/enterprise/service";
import { getCustomerKeywordSet } from "@/lib/keywords/service";
import { getContentPool, getPublishingJobsByTask } from "@/lib/storage/data-store";
import { listTaskBundles } from "@/lib/tasks/service";
import type { ContentPoolItemStatus, TaskBundle } from "@/lib/types";

export type WorkflowStepKey = "enterprise" | "customerKeywords" | "taskCreate" | "contentPool" | "publishExecution";

export interface WorkflowStepStatus {
  key: WorkflowStepKey;
  completed: boolean;
  completedAt?: string;
  reason: string;
}

export interface WorkflowStatus {
  steps: Record<WorkflowStepKey, WorkflowStepStatus>;
  currentTaskId?: string;
  updatedAt: string;
}

const contentPoolReadyStatuses = new Set<ContentPoolItemStatus>(["sample", "ready", "pending_publish", "publishing", "manual_pending", "published"]);

function stepStatus(key: WorkflowStepKey, completed: boolean, reason: string, completedAt?: string): WorkflowStepStatus {
  return {
    key,
    completed,
    reason,
    completedAt: completed ? completedAt : undefined,
  };
}

function getCurrentPlannedBundle(bundles: TaskBundle[]) {
  return bundles.find((bundle) => Boolean(bundle.task.publishPlan)) ?? null;
}

export async function getWorkflowStatus(): Promise<WorkflowStatus> {
  const [enterpriseProfile, keywordSet, taskBundles] = await Promise.all([
    getEnterpriseProfile(),
    getCustomerKeywordSet(),
    listTaskBundles(),
  ]);

  const enterpriseComplete = Boolean(
    enterpriseProfile?.lastSavedAt && validateEnterpriseProfile(enterpriseProfile).length === 0,
  );
  const keywordComplete = Boolean(keywordSet?.savedAt && keywordSet.selectedQuestions.length === 5);
  const plannedBundle = getCurrentPlannedBundle(taskBundles);
  const publishPlan = plannedBundle?.task.publishPlan;
  const taskComplete = Boolean(publishPlan && publishPlan.totalArticleCount > 0);

  const [contentPool, publishingJobs] = plannedBundle
    ? await Promise.all([getContentPool(plannedBundle.task.id), getPublishingJobsByTask(plannedBundle.task.id)])
    : [null, []];
  const contentPoolItem = contentPool?.items.find((item) => contentPoolReadyStatuses.has(item.status));
  const contentPoolComplete = Boolean(contentPool?.items.length && contentPoolItem);
  const publishExecutionComplete = publishingJobs.length > 0;

  return {
    currentTaskId: plannedBundle?.task.id,
    updatedAt: new Date().toISOString(),
    steps: {
      enterprise: stepStatus(
        "enterprise",
        enterpriseComplete,
        enterpriseComplete ? "企业必填信息已保存。" : "企业必填信息未保存完整。",
        enterpriseProfile?.lastSavedAt,
      ),
      customerKeywords: stepStatus(
        "customerKeywords",
        keywordComplete,
        keywordComplete ? "已保存 5 个客户问题。" : "需要保存正好 5 个客户问题。",
        keywordSet?.savedAt,
      ),
      taskCreate: stepStatus(
        "taskCreate",
        taskComplete,
        taskComplete ? "发布计划已保存并包含文章总量。" : "需要保存文章总量大于 0 的发布计划。",
        publishPlan?.updatedAt,
      ),
      contentPool: stepStatus(
        "contentPool",
        contentPoolComplete,
        contentPoolComplete ? "当前任务已有生成结果。" : "当前任务还没有生成结果。",
        contentPoolItem?.updatedAt ?? contentPool?.updatedAt,
      ),
      publishExecution: stepStatus(
        "publishExecution",
        publishExecutionComplete,
        publishExecutionComplete ? "当前任务已有文章级发布记录。" : "当前任务还没有文章级发布记录。",
        publishingJobs[0]?.updatedAt,
      ),
    },
  };
}
