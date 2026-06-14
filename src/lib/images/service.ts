import { getAppConfig } from "@/lib/config/service";
import { formatArticleGenerationError } from "@/lib/content/article-generation-service";
import { materializeImageAssetToLocal } from "@/lib/images/local-image-store";
import { runImageModel } from "@/lib/integrations/images/client";
import { saveImage } from "@/lib/storage/data-store";
import { getTaskBundle, normalizeExpectedImageCount, updateTaskStatus } from "@/lib/tasks/service";

function formatImageGenerationPendingMessage(error: unknown) {
  const fallback = "图片生成暂未完成，已标记为待处理。";
  if (!(error instanceof Error)) {
    return fallback;
  }

  const friendly = formatArticleGenerationError(error).trim();
  if (!friendly) {
    return fallback;
  }

  return `图片生成暂未完成，已标记为待处理：${friendly}`;
}

export async function generateImageForTask(taskId: string, imageCount?: number) {
  const bundle = await getTaskBundle(taskId);
  if (!bundle?.theme) {
    throw new Error("提问主题尚未准备完成");
  }
  if (!bundle.content) {
    throw new Error("内容主稿尚未准备完成");
  }

  try {
    const config = await getAppConfig();
    const expectedImageCount = normalizeExpectedImageCount(imageCount ?? bundle.task.expectedImageCount);
    const asset = await runImageModel(bundle.product, bundle.theme, bundle.content, config.imageModelApiConfig, expectedImageCount);
    if (!asset.images?.length || asset.images.length !== expectedImageCount) {
      throw new Error(`图片生成结果不完整：当前仅得到 ${asset.images?.length ?? 0} 张图，目标应生成 ${expectedImageCount} 张文章配图。`);
    }
    const localizedAsset = await materializeImageAssetToLocal(taskId, asset);
    await saveImage(localizedAsset);
    await updateTaskStatus(taskId, "image_generated", {
      expectedImageCount,
    });
    return localizedAsset;
  } catch (error) {
    await updateTaskStatus(taskId, bundle.task.status, {
      failedStage: undefined,
      errorCode: undefined,
      errorMessage: formatImageGenerationPendingMessage(error),
      retryable: true,
    });
    throw new Error(formatImageGenerationPendingMessage(error));
  }
}
