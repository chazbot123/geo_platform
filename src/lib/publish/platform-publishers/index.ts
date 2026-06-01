"use client";

import { toutiaoPublisher } from "@/lib/publish/platform-publishers/toutiao-publisher";
import type { PlatformPublisher } from "@/lib/publish/platform-publishers/base";

export function getPlatformPublisher(platform: string): PlatformPublisher | null {
  switch (platform) {
    case "toutiao":
      return toutiaoPublisher;
    default:
      return null;
  }
}
