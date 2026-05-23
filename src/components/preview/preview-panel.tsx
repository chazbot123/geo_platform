"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import type { ContentDraft, ImageAsset, ReviewResult } from "@/lib/types";

export function PreviewPanel({ taskId, initialContent, initialImage, review }: { taskId: string; initialContent?: ContentDraft; initialImage?: ImageAsset; review: ReviewResult }) {
  const [content, setContent] = useState(initialContent);
  const [image, setImage] = useState(initialImage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="space-y-4">
        <div className="flex gap-3">
          <button className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-slate-950" disabled={loading} onClick={() => generate("content")}>
            {loading ? <LoaderCircle className="inline h-4 w-4 animate-spin" /> : null} 生成主稿
          </button>
          <button className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white" disabled={loading} onClick={() => generate("image")}>
            生成图片
          </button>
          <button className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white" disabled={loading || !content} onClick={saveEdits}>
            <Save className="inline h-4 w-4" /> 保存修改
          </button>
        </div>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="label-base">内容主稿</p>
          {content ? (
            <div className="space-y-4">
              <input className="input-base text-lg font-semibold" value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} />
              <textarea className="input-base min-h-24" value={content.summary} onChange={(event) => setContent({ ...content, summary: event.target.value })} />
              <textarea className="input-base min-h-[280px]" value={content.content} onChange={(event) => setContent({ ...content, content: event.target.value })} />
              <input className="input-base" value={content.cta} onChange={(event) => setContent({ ...content, cta: event.target.value })} />
            </div>
          ) : (
            <p className="text-sm text-slate-300">请先生成内容主稿。</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="label-base">封面图片</p>
          {image ? (
            <div className="overflow-hidden rounded-[24px] border border-white/10">
              <img src={image.url} alt="封面图" className="h-auto w-full object-cover" />
            </div>
          ) : (
            <p className="text-sm text-slate-300">请先生成封面图片。</p>
          )}
        </div>
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
          <p className="label-base">基础校验</p>
          <ul className="space-y-2">
            {review.contentWarnings.map((item) => (
              <li key={item}>- {item}</li>
            ))}
            {review.imageWarnings.map((item) => (
              <li key={item}>- {item}</li>
            ))}
            {review.contentWarnings.length === 0 && review.imageWarnings.length === 0 ? <li>- 当前未发现基础风险。</li> : null}
          </ul>
        </div>
        <Link className="block rounded-2xl bg-white px-4 py-4 text-center text-sm font-semibold text-slate-950" href={`/publish/${taskId}`}>
          进入发布阶段
        </Link>
      </div>
    </div>
  );
}
