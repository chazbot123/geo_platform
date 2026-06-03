"use client";

import { toutiaoPublisher } from "@/lib/publish/platform-publishers/toutiao-publisher";
import { electronBrowserPublisher } from "@/lib/publish/platform-publishers/electron-browser-publisher";
import type { PlatformPublisher } from "@/lib/publish/platform-publishers/base";

export function getPlatformPublisher(platform: string): PlatformPublisher | null {
  switch (platform) {
    case "toutiao":
      return toutiaoPublisher;
    case "baijiahao":
    case "douyin":
    case "wechat":
    case "videohao":
    case "zhihu":
    case "weibo":
    case "csdn":
      return electronBrowserPublisher;
    default:
      return null;
  }
}
