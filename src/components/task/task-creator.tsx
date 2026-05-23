"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { FolderImportPanel } from "@/components/task/folder-import-panel";
import { LocalFilePathInput } from "@/components/task/local-file-path-input";
import { useTaskDraftStore } from "@/hooks/use-task-draft-store";
import { jizhidaoSuiteRequiredPreset } from "@/lib/task-presets";
import type { FolderImportPreview, TaskCreateInput } from "@/lib/types";

const fields: Array<{ key: keyof TaskCreateInput; label: string; type?: string; placeholder?: string }> = [
  { key: "productName", label: "产品名称" },
  { key: "category", label: "产品品类" },
  { key: "sellingPoints", label: "核心卖点" },
  { key: "targetAudience", label: "目标人群" },
  { key: "priceRange", label: "价格带" },
  { key: "scenarios", label: "适用场景" },
  { key: "brandTone", label: "品牌调性" },
  { key: "competitorName", label: "竞品名称" },
  { key: "competitorKeywords", label: "竞品关键词" },
  { key: "competitorLink", label: "竞品链接" },
  { key: "restrictedWords", label: "禁用词" },
  { key: "complianceNotes", label: "合规说明" },
  { key: "scheduledAt", label: "发布时间", type: "datetime-local" },
];

type AssetFieldKey = "productImagePath" | "brandImagePath" | "documentPath";

const assetFields: Array<{
  key: AssetFieldKey;
  label: string;
  placeholder: string;
  helperText: string;
  accept: string;
  kind: "image" | "document";
}> = [
  {
    key: "productImagePath",
    label: "产品图片路径",
    placeholder: "请输入产品图片路径",
    helperText: "支持拖入图片或点击选择",
    accept: ".png,.jpg,.jpeg,.webp",
    kind: "image",
  },
  {
    key: "brandImagePath",
    label: "品牌图片路径",
    placeholder: "请输入品牌图片路径",
    helperText: "支持拖入图片或点击选择",
    accept: ".png,.jpg,.jpeg,.webp",
    kind: "image",
  },
  {
    key: "documentPath",
    label: "说明书路径",
    placeholder: "请输入说明书路径",
    helperText: "支持拖入文档或点击选择",
    accept: ".pdf,.doc,.docx,.txt,.md",
    kind: "document",
  },
];

export function TaskCreator() {
  const router = useRouter();
  const { draft, setField, fillDraft, applyImportSuggestions, reset } = useTaskDraftStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [assetDisplayNames, setAssetDisplayNames] = useState<Record<AssetFieldKey, string>>({
    productImagePath: "",
    brandImagePath: "",
    documentPath: "",
  });

  function applyFolderImport(preview: FolderImportPreview) {
    applyImportSuggestions(preview.suggestions);
    if (preview.suggestedAssets) {
      fillDraft(preview.suggestedAssets);
      setAssetDisplayNames((current) => ({
        productImagePath: preview.suggestedAssets?.productImagePath ? extractFileName(preview.suggestedAssets.productImagePath) : current.productImagePath,
        brandImagePath: preview.suggestedAssets?.brandImagePath ? extractFileName(preview.suggestedAssets.brandImagePath) : current.brandImagePath,
        documentPath: preview.suggestedAssets?.documentPath ? extractFileName(preview.suggestedAssets.documentPath) : current.documentPath,
      }));
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/products/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "创建任务失败");
      }
      reset();
      setAssetDisplayNames({
        productImagePath: "",
        brandImagePath: "",
        documentPath: "",
      });
      router.push(`/keywords/${payload.task.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "创建任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <FolderImportPanel onApply={applyFolderImport} />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 text-sm leading-7 text-slate-300">
          <p className="flex items-center gap-2 text-white">
            <Sparkles className="h-4 w-4 text-accent" />
            极之道三件套预置
          </p>
          <p className="mt-3">
            该预置内容基于“极之道三件套完整产品手册”整理，只会填充当前提交时必须填写的 6 个字段。
          </p>
          <p className="mt-2">填充后你仍然可以继续手动修改内容，再决定是否提交任务。</p>
        </div>
        <div className="rounded-[28px] border border-white/10 bg-gradient-to-br from-white/10 to-accent/10 p-5">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/15 px-5 py-4 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:bg-accent/20"
            onClick={() => fillDraft(jizhidaoSuiteRequiredPreset)}
          >
            一键填入三件套必填字段
          </button>
          <p className="mt-3 text-sm text-slate-200">将自动写入：产品名称、产品品类、核心卖点、目标人群、适用场景、品牌调性。</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key}>
            <span className="label-base">{field.label}</span>
            <input
              className="input-base"
              type={field.type ?? "text"}
              value={String(draft[field.key] ?? "")}
              onChange={(event) => setField(field.key, event.target.value as never)}
              placeholder={field.placeholder ?? `请输入${field.label}`}
            />
          </label>
        ))}
        {assetFields.map((field) => (
          <LocalFilePathInput
            key={field.key}
            label={field.label}
            value={String(draft[field.key] ?? "")}
            placeholder={field.placeholder}
            helperText={field.helperText}
            accept={field.accept}
            kind={field.kind}
            displayName={assetDisplayNames[field.key]}
            onValueChange={(nextValue) => setField(field.key, nextValue as never)}
            onDisplayNameChange={(fileName) =>
              setAssetDisplayNames((current) => ({
                ...current,
                [field.key]: fileName,
              }))
            }
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 text-sm leading-7 text-slate-300">
          <p className="flex items-center gap-2 text-white"><Sparkles className="h-4 w-4 text-accent" /> MVP 约束</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>1. 当前任务会生成内容主稿和封面素材。</li>
            <li>2. 发布阶段仅面向社媒平台工作台。</li>
            <li>3. 未配置真实外部 API 时会自动使用本地 Mock。</li>
            <li>4. 支持人工确认关键词和人工补录发布结果。</li>
          </ul>
        </div>
        <div className="rounded-[28px] border border-white/10 bg-gradient-to-br from-accent/15 to-cyan-500/10 p-5">
          <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-4 text-sm font-semibold text-slate-950 transition hover:translate-y-[-1px] hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-70" disabled={submitting}>
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            创建 GEO 任务
          </button>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : <p className="mt-3 text-sm text-slate-200">任务创建成功后会自动进入关键词阶段。</p>}
        </div>
      </div>
    </form>
  );
}

function extractFileName(filePath: string) {
  const segments = filePath.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? filePath;
}
