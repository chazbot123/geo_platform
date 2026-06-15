import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { strFromU8, unzipSync } from "fflate";
import { getAppConfig } from "@/lib/config/service";
import type { EnterpriseAsset, EnterpriseParseResult, EnterpriseProfileFields } from "@/lib/enterprise/types";
import { callConfiguredTextModel, parseJsonFromModelText } from "@/lib/integrations/openai-compatible";
import type { ModelApiConfig } from "@/lib/types";

export const runtime = "nodejs";

const textExtensions = new Set(["txt", "md", "csv", "json"]);
const pdfExtensions = new Set(["pdf"]);
const docxExtensions = new Set(["docx"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const maxTextBytes = 1024 * 1024;
const enterpriseFields = [
  "companyName",
  "brandShortName",
  "productService",
  "region",
  "brandStory",
  "productFeatures",
  "audience",
  "trustProof",
  "painPoints",
  "customerCases",
] satisfies Array<keyof EnterpriseProfileFields>;

function getExtension(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function makeAsset(file: File, kind: EnterpriseAsset["kind"]): EnterpriseAsset {
  return {
    id: `${kind}-${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    type: file.type || "",
    kind,
    uploadedAt: new Date().toISOString(),
  };
}

async function readText(file: File) {
  if (file.size > maxTextBytes) {
    return "";
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("utf8").replace(/\u0000/g, "").trim();
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocxXmlText(xml: string) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

async function readDocxText(file: File) {
  if (file.size > maxTextBytes * 5) {
    return "";
  }

  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const xmlEntries = Object.entries(archive)
      .filter(([name]) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name))
      .sort(([left], [right]) => left.localeCompare(right));

    return xmlEntries
      .map(([, data]) => extractDocxXmlText(strFromU8(data)))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  } catch {
    return "";
  }
}

async function readPdfText(file: File) {
  if (file.size > maxTextBytes * 10) {
    return "";
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
    } finally {
      await parser.destroy();
    }
  } catch {
    return "";
  }
}

function findValue(text: string, labels: string[]) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^(?:#{1,6}\\s*)?${escaped}\\s*[:：\\-]\\s*(.+)$`, "i");
    const hit = lines.find((line) => pattern.test(line));
    const value = hit?.match(pattern)?.[1]?.trim();
    if (value) {
      return value.slice(0, 1200);
    }
  }

  return "";
}

function buildSuggestions(text: string): Partial<EnterpriseProfileFields> {
  return {
    companyName: findValue(text, ["公司名称", "企业名称", "公司", "企业"]),
    brandShortName: findValue(text, ["品牌简称", "品牌", "简称"]),
    productService: findValue(text, ["产品服务", "产品/服务", "主营产品", "服务", "产品"]),
    region: findValue(text, ["地区", "服务地区", "所在地区", "城市"]),
    brandStory: findValue(text, ["品牌故事", "公司介绍", "企业介绍", "品牌介绍"]),
    productFeatures: findValue(text, ["产品特点", "核心优势", "卖点", "服务特色"]),
    audience: findValue(text, ["服务人群", "目标用户", "目标客户", "受众"]),
    trustProof: findValue(text, ["信任背书", "资质", "荣誉", "认证"]),
    painPoints: findValue(text, ["用户痛点", "客户痛点", "痛点", "问题"]),
    customerCases: findValue(text, ["客户案例", "案例", "成功案例"]),
  };
}

function normalizeSuggestionPayload(payload: Partial<Record<keyof EnterpriseProfileFields, unknown>> | null) {
  const suggestions: Partial<EnterpriseProfileFields> = {};
  for (const field of enterpriseFields) {
    const value = payload?.[field];
    if (typeof value === "string" && value.trim()) {
      suggestions[field] = value.trim().slice(0, 1200);
    }
  }
  return suggestions;
}

function mergeSuggestions(...items: Array<Partial<EnterpriseProfileFields>>) {
  const merged: Partial<EnterpriseProfileFields> = {};
  for (const item of items) {
    for (const field of enterpriseFields) {
      const value = item[field]?.trim();
      if (value) {
        merged[field] = value;
      }
    }
  }
  return merged;
}

function canUseModel(config: ModelApiConfig) {
  return Boolean(config.baseUrl?.trim()) && !config.provider.toLowerCase().startsWith("mock");
}

function buildEnterpriseParseMessages(text: string) {
  return [
    {
      role: "system" as const,
      content: [
        "你是企业资料结构化解析助手。",
        "请从用户上传的企业资料中抽取字段，只返回 JSON，不要解释。",
        "字段：companyName, brandShortName, productService, region, brandStory, productFeatures, audience, trustProof, painPoints, customerCases。",
        "没有把握的字段返回空字符串，不要编造。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `请解析以下企业资料并返回 JSON：\n\n${text.slice(0, 16000)}`,
    },
  ];
}

async function buildModelSuggestions(text: string) {
  if (!text.trim()) {
    return { suggestions: {}, usedModel: false };
  }

  try {
    const config = (await getAppConfig()).contentModelApiConfig;
    if (!canUseModel(config)) {
      return { suggestions: {}, usedModel: false };
    }
    const result = await callConfiguredTextModel(config, buildEnterpriseParseMessages(text));
    const payload = parseJsonFromModelText<Partial<Record<keyof EnterpriseProfileFields, unknown>>>(result.rawText);
    return { suggestions: normalizeSuggestionPayload(payload), usedModel: true };
  } catch {
    return { suggestions: {}, usedModel: false };
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "请选择要上传的企业资料文档或产品图片。" }, { status: 400 });
    }

    const materialFiles: EnterpriseAsset[] = [];
    const imageFiles: EnterpriseAsset[] = [];
    const textParts: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      const extension = getExtension(file.name);

      if (textExtensions.has(extension)) {
        materialFiles.push(makeAsset(file, "material"));
        const text = await readText(file);
        if (text) {
          textParts.push(text);
        }
        continue;
      }

      if (docxExtensions.has(extension)) {
        materialFiles.push(makeAsset(file, "material"));
        const text = await readDocxText(file);
        if (text) {
          textParts.push(text);
        } else {
          skipped.push(file.name);
        }
        continue;
      }

      if (pdfExtensions.has(extension)) {
        materialFiles.push(makeAsset(file, "material"));
        const text = await readPdfText(file);
        if (text) {
          textParts.push(text);
        } else {
          skipped.push(file.name);
        }
        continue;
      }

      if (imageExtensions.has(extension)) {
        imageFiles.push(makeAsset(file, "image"));
        continue;
      }

      materialFiles.push(makeAsset(file, "material"));
      skipped.push(file.name);
    }

    if (!materialFiles.length && !imageFiles.length) {
      return NextResponse.json({ error: "当前文件无法识别，请上传 txt、md、csv、json、pdf、docx 或图片文件。" }, { status: 400 });
    }

    const sourceText = textParts.join("\n");
    const ruleSuggestions = buildSuggestions(sourceText);
    const modelResult = await buildModelSuggestions(sourceText);
    const suggestions = mergeSuggestions(ruleSuggestions, modelResult.suggestions);
    const filledCount = Object.values(suggestions).filter(Boolean).length;
    const parseSource = modelResult.usedModel ? "AI 大模型" : "规则";

    const message =
      filledCount > 0
        ? `已通过${parseSource}识别 ${filledCount} 个字段，请确认后保存；图片仅作为后续生图参考，不会识别内容或写入表单。`
        : skipped.length
          ? `已记录企业资料，但 ${skipped.join("、")} 暂未提取到可回填文本，可手动填写后保存。图片仅作为后续生图参考，不会识别内容或写入表单。`
          : "已记录企业资料，可手动补充企业信息后保存。图片仅作为后续生图参考，不会识别内容或写入表单。";

    const result: EnterpriseParseResult = {
      suggestions,
      materialFiles,
      imageFiles,
      parseStatus: "parsed",
      parseMessage: message,
    };

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料解析失败，可手动填写后继续保存。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
