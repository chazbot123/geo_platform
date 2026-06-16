function hasChinese(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

export function toUserFacingErrorMessage(value: unknown, fallback: string) {
  const message = value instanceof Error ? value.message : String(value || "").trim();
  if (!message) return fallback;
  if (hasChinese(message)) return message;

  const normalized = message.toLowerCase();
  if (normalized.includes("release manifest not found") || normalized.includes("manifest not found")) {
    return "未找到更新发布清单，请确认服务端已上传当前平台的安装包和版本信息。";
  }
  if (normalized.includes("fetch failed") || normalized.includes("networkerror") || normalized.includes("failed to fetch")) {
    return "网络连接失败，请检查网络后重试。";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "请求超时，请稍后重试。";
  }
  if (normalized.includes("unauthorized") || normalized.includes("invalid token") || normalized.includes("invalid api key")) {
    return "认证失败，请重新登录或检查授权配置。";
  }
  if (normalized.includes("forbidden") || normalized.includes("permission denied")) {
    return "当前账号没有执行此操作的权限，请检查账号权限。";
  }
  if (normalized.includes("not found")) {
    return "未找到对应资源，请确认配置是否正确。";
  }
  if (normalized.includes("service unavailable") || normalized.includes("bad gateway")) {
    return "服务暂时不可用，请稍后重试。";
  }

  return fallback;
}
