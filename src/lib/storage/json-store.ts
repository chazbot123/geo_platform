import path from "node:path";
import { promises as fs } from "node:fs";

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

function stripBom(raw: string) {
  return raw.replace(/^\uFEFF/, "");
}

function findFirstCompleteJsonValue(raw: string) {
  const source = raw.trimStart();
  if (!source) {
    return -1;
  }
  const opener = source[0];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
  if (!closer) {
    return -1;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  const leadingWhitespaceLength = raw.length - source.length;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return leadingWhitespaceLength + index + 1;
      }
    }
  }

  return -1;
}

function parseJsonWithRecovery<T>(raw: string): T {
  const normalized = stripBom(raw);
  try {
    return JSON.parse(normalized) as T;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    const boundary = findFirstCompleteJsonValue(normalized);
    if (boundary <= 0 || boundary >= normalized.length) {
      throw error;
    }
    return JSON.parse(normalized.slice(0, boundary)) as T;
  }
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseJsonWithRecovery<T>(raw);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

const retryableRenameErrorCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
const renameRetryDelaysMs = [20, 50, 100, 150];

function isRetryableRenameError(error: NodeJS.ErrnoException) {
  return Boolean(error.code && retryableRenameErrorCodes.has(error.code));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function safeUnlink(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

async function replaceFileFromTemp(tempFilePath: string, filePath: string, nextContent: string) {
  let lastRenameError: NodeJS.ErrnoException | undefined;

  for (let attempt = 0; attempt <= renameRetryDelaysMs.length; attempt += 1) {
    try {
      await fs.rename(tempFilePath, filePath);
      return;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (!isRetryableRenameError(nodeError) || attempt === renameRetryDelaysMs.length) {
        lastRenameError = nodeError;
        break;
      }
      await sleep(renameRetryDelaysMs[attempt]);
    }
  }

  if (lastRenameError && isRetryableRenameError(lastRenameError)) {
    await fs.writeFile(filePath, nextContent, "utf8");
    await safeUnlink(tempFilePath);
    return;
  }

  throw lastRenameError ?? new Error(`写入 JSON 文件失败：${filePath}`);
}

export async function writeJsonFile<T>(filePath: string, value: T) {
  await ensureDir(path.dirname(filePath));
  const nextContent = JSON.stringify(value, null, 2);
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, nextContent, "utf8");
  try {
    await replaceFileFromTemp(tempFilePath, filePath, nextContent);
  } finally {
    await safeUnlink(tempFilePath);
  }
}

export async function listJsonFiles<T>(dirPath: string): Promise<T[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const values = await Promise.all(
      files.map(async (entry) => {
        const filePath = path.join(dirPath, entry.name);
        return readJsonFile<T | null>(filePath, null);
      }),
    );
    return values.reduce<T[]>((result, value) => {
      if (value !== null) {
        result.push(value);
      }
      return result;
    }, []);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
