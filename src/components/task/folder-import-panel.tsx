"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, LoaderCircle, Sparkles } from "lucide-react";
import type { FolderImportPreview, TaskCreateInput } from "@/lib/types";

type FileWithRelativePath = File & { webkitRelativePath: string };

interface FolderImportPanelProps {
  onApply: (preview: FolderImportPreview) => void;
}

export function FolderImportPanel({ onApply }: FolderImportPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileWithRelativePath[]>([]);
  const [preview, setPreview] = useState<FolderImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.setAttribute("webkitdirectory", "");
    inputRef.current.setAttribute("directory", "");
  }, []);

  const stats = useMemo(() => {
    return {
      total: selectedFiles.length,
      text: selectedFiles.filter((file) => /\.(txt|md|json|csv)$/i.test(file.name)).length,
      image: selectedFiles.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name)).length,
    };
  }, [selectedFiles]);

  async function analyze() {
    if (!selectedFiles.length) {
      setError("请先选择一个资料文件夹。");
      return;
    }

    setImporting(true);
    setError("");

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append("files", file);
        formData.append("relativePaths", file.webkitRelativePath || file.name);
      });

      const response = await fetch("/api/import/folder", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "文件夹解析失败");
      }

      setPreview(payload.preview as FolderImportPreview);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文件夹解析失败");
    } finally {
      setImporting(false);
    }
  }

  function clearAll() {
    setSelectedFiles([]);
    setPreview(null);
    setError("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const suggestedAssets = preview?.suggestedAssets ?? {};
  const hasSuggestedAssets = Object.values(suggestedAssets).some(Boolean);

  return (
    <div className="grid gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-white">
            <FolderOpen className="h-4 w-4 text-accent" />
            文件夹导入识别
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            选择产品资料文件夹后，系统会读取文本与图片文件，调用第一阶段模型生成 6 个必填字段建议。
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          支持 txt / md / json / csv / png / jpg / jpeg / webp
        </div>
      </div>

      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        onChange={(event) => {
          const nextFiles = Array.from(event.target.files ?? []) as FileWithRelativePath[];
          setSelectedFiles(nextFiles);
          setPreview(null);
          setError("");
        }}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
        <button
          type="button"
          className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/10"
          onClick={() => inputRef.current?.click()}
        >
          选择产品资料文件夹
        </button>
        <button
          type="button"
          className="rounded-2xl bg-accent px-5 py-4 text-sm font-semibold text-slate-950 transition hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-70"
          disabled={!selectedFiles.length || importing}
          onClick={analyze}
        >
          {importing ? <LoaderCircle className="mx-auto h-4 w-4 animate-spin" /> : "开始解析"}
        </button>
        <button
          type="button"
          className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={!preview}
          onClick={() => preview && onApply(preview)}
        >
          应用到必填字段
        </button>
        <button type="button" className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/10" onClick={clearAll}>
          清空导入结果
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/20 px-4 py-3 text-sm text-slate-300">已选文件：{stats.total}</div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/20 px-4 py-3 text-sm text-slate-300">文本文件：{stats.text}</div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/20 px-4 py-3 text-sm text-slate-300">图片文件：{stats.image}</div>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {preview ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-accent" />
              识别结果预览
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{preview.rawSummary}</p>
            {preview.warnings.length ? (
              <ul className="mt-3 space-y-2 text-sm text-amber-200">
                {preview.warnings.map((warning) => (
                  <li key={warning}>- {warning}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {preview.suggestions.map((suggestion) => (
              <div key={suggestion.field} className="rounded-2xl border border-white/10 bg-slate-950/20 p-4">
                <p className="text-sm font-semibold text-white">{suggestion.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{suggestion.value}</p>
                <p className="mt-3 text-xs text-slate-400">置信度：{Math.round(suggestion.confidence * 100)}%</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">来源：{suggestion.sourceFiles.join("、") || "模型综合判断"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">说明：{suggestion.reason}</p>
              </div>
            ))}
          </div>

          {hasSuggestedAssets ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4 text-sm text-slate-300">
              <p className="font-semibold text-white">附加识别结果</p>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {Object.entries(suggestedAssets).map(([key, value]) => (
                  <div key={key} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-xs text-slate-400">{formatAssetLabel(key as keyof TaskCreateInput)}</p>
                    <p className="mt-1 break-all text-sm text-slate-200">{value || "未识别"}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {preview.unmappedFiles.length ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/20 p-4 text-sm text-slate-300">
              <p className="font-semibold text-white">未参与解析的文件</p>
              <p className="mt-2 leading-6">{preview.unmappedFiles.join("、")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatAssetLabel(key: keyof TaskCreateInput) {
  switch (key) {
    case "productImagePath":
      return "产品图片路径";
    case "brandImagePath":
      return "品牌图片路径";
    case "documentPath":
      return "说明书路径";
    default:
      return key;
  }
}
