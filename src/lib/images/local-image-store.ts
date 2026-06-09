import path from "node:path";
import { promises as fs } from "node:fs";
import { dataDirectories } from "@/lib/paths";
import { ensureDir } from "@/lib/storage/json-store";
import type { ArticleImageItem, ImageAsset } from "@/lib/types";

function normalizeRemoteUrl(value: string) {
  return String(value || "").trim();
}

function guessExtension(url: string, mimeType = "") {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes("png")) return ".png";
  if (normalizedMimeType.includes("jpeg") || normalizedMimeType.includes("jpg")) return ".jpg";
  if (normalizedMimeType.includes("webp")) return ".webp";
  if (normalizedMimeType.includes("gif")) return ".gif";

  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname || "").toLowerCase();
    if (ext) {
      return ext;
    }
  } catch {
    // ignore invalid urls and use the default extension below
  }

  return ".png";
}

async function clearDirectory(dirPath: string) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await ensureDir(dirPath);
}

async function downloadRemoteImageToLocal(url: string, filePath: string) {
  const normalizedUrl = normalizeRemoteUrl(url);
  const dataUrlMatch = normalizedUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    await fs.writeFile(filePath, Buffer.from(dataUrlMatch[2], "base64"));
    return;
  }
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new Error(`不支持落盘的图片地址：${normalizedUrl || "空地址"}`);
  }

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error(`图片下载失败：${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
}

function buildStableFileBaseName(index: number) {
  return index === 0 ? "cover" : `image-${index}`;
}

async function materializeArticleImageItems(taskDir: string, taskId: string, items: ArticleImageItem[]) {
  const nextItems: ArticleImageItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const fileBaseName = buildStableFileBaseName(index);
    const extension = guessExtension(item.url, item.generationMode === "reference" ? "image/png" : "");
    const localPath = path.join(taskDir, `${fileBaseName}${extension}`);
    const publicUrl = `/generated-images/${taskId}/${fileBaseName}${extension}`;
    await downloadRemoteImageToLocal(item.url, localPath);
    nextItems.push({
      ...item,
      localPath,
      publicUrl,
    });
  }

  return nextItems;
}

export function generatedImageTaskDir(taskId: string) {
  return path.join(dataDirectories.generatedImages, taskId);
}

export async function materializeImageAssetToLocal(taskId: string, asset: ImageAsset): Promise<ImageAsset> {
  const taskDir = generatedImageTaskDir(taskId);
  await clearDirectory(taskDir);

  const items = await materializeArticleImageItems(taskDir, taskId, asset.images ?? []);
  const coverSource = items[0];

  return {
    ...asset,
    localImageDir: taskDir,
    localCoverPath: coverSource?.localPath,
    images: items,
  };
}
