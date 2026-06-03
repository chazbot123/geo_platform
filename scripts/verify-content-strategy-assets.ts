import { loadPlatformStrategy } from "../src/lib/content/prompt-loader.js";

(async function main() {
  const platforms = ["toutiao", "wechat", "blog", "xiaohongshu", "douyin"];

  for (const platform of platforms) {
    const strategy = await loadPlatformStrategy(platform);
    if (!strategy) {
      throw new Error(`Expected strategy for ${platform}`);
    }
  }

  const toutiao = await loadPlatformStrategy("toutiao");
  if (toutiao?.metadata.faqCount.min !== 0) {
    throw new Error("Expected toutiao faqCount.min to support optional FAQ with value 0");
  }

  console.log("content strategy assets ok");
})();
