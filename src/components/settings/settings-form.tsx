"use client";

import { useState } from "react";
import { CheckCircle, Eye, EyeOff, ImageIcon, LoaderCircle, Save, Type, XCircle } from "lucide-react";
import { hydrateModelConfigWithProviderDefaults, modelProviderOptions, resolveModelConfigForProviderChange, type ModelSection } from "@/lib/config/model-providers";
import type { AppConfig, ModelApiConfig } from "@/lib/types";

interface ProbeOutcome {
  ok: boolean;
  endpoint?: string;
  error?: string;
  attempts?: Array<{ endpoint?: string; authMode?: string; error?: string }>;
  isMockFallback?: boolean;
  provider?: string;
}

interface ProbeResult {
  text: ProbeOutcome;
  image: ProbeOutcome;
}

const modelLabels: Record<ModelSection, { title: string; description?: string; icon: typeof Type }> = {
  text: {
    title: "文字模型",
    icon: Type,
  },
  image: {
    title: "图片模型",
    icon: ImageIcon,
  },
};

const fieldLabels: Record<keyof ModelApiConfig, string> = {
  provider: "服务商",
  baseUrl: "接口地址",
  apiKey: "API Key",
  modelName: "模型名称",
  timeout: "超时时间（毫秒）",
};

const editableFields: Array<keyof ModelApiConfig> = ["provider", "baseUrl", "modelName", "apiKey"];
function getModelConfig(config: AppConfig, section: ModelSection) {
  return section === "text" ? config.contentModelApiConfig : config.imageModelApiConfig;
}

function hydrateConfigWithProviderDefaults(config: AppConfig): AppConfig {
  const nextTextModel = hydrateModelConfigWithProviderDefaults("text", config.contentModelApiConfig);
  return {
    ...config,
    stage1ModelApiConfig: nextTextModel,
    contentModelApiConfig: nextTextModel,
    imageModelApiConfig: hydrateModelConfigWithProviderDefaults("image", config.imageModelApiConfig),
  };
}

export function SettingsForm({ initialConfig }: { initialConfig: AppConfig }) {
  const [config, setConfig] = useState(() => hydrateConfigWithProviderDefaults(initialConfig));
  const [message, setMessage] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<Record<ModelSection, boolean>>({
    text: false,
    image: false,
  });

  function updateModel(section: ModelSection, field: keyof ModelApiConfig, value: string) {
    setConfig((currentConfig) => {
      const current = getModelConfig(currentConfig, section);
      const nextModelConfig = {
        ...current,
        [field]: field === "timeout" ? Number(value) : value,
      };

      if (field === "provider") {
        const providerDefaults = resolveModelConfigForProviderChange(section, value);
        nextModelConfig.baseUrl = providerDefaults.baseUrl;
        nextModelConfig.modelName = providerDefaults.modelName;
      }

      if (section === "text") {
        return {
          ...currentConfig,
          stage1ModelApiConfig: nextModelConfig,
          contentModelApiConfig: nextModelConfig,
        };
      }

      return {
        ...currentConfig,
        imageModelApiConfig: nextModelConfig,
      };
    });
  }

  async function save() {
    setMessage("");
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const payload = await response.json();
    setConfig(payload.config ? hydrateConfigWithProviderDefaults(payload.config) : config);
    setMessage(response.ok ? "配置已保存。" : payload.error ?? "保存失败。");
  }

  async function probe() {
    setProbing(true);
    setProbeResult(null);
    try {
      const response = await fetch("/api/config/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = (await response.json()) as ProbeResult;
      setProbeResult(payload);
    } catch {
      setProbeResult({ text: { ok: false, error: "请求失败" }, image: { ok: false, error: "请求失败" } });
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-2">
        {(["text", "image"] as const).map((section) => {
          const modelConfig = getModelConfig(config, section);
          const Icon = modelLabels[section].icon;

          return (
            <section key={section} className="rounded-lg border border-stroke bg-panel/70 p-5 shadow-panel">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stroke bg-surface text-accent">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink">{modelLabels[section].title}</h3>
                  {modelLabels[section].description ? (
                    <p className="mt-1 text-sm leading-6 text-muted">{modelLabels[section].description}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {editableFields.map((field) => (
                  <label key={field} className="block">
                    <span className="label-base">{fieldLabels[field]}</span>
                    {field === "provider" ? (
                      <select
                        className="input-base"
                        value={String(modelConfig.provider ?? "openai")}
                        onChange={(event) => updateModel(section, field, event.target.value)}
                      >
                        {modelProviderOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field === "apiKey" ? (
                      <div className="relative">
                        <input
                          className="input-base pr-11"
                          type={apiKeyVisibility[section] ? "text" : "password"}
                          value={String(modelConfig[field] ?? "")}
                          onChange={(event) => updateModel(section, field, event.target.value)}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted transition-colors hover:text-ink"
                          onClick={() =>
                            setApiKeyVisibility((currentVisibility) => ({
                              ...currentVisibility,
                              [section]: !currentVisibility[section],
                            }))
                          }
                          aria-label={apiKeyVisibility[section] ? "隐藏 API Key" : "显示 API Key"}
                          aria-pressed={apiKeyVisibility[section]}
                        >
                          {apiKeyVisibility[section] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    ) : (
                      <input
                        className="input-base"
                        type="text"
                        value={String(modelConfig[field] ?? "")}
                        onChange={(event) => updateModel(section, field, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-surface transition-colors hover:bg-accent-soft"
          onClick={save}
        >
          <Save className="h-4 w-4" />
          保存配置
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stroke bg-surface px-5 py-3 text-sm font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
          onClick={probe}
          disabled={probing}
        >
          {probing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {probing ? "探测中..." : "测试模型连接"}
        </button>
      </div>

      {probeResult ? (
        <div className="rounded-lg border border-stroke bg-panel/60 p-5">
          <p className="label-base">测试结果</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {(["text", "image"] as const).map((key) => {
              const outcome = probeResult[key];
              const label = modelLabels[key].title;

              return (
                <div key={key} className={`rounded-lg border p-4 ${outcome.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-danger/20 bg-danger/5"}`}>
                  <div className="mb-2 flex items-center gap-2">
                    {outcome.ok ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-danger" />}
                    <span className="text-sm font-semibold text-ink">{label}</span>
                    <span className={`ml-auto text-xs font-medium ${outcome.ok ? "text-emerald-400" : "text-danger"}`}>
                      {outcome.ok ? "可用" : "失败"}
                    </span>
                  </div>
                  {outcome.isMockFallback ? (
                    <div className="mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
                      当前使用模拟回退，未连接真实 API。
                    </div>
                  ) : null}
                  {outcome.provider ? <p className="mb-1 text-[11px] text-muted">服务商：{outcome.provider}</p> : null}
                  {outcome.endpoint ? <p className="break-all font-mono text-[11px] text-muted">{outcome.endpoint}</p> : null}
                  {outcome.error ? <p className="mt-1 text-xs text-danger">{outcome.error}</p> : null}
                  {outcome.attempts && outcome.attempts.length > 0 ? (
                    <details className="mt-2 text-xs text-muted">
                      <summary className="cursor-pointer">查看探测明细</summary>
                      <ul className="mt-2 space-y-1">
                        {outcome.attempts.map((attempt, index) => (
                          <li key={index} className="break-all font-mono text-[10px] text-muted/70">
                            {attempt.authMode ?? "?"} - {attempt.endpoint ?? "?"} ({attempt.error ?? "UNKNOWN"})
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}
