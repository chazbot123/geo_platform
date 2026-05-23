"use client";

import { extensionBrowserPublisher } from "@/lib/publish/platform-publishers/extension-browser-publisher";
import type { PlatformPublisher } from "@/lib/publish/platform-publishers/base";

export function getPlatformPublisher(platform: string): PlatformPublisher | null {
  switch (platform) {
    case "xiaohongshu":
      return extensionBrowserPublisher;
    case "douyin":
      return extensionBrowserPublisher;
    default:
      return null;
  }
}
