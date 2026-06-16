import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dataDirectories } from "@/lib/paths";
import { ensureDir, listJsonFiles, readJsonFile, writeJsonFile } from "@/lib/storage/json-store";
import type {
  AppConfig,
  AccountPublishingDraft,
  ContentDraft,
  ContentPoolRecord,
  ImageAsset,
  PlatformAccountRecord,
  ProductProfile,
  PublishResult,
  PublishingDraft,
  PublishingJobRecord,
  TaskRecord,
  ThemeSet,
} from "@/lib/types";

const filePathFor = (dirPath: string, id: string) => path.join(dirPath, `${id}.json`);
const retryablePlatformAccountErrorCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
const platformAccountWriteBackDelaysMs = [1000, 3000, 5000, 10000] as const;
const inMemoryPlatformAccounts = new Map<string, PlatformAccountRecord>();
const pendingPlatformAccountWriteBacks = new Map<string, Promise<void>>();
const deletedPlatformAccountIds = new Set<string>();

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryablePlatformAccountError(error: unknown) {
  const nodeError = error as NodeJS.ErrnoException | undefined;
  return Boolean(nodeError?.code && retryablePlatformAccountErrorCodes.has(nodeError.code));
}

function clonePlatformAccountRecord(account: PlatformAccountRecord) {
  return {
    ...account,
  };
}

function platformAccountUpdatedAtMs(account?: PlatformAccountRecord | null) {
  return new Date(account?.updatedAt || 0).getTime();
}

function selectNewestPlatformAccount(
  memoryAccount: PlatformAccountRecord | null | undefined,
  diskAccount: PlatformAccountRecord | null | undefined,
) {
  if (!memoryAccount) return diskAccount ?? null;
  if (!diskAccount) return memoryAccount;
  return platformAccountUpdatedAtMs(memoryAccount) >= platformAccountUpdatedAtMs(diskAccount) ? memoryAccount : diskAccount;
}

function syncInMemoryPlatformAccount(account: PlatformAccountRecord) {
  const snapshot = clonePlatformAccountRecord(account);
  inMemoryPlatformAccounts.set(snapshot.id, snapshot);
  deletedPlatformAccountIds.delete(snapshot.id);
  return snapshot;
}

function schedulePlatformAccountWriteBack(accountId: string) {
  if (pendingPlatformAccountWriteBacks.has(accountId)) {
    return;
  }
  const task = (async () => {
    for (const delayMs of platformAccountWriteBackDelaysMs) {
      await sleep(delayMs);
      if (deletedPlatformAccountIds.has(accountId)) {
        return;
      }
      const snapshot = inMemoryPlatformAccounts.get(accountId);
      if (!snapshot) {
        return;
      }
      try {
        await writeJsonFile(filePathFor(dataDirectories.platformAccounts, accountId), snapshot);
        return;
      } catch (error) {
        if (!isRetryablePlatformAccountError(error)) {
          throw error;
        }
      }
    }
  })().finally(() => {
    pendingPlatformAccountWriteBacks.delete(accountId);
  });
  pendingPlatformAccountWriteBacks.set(accountId, task);
  void task.catch(() => undefined);
}

export async function ensureStorageReady() {
  await Promise.all(Object.values(dataDirectories).map((dirPath) => ensureDir(dirPath)));
}

export function createRecordId() {
  return randomUUID();
}

export async function saveTask(task: TaskRecord) {
  await writeJsonFile(filePathFor(dataDirectories.tasks, task.id), task);
  return task;
}

export async function getTask(taskId: string) {
  return readJsonFile<TaskRecord | null>(filePathFor(dataDirectories.tasks, taskId), null);
}

export async function listTasks() {
  return listJsonFiles<TaskRecord>(dataDirectories.tasks);
}

export async function saveProduct(product: ProductProfile) {
  await writeJsonFile(filePathFor(dataDirectories.products, product.id), product);
  return product;
}

export async function getProduct(productId: string) {
  return readJsonFile<ProductProfile | null>(filePathFor(dataDirectories.products, productId), null);
}

export async function listProducts() {
  return listJsonFiles<ProductProfile>(dataDirectories.products);
}

export async function saveTheme(theme: ThemeSet) {
  await writeJsonFile(filePathFor(dataDirectories.themes, theme.taskId), theme);
  return theme;
}

export async function getTheme(taskId: string) {
  return readJsonFile<ThemeSet | null>(filePathFor(dataDirectories.themes, taskId), null);
}

export async function saveContent(content: ContentDraft) {
  await writeJsonFile(filePathFor(dataDirectories.content, content.taskId), content);
  return content;
}

export async function getContent(taskId: string) {
  return readJsonFile<ContentDraft | null>(filePathFor(dataDirectories.content, taskId), null);
}

export async function listAllContentDrafts() {
  return listJsonFiles<ContentDraft>(dataDirectories.content);
}

export async function saveContentPool(record: ContentPoolRecord) {
  await writeJsonFile(filePathFor(dataDirectories.contentPool, record.taskId), record);
  return record;
}

export async function getContentPool(taskId: string) {
  return readJsonFile<ContentPoolRecord | null>(filePathFor(dataDirectories.contentPool, taskId), null);
}

export async function listContentPools() {
  return listJsonFiles<ContentPoolRecord>(dataDirectories.contentPool);
}

export async function saveImage(image: ImageAsset) {
  await writeJsonFile(filePathFor(dataDirectories.images, image.taskId), image);
  return image;
}

export async function getImage(taskId: string) {
  return readJsonFile<ImageAsset | null>(filePathFor(dataDirectories.images, taskId), null);
}

export async function savePublishResult(result: PublishResult) {
  await writeJsonFile(filePathFor(dataDirectories.publish, result.taskId), result);
  return result;
}

export async function getPublishResult(taskId: string) {
  return readJsonFile<PublishResult | null>(filePathFor(dataDirectories.publish, taskId), null);
}

export async function listPublishResults() {
  return listJsonFiles<PublishResult>(dataDirectories.publish);
}

export async function deletePublishResult(taskId: string) {
  const jsonPath = filePathFor(dataDirectories.publish, taskId);
  const htmlPath = path.join(dataDirectories.publish, `${taskId}.html`);
  for (const filePath of [jsonPath, htmlPath]) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function savePlatformAccount(account: PlatformAccountRecord) {
  const snapshot = syncInMemoryPlatformAccount(account);
  try {
    await writeJsonFile(filePathFor(dataDirectories.platformAccounts, snapshot.id), snapshot);
  } catch (error) {
    if (!isRetryablePlatformAccountError(error)) {
      throw error;
    }
    schedulePlatformAccountWriteBack(snapshot.id);
  }
  return snapshot;
}

export async function getPlatformAccount(accountId: string) {
  const memoryAccount = deletedPlatformAccountIds.has(accountId) ? null : inMemoryPlatformAccounts.get(accountId) ?? null;
  try {
    const diskAccount = await readJsonFile<PlatformAccountRecord | null>(filePathFor(dataDirectories.platformAccounts, accountId), null);
    const next = selectNewestPlatformAccount(memoryAccount, diskAccount);
    if (next) {
      syncInMemoryPlatformAccount(next);
    }
    return next;
  } catch (error) {
    if (!isRetryablePlatformAccountError(error)) {
      throw error;
    }
    return memoryAccount;
  }
}

export async function listPlatformAccounts() {
  const mergedAccounts = new Map<string, PlatformAccountRecord>();
  for (const [accountId, account] of inMemoryPlatformAccounts.entries()) {
    if (!deletedPlatformAccountIds.has(accountId)) {
      mergedAccounts.set(accountId, clonePlatformAccountRecord(account));
    }
  }

  try {
    const entries = await fs.readdir(dataDirectories.platformAccounts, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    await Promise.all(
      files.map(async (entry) => {
        const accountId = entry.name.replace(/\.json$/i, "");
        if (deletedPlatformAccountIds.has(accountId)) {
          return;
        }
        try {
          const diskAccount = await readJsonFile<PlatformAccountRecord | null>(
            filePathFor(dataDirectories.platformAccounts, accountId),
            null,
          );
          const next = selectNewestPlatformAccount(mergedAccounts.get(accountId), diskAccount);
          if (next) {
            mergedAccounts.set(accountId, syncInMemoryPlatformAccount(next));
          }
        } catch (error) {
          if (!isRetryablePlatformAccountError(error)) {
            throw error;
          }
        }
      }),
    );
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT" && !isRetryablePlatformAccountError(error)) {
      throw error;
    }
  }

  return Array.from(mergedAccounts.values());
}

export async function deletePlatformAccount(accountId: string) {
  const filePath = filePathFor(dataDirectories.platformAccounts, accountId);
  inMemoryPlatformAccounts.delete(accountId);
  deletedPlatformAccountIds.add(accountId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT" && !isRetryablePlatformAccountError(error)) {
      throw error;
    }
  }
}

export async function savePublishingDraft(draft: PublishingDraft) {
  await writeJsonFile(filePathFor(dataDirectories.publishingDrafts, draft.id), draft);
  return draft;
}

export async function getPublishingDraft(draftId: string) {
  return readJsonFile<PublishingDraft | null>(filePathFor(dataDirectories.publishingDrafts, draftId), null);
}

export async function listPublishingDrafts() {
  return listJsonFiles<PublishingDraft>(dataDirectories.publishingDrafts);
}

export async function getPublishingDraftsByTask(taskId: string) {
  const drafts = await listPublishingDrafts();
  return drafts.filter((draft) => draft.taskId === taskId);
}

export async function deletePublishingDraft(draftId: string) {
  const filePath = filePathFor(dataDirectories.publishingDrafts, draftId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deletePublishingDraftsByTask(taskId: string) {
  const drafts = await getPublishingDraftsByTask(taskId);
  await Promise.all(drafts.map((draft) => deletePublishingDraft(draft.id)));
}

export async function saveAccountPublishingDraft(draft: AccountPublishingDraft) {
  await writeJsonFile(filePathFor(dataDirectories.accountPublishingDrafts, draft.id), draft);
  return draft;
}

export async function getAccountPublishingDraft(draftId: string) {
  return readJsonFile<AccountPublishingDraft | null>(filePathFor(dataDirectories.accountPublishingDrafts, draftId), null);
}

export async function listAccountPublishingDrafts() {
  return listJsonFiles<AccountPublishingDraft>(dataDirectories.accountPublishingDrafts);
}

export async function getAccountPublishingDraftsByTask(taskId: string) {
  const drafts = await listAccountPublishingDrafts();
  return drafts.filter((draft) => draft.taskId === taskId);
}

export async function deleteAccountPublishingDraft(draftId: string) {
  const filePath = filePathFor(dataDirectories.accountPublishingDrafts, draftId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deleteAccountPublishingDraftsByTask(taskId: string) {
  const drafts = await getAccountPublishingDraftsByTask(taskId);
  await Promise.all(drafts.map((draft) => deleteAccountPublishingDraft(draft.id)));
}

export async function savePublishingJob(job: PublishingJobRecord) {
  await writeJsonFile(filePathFor(dataDirectories.publishingJobs, job.id), job);
  return job;
}

export async function getPublishingJob(jobId: string) {
  return readJsonFile<PublishingJobRecord | null>(filePathFor(dataDirectories.publishingJobs, jobId), null);
}

export async function listPublishingJobs() {
  return listJsonFiles<PublishingJobRecord>(dataDirectories.publishingJobs);
}

export async function getPublishingJobsByTask(taskId: string) {
  const jobs = await listPublishingJobs();
  return jobs.filter((job) => job.taskId === taskId);
}

export async function deletePublishingJob(jobId: string) {
  const filePath = filePathFor(dataDirectories.publishingJobs, jobId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function deletePublishingJobsByTask(taskId: string) {
  const jobs = await getPublishingJobsByTask(taskId);
  await Promise.all(jobs.map((job) => deletePublishingJob(job.id)));
}

export async function saveConfig(config: AppConfig) {
  await writeJsonFile(path.join(dataDirectories.config, "app-config.json"), config);
  return config;
}

export async function getConfig() {
  return readJsonFile<AppConfig | null>(path.join(dataDirectories.config, "app-config.json"), null);
}
