import path from "node:path";

const fallbackDataDir = path.join(process.cwd(), "data");

export const dataRoot = process.env.GEO_DATA_DIR ?? fallbackDataDir;

export const dataDirectories = {
  tasks: path.join(dataRoot, "tasks"),
  products: path.join(dataRoot, "products"),
  themes: path.join(dataRoot, "themes"),
  content: path.join(dataRoot, "content"),
  images: path.join(dataRoot, "images"),
  generatedImages: path.join(process.cwd(), "public", "generated-images"),
  publish: path.join(dataRoot, "publish"),
  platformAccounts: path.join(dataRoot, "platform-accounts"),
  publishingJobs: path.join(dataRoot, "publishing-jobs"),
  publishingDrafts: path.join(dataRoot, "publishing-drafts"),
  accountPublishingDrafts: path.join(dataRoot, "account-publishing-drafts"),
  config: path.join(dataRoot, "config"),
};
