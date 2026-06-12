import type { PlatformAccountRecord } from "@/lib/types";

type AccountLabelInput = Pick<PlatformAccountRecord, "displayName" | "accountName" | "platformAccountId" | "platform">;

const platformLabels: Record<PlatformAccountRecord["platform"], string> = {
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

const suspiciousNamePattern = /发文规范|创作中心|内容管理|作品管理|发布作品|发布内容|创作服务平台|工作台|去发布|发作品|退出登录/i;
const placeholderNamePattern = /-(?:account|user)-\d{6,}$/i;

function normalizeLabel(value?: string) {
  const text = String(value || "").trim();
  return text || "";
}

function isGenericPlatformLabel(value: string, platform: PlatformAccountRecord["platform"]) {
  const label = platformLabels[platform];
  return value === label || value === `${label}账号`;
}

function isMeaningfulDisplayName(value: string, platform: PlatformAccountRecord["platform"]) {
  return Boolean(value) && !isGenericPlatformLabel(value, platform) && !suspiciousNamePattern.test(value);
}

function isMeaningfulIdentifier(value: string, platform: PlatformAccountRecord["platform"]) {
  return Boolean(value) && !placeholderNamePattern.test(value) && !isGenericPlatformLabel(value, platform) && !suspiciousNamePattern.test(value);
}

export function resolveAccountIdentifier(account: AccountLabelInput, fallback = "") {
  const candidates = [
    normalizeLabel(account.accountName),
    normalizeLabel(account.platformAccountId),
    normalizeLabel(fallback),
  ];
  return candidates.find((value) => isMeaningfulIdentifier(value || "", account.platform)) || normalizeLabel(account.platform);
}

export function formatAccountDisplayLabel(account: AccountLabelInput, fallback = "") {
  const displayName = normalizeLabel(account.displayName);
  const nickname = isMeaningfulDisplayName(displayName, account.platform) ? displayName : "";
  const identifier = resolveAccountIdentifier(account, fallback);
  if (nickname && identifier && nickname !== identifier) {
    return `${nickname}（${identifier}）`;
  }
  return nickname || identifier;
}
