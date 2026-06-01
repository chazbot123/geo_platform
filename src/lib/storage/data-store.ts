import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dataDirectories } from "@/lib/paths";
import { ensureDir, listJsonFiles, readJsonFile, writeJsonFile } from "@/lib/storage/json-store";
import type {
  AppConfig,
  ContentDraft,
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
  await writeJsonFile(filePathFor(dataDirectories.platformAccounts, account.id), account);
  return account;
}

export async function getPlatformAccount(accountId: string) {
  return readJsonFile<PlatformAccountRecord | null>(filePathFor(dataDirectories.platformAccounts, accountId), null);
}

export async function listPlatformAccounts() {
  return listJsonFiles<PlatformAccountRecord>(dataDirectories.platformAccounts);
}

export async function deletePlatformAccount(accountId: string) {
  const filePath = filePathFor(dataDirectories.platformAccounts, accountId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
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
