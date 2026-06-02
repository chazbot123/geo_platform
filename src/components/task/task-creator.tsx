"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Cpu, FolderOpen, LoaderCircle, Rocket, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { FolderImportPanel } from "@/components/task/folder-import-panel";
import { LocalFilePathInput } from "@/components/task/local-file-path-input";
import { RegionSelector } from "@/components/task/region-selector";
import { useTaskDraftStore } from "@/hooks/use-task-draft-store";
import { jizhidaoSuiteRequiredPreset } from "@/lib/task-presets";
import type { FolderImportPreview, SearchProvider, TaskCreateInput } from "@/lib/types";

const fields: Array<{ key: keyof TaskCreateInput; label: string; type?: string; placeholder?: string }> = [
  { key: "productName", label: "产品名称" },
  { key: "category", label: "产品品类" },
  { key: "sellingPoints", label: "核心卖点" },
  { key: "targetAudience", label: "目标人群" },
  { key: "priceRange", label: "价格带" },
  { key: "scenarios", label: "适用场景" },
  { key: "brandTone", label: "品牌调性" },
  { key: "complianceNotes", label: "合规说明" },
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

const searchProviders: Array<{
  key: SearchProvider;
  label: string;
  summary: string;
  detail: string;
}> = [
  {
    key: "doubao",
    label: "豆包",
    summary: "偏内容理解与热点联想",
    detail: "适合先从热点话题、兴趣趋势和内容切入点中提炼冷门机会词。",
  },
  {
    key: "yuanbao",
    label: "元宝",
    summary: "偏问答需求与消费洞察",
    detail: "更强调用户提问方式、使用动机和购买前疑问的长尾拆解。",
  },
  {
    key: "tongyi",
    label: "通义千问",
    summary: "偏类目结构与场景搜索",
    detail: "更适合围绕类目、人群、场景和购买意图做可检索的冷门词组合。",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    summary: "偏逻辑推演与冷门词组合",
    detail: "更适合做低竞争词推理、排序和关键词扩散生成。",
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
    <form className="flex flex-col gap-8" onSubmit={handleSubmit}>
      <div className="section-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="label-base">第一步</p>
            <h2 className="page-section-title">选择检索平台</h2>
            <p className="page-section-desc max-w-3xl">
              先确定本次 AI 提问句生成由哪一套平台逻辑驱动。系统会根据所选平台，叠加社媒与流媒体场景语境，再结合你上传的产品资料生成 10 条可供挑选的用户提问句。
            </p>
          </div>
          <div className="rounded-lg border border-accent/20 bg-accent-muted/20 px-4 py-3 text-xs leading-6 text-accent-soft">
            当前流程：单次仅运行 1 个检索平台，后续可重新切换平台再发起新的任务。
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {searchProviders.map((provider) => {
            const active = draft.searchProvider === provider.key;
            return (
              <button
                key={provider.key}
                type="button"
                className={`rounded-lg border p-5 text-left transition-colors ${
                  active
                    ? "border-accent bg-accent-muted/30 shadow-glow"
                    : "border-stroke bg-surface/40 hover:border-stroke-strong hover:bg-white/5"
                }`}
                onClick={() => setField("searchProvider", provider.key)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className={`h-5 w-5 ${active ? "text-accent" : "text-muted"}`} />
                    <p className="font-display text-base font-bold text-ink">{provider.label}</p>
                  </div>
                  {active ? <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-surface">已选中</span> : null}
                </div>
                <p className="mt-4 text-sm font-medium text-slate-200">{provider.summary}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{provider.detail}</p>
              </button>
            );
          })}
        </div>
      </div>

      <FolderImportPanel onApply={applyFolderImport} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-stroke-strong bg-surface/40 p-6 flex flex-col justify-between">
          <div>
            <p className="flex items-center gap-2 text-ink font-display text-lg mb-2">
              <Sparkles className="h-5 w-5 text-accent" />
              极之道三件套预置
            </p>
            <p className="text-sm leading-relaxed text-muted">
              该预置内容基于“极之道三件套完整产品手册”整理，只会填充当前提交时必须填写的 6 个字段。填充后你仍然可以继续手动修改内容，再决定是否提交任务。
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-accent/20 bg-accent-muted/30 p-6 relative overflow-hidden group">
          <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative z-10 flex flex-col h-full justify-between">
            <p className="text-sm text-ink/80 mb-4">自动写入：产品名称、品类、卖点、人群、场景、调性。</p>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-5 py-3.5 text-sm font-bold text-accent transition-all hover:bg-accent hover:text-surface hover:shadow-glow"
              onClick={() => fillDraft(jizhidaoSuiteRequiredPreset)}
            >
              <Zap className="h-4 w-4" />
              一键填入必填字段
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-stroke bg-surface/50 p-6 lg:p-8">
        <h3 className="font-display text-xl text-ink mb-6 flex items-center gap-2">
          <Cpu className="h-5 w-5 text-accent" />
          第二步：填写基础参数
        </h3>
        <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
          <RegionSelector
            province={draft.province ?? ""}
            city={draft.city ?? ""}
            district={draft.district ?? ""}
            onChange={(nextValue) => {
              setField("province", nextValue.province as never);
              setField("city", nextValue.city as never);
              setField("district", nextValue.district as never);
            }}
          />
          {fields.map((field) => (
            <label key={field.key} className="group relative">
              <span className="label-base group-focus-within:text-accent transition-colors">
                {field.label}
              </span>
              <input
                className="input-base peer"
                type={field.type ?? "text"}
                value={String(draft[field.key] ?? "")}
                onChange={(event) => setField(field.key, event.target.value as never)}
                placeholder={field.placeholder ?? `请输入${field.label}`}
              />
              <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-accent transition-all duration-300 peer-focus:w-full" />
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-stroke bg-surface/50 p-6 lg:p-8">
        <h3 className="font-display text-xl text-ink mb-6 flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-accent" />
          第三步：补充资产路径
        </h3>
        <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr] mt-4">
        <div className="rounded-2xl border border-stroke-strong bg-surface/40 p-6">
          <p className="flex items-center gap-2 text-ink font-display text-lg mb-4">
            <ShieldAlert className="h-5 w-5 text-warning" /> 
            MVP 约束
          </p>
          <ul className="space-y-3 text-sm text-muted font-mono">
            <li className="flex gap-2"><span className="text-accent">01.</span> 先按所选检索平台生成 10 条 AI 用户提问句</li>
            <li className="flex gap-2"><span className="text-accent">02.</span> 客户从 10 条提问句中最多选择 5 条作为最终主题</li>
            <li className="flex gap-2"><span className="text-accent">03.</span> 选词后进入社媒与流媒体分版文案页面</li>
            <li className="flex gap-2"><span className="text-accent">04.</span> 无真实模型接口时仍允许本地 Mock 跑通流程</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-accent/20 bg-gradient-to-br from-surface to-accent-muted/20 p-6 flex flex-col justify-end">
          <button 
            className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-5 text-base font-bold text-surface transition-all hover:bg-accent-soft hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 overflow-hidden" 
            disabled={submitting || !draft.searchProvider}
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <span className="relative z-10 flex items-center gap-2">
              {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />}
              {submitting ? "正在初始化工作流..." : "创建 GEO 任务"}
            </span>
          </button>
          <div className="mt-4 flex items-center justify-between">
            {error ? (
              <p className="text-sm text-danger font-mono animate-pulse">{error}</p>
            ) : (
              <p className="text-sm text-muted font-mono">
                {draft.searchProvider ? `Search Provider Ready // ${draft.searchProvider.toUpperCase()}` : "System Ready // Awaiting Search Provider"}
              </p>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function extractFileName(filePath: string) {
  const segments = filePath.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? filePath;
}
