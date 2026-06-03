import type { SearchProvider, SocialPlatform } from "@/lib/types";

export interface ProviderPublishBundle {
  searchProvider: SearchProvider;
  label: string;
  platforms: SocialPlatform[];
}

export const providerPublishMatrix: Record<SearchProvider, ProviderPublishBundle> = {
  doubao: {
    searchProvider: "doubao",
    label: "豆包",
    platforms: ["toutiao", "baijiahao", "douyin"],
  },
  yuanbao: {
    searchProvider: "yuanbao",
    // Consumer app Yuanbao is not a stable API target.
    // API-backed generation uses Tencent Hunyuan (tencent-hunyuan provider profile).
    label: "元宝（混元）",
    platforms: ["wechat", "videohao"],
  },
  tongyi: {
    searchProvider: "tongyi",
    label: "通义千问",
    platforms: ["zhihu", "weibo"],
  },
  deepseek: {
    searchProvider: "deepseek",
    label: "DeepSeek",
    platforms: ["zhihu", "csdn"],
  },
};

export function getProviderPublishBundle(searchProvider: SearchProvider | undefined) {
  return searchProvider ? providerPublishMatrix[searchProvider] : undefined;
}

export function getPlatformsBySearchProvider(searchProvider: SearchProvider | undefined): SocialPlatform[] {
  return getProviderPublishBundle(searchProvider)?.platforms ?? ["toutiao"];
}
