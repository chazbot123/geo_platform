import { getAppConfig } from "@/lib/config/service";
import { runStage1ImportModel } from "@/lib/integrations/stage1/import-client";
import type { FolderImportFile, FolderImportPreview } from "@/lib/types";

interface UploadedFolderFile {
  file: File;
  relativePath: string;
}

const MAX_FILE_COUNT = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_COUNT = 10;
const MAX_TEXT_LENGTH = 30000;
const MAX_TEXT_FILE_LENGTH = 6000;

const textExtensions = new Set(["txt", "md", "json", "csv"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const deferredExtensions = new Set(["pdf", "docx"]);

function getExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function detectKind(fileName: string): FolderImportFile["kind"] {
  const extension = getExtension(fileName);
  if (textExtensions.has(extension)) {
    return "text";
  }
  if (imageExtensions.has(extension)) {
    return "image";
  }
  return "unsupported";
}

function toPreviewFile(item: UploadedFolderFile): FolderImportFile {
  return {
    relativePath: item.relativePath,
    fileName: item.file.name,
    mimeType: item.file.type || "",
    size: item.file.size,
    kind: detectKind(item.file.name),
  };
}

async function readTextFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("utf8");
}

function sliceText(text: string, maxLength = MAX_TEXT_FILE_LENGTH) {
  return text.replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function pickSuggestedAsset(files: FolderImportFile[], keywords: string[]) {
  return (
    files.find((item) => item.kind === "image" && keywords.some((keyword) => item.relativePath.toLowerCase().includes(keyword)))?.relativePath ??
    files.find((item) => item.kind === "image")?.relativePath ??
    ""
  );
}

export async function analyzeFolderImport(files: UploadedFolderFile[]): Promise<FolderImportPreview> {
  if (!files.length) {
    throw new Error("未选择任何文件。");
  }

  if (files.length > MAX_FILE_COUNT) {
    throw new Error("IMPORT_TOO_MANY_FILES");
  }

  const previewFiles = files.map(toPreviewFile);
  const warnings: string[] = [];

  const oversizedFiles = previewFiles.filter((item) => item.size > MAX_FILE_SIZE);
  if (oversizedFiles.length) {
    warnings.push(`有 ${oversizedFiles.length} 个文件超过 10MB，已自动跳过。`);
  }

  const deferredFiles = previewFiles.filter((item) => deferredExtensions.has(getExtension(item.fileName)));
  if (deferredFiles.length) {
    warnings.push(`检测到 ${deferredFiles.length} 个 PDF/DOCX 文件，当前版本仅保留路径提示，未做深度内容提取。`);
  }

  const supportedEntries = files.filter((item) => {
    const preview = toPreviewFile(item);
    return preview.size <= MAX_FILE_SIZE && preview.kind !== "unsupported";
  });

  const textEntries = supportedEntries.filter((item) => detectKind(item.file.name) === "text");
  const imageEntries = supportedEntries.filter((item) => detectKind(item.file.name) === "image").slice(0, MAX_IMAGE_COUNT);

  if (!textEntries.length && !imageEntries.length) {
    throw new Error("IMPORT_UNSUPPORTED_TYPE");
  }

  if (supportedEntries.filter((item) => detectKind(item.file.name) === "image").length > MAX_IMAGE_COUNT) {
    warnings.push(`图片文件超过 ${MAX_IMAGE_COUNT} 个，仅取前 ${MAX_IMAGE_COUNT} 个参与分析。`);
  }

  let remainingTextBudget = MAX_TEXT_LENGTH;
  const textSources: Array<{ relativePath: string; content: string }> = [];
  for (const entry of textEntries) {
    if (remainingTextBudget <= 0) {
      warnings.push("文本内容已达到分析上限，后续文件仅保留路径，不再读取正文。");
      break;
    }

    const rawText = await readTextFile(entry.file);
    const normalized = sliceText(rawText, Math.min(MAX_TEXT_FILE_LENGTH, remainingTextBudget));
    if (!normalized) {
      continue;
    }

    textSources.push({
      relativePath: entry.relativePath,
      content: normalized,
    });
    remainingTextBudget -= normalized.length;
  }

  const imageSources = imageEntries.map((entry) => ({
    relativePath: entry.relativePath,
    mimeType: entry.file.type || "",
    size: entry.file.size,
  }));

  const config = await getAppConfig();
  const analyzed = await runStage1ImportModel(
    {
      textSources,
      imageSources,
      warnings,
    },
    config.stage1ModelApiConfig,
  );

  const suggestedAssets = {
    productImagePath: pickSuggestedAsset(previewFiles, ["product", "产品", "商品"]),
    brandImagePath: pickSuggestedAsset(previewFiles, ["brand", "logo", "品牌"]),
    documentPath:
      previewFiles.find((item) => ["pdf", "docx", "txt", "md", "json", "csv"].includes(getExtension(item.fileName)))?.relativePath ?? "",
  };

  return {
    files: previewFiles,
    suggestions: analyzed.suggestions,
    unmappedFiles: previewFiles.filter((item) => item.kind === "unsupported").map((item) => item.relativePath),
    warnings: analyzed.warnings,
    rawSummary: analyzed.rawSummary || `已分析 ${textSources.length} 个文本文件和 ${imageSources.length} 个图片文件。`,
    suggestedAssets,
  };
}
