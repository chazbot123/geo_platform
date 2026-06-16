import type { SearchProvider, SocialPlatform } from "@/lib/types";

export interface ProviderPublishBundle {
  searchProvider: SearchProvider;
  label: string;
  platforms: SocialPlatform[];
}

const fallbackPlatformOrder: SocialPlatform[] = [
  "douyin",
  "baijiahao",
  "toutiao",
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
    platforms: ["douyin", "baijiahao", "toutiao"],
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
    platforms: ["weibo", "xiaohongshu"],
  },
};

export function getProviderPublishBundle(searchProvider: SearchProvider | undefined) {
  return searchProvider ? providerPublishMatrix[searchProvider] : undefined;
}

export function getPlatformsBySearchProvider(searchProvider: SearchProvider | undefined): SocialPlatform[] {
  return getProviderPublishBundle(searchProvider)?.platforms ?? fallbackPlatformOrder;
}

export function normalizeSearchProviders(searchProviders: Array<SearchProvider | undefined> | SearchProvider | undefined): SearchProvider[] {
  const rawProviders = Array.isArray(searchProviders) ? searchProviders : searchProviders ? [searchProviders] : [];
  const validProviders = rawProviders.filter((provider): provider is SearchProvider => Boolean(provider && provider in providerPublishMatrix));
  return Array.from(new Set(validProviders));
}

export function getPlatformsBySearchProviders(searchProviders: Array<SearchProvider | undefined> | SearchProvider | undefined): SocialPlatform[] {
  const selectedProviders = normalizeSearchProviders(searchProviders);
  if (!selectedProviders.length) {
    return [];
  }
  const allowed = new Set(selectedProviders.flatMap((provider) => getPlatformsBySearchProvider(provider)));
  return fallbackPlatformOrder.filter((platform) => allowed.has(platform));
}

export function getSearchProviderForPlatform(
  platform: SocialPlatform,
  searchProviders: Array<SearchProvider | undefined> | SearchProvider | undefined,
): SearchProvider | undefined {
  const selectedProviders = normalizeSearchProviders(searchProviders);
  return selectedProviders.find((provider) => getPlatformsBySearchProvider(provider).includes(platform));
}

export function getAllPublishPlatforms(): SocialPlatform[] {
  return fallbackPlatformOrder.slice();
}
