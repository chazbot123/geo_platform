import { NextResponse } from "next/server";
import { analyzeFolderImport } from "@/lib/import/folder-import-service";

function formatProbeDetails(message: string) {
  const raw = message.replace("IMPORT_STAGE1_PROBE_FAILED@", "");
  try {
    const attempts = JSON.parse(raw) as Array<{ endpoint?: string; authMode?: string; error?: string }>;
    return attempts
      .map((attempt) => `${attempt.authMode ?? "unknown"} -> ${attempt.endpoint ?? "unknown"} (${attempt.error ?? "UNKNOWN_ERROR"})`)
      .join("；");
  } catch {
    return raw;
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files");
    const relativePaths = formData.getAll("relativePaths");

    const uploadedFiles = files
      .map((entry, index) => {
        if (!(entry instanceof File)) {
          return null;
        }

        return {
          file: entry,
          relativePath: String(relativePaths[index] ?? entry.name),
        };
      })
      .filter((item): item is { file: File; relativePath: string } => Boolean(item));

    const preview = await analyzeFolderImport(uploadedFiles);
    return NextResponse.json({ preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件夹解析失败。";

    if (message === "IMPORT_TOO_MANY_FILES") {
      return NextResponse.json({ error: "导入文件过多，请控制在 50 个以内。" }, { status: 400 });
    }

    if (message === "IMPORT_UNSUPPORTED_TYPE") {
      return NextResponse.json({ error: "当前文件夹中没有可解析的文本或图片文件。" }, { status: 400 });
    }

    if (message === "IMPORT_STAGE1_TIMEOUT") {
      return NextResponse.json({ error: "资料解析超时，请增大第一阶段模型超时时间后重试。" }, { status: 504 });
    }

    if (message.startsWith("IMPORT_STAGE1_PROBE_FAILED@")) {
      return NextResponse.json({ error: `资料解析自动探测失败。已尝试：${formatProbeDetails(message)}` }, { status: 502 });
    }

    if (message.startsWith("IMPORT_STAGE1_")) {
      return NextResponse.json({ error: `资料解析失败：${message}` }, { status: 502 });
    }

    return NextResponse.json({ error: message || "文件夹解析失败。" }, { status: 500 });
  }
}
