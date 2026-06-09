import type { SearchProvider, SocialPlatform } from "@/lib/types";

export interface ProviderPublishBundle {
  searchProvider: SearchProvider;
  label: string;
  platforms: SocialPlatform[];
}

const fallbackPlatformOrder: SocialPlatform[] = [
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
    platforms: ["toutiao", "baijiahao", "douyin"],
  },
  deepseek: {
    searchProvider: "deepseek",
    label: "DeepSeek",
    platforms: ["csdn", "zhihu"],
  },
  yuanbao: {
    searchProvider: "yuanbao",
    label: "腾讯元宝",
    platforms: ["wechat", "videohao"],
  },
  tongyi: {
    searchProvider: "tongyi",
    label: "通义千问",
    platforms: ["zhihu", "weibo", "xiaohongshu"],
  },
};

export function getProviderPublishBundle(searchProvider: SearchProvider | undefined) {
  return searchProvider ? providerPublishMatrix[searchProvider] : undefined;
}

export function getPlatformsBySearchProvider(searchProvider: SearchProvider | undefined): SocialPlatform[] {
  return getProviderPublishBundle(searchProvider)?.platforms ?? fallbackPlatformOrder;
}
