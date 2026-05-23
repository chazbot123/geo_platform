"use client";

import { useState } from "react";
import type { AppConfig } from "@/lib/types";
import { formatConfigFieldLabel, formatConfigGroupLabel } from "@/lib/utils";

function getConfigDescription(key: string, provider: string) {
  if (key === "stage1ModelApiConfig" && provider === "deepseek") {
    return "第一阶段模型同时承担关键词生成和文件夹资料解析，DeepSeek 直连支持填写根域名或完整兼容接口地址；系统会自动补全为 chat/completions，接口密钥只填写纯 token。";
  }

  if (key === "contentModelApiConfig" && provider === "deepseek") {
    return "DeepSeek 直连支持填写根域名或完整兼容接口地址；系统会自动补全为 chat/completions，接口密钥只填写纯 token。";
  }

  if (key === "stage1ModelApiConfig") {
    return "第一阶段模型同时用于关键词生成和文件夹资料解析，建议超时时间不低于 60000ms。";
  }

  if (key === "imageModelApiConfig") {
    return "图片链路当前支持 Vidu 真生成，也保留 prompt-url 回退模式。若填写 Vidu，建议只填写 API 根地址，系统会自动拼接图片生成与任务查询接口。";
  }

  if (key === "publishApiConfig") {
    return "发布链路当前面向社媒真发布工作台。小红书默认走 Electron 自动化，抖音优先评估官方配置，条件不足时回退到 Electron 自动化。";
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
          <div className="space-y-3">
            {Object.entries(value).map(([field, fieldValue]) => (
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
                          [field]: field === "timeout" || field === "publishTimeoutMs" ? Number(event.target.value) : event.target.value,
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
