"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles, ChevronDown, XCircle, AlertTriangle } from "lucide-react";
import type { ReviewResult } from "@/lib/content/review-service";

const AI_SCENARIOS = [
  { id: "doubao_plain_answer", label: "豆包 - 普通用户答疑" },
  { id: "deepseek_logic", label: "DeepSeek - 深度逻辑分析" },
  { id: "tongyi_structured_summary", label: "通义 - 结构化总结" },
  { id: "yuanbao_qa_chain", label: "元宝 - 高频问答链" },
  { id: "generic_ai_retrieval", label: "通用 GEO 检索" },
];

const PLATFORMS = [
  { id: "toutiao", label: "今日头条" },
  { id: "wechat", label: "微信公众号" },
  { id: "blog", label: "网站博客" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "douyin", label: "抖音" },
];

interface AngleItem {
  angleId: string;
  label: string;
  description: string;
  applicablePlatforms: string[];
  titleDirection: string;
}

export default function ContentStrategyPage({ params }: { params: { taskId: string } }) {
  const router = useRouter();
  const { taskId } = params;

  const [aiScenario, setAiScenario] = useState("doubao_plain_answer");
  const [platform, setPlatform] = useState("toutiao");
  const [contentAngle, setContentAngle] = useState("selection_criteria");
  const [angles, setAngles] = useState<AngleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);

  useEffect(() => {
    fetch("/api/content/angles")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.angles)) {
          setAngles(data.angles);
          if (data.angles.length > 0 && !data.angles.find((a: AngleItem) => a.angleId === contentAngle)) {
            setContentAngle(data.angles[0].angleId);
          }
        }
      })
      .catch(() => {});
  }, []);

  const filteredAngles = angles.filter(
    (a) => a.applicablePlatforms.includes(platform) || a.applicablePlatforms.length === 0,
  );

  async function handleGenerate() {
    setLoading(true);
    setError("");
    setReviewResult(null);
    try {
      const response = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, aiScenario, platform, contentAngle }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "内容生成失败");
      if (payload.reviewResult) {
        setReviewResult(payload.reviewResult as ReviewResult);
        if (payload.reviewResult.passed) {
          router.push(`/reports/${taskId}`);
        }
      } else {
        router.push(`/reports/${taskId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  const hasBlockingIssues = (reviewResult?.blockingIssues?.length ?? 0) > 0;
  const hasWarnings = (reviewResult?.warnings?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-[32px] border border-stroke bg-panel/80 p-8 shadow-panel backdrop-blur-xl">
        <div className="mb-8">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted">内容策略</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">选择生成策略</h1>
          <p className="mt-2 text-sm text-muted">选择 AI 场景、目标平台和内容角度，系统将按策略生成文章。</p>
        </div>

        <div className="flex flex-col gap-6">
          {/* AI 场景 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-ink">AI 检索场景</label>
            <div className="relative">
              <select
                value={aiScenario}
                onChange={(e) => setAiScenario(e.target.value)}
                className="w-full appearance-none rounded-[16px] border border-stroke bg-surface/50 px-4 py-3 pr-10 text-sm text-ink outline-none transition-colors focus:border-accent"
              >
                {AI_SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
          </div>

          {/* 目标平台 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-ink">目标发布平台</label>
            <div className="relative">
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="w-full appearance-none rounded-[16px] border border-stroke bg-surface/50 px-4 py-3 pr-10 text-sm text-ink outline-none transition-colors focus:border-accent"
              >
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
          </div>

          {/* 内容角度 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-ink">内容角度</label>
            <div className="relative">
              <select
                value={contentAngle}
                onChange={(e) => setContentAngle(e.target.value)}
                className="w-full appearance-none rounded-[16px] border border-stroke bg-surface/50 px-4 py-3 pr-10 text-sm text-ink outline-none transition-colors focus:border-accent"
              >
                {(filteredAngles.length > 0 ? filteredAngles : angles).map((a) => (
                  <option key={a.angleId} value={a.angleId}>{a.label} — {a.description}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="rounded-[12px] bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
          )}

          {/* 审核结果 */}
          {reviewResult && !reviewResult.passed && (
            <div className={`rounded-[20px] border p-5 ${hasBlockingIssues ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}`}>
              <div className="mb-4 flex items-center gap-2">
                {hasBlockingIssues
                  ? <XCircle className="h-5 w-5 text-danger" />
                  : <AlertTriangle className="h-5 w-5 text-warning" />}
                <span className="font-semibold text-sm text-ink">
                  {hasBlockingIssues ? "内容审核未通过，存在阻断问题" : "内容审核通过，但存在警告"}
                </span>
              </div>
              {reviewResult.blockingIssues.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {reviewResult.blockingIssues.map((issue, i) => (
                    <li key={i} className="rounded-[12px] border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-slate-200">
                      <span className="font-medium text-danger">[{issue.code}]</span> {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {reviewResult.warnings.length > 0 && (
                <ul className="space-y-2">
                  {reviewResult.warnings.map((issue, i) => (
                    <li key={i} className="rounded-[12px] border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-slate-300">
                      <span className="font-medium text-warning">[{issue.code}]</span> {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {reviewResult.scores && (
                <div className="mt-4 grid grid-cols-3 gap-3 rounded-[16px] border border-stroke bg-surface/50 p-3 text-center text-xs">
                  <div>
                    <p className="text-muted">平台适配</p>
                    <p className={`mt-1 font-bold text-base ${reviewResult.scores.platformFit >= 80 ? "text-emerald-400" : reviewResult.scores.platformFit >= 50 ? "text-warning" : "text-danger"}`}>
                      {reviewResult.scores.platformFit}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">合规度</p>
                    <p className={`mt-1 font-bold text-base ${reviewResult.scores.complianceFit >= 80 ? "text-emerald-400" : reviewResult.scores.complianceFit >= 50 ? "text-warning" : "text-danger"}`}>
                      {reviewResult.scores.complianceFit}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">问题覆盖</p>
                    <p className={`mt-1 font-bold text-base ${reviewResult.scores.questionCoverage >= 80 ? "text-emerald-400" : reviewResult.scores.questionCoverage >= 60 ? "text-warning" : "text-danger"}`}>
                      {reviewResult.scores.questionCoverage}%
                    </p>
                  </div>
                </div>
              )}
              {hasWarnings && !hasBlockingIssues && (
                <button
                  className="mt-4 w-full rounded-[16px] border border-stroke bg-surface/50 px-4 py-3 text-sm font-medium text-muted hover:text-ink transition-colors"
                  onClick={() => router.push(`/reports/${taskId}`)}
                >
                  忽略警告，继续查看报告 →
                </button>
              )}
              {hasBlockingIssues && (
                <p className="mt-3 text-xs text-muted">请修正上述阻断问题后重新生成，或调整生成策略后再试。</p>
              )}
            </div>
          )}

          {/* 生成按钮 */}
          <button
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-[20px] bg-accent px-6 py-4 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50 disabled:shadow-none"
            onClick={handleGenerate}
            disabled={loading}
          >
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 ease-in-out group-hover:translate-x-full" />
            {loading ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            <span className="relative z-10">{loading ? "正在生成..." : "按策略生成文章"}</span>
          </button>

          {/* 跳过按钮 */}
          <button
            className="text-sm text-muted hover:text-ink transition-colors"
            onClick={() => router.push(`/reports/${taskId}`)}
            disabled={loading}
          >
            跳过，使用默认策略 →
          </button>
        </div>
      </div>
    </div>
  );
}

