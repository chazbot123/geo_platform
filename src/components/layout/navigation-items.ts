import { MessageSquare, RefreshCw, Settings, ShieldCheck } from "lucide-react";

export const settingsItems = [
  { href: "/device-authorization", label: "设备授权", icon: ShieldCheck },
  { href: "/settings", label: "模型设置", icon: Settings },
  { href: "/feedback", label: "意见反馈", icon: MessageSquare },
  { href: "/updates", label: "检查更新", icon: RefreshCw },
];
