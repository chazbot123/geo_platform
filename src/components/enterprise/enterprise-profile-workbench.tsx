"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, ImageIcon, Loader2, Save, UploadCloud } from "lucide-react";
import { dispatchWorkflowStatusRefresh } from "@/components/layout/app-shell";
import { RegionSelector } from "@/components/task/region-selector";
import { chinaRegions } from "@/lib/regions/china-admin";
import type { EnterpriseAsset, EnterpriseParseStatus, EnterpriseProfile, EnterpriseProfileFields } from "@/lib/enterprise/types";

const emptyFields: EnterpriseProfileFields = {
  companyName: "",
  brandShortName: "",
  productService: "",
  region: "",
  brandStory: "",
  productFeatures: "",
  audience: "",
  trustProof: "",
  painPoints: "",
  customerCases: "",
};

interface RegionSelection {
  province: string;
  city: string;
  district: string;
}

const emptyRegionSelection: RegionSelection = {
  province: "",
  city: "",
  district: "",
};

const requiredFields: Array<keyof EnterpriseProfileFields> = ["companyName", "brandShortName", "productService", "region"];

const fieldGroups: Array<{
  title: string;
  fields: Array<{
    key: keyof EnterpriseProfileFields;
    label: string;
    required?: boolean;
    textarea?: boolean;
    placeholder: string;
  }>;
}> = [
  {
    title: "基础信息",
    fields: [
      { key: "companyName", label: "公司名称", required: true, placeholder: "例如：杭州某某科技有限公司" },
      { key: "brandShortName", label: "品牌简称", required: true, placeholder: "例如：某某科技" },
      { key: "productService", label: "产品服务", required: true, placeholder: "例如：企业级内容生产工具" },
    ],
  },
  {
    title: "品牌与产品",
    fields: [
      { key: "brandStory", label: "品牌故事", textarea: true, placeholder: "简要说明品牌背景、定位和发展脉络" },
      { key: "productFeatures", label: "产品特点", textarea: true, placeholder: "列出核心功能、服务优势或差异化能力" },
      { key: "trustProof", label: "信任背书", textarea: true, placeholder: "填写资质、奖项、合作客户、认证或数据证明" },
    ],
  },
  {
    title: "客户视角",
    fields: [
      { key: "audience", label: "服务人群", textarea: true, placeholder: "描述目标客户、购买角色和使用场景" },
      { key: "painPoints", label: "用户痛点", textarea: true, placeholder: "填写客户常见问题、顾虑和决策阻碍" },
      { key: "customerCases", label: "客户案例", textarea: true, placeholder: "补充典型案例、项目结果或客户反馈" },
    ],
  },
];

function formatDate(value: string) {
  if (!value) {
    return "未保存";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getAssetKind(file: File): EnterpriseAsset["kind"] {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    return "image";
  }
  return "material";
}

function fileToAsset(file: File, kind: EnterpriseAsset["kind"]): EnterpriseAsset {
  return {
    id: `${kind}-${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    type: file.type || "",
    kind,
    uploadedAt: new Date().toISOString(),
  };
}

function mergeAssets(current: EnterpriseAsset[], incoming: EnterpriseAsset[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function buildRegion(selection: RegionSelection) {
  return [selection.province, selection.city, selection.district].filter(Boolean).join("");
}

function parseRegion(region: string): RegionSelection {
  const value = region.trim();
  if (!value) return emptyRegionSelection;

  for (const province of chinaRegions) {
    const cities = province.children ?? [];
    if (value.startsWith(province.name)) {
      const restAfterProvince = value.slice(province.name.length);
      for (const city of cities) {
        const districts = city.children ?? [];
        const cityMatched = restAfterProvince.startsWith(city.name) || value.includes(city.name);
        if (!cityMatched) continue;
        const district = districts.find((item) => value.endsWith(item.name) || value.includes(item.name))?.name ?? "";
        return { province: province.name, city: city.name, district };
      }
      return { province: province.name, city: "", district: "" };
    }

    for (const city of cities) {
      if (!value.startsWith(city.name) && !value.includes(city.name)) continue;
      const district = (city.children ?? []).find((item) => value.endsWith(item.name) || value.includes(item.name))?.name ?? "";
      return { province: province.name, city: city.name, district };
    }
  }

  return emptyRegionSelection;
}

function AssetList({ assets, emptyText }: { assets: EnterpriseAsset[]; emptyText: string }) {
  if (!assets.length) {
    return <p className="text-sm text-muted">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2">
      {assets.map((asset) => (
        <li key={asset.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-soft px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-ink">{asset.name}</span>
          <span className="shrink-0 text-xs text-muted">{Math.max(1, Math.round(asset.size / 1024))} KB</span>
        </li>
      ))}
    </ul>
  );
}

function fieldLabel(field: keyof EnterpriseProfileFields) {
  switch (field) {
    case "companyName":
      return "公司名称";
    case "brandShortName":
      return "品牌简称";
    case "productService":
      return "产品服务";
    case "region":
      return "地区";
    default:
      return field;
  }
}

export function EnterpriseProfileWorkbench() {
  const [fields, setFields] = useState<EnterpriseProfileFields>(emptyFields);
  const [regionSelection, setRegionSelection] = useState<RegionSelection>(emptyRegionSelection);
  const [materialFiles, setMaterialFiles] = useState<EnterpriseAsset[]>([]);
  const [imageFiles, setImageFiles] = useState<EnterpriseAsset[]>([]);
  const [parseStatus, setParseStatus] = useState<EnterpriseParseStatus>("idle");
  const [parseMessage, setParseMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const missingFields = useMemo(() => requiredFields.filter((field) => !fields[field].trim()), [fields]);
  const canContinue = missingFields.length === 0 && Boolean(lastSavedAt) && !dirty;

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const response = await fetch("/api/enterprise/profile", { cache: "no-store" });
        const data = (await response.json()) as { profile: EnterpriseProfile | null };

        if (!active || !data.profile) {
          return;
        }

        const profile = data.profile;
        setFields({
          companyName: profile.companyName,
          brandShortName: profile.brandShortName,
          productService: profile.productService,
          region: profile.region,
          brandStory: profile.brandStory,
          productFeatures: profile.productFeatures,
          audience: profile.audience,
          trustProof: profile.trustProof,
          painPoints: profile.painPoints,
          customerCases: profile.customerCases,
        });
        setRegionSelection(parseRegion(profile.region));
        setMaterialFiles(profile.materialFiles);
        setImageFiles(profile.imageFiles);
        setParseStatus(profile.parseStatus);
        setParseMessage(profile.parseMessage);
        setLastSavedAt(profile.lastSavedAt);
        setDirty(false);
      } catch {
        if (active) {
          setErrorMessage("企业信息加载失败，请刷新后重试。");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  function updateField(key: keyof EnterpriseProfileFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setStatusMessage("");
    setErrorMessage("");
  }

  function updateRegion(nextValue: RegionSelection) {
    setRegionSelection(nextValue);
    updateField("region", buildRegion(nextValue));
  }

  async function parseFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    const selectedFiles = Array.from(files);
    const localAssets = selectedFiles.map((file) => fileToAsset(file, getAssetKind(file)));

    setMaterialFiles((current) => mergeAssets(current, localAssets.filter((asset) => asset.kind === "material")));
    setImageFiles((current) => mergeAssets(current, localAssets.filter((asset) => asset.kind === "image")));
    setDirty(true);

    const formData = new FormData();
    for (const file of selectedFiles) {
      formData.append("files", file);
    }

    setParsing(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const response = await fetch("/api/enterprise/parse", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "资料解析失败。");
      }

      const result = data.result as {
        suggestions: Partial<EnterpriseProfileFields>;
        materialFiles: EnterpriseAsset[];
        imageFiles: EnterpriseAsset[];
        parseStatus: EnterpriseParseStatus;
        parseMessage: string;
      };

      setFields((current) => ({ ...current, ...result.suggestions }));
      if (result.suggestions.region) {
        setRegionSelection(parseRegion(result.suggestions.region));
      }
      setMaterialFiles((current) => mergeAssets(current, result.materialFiles));
      setImageFiles((current) => mergeAssets(current, result.imageFiles));
      setParseStatus(result.parseStatus);
      setParseMessage(result.parseMessage);
      setStatusMessage("解析结果已回填，请确认后保存。");
      setDirty(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "资料解析失败，可手动填写后继续。";
      setParseStatus("failed");
      setParseMessage(message);
      setErrorMessage(message);
      setDirty(true);
    } finally {
      setParsing(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const response = await fetch("/api/enterprise/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          materialFiles,
          imageFiles,
          parseStatus,
          parseMessage,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "企业信息保存失败。");
      }

      const profile = data.profile as EnterpriseProfile;
      setLastSavedAt(profile.lastSavedAt);
      setDirty(false);
      setStatusMessage("企业信息已保存。");
      dispatchWorkflowStatusRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "企业信息保存失败。";
      setErrorMessage(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="section-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="page-section-title">企业档案</h2>
            <p className="page-section-desc">保存后用于生成客户问题、内容和发布任务。</p>
          </div>
          <span className="status-pill">{lastSavedAt ? `已保存 ${formatDate(lastSavedAt)}` : "未保存"}</span>
        </div>

        {loading ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载企业信息
          </div>
        ) : (
          <div className="mt-6 space-y-7">
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-4 flex items-center gap-2">
                <UploadCloud className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-ink">资料文件与产品公司图片</h3>
              </div>
              <label className="mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-3 py-5 text-center text-sm text-muted transition hover:border-accent hover:text-ink">
                <span className="inline-flex items-center gap-2">
                  <UploadCloud className="h-4 w-4" />
                  上传资料文件或图片
                </span>
                <span className="text-xs text-muted">支持 txt、md、csv、json、pdf、docx、png、jpg、jpeg、webp</span>
                <input
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(event) => parseFiles(event.target.files)}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                    <FileText className="h-4 w-4 text-accent" />
                    资料文件
                  </div>
                  <AssetList assets={materialFiles} emptyText="暂无资料文件" />
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
                    <ImageIcon className="h-4 w-4 text-accent" />
                    产品与公司图片
                  </div>
                  <AssetList assets={imageFiles} emptyText="暂无图片素材" />
                </div>
              </div>
            </div>

            {fieldGroups.map((group) => (
              <div key={group.title} className="space-y-4">
                <h3 className="text-sm font-semibold text-ink">{group.title}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {group.fields.map((field) => {
                    const invalid = field.required && !fields[field.key].trim();
                    return (
                      <label key={field.key} className={field.textarea ? "sm:col-span-2" : ""}>
                        <span className="mb-2 block text-sm font-medium text-ink">
                          {field.label}
                          {field.required ? <span className="ml-1 text-red-500">*</span> : null}
                        </span>
                        {field.textarea ? (
                          <textarea
                            value={fields[field.key]}
                            onChange={(event) => updateField(field.key, event.target.value)}
                            placeholder={field.placeholder}
                            rows={4}
                            className="min-h-28 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
                          />
                        ) : (
                          <input
                            value={fields[field.key]}
                            onChange={(event) => updateField(field.key, event.target.value)}
                            placeholder={field.placeholder}
                            className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none transition focus:border-accent"
                          />
                        )}
                        {invalid ? <span className="mt-1 block text-xs text-red-500">必填</span> : null}
                      </label>
                    );
                  })}
                  {group.title === "基础信息" ? (
                    <RegionSelector
                      province={regionSelection.province}
                      city={regionSelection.city}
                      district={regionSelection.district}
                      onChange={updateRegion}
                    />
                  ) : null}
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-5 text-sm">
                {parsing ? (
                  <span className="inline-flex items-center gap-2 text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在解析资料
                  </span>
                ) : errorMessage ? (
                  <span className="text-red-500">{errorMessage}</span>
                ) : statusMessage ? (
                  <span className="inline-flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {statusMessage}
                  </span>
                ) : parseMessage ? (
                  <span className="text-muted">{dirty ? "有未保存更改，请保存后进入下一步。" : parseMessage}</span>
                ) : (
                  <span className="text-muted">解析只回填表单，保存后才会写入本地。</span>
                )}
              </div>

              <button
                type="button"
                onClick={saveProfile}
                disabled={saving || missingFields.length > 0}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存企业信息
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="section-card">
        <h2 className="page-section-title">下一步</h2>
        <p className="page-section-desc">保存必填信息后进入客户关键词。</p>

        <div className="mt-5 space-y-3 text-sm">
          {requiredFields.map((field) => (
            <div key={field} className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-b-0">
              <span className="text-muted">{fieldLabel(field)}</span>
              <span className={fields[field].trim() ? "text-emerald-600" : "text-red-500"}>
                {fields[field].trim() ? "已填写" : "待填写"}
              </span>
            </div>
          ))}
        </div>

        <Link
          className={`mt-6 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium ${
            canContinue ? "bg-accent text-white" : "pointer-events-none bg-surface-soft text-muted"
          }`}
          href="/customer-keywords"
          aria-disabled={!canContinue}
        >
          {dirty ? "请先保存" : "客户关键词"}
        </Link>
      </aside>
    </div>
  );
}
