"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Sparkles, ChevronDown } from "lucide-react";

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
    try {
      const response = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, aiScenario, platform, contentAngle }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "内容生成失败");
      router.push(`/reports/${taskId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

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
