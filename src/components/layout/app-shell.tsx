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
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1600px] gap-5 lg:grid-cols-[248px_minmax(0,1fr)] items-start">
        <aside className="glass-panel sticky top-4 rounded-xl p-3">
          <div className="mb-3 rounded-lg border border-stroke bg-surface/70 p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Local Active</p>
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">GEO Desktop</h1>
            <p className="mt-2 text-xs leading-relaxed text-muted">内容生成、账号管理和多平台发布控制台</p>
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
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    active 
                      ? "bg-accent-muted text-accent" 
                      : "text-muted hover:bg-surface hover:text-ink"
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-r-full border-l-2 border-accent" />
                  )}
                  <Icon className="h-4 w-4" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="glass-panel min-h-[calc(100vh-2rem)] rounded-xl p-5 lg:p-7">
          <header className="mb-6 flex flex-col gap-4 border-b border-stroke pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-4xl">
              <p className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                工作台
              </p>
              <h2 className="font-display text-3xl font-bold tracking-tight text-ink lg:text-4xl">{title}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>
            </div>
            <div className="status-pill shrink-0 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span>Local Mode</span>
              <span className="h-3 w-px bg-stroke-strong" />
              <span>v1.0.0-beta</span>
            </div>
          </header>
          <div className="animate-in fade-in duration-300 ease-out">{children}</div>
        </main>
      </div>
    </div>
  );
}
