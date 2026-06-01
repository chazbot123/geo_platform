﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿"use client";

import { useState } from "react";
import type { AppConfig } from "@/lib/types";
import { formatConfigFieldLabel, formatConfigGroupLabel } from "@/lib/utils";

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

  async function save() {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const payload = await response.json();
    setMessage(response.ok ? "配置已保存。" : payload.error ?? "保存失败。");
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
      {message ? <p className="text-sm text-slate-300">{message}</p> : null}
    </div>
  );
}
