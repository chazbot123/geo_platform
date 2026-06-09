"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, RefreshCw, Save } from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
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

const HEAT_DESC: Record<CustomerKeywordHeat, string> = {
  high: "优先覆盖高频选择、价格、避坑和本地服务问题。",
  medium: "补充场景、流程、交付和验证类问题。",
  low: "保留长尾问题，用于后续内容差异化。",
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
  const [data, setData] = useState<WorkbenchData>(emptyData);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const allCandidates = useMemo(
    () => (data.keywordSet ? Object.values(data.keywordSet.candidates).flat() : []),
    [data.keywordSet],
  );
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
    setGenerating(true);
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
            请先在企业信息页保存公司名称、品牌简称、产品服务和地区。
            <Link className="ml-2 font-medium text-accent" href="/enterprise">
              去填写
            </Link>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">{HEAT_LABELS[heat]}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted">{HEAT_DESC[heat]}</p>
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
