import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "极EO | 读懂人群分布，精准把握流量",
  description: "GEO 桌面发布与内容生产工作流",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="font-body antialiased">{children}</body>
    </html>
  );
}
