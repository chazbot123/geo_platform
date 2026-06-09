import type { StaticImageData } from "next/image";
import baijiahaoIcon from "@/img/百家号-nh.svg";
import csdnIcon from "@/img/csdn.svg";
import deepseekIcon from "@/img/deepseek.svg";
import doubaoIcon from "@/img/豆包.svg";
import douyinIcon from "@/img/抖音.svg";
import toutiaoIcon from "@/img/今日头条.svg";
import wechatIcon from "@/img/公众号.svg";
import weiboIcon from "@/img/微博.svg";
import xiaohongshuIcon from "@/img/小红书.svg";
import yuanbaoIcon from "@/img/腾讯元宝.svg";
import tongyiIcon from "@/img/通义千问.svg";
import videohaoIcon from "@/img/视频号.svg";
import zhihuIcon from "@/img/知乎.svg";
import type { SearchProvider, SocialPlatform } from "@/lib/types";

type IconSource = StaticImageData | string;

const providerIcons: Record<SearchProvider, IconSource> = {
  doubao: doubaoIcon,
  deepseek: deepseekIcon,
  yuanbao: yuanbaoIcon,
  tongyi: tongyiIcon,
};

const platformIcons: Record<SocialPlatform, IconSource> = {
  toutiao: toutiaoIcon,
  baijiahao: baijiahaoIcon,
  douyin: douyinIcon,
  xiaohongshu: xiaohongshuIcon,
  wechat: wechatIcon,
  videohao: videohaoIcon,
  zhihu: zhihuIcon,
  weibo: weiboIcon,
  csdn: csdnIcon,
};

function toIconUrl(icon: IconSource) {
  return typeof icon === "string" ? icon : icon.src;
}

export function getSearchProviderIcon(searchProvider: SearchProvider) {
  return toIconUrl(providerIcons[searchProvider]);
}

export function getSocialPlatformIcon(platform: SocialPlatform) {
  return toIconUrl(platformIcons[platform]);
}
