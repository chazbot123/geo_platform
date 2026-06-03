﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿"use client";

import { useState } from "react";
import { LoaderCircle, CheckCircle, XCircle } from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { formatConfigFieldLabel, formatConfigGroupLabel } from "@/lib/utils";

interface ProbeOutcome {
  ok: boolean;
  endpoint?: string;
  error?: string;
  attempts?: Array<{ endpoint?: string; authMode?: string; error?: string }>;
  isMockFallback?: boolean;
  provider?: string;
}

interface ProbeResult {
  stage1: ProbeOutcome;
  content: ProbeOutcome;
}

function getConfigDescription(key: string, provider: string) {
  const normalizedProvider = provider.trim().toLowerCase();

  if (key === "stage1ModelApiConfig" && normalizedProvider === "deepseek") {
    return "第一阶段模型同时承担关键词生成和文件夹资料解析，DeepSeek 直连支持填写根域名或完整兼容接口地址；系统会自动补全为 chat/completions，接口密钥只填写纯 token。";
  }

  if (key === "contentModelApiConfig" && normalizedProvider === "deepseek") {
    return "DeepSeek 直连支持填写根域名或完整兼容接口地址；系统会自动补全为 chat/completions，接口密钥只填写纯 token。";
  }

  if (key === "stage1ModelApiConfig") {
    return "第一阶段模型固定使用 newapi-auto 自动探测模式。你只需要填写 API 地址、密钥、模型名称和超时；系统会自动尝试常见的 endpoint 与鉴权头组合，并直接生成 10 条 AI 提问句。建议优先填写纯根域名或 /v1 地址，当前建议超时时间不低于 120000ms。";
  }

  if (key === "imageModelApiConfig") {
    if (normalizedProvider === "newapi-auto") {
      return "图片模型配置支持统一展示为 newapi-auto，但当前仅用于统一配置语义，不承诺该 key 可直接驱动图片真生成；图片运行时仍优先按现有 Vidu / prompt-url 逻辑执行。";
    }
    return "图片链路当前支持 Vidu 真生成，也保留 prompt-url 回退模式。若填写 Vidu，建议只填写 API 根地址，系统会自动拼接图片生成与任务查询接口。";
  }

  if (key === "publishApiConfig") {
    return "发布链路当前面向今日头条真发布工作台。本轮主链路仅打通今日头条，并优先通过 Electron 执行真实图文发布。";
  }

  return "";
}

export function SettingsForm({ initialConfig }: { initialConfig: AppConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [message, setMessage] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  async function save() {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const payload = await response.json();
    setMessage(response.ok ? "配置已保存。" : payload.error ?? "保存失败。");
  }

  async function probe() {
    setProbing(true);
    setProbeResult(null);
    try {
      const response = await fetch("/api/config/probe", { method: "POST" });
      const payload = await response.json() as ProbeResult;
      setProbeResult(payload);
    } catch {
      setProbeResult({ stage1: { ok: false, error: "请求失败" }, content: { ok: false, error: "请求失败" } });
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {Object.entries(config).map(([key, value]) => (
        <div key={key} className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="label-base">{formatConfigGroupLabel(key)}</p>
          {getConfigDescription(key, String(value.provider ?? "")) ? (
            <p className="mt-2 text-sm leading-6 text-slate-400">{getConfigDescription(key, String(value.provider ?? ""))}</p>
          ) : null}
          {key === "stage1ModelApiConfig" ? (
            <p className="mt-3 text-xs font-medium text-sky-300">
              供应商固定：newapi-auto。示例：`https://xxx.com`、`https://xxx.com/v1`、`https://xxx.com/v1/chat/completions`
            </p>
          ) : null}
          <div className="space-y-3">
            {Object.entries(value)
              .filter(([field]) => !(key === "stage1ModelApiConfig" && field === "provider"))
              .map(([field, fieldValue]) => (
              <label key={field}>
                <span className="label-base">{formatConfigFieldLabel(field)}</span>
                {typeof fieldValue === "boolean" ? (
                  <select
                    className="input-base"
                    value={fieldValue ? "true" : "false"}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        [key]: {
                          ...value,
                          [field]: event.target.value === "true",
                        },
                      })
                    }
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className="input-base"
                    value={String(fieldValue ?? "")}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        [key]: {
                          ...value,
                            [field]:
                              field === "timeout" || field === "publishTimeoutMs" || field === "timeoutMs" || field === "maxHitsPerSource"
                                ? Number(event.target.value)
                                : event.target.value,
                        },
                      })
                    }
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button className="rounded-2xl bg-accent px-5 py-4 text-sm font-semibold text-slate-950" onClick={save}>
        保存本地配置
      </button>
      <button
        className="flex items-center justify-center gap-2 rounded-2xl border border-stroke bg-white/5 px-5 py-4 text-sm font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
        onClick={probe}
        disabled={probing}
      >
        {probing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {probing ? "探测中..." : "测试模型连接"}
      </button>
      {probeResult && (
        <div className="col-span-full rounded-2xl border border-stroke bg-white/5 p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">模型探测结果</p>
          {(["stage1", "content"] as const).map((key) => {
            const outcome = probeResult[key];
            const label = key === "stage1" ? "第一阶段模型" : "内容模型";
            return (
              <div key={key} className={`rounded-xl border p-4 ${outcome.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-danger/20 bg-danger/5"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {outcome.ok
                    ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                    : <XCircle className="h-4 w-4 text-danger" />}
                  <span className="text-sm font-semibold text-ink">{label}</span>
                  <span className={`ml-auto text-xs font-medium ${outcome.ok ? "text-emerald-400" : "text-danger"}`}>
                    {outcome.ok ? "连接正常" : "连接失败"}
                  </span>
                </div>
                {outcome.isMockFallback && (
                  <div className="mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
                    当前结果来自模拟回退（mock fallback），未连接到真实 API
                  </div>
                )}
                {outcome.provider && (
                  <p className="text-[11px] text-muted mb-1">供应商：{outcome.provider}</p>
                )}
                {outcome.endpoint && (
                  <p className="font-mono text-[11px] text-muted break-all">{outcome.endpoint}</p>
                )}
                {outcome.attempts && outcome.attempts.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted">探测尝试：{outcome.attempts.length} 次</p>
                )}
                {outcome.error && (
                  <p className="mt-1 text-xs text-danger">{outcome.error}</p>
                )}
                {outcome.attempts && outcome.attempts.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {outcome.attempts.map((attempt, i) => (
                      <li key={i} className="font-mono text-[10px] text-muted/70">
                        {attempt.authMode ?? "?"} → {attempt.endpoint ?? "?"} ({attempt.error ?? "UNKNOWN"})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      {message ? <p className="text-sm text-slate-300">{message}</p> : null}
    </div>
  );
}
