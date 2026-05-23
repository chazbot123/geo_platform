import { getAppConfig } from "@/lib/config/service";
import { runContentModel } from "@/lib/integrations/content/client";
import { saveContent } from "@/lib/storage/data-store";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import type { ContentDraft } from "@/lib/types";

export async function generateContentForTask(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("关键词主题尚未准备完成");
  }

  try {
    const config = await getAppConfig();
    const draft = await runContentModel(bundle.product, bundle.theme, config.contentModelApiConfig);
    await saveContent(draft);
    await updateTaskStatus(taskId, "content_generated");
    return draft;
  } catch (error) {
    await markTaskFailed(taskId, "content", error instanceof Error ? error.message : "内容生成失败");
    throw error;
  }
}

export async function updateContentDraft(taskId: string, patch: Pick<ContentDraft, "title" | "summary" | "cta" | "content">) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.content) {
    throw new Error("内容草稿不存在");
  }

  const nextDraft: ContentDraft = {
    ...bundle.content,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await saveContent(nextDraft);
  return nextDraft;
}
