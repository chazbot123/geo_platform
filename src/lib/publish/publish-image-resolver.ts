import path from "node:path";
import { promises as fs } from "node:fs";
import { dataDirectories } from "@/lib/paths";
import { ensureDir } from "@/lib/storage/json-store";

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function decodeFileUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return "";
    return decodeURIComponent(url.pathname.replace(/^\/([a-zA-Z]:)/, "$1"));
  } catch {
    return "";
  }
}

function publicGeneratedImagePath(value: string) {
  const normalized = String(value || "").trim();
  const marker = "/generated-images/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return "";
  const relative = normalized.slice(markerIndex + 1).split(/[?#]/)[0];
  return path.join(process.cwd(), "public", relative);
}

function migratedGeneratedImagePath(taskId: string, value: string) {
  const normalized = String(value || "").trim();
  if (!taskId || !normalized) return "";
  const fileName = path.basename(normalized.split(/[?#]/)[0]);
  if (!fileName) return "";
  return path.join(dataDirectories.generatedImages, taskId, fileName);
}

function guessExtensionFromUrl(value: string) {
  try {
    const parsed = new URL(value);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (ext) return ext;
  } catch {
    // fall through
  }
  return ".png";
}

async function materializeRemoteImage(taskId: string, url: string, index: number) {
  if (!/^https?:\/\//i.test(url)) return "";
  const targetDir = path.join(dataDirectories.generatedImages, taskId || "publish-remote");
  await ensureDir(targetDir);
  const filePath = path.join(targetDir, `publish-${index + 1}${guessExtensionFromUrl(url)}`);
  if (await fileExists(filePath)) return filePath;

  const response = await fetch(url);
  if (!response.ok) return "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) return "";
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function resolveOneImagePath(taskId: string, source: string, index: number) {
  const raw = String(source || "").trim();
  if (!raw) return "";

  const candidates = [
    raw,
    decodeFileUrl(raw),
    publicGeneratedImagePath(raw),
    migratedGeneratedImagePath(taskId, raw),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return materializeRemoteImage(taskId, raw, index);
}

export async function resolvePublishImagePaths(input: {
  taskId: string;
  imageUrls?: string[];
  localImagePaths?: string[];
}) {
  const sources = [
    ...(input.localImagePaths ?? []),
    ...(input.imageUrls ?? []),
  ];
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < sources.length; index += 1) {
    const filePath = await resolveOneImagePath(input.taskId, sources[index], index);
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    resolved.push(filePath);
  }

  return resolved;
}
