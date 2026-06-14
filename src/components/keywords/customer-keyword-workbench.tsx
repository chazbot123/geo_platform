"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, RefreshCw, Save } from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
import { requireLicensedAction } from "@/lib/license/guard";
import type {
  CustomerKeywordCandidate,
  CustomerKeywordHeat,
  CustomerKeywordSet,
  SavedEnterpriseProfile,
} from "@/lib/keywords/service";

interface WorkbenchData {
  enterprise: SavedEnterpriseProfile | null;
  keywordSet: CustomerKeywordSet | null;
  canGenerate: boolean;
  canCreateTask: boolean;
}

const HEAT_LABELS: Record<CustomerKeywordHeat, string> = {
  high: "高热度",
  medium: "中热度",
  low: "低热度",
};

function formatTime(value?: string) {
  if (!value) return "未保存";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function emptyData(): WorkbenchData {
  return {
    enterprise: null,
    keywordSet: null,
    canGenerate: false,
    canCreateTask: false,
  };
}

export function CustomerKeywordWorkbench() {
  const router = useRouter();
  const [data, setData] = useState<WorkbenchData>(emptyData);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingStepIndex, setGeneratingStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const allCandidates = useMemo(
    () => (data.keywordSet ? Object.values(data.keywordSet.candidates).flat() : []),
    [data.keywordSet],
  );
  const generatingSteps = useMemo(() => {
    const productService = data.enterprise?.productService?.trim() || "产品/服务";
    const region = data.enterprise?.region?.trim() || "地区";
    return [
      `正在结合“${productService}”生成真实客户提问`,
      `正在适度参考“${region}”的地域场景`,
      "正在过滤占位化、营销化和不自然的问题",
      "正在整理高热度、中热度、低热度候选",
      "正在让问题更像客户会直接问 AI 的表达",
    ];
  }, [data.enterprise]);
  const currentGeneratingStep = generatingSteps[generatingStepIndex] ?? "正在生成客户关键词";
  const generatingProgress = Math.round(((generatingStepIndex + 1) / generatingSteps.length) * 100);
  const selectedCount = selectedIds.length;
  const hasExactSelection = selectedCount === 5;

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/keywords", { cache: "no-store" });
      const payload = (await response.json()) as WorkbenchData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "读取客户关键词失败。");
      setData(payload);
      setSelectedIds(payload.keywordSet?.selectedQuestions.map((item) => item.id) ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取客户关键词失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!generating) {
      setGeneratingStepIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setGeneratingStepIndex((current) => (current < generatingSteps.length - 1 ? current + 1 : current));
    }, 1400);

    return () => window.clearInterval(timer);
  }, [generating, generatingSteps.length]);

  function toggleCandidate(candidate: CustomerKeywordCandidate) {
    setMessage("");
    setError("");
    setSelectedIds((current) => {
      if (current.includes(candidate.id)) {
        return current.filter((id) => id !== candidate.id);
      }
      if (current.length >= 5) {
        setError("只能选择 5 个核心问题。");
        return current;
      }
      return [...current, candidate.id];
    });
  }

  async function generate() {
    const licenseGuard = await requireLicensedAction("generate_content");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setGenerating(true);
    setGeneratingStepIndex(0);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/keywords/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "customer" }),
      });
      const payload = (await response.json()) as { keywordSet?: CustomerKeywordSet; error?: string };
      if (!response.ok || !payload.keywordSet) throw new Error(payload.error || "生成客户关键词失败。");
      setData((current) => ({
        ...current,
        keywordSet: payload.keywordSet ?? null,
        canCreateTask: false,
      }));
      setSelectedIds([]);
      setMessage("已生成新的客户问题候选。");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "生成客户关键词失败。");
    } finally {
      setGenerating(false);
    }
  }

  async function saveSelection() {
    const licenseGuard = await requireLicensedAction("save_keywords");
    if (!licenseGuard.allowed) {
      setError(licenseGuard.message ?? "当前设备未授权，请先激活授权码。");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/keywords/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "customer", selectedIds }),
      });
      const payload = (await response.json()) as { keywordSet?: CustomerKeywordSet; canCreateTask?: boolean; error?: string };
      if (!response.ok || !payload.keywordSet) throw new Error(payload.error || "保存核心问题失败。");
      setData((current) => ({
        ...current,
        keywordSet: payload.keywordSet ?? null,
        canCreateTask: Boolean(payload.canCreateTask),
      }));
      setSelectedIds(payload.keywordSet.selectedQuestions.map((item) => item.id));
      setMessage("5 个核心问题已保存。");
      dispatchWorkflowStatusRefresh();
      router.push("/tasks/create");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存核心问题失败。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="section-card">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取企业信息和已保存问题
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Step 2</p>
            <h2 className="page-section-title mt-2">客户关键词</h2>
            <p className="page-section-desc mt-2">生成客户会在 AI 平台直接提出的问题，并保存 5 个核心问题。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={!data.canGenerate || generating}
              className="inline-flex items-center gap-2 rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              生成候选
            </button>
            <button
              type="button"
              onClick={saveSelection}
              disabled={!hasExactSelection || saving}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存 5 个问题
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="subtle-card">
            <p className="text-xs text-muted">企业信息</p>
            <p className="mt-2 text-sm font-medium text-ink">{data.enterprise ? data.enterprise.companyName : "未保存"}</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">已选择</p>
            <p className="mt-2 text-sm font-medium text-ink">{selectedCount}/5</p>
          </div>
          <div className="subtle-card">
            <p className="text-xs text-muted">最近保存</p>
            <p className="mt-2 text-sm font-medium text-ink">{formatTime(data.keywordSet?.savedAt)}</p>
          </div>
        </div>

        {!data.canGenerate ? (
          <div className="mt-5 rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-ink">
            请先在企业信息页保存公司名称、品牌简称、产品/服务和地区。
            <Link className="ml-2 font-medium text-accent" href="/enterprise">
              去填写
            </Link>
          </div>
        ) : null}

        {generating ? (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">正在调用文字模型生成客户关键词...</p>
                <p className="mt-1 text-sm text-accent transition-opacity duration-300">{currentGeneratingStep}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-accent">{generatingProgress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-accent/10">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
                style={{ width: `${generatingProgress}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {generatingSteps.map((step, index) => {
                const isActive = index === generatingStepIndex;
                const isCompleted = index < generatingStepIndex;
                return (
                  <span
                    key={step}
                    className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                      isActive
                        ? "bg-accent text-white"
                        : isCompleted
                          ? "bg-accent/15 text-accent"
                          : "bg-surface text-muted"
                    }`}
                  >
                    {index + 1}. {step.replace(/^正在/, "")}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
        {message ? <p className="mt-4 text-sm text-emerald-500">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {(["high", "medium", "low"] as CustomerKeywordHeat[]).map((heat) => {
          const candidates = data.keywordSet?.candidates[heat] ?? [];
          return (
            <div key={heat} className="section-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-ink">{HEAT_LABELS[heat]}</h3>
                </div>
                <span className="status-pill">{candidates.length || 0} 条</span>
              </div>
              <div className="mt-4 space-y-2">
                {candidates.length ? (
                  candidates.map((candidate) => {
                    const selected = selectedIds.includes(candidate.id);
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => toggleCandidate(candidate)}
                        className={`flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition ${
                          selected
                            ? "border-accent bg-accent/10 text-ink"
                            : "border-border bg-surface text-muted hover:border-border-strong hover:text-ink"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            selected ? "border-accent bg-accent text-white" : "border-border-strong"
                          }`}
                        >
                          {selected ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                        <span className="leading-6">{candidate.question}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
                    等待生成 10-15 个候选问题。
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="section-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">下一步</h3>
            <p className="mt-1 text-sm text-muted">保存 5 个核心问题后，才能进入创建任务。</p>
          </div>
          {data.canCreateTask ? (
            <Link
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
              href="/tasks/create"
            >
              创建任务
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted"
            >
              需先保存 5 个问题
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
