"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, FileText, Image as ImageIcon, LoaderCircle, Save, ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import type { ContentDraft, ImageAsset, ReviewResult, TaskBundle } from "@/lib/types";
import type { ReviewResult as ContentReviewResult } from "@/lib/content/review-service";
import { reviewDraft } from "@/lib/review/service";
import { DEFAULT_EXPECTED_IMAGE_COUNT } from "@/lib/tasks/constants";

const MIN_IMAGE_COUNT = 1;
const MAX_IMAGE_COUNT = 10;

interface ReportBlock {
  id: string;
  heading: string;
  body: string;
  paragraphIndex: number;
  question?: string;
  summary?: string;
}

type ImageAssetState =
  | { status: "ready"; count: number; hasLegacyCoverOnly: boolean }
  | { status: "incomplete_images"; count: number; hasLegacyCoverOnly: boolean }
  | { status: "missing_images"; count: number; hasLegacyCoverOnly: boolean };

function getRenderableImages(image?: ImageAsset) {
  return image?.images ?? [];
}

function getImageAssetState(image?: ImageAsset): ImageAssetState {
  const imageItems = image?.images ?? [];
  const hasLegacyCoverOnly = Boolean(image?.url && imageItems.length === 0);
  if (imageItems.length > 0) {
    return {
      status: "ready" as const,
      count: imageItems.length,
      hasLegacyCoverOnly,
    };
  }
  if (hasLegacyCoverOnly) {
    return {
      status: "incomplete_images" as const,
      count: imageItems.length || 1,
      hasLegacyCoverOnly,
    };
  }
  return {
    status: "missing_images" as const,
    count: 0,
    hasLegacyCoverOnly: false,
  };
}

function hasReferenceInputs(bundle: TaskBundle) {
  return Boolean(bundle.product.productImagePath?.trim() || bundle.product.brandImagePath?.trim());
}

function getReferenceModeLabel(imageItems: ReturnType<typeof getRenderableImages>) {
  if (!imageItems.length) {
    return "";
  }
  return imageItems.some((item) => item.referenceMode === "reference_enhanced")
    ? "参考图增强生成（OpenAI 兼容图生图）"
    : "仅文章语义生成（OpenAI 兼容文生图）";
}

function splitContentParagraphs(content?: string) {
  if (!content?.trim()) {
    return [] as string[];
  }

  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildReportBlocks(content?: ContentDraft): ReportBlock[] {
  if (!content) {
    return [] as ReportBlock[];
  }

  if (content.reportSections?.length) {
    const blocks: ReportBlock[] = [];
    if (content.summary?.trim()) {
      blocks.push({ id: "summary", heading: "报告摘要", body: content.summary.trim(), paragraphIndex: 0 });
    }
    if (content.reportIntroduction?.trim()) {
      blocks.push({ id: "introduction", heading: "报告引言", body: content.reportIntroduction.trim(), paragraphIndex: 1 });
    }
    content.reportSections.forEach((section, index) => {
      blocks.push({
        id: `section-${index}`,
        heading: section.heading,
        body: section.body,
        question: section.question,
        summary: section.summary,
        paragraphIndex: 2 + index,
      });
    });
    if (content.reportConclusion?.trim()) {
      blocks.push({
        id: "conclusion",
        heading: "报告结论",
        body: content.reportConclusion.trim(),
        paragraphIndex: 2 + content.reportSections.length,
      });
    }
    if (content.cta?.trim()) {
      blocks.push({
        id: "cta",
        heading: "行动建议",
        body: content.cta.trim(),
        paragraphIndex: 3 + (content.reportSections?.length ?? 0),
      });
    }
    return blocks;
  }

  return splitContentParagraphs(content.content).map((paragraph, index): ReportBlock => ({
    id: `paragraph-${index}`,
    heading: paragraph.startsWith("## ") ? paragraph.replace(/^##\s*/, "") : `正文段落 ${index + 1}`,
    body: paragraph.replace(/^##\s*[^\n]+\n?/u, "").trim() || paragraph,
    paragraphIndex: index,
  }));
}

function renderParagraph(paragraph: string) {
  if (paragraph.startsWith("## ")) {
    return <h4 className="font-display text-xl font-bold text-ink">{paragraph.replace(/^##\s*/, "")}</h4>;
  }
  if (paragraph.startsWith("# ")) {
    return <h3 className="font-display text-2xl font-bold text-ink">{paragraph.replace(/^#\s*/, "")}</h3>;
  }
  return <p className="text-base leading-8 text-slate-200 whitespace-pre-wrap">{paragraph}</p>;
}

export function ReportWorkbench({
  bundle,
  review,
}: {
  bundle: TaskBundle;
  review: ReviewResult;
}) {
  const [content, setContent] = useState(bundle.content);
  const [image, setImage] = useState(bundle.image);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(() => {
    const initialImageState = getImageAssetState(bundle.image);
    if (initialImageState.status === "ready") return 3;
    if (bundle.content) return 2;
    return 1;
  });
  const [reviewResult, setReviewResult] = useState<ContentReviewResult | null>(null);
  const [expectedImageCount, setExpectedImageCount] = useState(bundle.task.expectedImageCount ?? DEFAULT_EXPECTED_IMAGE_COUNT);

  const imageItems = useMemo(() => getRenderableImages(image), [image]);
  const imageAssetState = useMemo(() => getImageAssetState(image), [image]);
  const reportBlocks = useMemo(() => buildReportBlocks(content), [content]);
  const liveReview = useMemo(
    () => reviewDraft(content, image, image?.images?.length || expectedImageCount),
    [content, image, expectedImageCount],
  );
  const hasWarnings = liveReview.contentWarnings.length > 0 || liveReview.imageWarnings.length > 0;
  const hasReferenceAssets = hasReferenceInputs(bundle);
  const generatedModeLabel = useMemo(() => getReferenceModeLabel(imageItems), [imageItems]);
  const generatedImageCount = imageItems.filter((item) => item.reviewStatus !== "failed").length;
  const failedImageCount = imageItems.filter((item) => item.reviewStatus === "failed").length;
  const generatedImages = imageItems.filter((item) => item.reviewStatus !== "failed");
  const failedImages = imageItems.filter((item) => item.reviewStatus === "failed");

  async function generate(target: "content" | "image") {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const endpoint = target === "image" ? "/api/images/generate" : `/api/${target}/generate`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === "image" ? { taskId: bundle.task.id, imageCount: expectedImageCount } : { taskId: bundle.task.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `${target === "content" ? "内容" : "图片"}生成失败`);
      }
      if (target === "content") {
        setContent(payload.content);
        if (payload.reviewResult) {
          setReviewResult(payload.reviewResult);
        }
        setMessage("权威报告已生成。");
      } else {
        setImage(payload.image);
        setMessage(
          hasReferenceAssets
            ? `已结合参考图与文章内容生成 ${expectedImageCount} 张文章配图。`
            : `已根据文章内容生成 ${expectedImageCount} 张文章配图。`,
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveEditsAndContinue() {
    if (!content) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/content/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: bundle.task.id,
          title: content.title,
          summary: content.summary,
          cta: content.cta,
          content: content.content,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "保存失败");
      setContent(payload.content);
      setMessage("");
      setActiveStep(2);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel transition-all duration-300 ${activeStep === 1 ? "bg-panel/80 backdrop-blur-xl" : "bg-panel/40"}`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="label-base">Step 1</p>
              <h2 className="font-display text-2xl font-bold text-ink">权威报告文案生成</h2>
            </div>
            {activeStep > 1 && (
              <button onClick={() => setActiveStep(1)} className="text-sm font-medium text-accent hover:text-accent-soft transition-colors">
                重新编辑
              </button>
            )}
          </div>

          {activeStep === 1 ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="space-y-3 rounded-[24px] bg-surface/50 p-5 text-sm leading-7 text-muted">
                <p>已确认提问句：{bundle.theme?.selectedKeywords?.join("、") ?? "--"}</p>
                <p>提问主题：{bundle.theme?.selectedKeywordTheme ?? "--"}</p>
                <p>产品名称：{bundle.product.productName}</p>
                <p>产品品类：{bundle.product.category}</p>
              </div>

              <div className="flex flex-wrap gap-4">
                <button
                  className="flex items-center justify-center gap-2 rounded-[20px] bg-accent px-6 py-3.5 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50"
                  disabled={loading}
                  onClick={() => generate("content")}
                >
                  {loading && activeStep === 1 ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {content ? "重新生成权威报告" : "生成权威报告"}
                </button>
              </div>

              {error && activeStep === 1 ? <p className="text-sm text-danger">{error}</p> : null}
              {message && activeStep === 1 ? <p className="text-sm text-emerald-400">{message}</p> : null}

              {content ? (
                <div className="mt-8 space-y-5 rounded-[24px] border border-stroke bg-panel/50 p-6">
                  <h3 className="mb-4 font-display text-xl font-bold text-ink">报告编辑区</h3>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">标题</label>
                    <input className="input-base w-full font-display text-lg font-bold" value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">摘要</label>
                    <textarea className="input-base w-full min-h-[120px] resize-y leading-relaxed" value={content.summary} onChange={(event) => setContent({ ...content, summary: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">正文</label>
                    <textarea className="input-base w-full min-h-[360px] resize-y leading-relaxed" value={content.content} onChange={(event) => setContent({ ...content, content: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">行动建议</label>
                    <input className="input-base w-full" value={content.cta} onChange={(event) => setContent({ ...content, cta: event.target.value })} />
                  </div>
                  <div className="flex justify-end pt-4">
                    <button
                      className="flex items-center justify-center gap-2 rounded-[20px] bg-ink px-8 py-3.5 text-sm font-bold text-surface transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98] disabled:opacity-50"
                      disabled={loading}
                      onClick={saveEditsAndContinue}
                    >
                      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      保存并确认文案，进入下一步
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[16px] bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              文案已确认
            </div>
          )}
        </div>

        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel transition-all duration-300 ${activeStep === 2 ? "bg-panel/80 backdrop-blur-xl" : "bg-panel/40"} ${activeStep < 2 ? "pointer-events-none opacity-50 grayscale" : ""}`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="label-base">Step 2</p>
              <h2 className="font-display text-2xl font-bold text-ink">文章配图生成（可选）</h2>
            </div>
            {activeStep > 2 && (
              <button onClick={() => setActiveStep(2)} className="text-sm font-medium text-accent hover:text-accent-soft transition-colors">
                重新配置
              </button>
            )}
          </div>

          {activeStep === 2 ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className={`rounded-[24px] border p-4 text-sm leading-7 ${hasReferenceAssets ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-stroke bg-surface/40 text-slate-300"}`}>
                {hasReferenceAssets
                  ? `已检测到参考图输入。当前 GPT 图片链路会自动走 OpenAI 兼容图生图编辑接口，结合参考图与当前权威报告章节语义，生成 ${expectedImageCount} 张文章配图。`
                  : `当前未检测到参考图输入。当前 GPT 图片链路会走 OpenAI 兼容文生图接口，仅根据当前权威报告章节语义生成 ${expectedImageCount} 张文章配图。`}
              </div>

              <label className="block max-w-xs space-y-2">
                <span className="text-xs font-medium text-muted uppercase tracking-wider">本次图片数量</span>
                <input
                  className="input-base w-full"
                  type="number"
                  min={MIN_IMAGE_COUNT}
                  max={MAX_IMAGE_COUNT}
                  value={expectedImageCount}
                  onChange={(event) => {
                    const nextValue = Number.parseInt(event.target.value || String(DEFAULT_EXPECTED_IMAGE_COUNT), 10);
                    setExpectedImageCount(Math.max(MIN_IMAGE_COUNT, Math.min(MAX_IMAGE_COUNT, Number.isFinite(nextValue) ? nextValue : DEFAULT_EXPECTED_IMAGE_COUNT)));
                  }}
                />
                <p className="text-xs text-muted">支持 1-10 张。当前任务后续重新生成会优先沿用这个数量。</p>
              </label>

              <div className="flex flex-wrap gap-4">
                <button
                  className="flex items-center justify-center gap-2 rounded-[20px] bg-accent px-6 py-3.5 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50"
                  disabled={loading || !content}
                  onClick={() => generate("image")}
                >
                  {loading && activeStep === 2 ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  {imageAssetState.status === "ready" ? `重新生成 ${expectedImageCount} 张文章配图` : `生成 ${expectedImageCount} 张文章配图`}
                </button>
              </div>

              {error && activeStep === 2 ? <p className="text-sm text-danger">{error}</p> : null}
              {message && activeStep === 2 ? <p className="text-sm text-emerald-400">{message}</p> : null}

              {imageAssetState.status === "ready" ? (
                <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-7 text-emerald-300">
                  当前成功生成 {generatedImageCount} 张文章配图。{failedImageCount ? `另有 ${failedImageCount} 张失败待处理。` : ""}{generatedModeLabel ? `本次模式：${generatedModeLabel}。` : ""}
                </div>
              ) : imageAssetState.status === "incomplete_images" ? (
                <div className="rounded-[24px] border border-warning/30 bg-warning/5 p-4 text-sm leading-7 text-slate-200">
                  {imageAssetState.hasLegacyCoverOnly
                    ? "检测到历史旧图片资产，仅有 legacy 单图，当前不再视为本轮配图已完成。请按新的数量要求重新生成。"
                    : `当前正式图片资产仅有 ${imageAssetState.count} 张，可按需要重新生成或直接进入后续处理。`}
                </div>
              ) : null}

              {failedImages.length ? (
                <div className="rounded-[24px] border border-danger/20 bg-danger/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-danger">失败图片</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {failedImages.slice(0, 4).map((item) => (
                      <div key={item.id} className="rounded-[20px] border border-danger/20 bg-surface p-3 text-xs text-muted">
                        <p className="font-medium text-ink">{item.sectionHeading || item.placement.caption || item.alt}</p>
                        <p className="mt-1 text-danger">生成失败，需单独补生成</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-4 pt-4">
                <button
                  className="flex items-center justify-center gap-2 rounded-[20px] border border-stroke bg-surface px-6 py-3.5 text-sm font-bold text-ink transition-colors hover:border-stroke-strong hover:bg-white/5 disabled:opacity-50"
                  disabled={loading}
                  onClick={() => setActiveStep(3)}
                >
                  跳过配图，仅使用纯文本
                </button>
                <button
                  className="flex items-center justify-center gap-2 rounded-[20px] bg-ink px-8 py-3.5 text-sm font-bold text-surface transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98] disabled:opacity-50"
                  disabled={loading || imageAssetState.status !== "ready"}
                  onClick={() => setActiveStep(3)}
                >
                  配图确认无误，进入排版预览
                </button>
              </div>
            </div>
          ) : activeStep > 2 ? (
            <div className="flex items-center gap-2 rounded-[16px] bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              {imageAssetState.status === "ready" ? `已确认 ${imageAssetState.count} 张配图` : "已确认纯文本模式"}
            </div>
          ) : null}
        </div>

        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel transition-all duration-300 ${activeStep >= 3 ? "bg-panel/80 backdrop-blur-xl" : "bg-panel/40 opacity-50 grayscale pointer-events-none"}`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="label-base">Step 3</p>
              <h2 className="font-display text-2xl font-bold text-ink">图文排版预览</h2>
            </div>
            {activeStep === 4 && <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">报告已就绪</span>}
          </div>

          {activeStep >= 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
              {content ? (
                <div className="space-y-5">
                  {reportBlocks.map((block) => {
                    const matchedImages = imageItems.filter(
                      (item) => item.placement.paragraphIndex === block.paragraphIndex || item.sectionHeading === block.heading,
                    );
                    return (
                      <div key={block.id} className="space-y-4">
                        <div className="space-y-3 rounded-[24px] border border-stroke bg-panel/50 p-5">
                          <h4 className="font-display text-xl font-bold text-ink">{block.heading}</h4>
                          {block.question ? <p className="text-sm font-medium text-accent-soft">对应提问句：{block.question}</p> : null}
                          {block.summary ? <p className="rounded-2xl border border-stroke bg-surface/40 p-4 text-sm leading-7 text-slate-300">{block.summary}</p> : null}
                          {renderParagraph(block.body)}
                        </div>
                        {matchedImages.map((item) => (
                          <figure key={item.id} className="overflow-hidden rounded-[24px] border border-stroke bg-panel/60">
                            <img src={item.publicUrl ?? item.url} alt={item.alt} className="h-auto w-full object-cover" />
                            <figcaption className="px-4 py-3 text-xs text-muted">
                              {item.sectionHeading ? `${item.sectionHeading} · ` : ""}
                              {item.placement.caption || item.alt}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {activeStep === 3 && (
                <div className="flex justify-end pt-6">
                  <button
                    className="flex items-center justify-center gap-2 rounded-[20px] bg-emerald-500 px-8 py-3.5 text-sm font-bold text-white transition-all hover:scale-[1.02] hover:bg-emerald-400 active:scale-[0.98]"
                    onClick={() => setActiveStep(4)}
                  >
                    确认排版无误，准备发布
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className={`rounded-[32px] border ${hasWarnings ? "border-warning/30 bg-warning/5" : "border-emerald-500/20 bg-emerald-500/5"} p-8 shadow-panel backdrop-blur-xl`}>
          <div className="mb-6 flex items-center gap-3">
            {hasWarnings ? <AlertTriangle className="h-6 w-6 text-warning" /> : <ShieldCheck className="h-6 w-6 text-emerald-400" />}
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">质量巡检</h2>
          </div>
          <ul className="space-y-3">
            {liveReview.contentWarnings.map((item, i) => (
              <li key={`c-${i}`} className="flex items-start gap-3 rounded-[16px] bg-surface/50 p-4 text-sm leading-relaxed text-slate-300">
                <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning"></span>
                {item}
              </li>
            ))}
            {liveReview.imageWarnings.map((item, i) => (
              <li key={`i-${i}`} className="flex items-start gap-3 rounded-[16px] bg-surface/50 p-4 text-sm leading-relaxed text-slate-300">
                <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning"></span>
                {item}
              </li>
            ))}
            {!hasWarnings && (
              <li className="flex items-center gap-3 rounded-[16px] bg-surface/50 p-4 text-sm font-medium text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
                当前报告与图片各项指标良好。
              </li>
            )}
          </ul>
        </div>

        {reviewResult && (reviewResult.blockingIssues.length > 0 || reviewResult.warnings.length > 0) && (
          <div className={`rounded-[32px] border p-8 shadow-panel backdrop-blur-xl ${reviewResult.blockingIssues.length > 0 ? "border-danger/30 bg-danger/5" : "border-warning/30 bg-warning/5"}`}>
            <div className="mb-6 flex items-center gap-3">
              <XCircle className={`h-6 w-6 ${reviewResult.blockingIssues.length > 0 ? "text-danger" : "text-warning"}`} />
              <h2 className="font-display text-xl font-bold tracking-tight text-ink">内容策略审核</h2>
            </div>
            {reviewResult.blockingIssues.length > 0 && (
              <div className="mb-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-danger">阻断问题（{reviewResult.blockingIssues.length}）</p>
                <ul className="space-y-2">
                  {reviewResult.blockingIssues.map((issue, i) => (
                    <li key={`b-${i}`} className="rounded-[14px] border border-danger/20 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-slate-200">
                      <span className="font-medium text-danger">[{issue.code}]</span> {issue.message}
                      {issue.evidence ? <span className="ml-2 font-mono text-xs text-muted">「{issue.evidence}」</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reviewResult.warnings.length > 0 && (
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-warning">警告（{reviewResult.warnings.length}）</p>
                <ul className="space-y-2">
                  {reviewResult.warnings.map((issue, i) => (
                    <li key={`w-${i}`} className="rounded-[14px] border border-warning/20 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-slate-300">
                      <span className="font-medium text-warning">[{issue.code}]</span> {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 grid grid-cols-3 gap-3 rounded-[16px] border border-stroke bg-surface/50 p-4 text-center text-xs">
              <div>
                <p className="text-muted">平台适配</p>
                <p className={`mt-1 text-lg font-bold ${reviewResult.scores.platformFit >= 80 ? "text-emerald-400" : reviewResult.scores.platformFit >= 50 ? "text-warning" : "text-danger"}`}>
                  {reviewResult.scores.platformFit}
                </p>
              </div>
              <div>
                <p className="text-muted">合规度</p>
                <p className={`mt-1 text-lg font-bold ${reviewResult.scores.complianceFit >= 80 ? "text-emerald-400" : reviewResult.scores.complianceFit >= 50 ? "text-warning" : "text-danger"}`}>
                  {reviewResult.scores.complianceFit}
                </p>
              </div>
              <div>
                <p className="text-muted">问题覆盖</p>
                <p className={`mt-1 text-lg font-bold ${reviewResult.scores.questionCoverage >= 80 ? "text-emerald-400" : reviewResult.scores.questionCoverage >= 60 ? "text-warning" : "text-danger"}`}>
                  {reviewResult.scores.questionCoverage}%
                </p>
              </div>
            </div>
          </div>
        )}

        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel backdrop-blur-xl transition-all duration-300 ${activeStep === 4 ? "bg-panel/80" : "bg-panel/30 opacity-60"}`}>
          <h3 className="font-display text-2xl font-bold text-ink">下一步</h3>
          <p className="mt-3 text-sm leading-7 text-muted">
            {activeStep === 4
              ? "第二阶段已完成。你可以直接进入发布工作台，后续会优先消费当前权威报告和图片资源。"
              : "请先在左侧完成文案生成、图片配置以及图文排版预览的确认，才能进入发布环节。"}
          </p>

          {activeStep === 4 ? (
            <Link
              href={`/publish/${bundle.task.id}`}
              className="group mt-6 flex w-full items-center justify-center gap-3 rounded-[24px] bg-ink px-6 py-5 text-base font-bold text-surface shadow-panel transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
            >
              进入发布工作台
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          ) : (
            <button
              disabled
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-[24px] border border-stroke bg-surface px-6 py-5 text-base font-bold text-muted cursor-not-allowed"
            >
              请先完成排版预览确认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
