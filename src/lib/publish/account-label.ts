import type { PlatformAccountRecord } from "@/lib/types";

type AccountLabelInput = Pick<PlatformAccountRecord, "displayName" | "accountName" | "platformAccountId" | "platform">;

export const platformAccountLabels: Record<PlatformAccountRecord["platform"], string> = {
  toutiao: "今日头条",
  baijiahao: "百家号",
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "微信公众号",
  videohao: "视频号",
  zhihu: "知乎",
  weibo: "微博",
  csdn: "CSDN",
};

const allPlatformLabels = new Set(Object.values(platformAccountLabels));
const placeholderNamePattern = /(?:^|[-_])(account|user)[-_]?\d{6,}$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const suspiciousNamePattern =
  /发布文章|发布作品|发布内容|创作中心|内容管理|作品管理|发文规范|创作服务平台|工作台|去发布|退出登录|登录|注册|首页|消息|私信|评论|点赞|关注|粉丝|热搜|推荐|搜索|客户端|来自|秒前|分钟前|小时前|天前|周前|个月前|年前/i;
const timePollutionPattern = /\d+\s*(?:秒|分钟|分|小时|天|周|个月|月|年)前/i;
const baijiahaoFeedNoisePattern = /热点榜|快来看看|^\s*切换(?:\s+.*\(\d+s\))?\s*$/i;

function normalizeLabel(value?: string) {
  const text = String(value || "")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || "";
}

function isGenericPlatformLabel(value: string, platform: PlatformAccountRecord["platform"]) {
  const label = platformAccountLabels[platform];
  return value === label || value === `${label}账号` || allPlatformLabels.has(value);
}

export function isSuspiciousAccountLabel(value?: string, platform?: PlatformAccountRecord["platform"]) {
  const text = normalizeLabel(value);
  if (!text) return true;
  if (platform && isGenericPlatformLabel(text, platform)) return true;
  if (platform === "baijiahao" && baijiahaoFeedNoisePattern.test(text)) return true;
  return suspiciousNamePattern.test(text) || timePollutionPattern.test(text);
}

export function isMeaningfulAccountDisplayName(value: string, platform: PlatformAccountRecord["platform"]) {
  return Boolean(value) && !isSuspiciousAccountLabel(value, platform);
}

export function isMeaningfulAccountIdentifier(value: string, platform: PlatformAccountRecord["platform"]) {
  return Boolean(value) && !placeholderNamePattern.test(value) && !uuidPattern.test(value) && !isSuspiciousAccountLabel(value, platform);
}

function isHumanReadableName(value: string) {
  return Boolean(value) && !uuidPattern.test(value) && !/^\d{8,}$/.test(value);
}

export function resolveAccountIdentifier(account: AccountLabelInput, fallback = "") {
  const candidates = [
    normalizeLabel(account.accountName),
    normalizeLabel(account.platformAccountId),
    normalizeLabel(fallback),
  ];
  return (
    candidates.find((value) => isMeaningfulAccountIdentifier(value || "", account.platform)) ||
    `${platformAccountLabels[account.platform]}账号`
  );
}

export function formatAccountDisplayLabel(account: AccountLabelInput, fallback = "") {
  const displayName = normalizeLabel(account.displayName);
  const accountName = normalizeLabel(account.accountName);
  const platformAccountId = normalizeLabel(account.platformAccountId);
  const fallbackLabel = normalizeLabel(fallback);
  const nickname = isMeaningfulAccountDisplayName(displayName, account.platform) ? displayName : "";
  const identifier = [accountName, platformAccountId, fallbackLabel].find((value) => {
    if (!isMeaningfulAccountIdentifier(value || "", account.platform)) return false;
    return true;
  });

  if (nickname && identifier && nickname !== identifier) {
    return `${nickname}（${identifier}）`;
  }
  return nickname || identifier || `${platformAccountLabels[account.platform]}账号`;
}

export function resolveAccountProfileName(account: AccountLabelInput) {
  const displayName = normalizeLabel(account.displayName);
  if (isMeaningfulAccountDisplayName(displayName, account.platform)) {
    return displayName;
  }

  const accountName = normalizeLabel(account.accountName);
  if (isMeaningfulAccountDisplayName(accountName, account.platform) && isHumanReadableName(accountName)) {
    return accountName;
  }

  return "";
}

export function sanitizeAccountProfileForSave(
  platform: PlatformAccountRecord["platform"],
  incoming: {
    accountName?: string;
    displayName?: string;
    platformAccountId?: string;
  },
  current?: Partial<AccountLabelInput>,
) {
  const incomingAccountName = normalizeLabel(incoming.accountName);
  const incomingDisplayName = normalizeLabel(incoming.displayName);
  const incomingPlatformAccountId = normalizeLabel(incoming.platformAccountId);
  const currentAccountName = normalizeLabel(current?.accountName);
  const currentDisplayName = normalizeLabel(current?.displayName);
  const currentPlatformAccountId = normalizeLabel(current?.platformAccountId);

  const platformAccountId =
    [incomingPlatformAccountId, currentPlatformAccountId].find((value) => isMeaningfulAccountIdentifier(value, platform)) ||
    undefined;
  const accountName =
    [incomingAccountName, platformAccountId, currentAccountName, currentPlatformAccountId].find((value) =>
      isMeaningfulAccountIdentifier(value || "", platform),
    ) || `${platformAccountLabels[platform]}账号`;
  const displayName =
    [incomingDisplayName, currentDisplayName, incomingAccountName, currentAccountName].find((value) => {
      if (!isMeaningfulAccountDisplayName(value || "", platform)) return false;
      return isHumanReadableName(value || "");
    }) || undefined;

  return {
    accountName,
    displayName,
    platformAccountId,
  };
}
