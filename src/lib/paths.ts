import path from "node:path";

const fallbackDataDir = path.join(process.cwd(), "data");

export const dataRoot = process.env.GEO_DATA_DIR ?? fallbackDataDir;

export const dataDirectories = {
  tasks: path.join(dataRoot, "tasks"),
  products: path.join(dataRoot, "products"),
  themes: path.join(dataRoot, "themes"),
  content: path.join(dataRoot, "content"),
  images: path.join(dataRoot, "images"),
  publish: path.join(dataRoot, "publish"),
  platformAccounts: path.join(dataRoot, "platform-accounts"),
  extensionLoginSessions: path.join(dataRoot, "extension-login-sessions"),
  extensionPublishSessions: path.join(dataRoot, "extension-publish-sessions"),
  publishingJobs: path.join(dataRoot, "publishing-jobs"),
  publishingDrafts: path.join(dataRoot, "publishing-drafts"),
  config: path.join(dataRoot, "config"),
};
