import type { SearchProvider, SocialPlatform } from "@/lib/types";

export interface ProviderPublishBundle {
  searchProvider: SearchProvider;
  label: string;
  platforms: SocialPlatform[];
}

const automatedPlatformOrder: SocialPlatform[] = [
  "toutiao",
  "baijiahao",
  "douyin",
  "xiaohongshu",
  "wechat",
  "videohao",
  "zhihu",
  "weibo",
  "csdn",
];

export const providerPublishMatrix: Record<SearchProvider, ProviderPublishBundle> = {
  doubao: {
    searchProvider: "doubao",
    label: "豆包",
    platforms: automatedPlatformOrder,
  },
  yuanbao: {
    searchProvider: "yuanbao",
    // Consumer app Yuanbao is not a stable API target.
    // API-backed generation uses Tencent Hunyuan (tencent-hunyuan provider profile).
    label: "元宝（混元）",
    platforms: automatedPlatformOrder,
  },
  tongyi: {
    searchProvider: "tongyi",
    label: "通义千问",
    platforms: automatedPlatformOrder,
  },
  deepseek: {
    searchProvider: "deepseek",
    label: "DeepSeek",
    platforms: automatedPlatformOrder,
  },
};

export function getProviderPublishBundle(searchProvider: SearchProvider | undefined) {
  return searchProvider ? providerPublishMatrix[searchProvider] : undefined;
}

export function getPlatformsBySearchProvider(searchProvider: SearchProvider | undefined): SocialPlatform[] {
  return getProviderPublishBundle(searchProvider)?.platforms ?? automatedPlatformOrder;
}
