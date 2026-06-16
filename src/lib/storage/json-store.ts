import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

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
const retryableWriteErrorCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
const renameRetryDelaysMs = [20, 50, 100, 150];
const transactionRetryDelaysMs = [20, 50, 100, 150, 250, 400, 600];
const pendingWritesByPath = new Map<string, Promise<void>>();
const bestEffortJsonFileNames = new Set(["publish-account-detection-cache.json"]);

function isRetryableRenameError(error: NodeJS.ErrnoException) {
  return Boolean(error.code && retryableRenameErrorCodes.has(error.code));
}

function isRetryableWriteError(error: NodeJS.ErrnoException) {
  return Boolean(error.code && retryableWriteErrorCodes.has(error.code));
}

function shouldSuppressJsonWriteError(filePath: string, error: NodeJS.ErrnoException) {
  return isRetryableWriteError(error) && bestEffortJsonFileNames.has(path.basename(filePath));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function reportJsonStoreDebugEvent(
  hypothesisId: "A" | "B" | "C" | "D",
  location: string,
  msg: string,
  data: Record<string, unknown>,
  traceId?: string,
) {
  let debugServerUrl = "http://127.0.0.1:7777/event";
  let debugSessionId = "eperm-json-write";
  try {
    const envContent = await fs.readFile(path.join(process.cwd(), ".dbg", "eperm-json-write.env"), "utf8");
    debugServerUrl = envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || debugServerUrl;
    debugSessionId = envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || debugSessionId;
  } catch {}
  await fetch(debugServerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: debugSessionId,
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      traceId,
      ts: Date.now(),
    }),
  }).catch(() => undefined);
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

async function writeFileWithRetry(filePath: string, content: string) {
  let lastWriteError: NodeJS.ErrnoException | undefined;

  for (let attempt = 0; attempt <= renameRetryDelaysMs.length; attempt += 1) {
    try {
      await fs.writeFile(filePath, content, "utf8");
      return;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      // #region debug-point A:write-file-error
      void reportJsonStoreDebugEvent("A", "json-store.ts:writeFileWithRetry", "writeFile failed", {
        filePath,
        attempt,
        code: nodeError.code,
        message: nodeError.message,
      });
      // #endregion
      if (!isRetryableWriteError(nodeError) || attempt === renameRetryDelaysMs.length) {
        lastWriteError = nodeError;
        break;
      }
      await sleep(renameRetryDelaysMs[attempt]);
    }
  }

  throw lastWriteError ?? new Error(`写入 JSON 文件失败：${filePath}`);
}

async function replaceFileFromTemp(tempFilePath: string, filePath: string, nextContent: string) {
  let lastRenameError: NodeJS.ErrnoException | undefined;

  for (let attempt = 0; attempt <= renameRetryDelaysMs.length; attempt += 1) {
    try {
      await fs.rename(tempFilePath, filePath);
      return;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      // #region debug-point A:rename-error
      void reportJsonStoreDebugEvent("A", "json-store.ts:replaceFileFromTemp", "rename failed", {
        filePath,
        tempFilePath,
        attempt,
        code: nodeError.code,
        message: nodeError.message,
      });
      // #endregion
      if (!isRetryableRenameError(nodeError) || attempt === renameRetryDelaysMs.length) {
        lastRenameError = nodeError;
        break;
      }
      await sleep(renameRetryDelaysMs[attempt]);
    }
  }

  if (lastRenameError && isRetryableRenameError(lastRenameError)) {
    await writeFileWithRetry(filePath, nextContent);
    await safeUnlink(tempFilePath);
    return;
  }

  throw lastRenameError ?? new Error(`写入 JSON 文件失败：${filePath}`);
}

async function performWriteJsonFile<T>(filePath: string, value: T) {
  await ensureDir(path.dirname(filePath));
  const nextContent = JSON.stringify(value, null, 2);
  let lastTransactionError: NodeJS.ErrnoException | undefined;
  const traceId = randomUUID();

  // #region debug-point C:write-start
  void reportJsonStoreDebugEvent("C", "json-store.ts:performWriteJsonFile", "write transaction started", {
    filePath,
    contentLength: nextContent.length,
  }, traceId);
  // #endregion

  for (let attempt = 0; attempt <= transactionRetryDelaysMs.length; attempt += 1) {
    const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try {
      // #region debug-point B:write-attempt
      void reportJsonStoreDebugEvent("B", "json-store.ts:performWriteJsonFile", "write transaction attempt", {
        filePath,
        tempFilePath,
        attempt,
      }, traceId);
      // #endregion
      try {
        await writeFileWithRetry(tempFilePath, nextContent);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (!isRetryableWriteError(nodeError)) {
          throw error;
        }
        await writeFileWithRetry(filePath, nextContent);
        return;
      }
      try {
        await replaceFileFromTemp(tempFilePath, filePath, nextContent);
      } finally {
        await safeUnlink(tempFilePath);
      }
      // #region debug-point D:write-success
      void reportJsonStoreDebugEvent("D", "json-store.ts:performWriteJsonFile", "write transaction succeeded", {
        filePath,
        attempt,
      }, traceId);
      // #endregion
      return;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      await safeUnlink(tempFilePath);
      // #region debug-point D:write-transaction-error
      void reportJsonStoreDebugEvent("D", "json-store.ts:performWriteJsonFile", "write transaction failed", {
        filePath,
        attempt,
        code: nodeError.code,
        message: nodeError.message,
      }, traceId);
      // #endregion
      if (
        (!isRetryableWriteError(nodeError) && !isRetryableRenameError(nodeError)) ||
        attempt === transactionRetryDelaysMs.length
      ) {
        if (shouldSuppressJsonWriteError(filePath, nodeError)) {
          return;
        }
        lastTransactionError = nodeError;
        break;
      }
      await sleep(transactionRetryDelaysMs[attempt]);
    }
  }

  throw lastTransactionError ?? new Error(`写入 JSON 文件失败：${filePath}`);
}

export async function writeJsonFile<T>(filePath: string, value: T) {
  const previousWrite = pendingWritesByPath.get(filePath) ?? Promise.resolve();
  let resolveCurrentWrite: (() => void) | undefined;
  const currentWrite = new Promise<void>((resolve) => {
    resolveCurrentWrite = resolve;
  });
  pendingWritesByPath.set(filePath, previousWrite.then(() => currentWrite));

  try {
    await previousWrite;
    await performWriteJsonFile(filePath, value);
  } finally {
    resolveCurrentWrite?.();
    if (pendingWritesByPath.get(filePath) === currentWrite) {
      pendingWritesByPath.delete(filePath);
    }
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
