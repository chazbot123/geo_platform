import {
  createRecordId,
  ensureStorageReady,
  getContent,
  getImage,
  getProduct,
  getPublishResult,
  getTask,
  getTheme,
  listTasks,
  saveTask,
} from "@/lib/storage/data-store";
import type { ProductProfile, TaskBundle, TaskCreateInput, TaskRecord, TaskStatus } from "@/lib/types";

function now() {
  return new Date().toISOString();
}

export async function createTask(input: TaskCreateInput) {
  await ensureStorageReady();
  const taskId = createRecordId();
  const productId = createRecordId();
  const { searchProvider, ...productInput } = input;

  const product: ProductProfile = {
    id: productId,
    taskId,
    ...productInput,
  };

  const task: TaskRecord = {
    id: taskId,
    productId,
    status: "created",
    searchProvider: searchProvider || undefined,
    createdAt: now(),
    updatedAt: now(),
  };

  const { saveProduct } = await import("@/lib/storage/data-store");
  await saveProduct(product);
  await saveTask(task);

  return { task, product };
}

export async function getTaskBundle(taskId: string): Promise<TaskBundle | null> {
  await ensureStorageReady();
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const [product, theme, content, image, publish] = await Promise.all([
    getProduct(task.productId),
    getTheme(taskId),
    getContent(taskId),
    getImage(taskId),
    getPublishResult(taskId),
  ]);

  if (!product) {
    return null;
  }

  return {
    task,
    product,
    theme: theme ?? undefined,
    content: content ?? undefined,
    image: image ?? undefined,
    publish: publish ?? undefined,
  };
}

export async function listTaskBundles() {
  await ensureStorageReady();
  const tasks = await listTasks();
  const bundles = await Promise.all(tasks.map((task) => getTaskBundle(task.id)));
  return bundles
    .filter((bundle): bundle is TaskBundle => Boolean(bundle))
    .sort((left, right) => new Date(right.task.updatedAt).getTime() - new Date(left.task.updatedAt).getTime());
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, patch?: Partial<TaskRecord>) {
  const task = await getTask(taskId);
  if (!task) {
    throw new Error("任务不存在");
  }

  const nextTask: TaskRecord = {
    ...task,
    ...patch,
    status,
    updatedAt: now(),
  };

  await saveTask(nextTask);
  return nextTask;
}

export async function markTaskFailed(taskId: string, failedStage: string, errorMessage: string, retryable = true) {
  return updateTaskStatus(taskId, "failed", {
    failedStage,
    errorCode: failedStage.toUpperCase(),
    errorMessage,
    retryable,
  });
}
