"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, FileText, Image as ImageIcon, LoaderCircle, Save, ShieldCheck, AlertTriangle } from "lucide-react";
import type { ContentDraft, ImageAsset, ReviewResult, TaskBundle } from "@/lib/types";
import { reviewDraft } from "@/lib/review/service";

const REQUIRED_IMAGE_COUNT = 5;

interface ReportBlock {
  id: string;
  heading: string;
  body: string;
  paragraphIndex: number;
  question?: string;
  summary?: string;
}

function getRenderableImages(image?: ImageAsset) {
  return image?.images ?? [];
}

function getImageAssetState(image?: ImageAsset) {
  const imageItems = image?.images ?? [];
  const hasLegacyCoverOnly = Boolean(image?.url && imageItems.length === 0);
  if (imageItems.length === REQUIRED_IMAGE_COUNT) {
    return {
      status: "ready" as const,
      count: imageItems.length,
      hasLegacyCoverOnly,
    };
  }
  if (imageItems.length > 0 || hasLegacyCoverOnly) {
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
  return imageItems.some((item) => item.referenceMode === "reference_enhanced") ? "参考图增强生成" : "仅文章语义生成";
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
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);

  const imageItems = useMemo(() => getRenderableImages(image), [image]);
  const imageAssetState = useMemo(() => getImageAssetState(image), [image]);
  const reportBlocks = useMemo(() => buildReportBlocks(content), [content]);
  const liveReview = useMemo(() => reviewDraft(content, image), [content, image]);
  const hasWarnings = liveReview.contentWarnings.length > 0 || liveReview.imageWarnings.length > 0;
  const hasReferenceAssets = hasReferenceInputs(bundle);
  const generatedModeLabel = useMemo(() => getReferenceModeLabel(imageItems), [imageItems]);

  async function generate(target: "content" | "image") {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const endpoint = target === "image" ? "/api/images/generate" : `/api/${target}/generate`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: bundle.task.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `${target === "content" ? "内容" : "图片"}生成失败`);
      }
      if (target === "content") {
        setContent(payload.content);
        setMessage("权威报告已生成。");
      } else {
        setImage(payload.image);
        setMessage(hasReferenceAssets ? "已结合参考图与文章内容生成 5 张文章配图。" : "已根据文章内容生成 5 张文章配图。");
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
        {/* Step 1: 权威报告文案生成 */}
        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel transition-all duration-300 ${activeStep === 1 ? "bg-panel/80 backdrop-blur-xl" : "bg-panel/40"}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="label-base">Step 1</p>
              <h2 className="font-display text-2xl font-bold text-ink">权威报告文案生成</h2>
            </div>
            {activeStep > 1 && (
              <button 
                onClick={() => setActiveStep(1)}
                className="text-sm font-medium text-accent hover:text-accent-soft transition-colors"
              >
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
                  <h3 className="font-display text-xl font-bold text-ink mb-4">报告编辑区</h3>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">标题</label>
                    <input
                      className="input-base w-full font-display text-lg font-bold"
                      value={content.title}
                      onChange={(event) => setContent({ ...content, title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">摘要</label>
                    <textarea
                      className="input-base w-full min-h-[120px] resize-y leading-relaxed"
                      value={content.summary}
                      onChange={(event) => setContent({ ...content, summary: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">正文</label>
                    <textarea
                      className="input-base w-full min-h-[360px] resize-y leading-relaxed"
                      value={content.content}
                      onChange={(event) => setContent({ ...content, content: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted uppercase tracking-wider">行动建议</label>
                    <input
                      className="input-base w-full"
                      value={content.cta}
                      onChange={(event) => setContent({ ...content, cta: event.target.value })}
                    />
                  </div>
                  <div className="pt-4 flex justify-end">
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
            <div className="rounded-[16px] bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-400 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> 文案已确认
            </div>
          )}
        </div>

        {/* Step 2: 文章配图生成 */}
        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel transition-all duration-300 ${activeStep === 2 ? "bg-panel/80 backdrop-blur-xl" : "bg-panel/40"} ${activeStep < 2 ? "opacity-50 grayscale pointer-events-none" : ""}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="label-base">Step 2</p>
              <h2 className="font-display text-2xl font-bold text-ink">文章配图生成 (可选)</h2>
            </div>
            {activeStep > 2 && (
              <button 
                onClick={() => setActiveStep(2)}
                className="text-sm font-medium text-accent hover:text-accent-soft transition-colors"
              >
                重新配置
              </button>
            )}
          </div>

          {activeStep === 2 ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className={`rounded-[24px] border p-4 text-sm leading-7 ${hasReferenceAssets ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-stroke bg-surface/40 text-slate-300"}`}>
                {hasReferenceAssets
                  ? "已检测到参考图输入，生成图片时会结合参考图与当前权威报告的章节语义，固定输出 5 张文章配图。"
                  : "当前未检测到参考图输入，生成图片时会仅根据当前权威报告的章节语义，固定输出 5 张文章配图。"}
              </div>

              <div className="flex flex-wrap gap-4">
                <button
                  className="flex items-center justify-center gap-2 rounded-[20px] bg-accent px-6 py-3.5 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50"
                  disabled={loading || !content}
                  onClick={() => generate("image")}
                >
                  {loading && activeStep === 2 ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                  {imageAssetState.status === "ready" ? "重新生成 5 张文章配图" : "生成 5 张文章配图"}
                </button>
              </div>
              
              {error && activeStep === 2 ? <p className="text-sm text-danger">{error}</p> : null}
              {message && activeStep === 2 ? <p className="text-sm text-emerald-400">{message}</p> : null}

              {imageAssetState.status === "ready" ? (
                <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-7 text-emerald-300">
                  当前图集已完整生成 {REQUIRED_IMAGE_COUNT} 张文章配图。{generatedModeLabel ? `本次模式：${generatedModeLabel}。` : ""}
                </div>
              ) : imageAssetState.status === "incomplete_images" ? (
                <div className="rounded-[24px] border border-warning/30 bg-warning/5 p-4 text-sm leading-7 text-slate-200">
                  {imageAssetState.hasLegacyCoverOnly
                    ? "检测到历史旧图片资产，仅有 legacy 单图，当前不再视为第二阶段配图已完成。请重新生成 5 张文章配图。"
                    : `当前正式图片资产仅有 ${imageAssetState.count} 张，第二阶段必须固定生成 ${REQUIRED_IMAGE_COUNT} 张文章配图后才能视为完成。请重新生成。`}
                </div>
              ) : null}

              <div className="pt-4 flex flex-wrap gap-4 justify-end">
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
            <div className="rounded-[16px] bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-400 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> {imageAssetState.status === "ready" ? "已确认 5 张配图" : "已确认纯文本模式"}
            </div>
          ) : null}
        </div>

        {/* Step 3: 图文排版预览 */}
        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel transition-all duration-300 ${activeStep >= 3 ? "bg-panel/80 backdrop-blur-xl" : "bg-panel/40 opacity-50 grayscale pointer-events-none"}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="label-base">Step 3</p>
              <h2 className="font-display text-2xl font-bold text-ink">图文排版预览</h2>
            </div>
            {activeStep === 4 && (
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                ✅ 报告已就绪
              </span>
            )}
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
                              {item.sectionHeading ? `${item.sectionHeading} · ` : ""}{item.placement.caption || item.alt}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {activeStep === 3 && (
                <div className="pt-6 flex justify-end">
                  <button
                    className="flex items-center justify-center gap-2 rounded-[20px] bg-emerald-500 text-white px-8 py-3.5 text-sm font-bold transition-all hover:scale-[1.02] hover:bg-emerald-400 active:scale-[0.98]"
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
            {!hasWarnings ? (
              <li className="flex items-center gap-3 rounded-[16px] bg-surface/50 p-4 text-sm font-medium text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
                当前报告与图片各项指标良好。
              </li>
            ) : null}
          </ul>
        </div>

        <div className={`rounded-[32px] border border-stroke p-8 shadow-panel backdrop-blur-xl transition-all duration-300 ${activeStep === 4 ? "bg-panel/80" : "bg-panel/30 opacity-60"}`}>
          <h3 className="font-display text-2xl font-bold text-ink">下一步</h3>
          <p className="mt-3 text-sm leading-7 text-muted">
            {activeStep === 4 
              ? "第二阶段已完成！您可以直接进入今日头条发布工作台。第三部分会优先消费当前权威报告和图片资源。"
              : "请先在左侧完成文案生成、图片配置以及图文排版预览的确认，才能进入发布环节。"}
          </p>
          
          {activeStep === 4 ? (
            <Link
              href={`/publish/${bundle.task.id}`}
              className="mt-6 group flex w-full items-center justify-center gap-3 rounded-[24px] bg-ink px-6 py-5 text-base font-bold text-surface shadow-panel transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
            >
              进入今日头条发布工作台
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          ) : (
            <button
              disabled
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-[24px] bg-surface border border-stroke px-6 py-5 text-base font-bold text-muted cursor-not-allowed"
            >
              请先完成排版预览确认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
