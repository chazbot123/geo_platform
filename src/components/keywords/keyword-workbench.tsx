"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import type { TaskRecord, ThemeSet } from "@/lib/types";
import { formatTaskStatus } from "@/lib/utils";

export function KeywordWorkbench({ taskId, task, initialTheme }: { taskId: string; task: TaskRecord; initialTheme?: ThemeSet }) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeSet | undefined>(initialTheme);
  const [selectedKeyword, setSelectedKeyword] = useState(initialTheme?.selectedKeyword ?? initialTheme?.mainKeyword ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generateKeywords() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/keywords/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "生成关键词失败");
      setTheme(payload.theme);
      setSelectedKeyword(payload.theme.selectedKeyword ?? payload.theme.mainKeyword);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "生成关键词失败");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!selectedKeyword) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/keywords/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, selectedKeyword }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "确认关键词失败");
      setTheme(payload.theme);
      router.push(`/preview/${taskId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "确认关键词失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="label-base">任务状态</p>
            <h3 className="text-xl font-semibold text-white">{formatTaskStatus(task.status)}</h3>
          </div>
          <button className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-slate-950" onClick={generateKeywords} disabled={loading}>
            {loading ? <LoaderCircle className="inline h-4 w-4 animate-spin" /> : null} 生成关键词
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        <div className="mt-6 space-y-3 text-sm text-slate-300">
          <p>系统会返回 1 个主冷门词、备选词以及 5 个相关关键词。</p>
          <p>确认最终主题后，再进入内容与图片生成阶段。</p>
        </div>
      </div>

      <div className="space-y-4">
        {theme ? (
          <>
            <div className="rounded-[28px] border border-emerald-300/15 bg-emerald-300/10 p-6">
              <p className="label-base">主关键词</p>
              <div className="mt-2 flex items-center justify-between gap-4">
                <h3 className="text-2xl font-semibold text-white">{theme.mainKeyword}</h3>
                <button className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white" onClick={() => setSelectedKeyword(theme.mainKeyword)}>
                  设为当前主题
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-200">{theme.scoreSummary}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[...theme.backupKeywords, ...theme.relatedKeywords].map((item) => (
                <button
                  key={item}
                  className={`rounded-[24px] border p-4 text-left transition ${selectedKeyword === item ? "border-accent bg-accent/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                  onClick={() => setSelectedKeyword(item)}
                >
                  <p className="text-sm text-white">{item}</p>
                </button>
              ))}
            </div>
            <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 text-sm font-semibold text-slate-950" onClick={confirm} disabled={loading || !selectedKeyword}>
              <CheckCircle2 className="h-4 w-4" /> 确认主题并继续
            </button>
          </>
        ) : (
          <div className="rounded-[28px] border border-dashed border-white/15 bg-white/5 p-6 text-sm text-slate-300">当前还没有关键词结果，请先点击左侧按钮开始生成。</div>
        )}
      </div>
    </div>
  );
}
