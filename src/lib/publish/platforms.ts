import type { PublishPlatform, PublishingExecutionMode, SocialPlatform } from "@/lib/types";

/**
 * Explicit route availability per platform, aligned with the brainstorm doc taxonomy.
 *
 * official_api_ready        – A public, documented write/publish API exists and can be used.
 * official_api_unavailable  – No confirmed public write API; automation or manual delivery required.
 * electron_ready            – Electron browser automation is the active route for this platform.
 * manual_required           – No automation is available; draft must be delivered manually.
 */
export type PlatformRouteAvailability =
  | "official_api_ready"
  | "official_api_unavailable"
  | "electron_ready"
  | "manual_required";

export interface PlatformDescriptor {
  key: PublishPlatform;
  label: string;
  loginSupported: boolean;
  executionMode: PublishingExecutionMode;
  automationStatus: "ready" | "manual_only" | "planned";
  routeAvailability: PlatformRouteAvailability;
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
    // No confirmed public article-publish API for Headline accounts; Electron is the active route.
    routeAvailability: "electron_ready",
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
    // No confirmed public article-publish API for Baijiahao; Electron automation is the active route.
    routeAvailability: "electron_ready",
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
    // Douyin is intentionally handled through Electron creator-center automation here.
    // New or low-trust accounts may still hit platform-side verification/risk controls.
    routeAvailability: "electron_ready",
    contentProfile: "短标题、短段落、口播或图文脚本，强调前三秒钩子。",
    publishEntryUrl: "https://creator.douyin.com/creator-micro/content/upload",
    hint: "通过 Electron 脚本承接抖音创作者中心发布，按图文/文本内容自动填充并提交；新号或低活跃账号容易触发验证/风控，建议使用成熟账号并保留人工验证兜底。",
  },
  {
    key: "xiaohongshu",
    label: "小红书",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    routeAvailability: "electron_ready",
    contentProfile: "搜索解答型种草笔记，围绕品牌名+产品名的真实问题写卖点、适用人群、场景和避坑，避免硬广口吻。",
    publishEntryUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
    hint: "通过 Electron 承接小红书创作者中心图文笔记发布，沿用已登录账号会话，自动填充搜索解答/种草向标题、正文、标签和配图；验证码、风控或发布确认会作为人工兜底返回。",
  },
  {
    key: "wechat",
    label: "微信公众号",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    routeAvailability: "electron_ready",
    contentProfile: "长文，逻辑完整，阅读连续性强，适合观点与案例拆解。",
    publishEntryUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10",
    hint: "通过 Electron 承接微信公众号图文发布，登录后在编辑器中自动填充内容并提交。",
  },
  {
    key: "videohao",
    label: "视频号",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    routeAvailability: "electron_ready",
    contentProfile: "短文案，节奏型表达，适合配合视频或图文动态。",
    publishEntryUrl: "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate",
    hint: "通过外置 Edge/CDP 视频号助手图文动态页上传素材、填充文案并提交；如平台强制要求扫码确认、审核或风控，会返回明确阻断阶段。",
  },
  {
    key: "zhihu",
    label: "知乎",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    routeAvailability: "electron_ready",
    contentProfile: "问答体或分析回答体，强调判断依据和边界。",
    publishEntryUrl: "https://zhuanlan.zhihu.com/write",
    hint: "通过 Electron 脚本进入知乎写作页自动填写标题、正文并提交；专栏选择、验证码或平台审核会作为自动化阻断返回。",
  },
  {
    key: "weibo",
    label: "微博",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    routeAvailability: "electron_ready",
    contentProfile: "短观点，可拆条，强调传播性和轻量互动。",
    publishEntryUrl: "https://passport.weibo.com/sso/signin?entry=miniblog&source=miniblog&disp=popup&url=https%3A%2F%2Fweibo.com%2Fnewlogin%3Ftabtype%3Dweibo%26gid%3D102803%26openLoginLayer%3D0%26url%3Dhttps%3A%2F%2Fweibo.com%2F&from=weibopro",
    hint: "通过 Electron 脚本进入微博发布框自动填写正文和话题并提交；验证码、安全验证或风控会作为自动化阻断返回。",
  },
  {
    key: "csdn",
    label: "CSDN",
    loginSupported: true,
    executionMode: "electron_automation",
    automationStatus: "ready",
    routeAvailability: "electron_ready",
    contentProfile: "经验、技术、方法论结构，适合清晰步骤和复盘。",
    publishEntryUrl: "https://editor.csdn.net/md/",
    hint: "通过 Electron 脚本进入 CSDN 编辑器自动填写标题、正文并提交；分类、验证码或审核阻断会返回稳定阶段。",
  },
];

export function getPlatformDescriptor(platform: PublishPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}

export function getSocialPlatformDescriptor(platform: SocialPlatform) {
  return publishPlatformDescriptors.find((item) => item.key === platform);
}
