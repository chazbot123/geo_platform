import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO 桌面版",
  description: "GEO 桌面工作流",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}