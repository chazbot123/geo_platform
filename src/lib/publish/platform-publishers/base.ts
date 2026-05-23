import type { PlatformAccountRecord, PublishingDraft, PublishingJobRecord } from "@/lib/types";

export interface PlatformPublishExecutionResult {
  status: "published" | "submitted" | "verifying" | "pending_review" | "verification_failed" | "failed" | "unsupported";
  draftUrl?: string;
  publishUrl?: string;
  verificationUrl?: string;
  externalStatus?: string;
  executionLog?: string[];
  verificationEvidence?: string;
  verificationAttempts?: number;
  platformItemId?: string;
  failureStage?: string;
  errorMessage?: string;
}

export interface PlatformPublisher {
  publish(input: {
    account: PlatformAccountRecord;
    draft: PublishingDraft;
    job: PublishingJobRecord;
    timeoutMs?: number;
  }): Promise<PlatformPublishExecutionResult>;
}
