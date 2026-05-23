import { getAppConfig } from "@/lib/config/service";
import { runStage1Model } from "@/lib/integrations/stage1/client";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";
import { saveTheme } from "@/lib/storage/data-store";

export async function generateKeywordsForTask(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle) {
    throw new Error("任务不存在");
  }

  try {
    const config = await getAppConfig();
    const theme = await runStage1Model(bundle.product, config.stage1ModelApiConfig);
    await saveTheme(theme);
    await updateTaskStatus(taskId, "keyword_generated");
    return theme;
  } catch (error) {
    await markTaskFailed(taskId, "keywords", error instanceof Error ? error.message : "生成关键词失败");
    throw error;
  }
}

export async function confirmKeyword(taskId: string, selectedKeyword: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("关键词主题不存在");
  }

  const nextTheme = {
    ...bundle.theme,
    selectedKeyword,
    updatedAt: new Date().toISOString(),
  };

  await saveTheme(nextTheme);
  await updateTaskStatus(taskId, bundle.task.status, { selectedKeyword });
  return nextTheme;
}
