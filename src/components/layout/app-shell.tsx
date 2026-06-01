﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileCode2, FileSearch, Rocket, Settings, ShieldCheck, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "创建任务", icon: FileCode2 },
  { href: "/keywords/demo", label: "关键词", icon: FileSearch },
  { href: "/accounts", label: "平台账号", icon: ShieldCheck },
  { href: "/publish", label: "发布工作台", icon: Rocket },
  { href: "/settings", label: "本地配置", icon: Settings },
];

export function AppShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="mx-auto grid max-w-[1400px] gap-8 lg:grid-cols-[280px_minmax(0,1fr)] items-start">
        <aside className="glass-panel rounded-3xl p-4 sticky top-8">
          <div className="mb-6 rounded-2xl border border-stroke-strong bg-surface/50 p-6 relative overflow-hidden group">
            <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-accent" />
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">System Active</p>
            </div>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">GEO<br/>Desktop</h1>
            <p className="mt-4 text-xs leading-relaxed text-muted font-mono">
              Local Publisher &<br/>Content Engine
            </p>
          </div>
          
          <nav className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href.replace("/demo", ""));
              return (
                <Link
                  key={item.href}
                  href={item.href === "/keywords/demo" ? "/" : item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-300 relative overflow-hidden",
                    active 
                      ? "text-accent bg-accent-muted" 
                      : "text-muted hover:text-ink hover:bg-surface"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-accent rounded-r-full shadow-glow" />
                  )}
                  <Icon className={cn("h-4 w-4 transition-transform duration-300", active ? "scale-110" : "group-hover:scale-110")} />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="glass-panel rounded-3xl p-6 lg:p-10 min-h-[calc(100vh-4rem)]">
          <header className="mb-10 flex flex-col gap-6 border-b border-stroke pb-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                执行控制台
              </p>
              <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-tight text-ink">{title}</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">{description}</p>
            </div>
            <div className="shrink-0 flex items-center gap-3 rounded-full border border-stroke-strong bg-surface/80 px-4 py-2 text-[11px] font-mono text-muted backdrop-blur-md">
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-accent" />Local Mode</span>
              <span className="w-px h-3 bg-stroke-strong" />
              <span>v1.0.0-beta</span>
            </div>
          </header>
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 ease-out">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
