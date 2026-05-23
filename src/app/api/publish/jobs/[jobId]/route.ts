import { NextResponse } from "next/server";
import { getPublishingJob } from "@/lib/storage/data-store";
import { recordPublishingJobResult, updatePublishingJobRecord } from "@/lib/publish/jobs-service";

export async function GET(_: Request, context: { params: { jobId: string } }) {
  const job = await getPublishingJob(context.params.jobId);
  if (!job) {
    return NextResponse.json({ error: "发布任务不存在。" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function PATCH(request: Request, context: { params: { jobId: string } }) {
  try {
    const {
      status,
      publishUrl,
      draftUrl,
      verificationUrl,
      notes,
      errorMessage,
      externalStatus,
      executionLog,
      verificationEvidence,
      verificationAttempts,
      platformItemId,
      failureStage,
    } = (await request.json()) as {
      status?:
        | "manual_pending"
        | "published"
        | "failed"
        | "running"
        | "queued"
        | "submitted"
        | "verifying"
        | "pending_review"
        | "verification_failed";
      publishUrl?: string;
      draftUrl?: string;
      verificationUrl?: string;
      notes?: string;
      errorMessage?: string;
      externalStatus?: string;
      executionLog?: string[];
      verificationEvidence?: string;
      verificationAttempts?: number;
      platformItemId?: string;
      failureStage?: string;
    };

    if (status) {
      const job = await recordPublishingJobResult({
        jobId: context.params.jobId,
        status,
        publishUrl,
        draftUrl,
        verificationUrl,
        notes,
        errorMessage,
        externalStatus,
        executionLog,
        verificationEvidence,
        verificationAttempts,
        platformItemId,
        failureStage,
      });
      return NextResponse.json({ job });
    }

    const job = await updatePublishingJobRecord(context.params.jobId, {
      publishUrl,
      draftUrl,
      verificationUrl,
      notes,
      errorMessage,
      externalStatus,
      executionLog,
      verificationEvidence,
      verificationAttempts,
      platformItemId,
      failureStage,
    });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新发布任务失败。" }, { status: 500 });
  }
}
