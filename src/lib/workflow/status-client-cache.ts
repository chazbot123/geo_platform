import type { WorkflowStatus } from "@/lib/workflow/status-service";

let cachedStatus: WorkflowStatus | null = null;
let pendingRequest: Promise<WorkflowStatus> | null = null;

export function invalidateWorkflowStatusCache() {
  cachedStatus = null;
  pendingRequest = null;
}

async function fetchWorkflowStatus() {
  const response = await fetch("/api/workflow/status", { cache: "no-store" });
  const payload = (await response.json()) as WorkflowStatus | { error?: string };
  if (!response.ok) {
    throw new Error("error" in payload && payload.error ? payload.error : "读取工作流状态失败。");
  }
  return payload as WorkflowStatus;
}

export async function loadWorkflowStatus(options: { force?: boolean } = {}) {
  if (!options.force && cachedStatus) {
    return cachedStatus;
  }
  if (!options.force && pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = fetchWorkflowStatus()
    .then((status) => {
      cachedStatus = status;
      return status;
    })
    .finally(() => {
      pendingRequest = null;
    });
  return pendingRequest;
}
