import { NextResponse } from "next/server";
import type { EnterpriseAsset, EnterpriseParseResult, EnterpriseProfileFields } from "@/lib/enterprise/types";

const textExtensions = new Set(["txt", "md", "csv", "json"]);
const imageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const maxTextBytes = 1024 * 1024;

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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "请选择要解析的资料文件或图片。" }, { status: 400 });
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

      if (imageExtensions.has(extension)) {
        imageFiles.push(makeAsset(file, "image"));
        continue;
      }

      materialFiles.push(makeAsset(file, "material"));
      skipped.push(file.name);
    }

    if (!materialFiles.length && !imageFiles.length) {
      return NextResponse.json({ error: "当前文件无法识别，请上传 txt、md、csv、json 或图片文件。" }, { status: 400 });
    }

    const suggestions = buildSuggestions(textParts.join("\n"));
    const filledCount = Object.values(suggestions).filter(Boolean).length;
    const message =
      filledCount > 0
        ? `已识别 ${filledCount} 个字段，请确认后保存。`
        : skipped.length
          ? "已记录素材文件，暂未识别出可回填字段，可手动填写后保存。"
          : "已记录素材文件，可手动补充企业信息后保存。";

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
