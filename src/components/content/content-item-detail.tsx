"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ImageIcon } from "lucide-react";
import type { ContentPoolItem, ContentPoolRiskLevel, ContentPoolItemStatus } from "@/lib/types";

const statusLabels: Record<ContentPoolItemStatus, string> = {
  pending_generation: "待生成",
  generating: "生成中",
  ready: "已完成",
  sample: "已完成",
  pending_publish: "待发布",
  publishing: "发布中",
  published: "已发布",
  failed: "失败",
  manual_pending: "待处理",
};

const riskLabels: Record<ContentPoolRiskLevel, string> = {
  low: "低风险",
  medium: "需关注",
  high: "未通过",
};

interface DetailResponse {
  item?: ContentPoolItem;
  taskId?: string;
  error?: string;
}

type ItemAction = "rewrite" | "confirm_medium" | "disperse";

function formatDateTime(value?: string) {
  if (!value) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ContentItemDetail({ itemId }: { itemId: string }) {
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId") || "";
  const [item, setItem] = useState<ContentPoolItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingAction, setSubmittingAction] = useState<ItemAction | null>(null);

  async function loadDetail(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    setError("");
    try {
      const query = new URLSearchParams({ id: itemId });
      if (taskId) query.set("taskId", taskId);
      const response = await fetch(`/api/content/pool/item?${query.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as DetailResponse;
      if (!response.ok || !data.item) throw new Error(data.error || "读取文章详情失败。");
      setItem(data.item);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "读取文章详情失败。");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [itemId, taskId]);

  useEffect(() => {
    if (!item || (item.status !== "pending_generation" && item.status !== "generating")) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadDetail({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [item]);

  async function handleAction(action: ItemAction) {
    if (!item) {
      return;
    }
    setSubmittingAction(action);
    setError("");
    try {
      const response = await fetch("/api/content/pool/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: item.taskId,
          itemId: item.id,
          action,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "处理文章失败。");
      }
      await loadDetail({ silent: true });
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "处理文章失败。");
    } finally {
      setSubmittingAction(null);
    }
  }

  if (loading) {
    return <section className="section-card text-sm text-muted">正在读取文章详情。</section>;
  }

  if (!item) {
    return (
      <section className="section-card">
        <h2 className="page-section-title">文章不存在</h2>
        <p className="page-section-desc">{error || "没有找到对应的内容项。"}</p>
        <Link className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-white" href="/content-pool">
          返回生成结果中心
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <Link className="inline-flex items-center gap-2 text-sm font-medium text-muted transition hover:text-ink" href={`/content-pool${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`}>
        <ArrowLeft className="h-4 w-4" />
        返回生成结果中心
      </Link>

      <section className="section-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="status-pill">#{item.sequence}</span>
              <span className="status-pill">{statusLabels[item.status]}</span>
              <span className="status-pill">{riskLabels[item.riskLevel]}</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink">{item.title || "文章尚未生成完成"}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{item.summary || item.stageMessage || "系统尚未写入最终成稿。"}</p>
          </div>
          <div className="grid shrink-0 gap-1 text-sm text-muted lg:w-72">
            <span>账号：{item.accountName || item.accountId}</span>
            <span>关键词：{item.keywordText}</span>
            <span>计划发布时间：{formatDateTime(item.plannedPublishTime)}</span>
            <span>更新时间：{formatDateTime(item.updatedAt)}</span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="section-card">
          <h3 className="page-section-title">正文</h3>
          {item.body ? (
            <div className="mt-4 whitespace-pre-line text-sm leading-7 text-ink">{item.body}</div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted">{item.failedReason || item.stageMessage || "正文会在最终生成完成后显示。"}</p>
          )}
        </article>

        <aside className="space-y-5">
          <section className="section-card">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-accent" />
              <h3 className="page-section-title">图片</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">{item.imagePrompt || "暂无图片提示。"}</p>
            <p className="mt-3 text-xs text-muted">图片数量：{item.imageList.length}</p>
            {item.imageList.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {item.imageList.slice(0, 4).map((image) => (
                  <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-md border border-line bg-surface">
                    <img className="h-24 w-full object-cover" src={image.url} alt={image.prompt} />
                  </a>
                ))}
              </div>
            ) : null}
          </section>

          <section className="section-card">
            <h3 className="page-section-title">生成信息</h3>
            <div className="mt-3 space-y-2 text-sm text-muted">
              <p>当前状态：{statusLabels[item.status]}</p>
              <p>风险结果：{riskLabels[item.riskLevel]}</p>
              <p>发布准备：{item.publishable ? "可进入发布" : "暂不可发布"}</p>
              {item.failedReason ? <p className="text-red-500">失败原因：{item.failedReason}</p> : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(item.status === "failed" || item.riskLevel === "high") && (
                <button
                  type="button"
                  className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                  disabled={Boolean(submittingAction)}
                  onClick={() => void handleAction("rewrite")}
                >
                  {submittingAction === "rewrite" ? "处理中..." : "重新生成本篇"}
                </button>
              )}
              {item.riskLevel === "medium" && (
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-2 text-xs font-medium text-ink disabled:opacity-60"
                  disabled={Boolean(submittingAction)}
                  onClick={() => void handleAction("confirm_medium")}
                >
                  {submittingAction === "confirm_medium" ? "处理中..." : "继续完成处理"}
                </button>
              )}
              {item.status === "pending_publish" && (
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-2 text-xs font-medium text-ink disabled:opacity-60"
                  disabled={Boolean(submittingAction)}
                  onClick={() => void handleAction("disperse")}
                >
                  {submittingAction === "disperse" ? "处理中..." : "重新降低重复"}
                </button>
              )}
            </div>
          </section>

          <section className="section-card">
            <h3 className="page-section-title">后台处理记录</h3>
            <div className="mt-3 space-y-2 text-sm text-muted">
              {(item.stageLog ?? []).slice(-6).reverse().map((entry) => (
                <div key={`${entry.stage}-${entry.at}`} className="rounded-md border border-line bg-surface px-3 py-2">
                  <p className="text-xs text-muted">{formatDateTime(entry.at)}</p>
                  <p className="mt-1 text-sm text-ink">{entry.message}</p>
                </div>
              ))}
              {!item.stageLog?.length ? <p>暂时没有处理记录。</p> : null}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}
