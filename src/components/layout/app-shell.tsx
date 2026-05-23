"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileCode2, FileSearch, GalleryVerticalEnd, Rocket, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "创建任务", icon: FileCode2 },
  { href: "/keywords/demo", label: "关键词", icon: FileSearch },
  { href: "/preview/demo", label: "内容预览", icon: GalleryVerticalEnd },
  { href: "/accounts", label: "平台账号", icon: ShieldCheck },
  { href: "/publish", label: "发布工作台", icon: Rocket },
  { href: "/settings", label: "本地配置", icon: Settings },
];

export function AppShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen px-6 py-6 text-ink">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="glass-panel rounded-[28px] p-5">
          <div className="mb-8 rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-accentSoft">GEO 桌面版</p>
            <h1 className="mt-3 font-display text-3xl text-white">本地发布工作流</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">面向 Windows 的 GEO 桌面测试版，支持关键词生成、内容撰写、图片生成、平台账号管理与社媒发布工作台。</p>
          </div>
          <nav className="space-y-2">
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href.replace("/demo", ""));
              return (
                <Link
                  key={item.href}
                  href={item.href === "/keywords/demo" || item.href === "/preview/demo" ? "/" : item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition",
                    active ? "bg-accent/15 text-white shadow-panel" : "bg-white/5 text-slate-300 hover:bg-white/10",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="glass-panel rounded-[32px] p-6 lg:p-8">
          <div className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-accentSoft">执行控制台</p>
              <h2 className="mt-3 font-display text-4xl text-white">{title}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
              单机模式  本地文件存储  社媒发布工作台
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
