"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";
import type { GeoAiScenario, GeoQuestionIntent, SearchProvider, TaskRecord, ThemeSet } from "@/lib/types";
import { formatTaskStatus } from "@/lib/utils";

const searchProviderLabels: Record<SearchProvider, string> = {
  doubao: "豆包",
  yuanbao: "元宝",
  tongyi: "通义千问",
  deepseek: "DeepSeek",
};

const aiScenarioLabels: Record<GeoAiScenario, string> = {
  doubao_plain_answer: "豆包直答",
  yuanbao_qa_chain: "元宝问答链",
  deepseek_logic: "DeepSeek 逻辑",
  tongyi_structured_summary: "通义结构化",
};

const intentLabels: Record<GeoQuestionIntent, string> = {
  selection_criteria: "选择标准",
  pitfall_avoidance: "避坑",
  price_logic: "价格",
  scenario_fit: "场景",
  comparison: "对比",
  local_service: "本地服务",
  faq_cluster: "追问",
  risk_boundary: "风险边界",
  process_solution: "流程",
  evidence_check: "证据核验",
};

export function KeywordWorkbench({ taskId, task, initialTheme }: { taskId: string; task: TaskRecord; initialTheme?: ThemeSet }) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeSet | undefined>(initialTheme);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>(initialTheme?.selectedKeywords ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const recommendedKeywords = useMemo(
    () =>
      theme?.recommendedKeywords?.length
        ? theme.recommendedKeywords
        : theme?.candidateKeywords?.length
          ? theme.candidateKeywords
          : [...(theme?.backupKeywords ?? []), ...(theme?.relatedKeywords ?? []), theme?.mainKeyword ?? ""].filter(Boolean).slice(0, 10),
    [theme],
  );
  const questionCandidates = useMemo(() => {
    const validIds = new Set(theme?.questionReview?.validQuestionIds ?? []);
    const candidates = theme?.questionCandidateSet?.questionCandidates ?? [];
    const visibleCandidates = validIds.size ? candidates.filter((candidate) => validIds.has(candidate.id)) : candidates;
    if (visibleCandidates.length) return visibleCandidates;
    return recommendedKeywords.map((question, index) => ({
      id: question,
      question,
      intent: "selection_criteria" as const,
      targetAiScenarios: [],
      contentAngle: "推荐提问句",
      userRole: "",
      regionUsage: "none" as const,
      commercialStage: "awareness" as const,
      mustAnswer: [],
      evidenceNeeded: [],
      riskNotes: [],
      generationRationale: "",
      scores: {
        userRealness: 0,
        commercialValue: 0,
        aiAnswerability: 0,
        platformExtensibility: 0,
        novelty: 0,
        riskControl: 0,
        total: 0,
      },
    }));
  }, [recommendedKeywords, theme]);

  function toggleKeyword(keyword: string) {
    setSelectedKeywords((current) => {
      if (current.includes(keyword)) {
        return current.filter((item) => item !== keyword);
      }
      if (current.length >= 5) {
        return current;
      }
      return [...current, keyword];
    });
  }

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
      if (!response.ok) throw new Error(payload.error ?? "生成提问句失败");
      setTheme(payload.theme);
      setSelectedKeywords(payload.theme.selectedKeywords ?? []);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "生成提问句失败";
      setError(
        message === "STAGE1_API_TIMEOUT"
          ? "AI 提问句生成超时，请稍后重试，或在设置页提高第一阶段模型超时时间。"
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!selectedKeywords.length) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/keywords/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, selectedKeywords }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "确认提问句失败");
      setTheme(payload.theme);
      router.push(`/content-strategy/${taskId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "确认提问句失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
      {/* Left Panel: Status & Actions */}
      <div className="rounded-[32px] border border-stroke bg-panel/80 p-8 shadow-panel backdrop-blur-xl h-fit">
        <div className="flex flex-col gap-6">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted">当前阶段</p>
            <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">AI 提问洞察</h3>
          </div>
          
          <div className="rounded-[20px] bg-surface/50 p-5">
            <p className="text-sm text-muted">任务状态</p>
            <p className="mt-1 font-display text-xl font-bold text-ink">{formatTaskStatus(task.status)}</p>
          </div>

          <button 
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-[20px] bg-accent px-6 py-4 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50 disabled:shadow-none" 
            onClick={generateKeywords} 
            disabled={loading}
          >
            {/* Button Shine Effect */}
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 ease-in-out group-hover:translate-x-full" />
            
            {loading ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            <span className="relative z-10">{theme ? "重新生成 AI 提问句" : "智能洞察 AI 用户提问句"}</span>
          </button>

          {error && (
            <div className="rounded-2xl border border-danger/20 bg-danger/10 p-4 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="mt-2 space-y-4 rounded-[20px] border border-dashed border-stroke p-5 text-sm leading-relaxed text-muted">
            <p className="flex items-start gap-2">
              <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
              当前检索平台：{task.searchProvider ? searchProviderLabels[task.searchProvider] : "未设置"}。本轮结果会结合产品、地区以及社媒与流媒体场景，直接整理 10 条 AI 用户提问句。
            </p>
            <p className="flex items-start gap-2">
              <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
              系统会直接输出 10 条可供挑选的提问句，覆盖认知、对比、顾虑、决策、场景和避坑等常见用户发问角度。
            </p>
            <p className="flex items-start gap-2">
              <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
              你可以从 10 条推荐提问句里最多选择 5 条，系统会把它们合并成一个提问主题，再进入第二阶段权威报告页面。
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel: Keywords Display & Selection */}
      <div className="space-y-6">
        {theme ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            <div className="group relative overflow-hidden rounded-[32px] border border-emerald-500/20 bg-emerald-500/5 p-8 shadow-panel backdrop-blur-xl transition-all hover:border-emerald-500/40">
              <div className="absolute -inset-px rounded-[32px] bg-gradient-to-b from-emerald-500/0 to-emerald-500/0 opacity-0 transition-opacity duration-300 group-hover:from-emerald-500/5 group-hover:opacity-100" />
              
              <div className="relative z-10">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">检索摘要</p>
                <h3 className="mt-4 font-display text-3xl font-bold tracking-tight text-white">
                  {task.searchProvider ? searchProviderLabels[task.searchProvider] : "检索平台"} AI 提问句生成摘要
                </h3>
                <div className="mt-6 rounded-2xl bg-surface/50 p-5">
                  <p className="text-sm leading-relaxed text-slate-300">{theme.scoreSummary}</p>
                </div>
                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">覆盖说明</p>
                  <p className="mt-3 text-sm leading-relaxed text-slate-200">{theme.rankingSummary}</p>
                </div>
                <div className="mt-4 rounded-2xl bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">示例提问句</p>
                  <p className="mt-2 text-sm text-slate-200">{questionCandidates.slice(0, 3).map((item) => item.question).join(" / ") || "--"}</p>
                </div>
                {theme.questionReview ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">有效问题</p>
                      <p className="mt-2 text-lg font-bold text-white">{theme.questionReview.validQuestionIds.length}</p>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">意图覆盖</p>
                      <p className="mt-2 text-lg font-bold text-white">{theme.questionReview.coverageReview.intentCount}</p>
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">质检状态</p>
                      <p className={`mt-2 text-lg font-bold ${theme.questionReview.passed ? "text-emerald-300" : "text-amber-300"}`}>
                        {theme.questionReview.passed ? "通过" : "需复核"}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[32px] border border-stroke bg-panel/50 p-8 shadow-panel backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted">10 条推荐提问句</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">从推荐提问句中最多选择 5 条，系统会按你的选择顺序合并成一个提问主题，供下一步生成权威报告文章。</p>
                </div>
                <div className="shrink-0 whitespace-nowrap rounded-full border border-stroke bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                  共 {questionCandidates.length} 个
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] bg-surface/50 p-4 text-sm text-muted">
                  已整理 AI 提问句：{questionCandidates.length} 条
                </div>
                <div className="rounded-[18px] bg-surface/50 p-4 text-sm text-muted">
                  已选择：{selectedKeywords.length} / 5
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {questionCandidates.map((candidate, index) => {
                  const item = candidate.question;
                  const checked = selectedKeywords.includes(item);
                  const disableSelect = !checked && selectedKeywords.length >= 5;
                  return (
                  <button
                    key={candidate.id || item}
                    className={`group relative flex items-center justify-between overflow-hidden rounded-[20px] border p-5 text-left transition-all duration-300 ${
                      checked
                        ? "border-accent bg-accent-muted/30 shadow-[0_0_20px_-5px_rgba(255,79,0,0.2)]" 
                        : "border-stroke bg-surface/50 hover:border-stroke-strong hover:bg-white/5"
                    }`}
                    onClick={() => toggleKeyword(item)}
                    disabled={disableSelect}
                  >
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">提问句 {String(index + 1).padStart(2, "0")}</p>
                      <span className={`mt-2 block font-display text-lg font-medium transition-colors ${
                        checked ? "text-accent" : "text-ink group-hover:text-white"
                      }`}>
                        {item}
                      </span>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-stroke bg-white/5 px-2.5 py-1 text-slate-300">
                          {intentLabels[candidate.intent]}
                        </span>
                        {candidate.targetAiScenarios.map((scenario) => (
                          <span key={scenario} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-200">
                            {aiScenarioLabels[scenario]}
                          </span>
                        ))}
                        {candidate.scores.total > 0 ? (
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">
                            {candidate.scores.total.toFixed(1)} 分
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {checked && (
                      <CheckCircle2 className="h-5 w-5 text-accent animate-in zoom-in" />
                    )}
                  </button>
                  );
                })}
              </div>
            </div>

            <button 
              className="flex w-full items-center justify-center gap-2 rounded-[24px] bg-ink px-6 py-5 text-base font-bold text-surface shadow-panel transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100" 
              onClick={confirm} 
              disabled={loading || !selectedKeywords.length}
            >
              <ArrowRight className="h-5 w-5" /> 
              {loading ? "正在保存..." : "确认提问主题，进入第二阶段权威报告页"}
            </button>
          </div>
        ) : (
          <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-[32px] border border-dashed border-stroke bg-panel/30 p-8 text-center backdrop-blur-xl">
            <div className="rounded-full bg-surface p-5 shadow-panel">
              <Sparkles className="h-8 w-8 text-muted" />
            </div>
            <h4 className="mt-6 font-display text-xl font-bold text-ink">等待 AI 提问句整理</h4>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              当前任务还没有生成专属的 AI 用户提问句。点击左侧按钮，引擎将直接为你整理 10 条推荐提问句。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
