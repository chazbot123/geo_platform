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
  Sun,
} from "lucide-react";
import { settingsItems } from "@/components/layout/navigation-items";
import { cn } from "@/lib/utils";
import type { WorkflowStatus, WorkflowStepKey } from "@/lib/workflow/status-service";

const workflowItems = [
  { key: "enterprise", href: "/enterprise", label: "企业信息", icon: Building2 },
  { key: "customerKeywords", href: "/customer-keywords", label: "客户关键词", icon: FileQuestion },
  { key: "taskCreate", href: "/tasks/create", label: "创建任务", icon: PenLine },
  { key: "contentPool", href: "/content-pool", label: "生成结果", icon: FolderKanban },
  { key: "publishExecution", href: "/publish-execution", label: "执行发布", icon: Rocket },
] satisfies Array<{ key: WorkflowStepKey; href: string; label: string; icon: typeof Building2 }>;

const emptyWorkflowStatus: WorkflowStatus = {
  updatedAt: "",
  steps: {
    enterprise: { key: "enterprise", completed: false, reason: "正在读取工作流状态。" },
    customerKeywords: { key: "customerKeywords", completed: false, reason: "正在读取工作流状态。" },
    taskCreate: { key: "taskCreate", completed: false, reason: "正在读取工作流状态。" },
    contentPool: { key: "contentPool", completed: false, reason: "正在读取工作流状态。" },
    publishExecution: { key: "publishExecution", completed: false, reason: "正在读取工作流状态。" },
  },
};

async function fetchWorkflowStatus(signal?: AbortSignal) {
  const response = await fetch("/api/workflow/status", { cache: "no-store", signal });
  const data = (await response.json()) as WorkflowStatus & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "读取工作流状态失败。");
  }
  return data;
}

export function dispatchWorkflowStatusRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("geo-workflow-status-refresh"));
}

export function AppShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>(emptyWorkflowStatus);

  useEffect(() => {
    const stored = window.localStorage.getItem("geo-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextTheme = stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";

    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    document.documentElement.classList.toggle("light", nextTheme === "light");
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function refreshStatus() {
      try {
        setWorkflowStatus(await fetchWorkflowStatus(controller.signal));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    void refreshStatus();
    window.addEventListener("geo-workflow-status-refresh", refreshStatus);
    return () => {
      controller.abort();
      window.removeEventListener("geo-workflow-status-refresh", refreshStatus);
    };
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
            <div className="flex items-center gap-3">
              <Link href="/enterprise" className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold text-white">
                  极EO
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold tracking-tight text-ink">极EO</span>
                  <span className="block text-xs text-muted">读懂人群分布，精准把握流量</span>
                </span>
              </Link>
            </div>
          </div>

          <nav className="mt-4 space-y-1" aria-label="GEO 生产流程">
            {workflowItems.map((item, index) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (pathname === "/" && index === 0);
              const completed = workflowStatus.steps[item.key]?.completed ?? false;

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
                      active ? "border-accent bg-accent text-white" : "border-stroke bg-panel text-muted group-hover:border-stroke-strong"
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
            <nav className="space-y-1" aria-label="系统设置">
              {settingsItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "bg-panelSoft text-ink" : "text-muted hover:bg-panelSoft hover:text-ink"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

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
          <header className="mb-6 border-b border-stroke pb-5">
            <p className="mb-2 text-xs font-medium text-accent">GEO 生产流程</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>
          </header>
          <div className="animate-in fade-in duration-300 ease-out">{children}</div>
        </main>
      </div>
    </div>
  );
}
