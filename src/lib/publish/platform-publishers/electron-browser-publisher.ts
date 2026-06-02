"use client";

import { runPlatformPublishWindow } from "@/lib/publish/electron-login-client";
import type { PlatformPublisher } from "@/lib/publish/platform-publishers/base";

export const electronBrowserPublisher: PlatformPublisher = {
  async publish({ account, draft, job, timeoutMs }) {
    return runPlatformPublishWindow({
      platform: draft.platform,
      title: `${draft.platform}发布`,
      publishUrl: draft.publishEntryUrl,
      sessionPartition: account.sessionPartition,
      sessionToken: job.sessionToken,
      timeoutMs,
      payload: {
        draftTitle: job.draftTitle,
        draftBody: job.draftBody,
        draftTags: job.draftTags,
        draftImages: job.draftImages,
        draftImagePaths: job.draftImagePaths,
        publishMode: job.publishMode ?? "text_only",
      },
    });
  },
};
