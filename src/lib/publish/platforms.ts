import type { PublishPlatform, PublishingExecutionMode, SocialPlatform } from "@/lib/types";

export interface PlatformDescriptor {
  key: PublishPlatform;
  label: string;
  loginSupported: boolean;
  executionMode: PublishingExecutionMode;
  automationStatus: "ready" | "manual_only" | "planned";
  contentProfile: string;
  publishEntryUrl?: string;
  hint: string;
}

export const publishPlatformDescriptors: PlatformDescriptor[] = [
  {
    key: "toutiao",
    label: "今日头条",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    contentProfile: "长图文分析稿，标题强判断，段落短，适合图文混排。",
    publishEntryUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    hint: "当前优先通过 Electron 承接今日头条图文自动发布。",
  },
  {
    key: "baijiahao",
    label: "百家号",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    contentProfile: "知识解释型图文，结构接近头条但信息密度更高。",
    publishEntryUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    hint: "通过 Electron 承接百家号图文自动发布，沿用登录校验、内容填写和结果回录链路。",
  },
  {
    key: "douyin",
    label: "抖音",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    contentProfile: "短标题、短段落、口播或图文脚本，强调前三秒钩子。",
    publishEntryUrl: "https://creator.douyin.com/creator-micro/content/upload",
    hint: "通过 Electron 承接抖音创作者中心发布，首版按图文/文本内容自动填充并提交。",
  },
  {
    key: "wechat",
    label: "微信公众号",
    loginSupported: false,
    executionMode: "manual_delivery",
    automationStatus: "planned",
    contentProfile: "长文，逻辑完整，阅读连续性强，适合观点与案例拆解。",
    publishEntryUrl: "https://mp.weixin.qq.com/",
    hint: "计划接入微信公众号发布流程，当前先保留账号稿与手动发布能力。",
  },
  {
    key: "videohao",
    label: "视频号",
    loginSupported: false,
    executionMode: "manual_delivery",
    automationStatus: "planned",
    contentProfile: "短文案，节奏型表达，适合配合视频或图文动态。",
    publishEntryUrl: "https://channels.weixin.qq.com/",
    hint: "计划接入视频号发布流程，当前先保留账号稿与手动发布能力。",
  },
  {
    key: "zhihu",
    label: "知乎",
    loginSupported: false,
    executionMode: "manual_delivery",
    automationStatus: "planned",
    contentProfile: "问答体或分析回答体，强调判断依据和边界。",
    publishEntryUrl: "https://www.zhihu.com/",
    hint: "计划接入知乎回答或文章发布流程，当前先保留账号稿与手动发布能力。",
  },
  {
    key: "weibo",
    label: "微博",
    loginSupported: false,
    executionMode: "manual_delivery",
    automationStatus: "planned",
    contentProfile: "短观点，可拆条，强调传播性和轻量互动。",
    publishEntryUrl: "https://weibo.com/",
    hint: "计划接入微博发布流程，当前先保留账号稿与手动发布能力。",
  },
  {
    key: "csdn",
    label: "CSDN",
    loginSupported: false,
    executionMode: "manual_delivery",
    automationStatus: "planned",
    contentProfile: "经验、技术、方法论结构，适合清晰步骤和复盘。",
    publishEntryUrl: "https://editor.csdn.net/md/",
    hint: "计划接入 CSDN 文章发布流程，当前先保留账号稿与手动发布能力。",
  },
];

export function getPlatformDescriptor(platform: PublishPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}

export function getSocialPlatformDescriptor(platform: SocialPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}
