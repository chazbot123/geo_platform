import { getAppConfig } from "@/lib/config/service";
import { runImageModel } from "@/lib/integrations/images/client";
import { saveImage } from "@/lib/storage/data-store";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";

export async function generateImageForTask(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("关键词主题尚未准备完成");
  }

  try {
    const config = await getAppConfig();
    const asset = await runImageModel(bundle.product, bundle.theme, config.imageModelApiConfig);
    await saveImage(asset);
    await updateTaskStatus(taskId, "image_generated");
    return asset;
  } catch (error) {
    await markTaskFailed(taskId, "image", error instanceof Error ? error.message : "图片生成失败");
    throw error;
  }
}
