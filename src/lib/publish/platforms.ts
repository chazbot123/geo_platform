import type { PublishPlatform, PublishingExecutionMode, SocialPlatform } from "@/lib/types";

export interface PlatformDescriptor {
  key: PublishPlatform;
  label: string;
  loginSupported: boolean;
  executionMode: PublishingExecutionMode;
  publishEntryUrl?: string;
  hint: string;
}

export const publishPlatformDescriptors: PlatformDescriptor[] = [
  {
    key: "toutiao",
    label: "今日头条",
    loginSupported: true,
    executionMode: "electron_automation",
    publishEntryUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    hint: "当前优先通过 Electron 承接今日头条图文自动发布。",
  },
];

export function getPlatformDescriptor(platform: PublishPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}

export function getSocialPlatformDescriptor(platform: SocialPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}
