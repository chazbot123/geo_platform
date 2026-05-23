"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, Image as ImageIcon, Upload } from "lucide-react";

type LocalFileFieldKind = "image" | "document";

type DropCapableFile = File & {
  path?: string;
};

interface LocalFilePathInputProps {
  label: string;
  value: string;
  placeholder: string;
  accept: string;
  kind: LocalFileFieldKind;
  displayName: string;
  helperText: string;
  onValueChange: (value: string) => void;
  onDisplayNameChange: (fileName: string) => void;
}

const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"];
const documentExtensions = [".pdf", ".doc", ".docx", ".txt", ".md"];

export function LocalFilePathInput({
  label,
  value,
  placeholder,
  accept,
  kind,
  displayName,
  helperText,
  onValueChange,
  onDisplayNameChange,
}: LocalFilePathInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const selectedName = useMemo(() => {
    if (displayName) {
      return displayName;
    }
    if (!value) {
      return "";
    }
    return extractFileName(value);
  }, [displayName, value]);

  function handleManualInput(nextValue: string) {
    setError("");
    onValueChange(nextValue);
    if (!nextValue.trim()) {
      onDisplayNameChange("");
    }
  }

  function handleButtonClick() {
    inputRef.current?.click();
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }
    void applySelectedFile(files);
    event.target.value = "";
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    const files = Array.from(event.dataTransfer.files ?? []) as DropCapableFile[];
    await applySelectedFile(files);
  }

  async function applySelectedFile(files: DropCapableFile[]) {
    setError("");

    if (files.length !== 1) {
      setError("一次只能拖入或选择 1 个文件。");
      return;
    }

    const file = files[0];
    if (!matchesKind(file, kind)) {
      setError(kind === "image" ? "这里只能放入图片文件。" : "这里只能放入说明书文档。");
      return;
    }

    const resolvedPath = await resolveFilePath(file);
    if (!resolvedPath) {
      setError("当前环境无法自动读取本地绝对路径，请手动填写完整路径。");
      return;
    }

    onValueChange(resolvedPath);
    onDisplayNameChange(file.name);
  }

  return (
    <label className="block">
      <span className="label-base">{label}</span>
      <div
        className={[
          "rounded-[24px] border p-3 transition",
          dragging ? "border-accent/60 bg-accent/10" : "border-white/10 bg-white/5",
        ].join(" ")}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragging) {
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
          }
          setDragging(false);
        }}
        onDrop={(event) => {
          void handleDrop(event);
        }}
      >
        <input ref={inputRef} className="hidden" type="file" accept={accept} onChange={handleInputChange} />

        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-200">
            {kind === "image" ? <ImageIcon className="h-4 w-4 text-accent" /> : <FileUp className="h-4 w-4 text-accent" />}
            <span>{helperText}</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            onClick={handleButtonClick}
          >
            <span className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              选择文件
            </span>
          </button>
        </div>

        <input className="input-base" value={value} onChange={(event) => handleManualInput(event.target.value)} placeholder={placeholder} />

        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/20 px-4 py-3 text-sm text-slate-300">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">当前显示</p>
          <p className="mt-2 break-all text-sm text-slate-100">{selectedName || "未选择文件，支持继续手动填写路径。"}</p>
        </div>

        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </div>
    </label>
  );
}

function matchesKind(file: File, kind: LocalFileFieldKind) {
  const normalizedName = file.name.toLowerCase();
  const extensions = kind === "image" ? imageExtensions : documentExtensions;
  return extensions.some((extension) => normalizedName.endsWith(extension));
}

async function resolveFilePath(file: DropCapableFile) {
  if (typeof file.path === "string" && file.path.trim()) {
    return file.path;
  }

  const maybeHandle = await extractHandlePath(file);
  if (maybeHandle) {
    return maybeHandle;
  }

  return "";
}

async function extractHandlePath(file: File) {
  const maybeFile = file as File & {
    handle?: {
      getFile?: () => Promise<File & { path?: string }>;
    };
  };

  if (!maybeFile.handle?.getFile) {
    return "";
  }

  try {
    const nextFile = await maybeFile.handle.getFile();
    if (typeof nextFile.path === "string" && nextFile.path.trim()) {
      return nextFile.path;
    }
  } catch {
    return "";
  }

  return "";
}

function extractFileName(filePath: string) {
  const segments = filePath.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? filePath;
}
