import type { PublishPlatform, PublishingExecutionMode, SocialPlatform } from "@/lib/types";

export interface PlatformDescriptor {
  key: PublishPlatform;
  label: string;
  loginSupported: boolean;
  executionMode: PublishingExecutionMode;
  publishEntryUrl?: string;
  hint: string;
}

export const socialPlatformDescriptors: PlatformDescriptor[] = [
  {
    key: "xiaohongshu",
    label: "小红书",
    loginSupported: true,
    executionMode: "extension_automation",
    publishEntryUrl: "https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=image",
    hint: "当前优先通过浏览器扩展承接登录态与图文真发布。",
  },
  {
    key: "douyin",
    label: "抖音",
    loginSupported: true,
    executionMode: "extension_automation",
    publishEntryUrl: "https://creator.douyin.com/creator-micro/content/publish",
    hint: "当前优先通过浏览器扩展执行登录复用与图文发布。",
  },
  {
    key: "wechat_mp",
    label: "视频号",
    loginSupported: true,
    executionMode: "manual_delivery",
    publishEntryUrl: "https://channels.weixin.qq.com/platform/post/create",
    hint: "首版支持桌面登录窗和发布工作台，暂不做自动发稿。",
  },
  {
    key: "kuaishou",
    label: "快手",
    loginSupported: true,
    executionMode: "manual_delivery",
    publishEntryUrl: "https://cp.kuaishou.com/article/publish/video",
    hint: "已预留全量平台入口，首版默认走手动交付。",
  },
  {
    key: "bilibili",
    label: "哔哩哔哩",
    loginSupported: true,
    executionMode: "manual_delivery",
    publishEntryUrl: "https://member.bilibili.com/platform/upload/text/apply",
    hint: "已预留桌面账号管理与交付入口。",
  },
  {
    key: "wechat_official",
    label: "微信公众号",
    loginSupported: true,
    executionMode: "manual_delivery",
    publishEntryUrl: "https://mp.weixin.qq.com/",
    hint: "首版支持账号中心和手动交付，后续可继续接官方发布接口。",
  },
];

export const publishPlatformDescriptors: PlatformDescriptor[] = socialPlatformDescriptors;

export function getPlatformDescriptor(platform: PublishPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}

export function getSocialPlatformDescriptor(platform: SocialPlatform) {
  return socialPlatformDescriptors.find((item) => item.key === platform);
}
