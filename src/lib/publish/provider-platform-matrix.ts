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
    platforms: ["toutiao", "baijiahao", "douyin", "xiaohongshu"],
  },
  deepseek: {
    searchProvider: "deepseek",
    label: "DeepSeek",
    platforms: ["csdn", "zhihu"],
  },
  yuanbao: {
    searchProvider: "yuanbao",
    label: "元宝",
    platforms: ["wechat", "videohao", "xiaohongshu"],
  },
  tongyi: {
    searchProvider: "tongyi",
    label: "千问",
    platforms: ["zhihu", "weibo", "xiaohongshu"],
  },
};

export function getProviderPublishBundle(searchProvider: SearchProvider | undefined) {
  return searchProvider ? providerPublishMatrix[searchProvider] : undefined;
}

export function getPlatformsBySearchProvider(searchProvider: SearchProvider | undefined): SocialPlatform[] {
  return getProviderPublishBundle(searchProvider)?.platforms ?? fallbackPlatformOrder;
}
