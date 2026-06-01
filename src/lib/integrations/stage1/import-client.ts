import { getFolderImportFieldLabel, requiredImportFields } from "@/lib/import/field-mapping";
import { callConfiguredTextModel, NewAPIProbeError, parseJsonFromModelText } from "@/lib/integrations/openai-compatible";
import type { FolderImportFieldKey, FolderImportPreview, FolderImportSuggestion, ModelApiConfig } from "@/lib/types";

export interface Stage1ImportTextSource {
  relativePath: string;
  content: string;
}

export interface Stage1ImportImageSource {
  relativePath: string;
  mimeType: string;
  size: number;
}

export interface Stage1ImportInput {
  textSources: Stage1ImportTextSource[];
  imageSources: Stage1ImportImageSource[];
  warnings: string[];
}

interface Stage1ImportFieldPayload {
  value?: string;
  reason?: string;
  confidence?: number;
  sourceFiles?: string[];
}

type Stage1ImportPayload = Partial<Record<FolderImportFieldKey, Stage1ImportFieldPayload>> & {
  warnings?: string[];
  rawSummary?: string;
};

function clampConfidence(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, numeric));
}

function normalizePreview(payload: Stage1ImportPayload | null): Pick<FolderImportPreview, "suggestions" | "warnings" | "rawSummary"> {
  const suggestions: FolderImportSuggestion[] = requiredImportFields
    .map((field) => {
      const item = payload?.[field];
      if (!item?.value?.trim()) {
        return null;
      }

      return {
        field,
        label: getFolderImportFieldLabel(field),
        value: item.value.trim(),
        confidence: clampConfidence(item.confidence),
        sourceFiles: Array.isArray(item.sourceFiles) ? item.sourceFiles.filter(Boolean) : [],
        reason: item.reason?.trim() || "基于导入资料自动提取",
      } satisfies FolderImportSuggestion;
    })
    .filter((item): item is FolderImportSuggestion => Boolean(item));

  return {
    suggestions,
    warnings: Array.isArray(payload?.warnings) ? payload!.warnings!.filter(Boolean) : [],
    rawSummary: payload?.rawSummary?.trim() || "",
  };
}

function takeFirstNonEmpty(lines: string[]) {
  return lines.map((line) => line.trim()).find(Boolean) || "";
}

function buildMockPreview(input: Stage1ImportInput): Pick<FolderImportPreview, "suggestions" | "warnings" | "rawSummary"> {
  const corpus = input.textSources.map((item) => item.content).join("\n");
  const lines = corpus
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fileStem = takeFirstNonEmpty(
    input.textSources
      .map((item) => item.relativePath.split(/[\\/]/).pop() ?? "")
      .map((name) => name.replace(/\.[^.]+$/g, "")),
  );

  const textSnippet = corpus.slice(0, 200);
  const categoryMatch = corpus.match(/(解决方案|系统|平台|工具|服务|产品|方案)/);
  const productName = takeFirstNonEmpty(lines) || fileStem || "导入资料产品";
  const category = categoryMatch ? `${productName}${categoryMatch[1]}` : `${productName}解决方案`;
  const sellingPoints = textSnippet || "基于导入资料自动整理的核心卖点";
  const targetAudience = corpus.includes("企业") ? "企业客户" : "潜在目标客户";
  const scenarios = corpus.includes("场景") ? takeFirstNonEmpty(lines.filter((line) => line.includes("场景"))) : "内容营销与业务展示";
  const brandTone = corpus.includes("专业") ? "专业可信" : "专业、清晰、业务导向";

  const values: Record<FolderImportFieldKey, string> = {
    productName,
    category,
    sellingPoints,
    targetAudience,
    scenarios,
    brandTone,
  };

  return {
    suggestions: requiredImportFields.map((field) => ({
      field,
      label: getFolderImportFieldLabel(field),
      value: values[field],
      confidence: 0.45,
      sourceFiles: input.textSources.slice(0, 3).map((item) => item.relativePath),
      reason: "当前使用 Stage1 本地回退模式，根据导入文本片段自动整理",
    })),
    warnings: [...input.warnings, "当前未配置真实第一阶段模型时，将使用本地规则回退生成字段建议。"],
    rawSummary: `已读取 ${input.textSources.length} 个文本文件和 ${input.imageSources.length} 个图片文件。`,
  };
}

function buildStage1ImportMessages(input: Stage1ImportInput) {
  const textBlocks = input.textSources
    .map((item, index) => [`[文本 ${index + 1}]`, `路径：${item.relativePath}`, `内容：`, item.content].join("\n"))
    .join("\n\n");

  const imageBlocks = input.imageSources.length
    ? input.imageSources
        .map((item, index) => `[图片 ${index + 1}] 路径：${item.relativePath}，类型：${item.mimeType || "unknown"}，大小：${item.size} 字节`)
        .join("\n")
    : "无图片文件";

  const warningText = input.warnings.length ? input.warnings.join("；") : "无";

  return [
    {
      role: "system" as const,
      content: [
        "你是 GEO 创建任务页的资料导入助手。",
        "你需要从导入的文本和图片文件摘要中，提取任务创建所需的 6 个必填字段建议。",
        "只返回 JSON，不要输出 Markdown，不要输出额外解释。",
        'JSON 结构必须为：{"productName":{"value":"","reason":"","confidence":0,"sourceFiles":[""]},"category":{"value":"","reason":"","confidence":0,"sourceFiles":[""]},"sellingPoints":{"value":"","reason":"","confidence":0,"sourceFiles":[""]},"targetAudience":{"value":"","reason":"","confidence":0,"sourceFiles":[""]},"scenarios":{"value":"","reason":"","confidence":0,"sourceFiles":[""]},"brandTone":{"value":"","reason":"","confidence":0,"sourceFiles":[""]},"warnings":[""],"rawSummary":""}',
        "confidence 返回 0 到 1 之间的小数。",
        "sourceFiles 必须返回相对路径数组。",
        "字段值应该简洁、可直接回填到表单。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `解析警告：${warningText}`,
        `文本文件数量：${input.textSources.length}`,
        `图片文件数量：${input.imageSources.length}`,
        "以下是导入资料：",
        textBlocks || "无文本内容",
        "以下是图片线索：",
        imageBlocks,
      ].join("\n\n"),
    },
  ];
}

export async function runStage1ImportModel(input: Stage1ImportInput, config: ModelApiConfig) {
  if (!config.baseUrl || config.provider.startsWith("mock")) {
    return buildMockPreview(input);
  }

  try {
    const result = await callConfiguredTextModel(config, buildStage1ImportMessages(input));
    const payload = parseJsonFromModelText<Stage1ImportPayload>(result.rawText);
    return normalizePreview(payload);
  } catch (error) {
    if (error instanceof NewAPIProbeError) {
      throw new Error(`IMPORT_STAGE1_PROBE_FAILED@${JSON.stringify(error.attempts)}`);
    }
    if (error instanceof Error && error.message.startsWith("HTTP_")) {
      throw new Error(`IMPORT_STAGE1_${error.message.replace("HTTP_", "")}`);
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      throw new Error("IMPORT_STAGE1_TIMEOUT");
    }
    throw new Error("IMPORT_STAGE1_PARSE_ERROR");
  }
}
