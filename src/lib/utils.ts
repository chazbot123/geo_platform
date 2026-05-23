import { clsx } from "clsx";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return clsx(inputs);
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "--";
  }
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
}

const taskStatusMap: Record<string, string> = {
  created: "已创建",
  keyword_generated: "关键词已生成",
  content_generated: "内容已生成",
  image_generated: "图片已生成",
  publishing: "发布中",
  published: "已发布",
  failed: "失败",
};

const configGroupMap: Record<string, string> = {
  stage1ModelApiConfig: "第一阶段模型 API 配置",
  contentModelApiConfig: "内容模型 API 配置",
  imageModelApiConfig: "图片模型 API 配置",
  publishApiConfig: "发布 API 配置",
};

const configFieldMap: Record<string, string> = {
  provider: "供应商",
  baseUrl: "接口地址",
  apiKey: "接口密钥",
  modelName: "模型名称",
  timeout: "超时时间",
};

export function formatTaskStatus(status?: string) {
  if (!status) {
    return "--";
  }
  return taskStatusMap[status] ?? status;
}

export function formatConfigGroupLabel(key: string) {
  return configGroupMap[key] ?? key;
}

export function formatConfigFieldLabel(key: string) {
  return configFieldMap[key] ?? key;
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
