"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle, Save, Image as ImageIcon, FileText, ArrowRight, ShieldCheck, AlertTriangle } from "lucide-react";
import type { ContentDraft, ImageAsset, ReviewResult } from "@/lib/types";

const REQUIRED_IMAGE_COUNT = 5;

interface ReportBlock {
  id: string;
  heading: string;
  body: string;
  paragraphIndex: number;
  question?: string;
  summary?: string;
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

function getReferenceModeLabel(imageItems: ReturnType<typeof getRenderableImages>) {
  if (!imageItems.length) {
    return "";
  }
  return imageItems.some((item) => item.referenceMode === "reference_enhanced") ? "参考图增强生成" : "仅文章语义生成";
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
    return <h3 className="font-display text-xl font-bold text-ink">{paragraph.replace(/^##\s*/, "")}</h3>;
  }
  if (paragraph.startsWith("# ")) {
    return <h2 className="font-display text-2xl font-bold text-ink">{paragraph.replace(/^#\s*/, "")}</h2>;
  }
  return <p className="text-base leading-8 text-slate-200">{paragraph}</p>;
}

export function PreviewPanel({ taskId, initialContent, initialImage, review }: { taskId: string; initialContent?: ContentDraft; initialImage?: ImageAsset; review: ReviewResult }) {
  const [content, setContent] = useState(initialContent);
  const [image, setImage] = useState(initialImage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const imageItems = getRenderableImages(image);
  const imageAssetState = getImageAssetState(image);
  const reportBlocks = buildReportBlocks(content);
  const generatedModeLabel = getReferenceModeLabel(imageItems);

  async function generate(target: "content" | "image") {
    setLoading(true);
    setError("");
    try {
      const endpoint = target === "image" ? "/api/images/generate" : `/api/${target}/generate`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `${target === "content" ? "内容" : "图片"}生成失败`);
      if (target === "content") setContent(payload.content);
      if (target === "image") setImage(payload.image);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveEdits() {
    if (!content) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/content/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, title: content.title, summary: content.summary, cta: content.cta, content: content.content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "保存失败");
      setContent(payload.content);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  const hasWarnings = review.contentWarnings.length > 0 || review.imageWarnings.length > 0;

  return (
    <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
      {/* Left Panel: Content Editor */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4 rounded-[32px] border border-stroke bg-panel/80 p-6 shadow-panel backdrop-blur-xl">
          <button 
            className="flex items-center justify-center gap-2 rounded-[20px] bg-accent px-6 py-3.5 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50 disabled:shadow-none" 
            disabled={loading} 
            onClick={() => generate("content")}
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} 
            智能生成主稿
          </button>
          <button 
            className="flex items-center justify-center gap-2 rounded-[20px] border border-stroke bg-surface px-6 py-3.5 text-sm font-bold text-ink transition-colors hover:border-stroke-strong hover:bg-white/5 disabled:opacity-50" 
            disabled={loading} 
            onClick={() => generate("image")}
          >
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
            生成视觉配图
          </button>
          <button 
            className="flex items-center justify-center gap-2 rounded-[20px] border border-stroke bg-surface px-6 py-3.5 text-sm font-bold text-ink transition-colors hover:border-stroke-strong hover:bg-white/5 disabled:opacity-50" 
            disabled={loading || !content} 
            onClick={saveEdits}
          >
            <Save className="h-4 w-4" /> 
            保存当前修改
          </button>
        </div>
        
        {error && (
          <div className="rounded-2xl border border-danger/20 bg-danger/10 p-4 text-sm font-medium text-danger animate-in slide-in-from-top-2">
            {error}
          </div>
        )}

        <div className="rounded-[32px] border border-stroke bg-panel/50 p-8 shadow-panel backdrop-blur-xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink">内容主稿区</h2>
            {content && (
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">已就绪</span>
            )}
          </div>
          
          {content ? (
            <div className="space-y-5 animate-in fade-in duration-500">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">核心标题</label>
                <input 
                  className="input-base w-full font-display text-lg font-bold" 
                  value={content.title} 
                  onChange={(event) => setContent({ ...content, title: event.target.value })} 
                  placeholder="输入极具吸引力的标题..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">亮点摘要</label>
                <textarea 
                  className="input-base w-full min-h-[100px] resize-y leading-relaxed" 
                  value={content.summary} 
                  onChange={(event) => setContent({ ...content, summary: event.target.value })} 
                  placeholder="提取核心卖点与亮点..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">正文深度解析</label>
                <textarea 
                  className="input-base w-full min-h-[320px] resize-y leading-relaxed" 
                  value={content.content} 
                  onChange={(event) => setContent({ ...content, content: event.target.value })} 
                  placeholder="撰写完整的正文内容..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">行动号召 (CTA)</label>
                <input 
                  className="input-base w-full text-accent-soft" 
                  value={content.cta} 
                  onChange={(event) => setContent({ ...content, cta: event.target.value })} 
                  placeholder="引导用户互动的号召语..."
                />
              </div>

              <div className="rounded-[28px] border border-stroke bg-surface/30 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-display text-xl font-bold text-ink">报告图文预览</h3>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-muted">
                    {imageItems.length} 张配图
                  </span>
                </div>

                <div className="space-y-5">
                  {imageAssetState.status === "ready" ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-7 text-emerald-300">
                      当前 5 张文章配图已完整插入预览。{generatedModeLabel ? `本次模式：${generatedModeLabel}。` : ""}
                    </div>
                  ) : imageAssetState.status === "incomplete_images" ? (
                    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm leading-7 text-slate-300">
                      {imageAssetState.hasLegacyCoverOnly
                        ? "当前只检测到历史旧单图，图文预览不再把它视为正式配图。请重新生成 5 张文章配图。"
                        : `当前图片资产仅有 ${imageAssetState.count} 张，第二阶段必须固定生成 ${REQUIRED_IMAGE_COUNT} 张后才会完整插入文章。`}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-stroke bg-panel/40 p-4 text-sm leading-7 text-muted">
                      当前还没有正式文章配图。生成完成后，图文预览会展示 5 张图片与报告正文的对应插入效果。
                    </div>
                  )}
                  {content.selectedKeywords?.length ? (
                    <div className="rounded-2xl border border-stroke bg-panel/60 p-4 text-sm leading-7 text-slate-300">
                      已确认提问句：{content.selectedKeywords.join("、")}
                    </div>
                  ) : null}
                  {reportBlocks.map((block) => {
                    const matchedImages = imageItems.filter((item) => item.placement.paragraphIndex === block.paragraphIndex || item.sectionHeading === block.heading);
                    return (
                      <div key={block.id} className="space-y-4">
                        <div className="space-y-3 rounded-[24px] border border-stroke bg-panel/50 p-5">
                          <h4 className="font-display text-xl font-bold text-ink">{block.heading}</h4>
                          {block.question ? (
                            <p className="text-sm font-medium text-accent-soft">对应提问句：{block.question}</p>
                          ) : null}
                          {block.summary ? (
                            <p className="rounded-2xl border border-stroke bg-surface/40 p-4 text-sm leading-7 text-slate-300">{block.summary}</p>
                          ) : null}
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
                  {!reportBlocks.length ? (
                    <div className="rounded-2xl border border-dashed border-stroke p-5 text-sm text-muted">
                      生成主稿后，这里会展示图文排版效果。
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-[400px] flex-col items-center justify-center rounded-[24px] border border-dashed border-stroke bg-surface/30 text-center">
              <div className="rounded-full bg-panel p-4 shadow-panel mb-4">
                <FileText className="h-6 w-6 text-muted" />
              </div>
              <p className="font-display text-lg font-medium text-ink">内容尚未生成</p>
              <p className="mt-2 text-sm text-muted">点击上方“智能生成主稿”开始创作</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Image & Review */}
      <div className="space-y-6">
        <div className="rounded-[32px] border border-stroke bg-panel/50 p-8 shadow-panel backdrop-blur-xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink">视觉呈现</h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                imageAssetState.status === "ready"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : imageAssetState.status === "incomplete_images"
                    ? "bg-warning/15 text-warning"
                    : "bg-white/5 text-muted"
              }`}
            >
              {imageAssetState.status === "ready" ? `${REQUIRED_IMAGE_COUNT} 张已生成` : `${imageAssetState.count}/${REQUIRED_IMAGE_COUNT} 张`}
            </span>
          </div>
          
          {imageAssetState.status === "ready" ? (
            <div className="space-y-4 animate-in fade-in duration-500">
              <div className="group relative overflow-hidden rounded-[24px] border border-stroke bg-surface shadow-panel transition-all hover:border-stroke-strong">
                <img src={imageItems[0]?.publicUrl ?? imageItems[0]?.url ?? image?.url ?? ""} alt={imageItems[0]?.alt ?? "智能生成的视觉配图"} className="h-auto w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-panel/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              </div>
              {imageItems.length > 1 ? (
                <div className="grid grid-cols-2 gap-3">
                  {imageItems.slice(1).map((item) => (
                    <div key={item.id} className="overflow-hidden rounded-[20px] border border-stroke bg-surface">
                      <img src={item.publicUrl ?? item.url} alt={item.alt} className="aspect-[4/3] w-full object-cover" />
                      <div className="space-y-1 px-3 py-2 text-xs text-muted">
                        <p>{item.sectionHeading || item.placement.caption || item.alt}</p>
                        {item.question ? <p>{item.question}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="rounded-2xl border border-stroke bg-surface/40 p-4 text-sm text-muted">
                已生成 {imageItems.length} 张与报告内容匹配的配图，当前模式为{generatedModeLabel || "文章配图生成"}，插入位会优先围绕总述、核心问题分析和结论区域智能排版。
              </div>
            </div>
          ) : imageAssetState.status === "incomplete_images" ? (
            <div className="space-y-4">
              <div className="flex aspect-video flex-col items-center justify-center rounded-[24px] border border-warning/30 bg-warning/5 text-center">
                <div className="rounded-full bg-panel p-4 shadow-panel mb-4">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                </div>
                <p className="font-medium text-ink">当前图集不完整</p>
                <p className="mt-1 max-w-md text-sm leading-7 text-slate-300">
                  {imageAssetState.hasLegacyCoverOnly
                    ? "检测到历史旧图片资产，仅有 1 张 legacy 单图，当前不再视为第二阶段已完成。请回到第二阶段重新生成 5 张文章配图。"
                    : `当前仅有 ${imageAssetState.count} 张正式图片，发布前必须补齐到 ${REQUIRED_IMAGE_COUNT} 张。请回到第二阶段重新生成。`}
                </p>
              </div>
              <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm text-slate-300">
                当前图集还不完整，但不会阻止第三阶段发布；如果你只发布文章正文，可以直接继续进入发布工作台。
              </div>
            </div>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center rounded-[24px] border border-dashed border-stroke bg-surface/30 text-center">
              <div className="rounded-full bg-panel p-4 shadow-panel mb-4">
                <ImageIcon className="h-6 w-6 text-muted" />
              </div>
              <p className="font-medium text-ink">暂无视觉素材</p>
              <p className="mt-1 text-sm text-muted">点击生成获取高质量配图</p>
            </div>
          )}
        </div>

        <div className={`rounded-[32px] border ${hasWarnings ? 'border-warning/30 bg-warning/5' : 'border-emerald-500/20 bg-emerald-500/5'} p-8 shadow-panel backdrop-blur-xl`}>
          <div className="mb-6 flex items-center gap-3">
            {hasWarnings ? (
              <AlertTriangle className="h-6 w-6 text-warning" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-emerald-400" />
            )}
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">基础质量巡检</h2>
          </div>
          
          <ul className="space-y-3">
            {review.contentWarnings.map((item, i) => (
              <li key={`c-${i}`} className="flex items-start gap-3 rounded-[16px] bg-surface/50 p-4 text-sm leading-relaxed text-slate-300">
                <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning"></span>
                {item}
              </li>
            ))}
            {review.imageWarnings.map((item, i) => (
              <li key={`i-${i}`} className="flex items-start gap-3 rounded-[16px] bg-surface/50 p-4 text-sm leading-relaxed text-slate-300">
                <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-warning"></span>
                {item}
              </li>
            ))}
            {!hasWarnings && (
              <li className="flex items-center gap-3 rounded-[16px] bg-surface/50 p-4 text-sm font-medium text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
                当前内容与素材各项指标良好，未发现基础风险。
              </li>
            )}
          </ul>
        </div>

        <Link 
          href={`/publish/${taskId}`}
          className="group flex w-full items-center justify-center gap-3 rounded-[24px] bg-ink px-6 py-5 text-base font-bold text-surface shadow-panel transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
        >
          确认并进入发布阶段
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}
