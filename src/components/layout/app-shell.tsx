"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileQuestion,
  FolderKanban,
  Moon,
  PenLine,
  Rocket,
  Settings,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";

const workflowItems = [
  { href: "/enterprise", label: "企业信息", icon: Building2 },
  { href: "/customer-keywords", label: "客户关键词", icon: FileQuestion },
  { href: "/tasks/create", label: "创建任务", icon: PenLine },
  { href: "/content-pool", label: "内容池", icon: FolderKanban },
  { href: "/publish-execution", label: "执行发布", icon: Rocket },
];

export function AppShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const activeIndex = workflowItems.findIndex((step) => pathname === step.href || pathname.startsWith(`${step.href}/`));

  useEffect(() => {
    const stored = window.localStorage.getItem("geo-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextTheme = stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";

    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.classList.toggle("light", nextTheme === "light");
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";

    setTheme(nextTheme);
    window.localStorage.setItem("geo-theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.classList.toggle("light", nextTheme === "light");
  }

  return (
    <div className="min-h-screen px-3 py-3 sm:px-5 lg:px-6">
      <div className="mx-auto grid max-w-[1680px] items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="glass-panel sticky top-3 rounded-lg p-3">
          <div className="border-b border-stroke px-2 pb-4">
            <div className="flex items-center justify-between gap-3">
              <Link href="/enterprise" className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-white">
                  GEO
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold tracking-tight text-ink">GEO Desktop</span>
                  <span className="block truncate text-xs text-muted">本地内容生产流程</span>
                </span>
              </Link>
              <span className="status-pill shrink-0">本地</span>
            </div>
          </div>

          <nav className="mt-4 space-y-1" aria-label="GEO 生产流程">
            {workflowItems.map((item, index) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (pathname === "/" && index === 0);
              const completed = activeIndex > index;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex min-h-12 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                    active ? "bg-accent-muted text-ink" : "text-muted hover:bg-panelSoft hover:text-ink"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                      active
                        ? "border-accent bg-accent text-white"
                        : "border-stroke bg-panel text-muted group-hover:border-stroke-strong"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] font-normal text-muted">步骤 {index + 1}</span>
                  </span>
                  {completed ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                  ) : active ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-accent" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0 text-muted/60" />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="mt-5 border-t border-stroke pt-3">
            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                pathname.startsWith("/settings") ? "bg-panelSoft text-ink" : "text-muted hover:bg-panelSoft hover:text-ink"
              )}
            >
              <Settings className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">设置</span>
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-muted transition-colors hover:bg-panelSoft hover:text-ink"
              aria-label="切换主题"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{theme === "dark" ? "浅色主题" : "深色主题"}</span>
            </button>
          </div>
        </aside>

        <main className="glass-panel min-h-[calc(100vh-1.5rem)] rounded-lg p-4 sm:p-5 lg:p-7">
          <header className="mb-6 flex flex-col gap-4 border-b border-stroke pb-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="mb-2 text-xs font-medium text-accent">GEO 生产流程</p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>
            </div>
            <div className="status-pill shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span>流程已切换</span>
              <span className="h-3 w-px bg-stroke-strong" />
              <span>五步工作流</span>
            </div>
          </header>
          <div className="animate-in fade-in duration-300 ease-out">{children}</div>
        </main>
      </div>
    </div>
  );
}
