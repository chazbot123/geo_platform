import { getAppConfig } from "@/lib/config/service";
import { materializeImageAssetToLocal } from "@/lib/images/local-image-store";
import { runImageModel } from "@/lib/integrations/images/client";
import { saveImage } from "@/lib/storage/data-store";
import { getTaskBundle, markTaskFailed, updateTaskStatus } from "@/lib/tasks/service";

const REQUIRED_IMAGE_COUNT = 5;

export async function generateImageForTask(taskId: string) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("提问主题尚未准备完成");
  }
  if (!bundle.content) {
    throw new Error("内容主稿尚未准备完成");
  }

  try {
    const config = await getAppConfig();
    const asset = await runImageModel(bundle.product, bundle.theme, bundle.content, config.imageModelApiConfig);
    if (!asset.images?.length || asset.images.length !== REQUIRED_IMAGE_COUNT) {
      throw new Error(`图片生成结果不完整：当前仅得到 ${asset.images?.length ?? 0} 张图，第二阶段必须固定生成 5 张文章配图。`);
    }
    const localizedAsset = await materializeImageAssetToLocal(taskId, asset);
    await saveImage(localizedAsset);
    await updateTaskStatus(taskId, "image_generated");
    return localizedAsset;
  } catch (error) {
    await markTaskFailed(taskId, "image", error instanceof Error ? error.message : "图片生成失败");
    throw error;
  }
}
