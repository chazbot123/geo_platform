export function toDisplayImageSrc(source?: string | null) {
  const raw = String(source ?? "").trim();
  if (!raw) return "";

  if (/^(https?:|data:|blob:|file:|\/)/i.test(raw)) {
    return raw;
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    const normalized = raw.replace(/\\/g, "/");
    const [drive, ...segments] = normalized.split("/");
    return `file:///${drive}/${segments.map(encodeURIComponent).join("/")}`;
  }

  if (/^\\\\/.test(raw)) {
    const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    return `file:////${normalized.split("/").map(encodeURIComponent).join("/")}`;
  }

  return raw;
}

export function toDisplayImageItems(remoteSources: string[] = [], localSources: string[] = []) {
  const maxLength = Math.max(remoteSources.length, localSources.length);
  return Array.from({ length: maxLength }, (_, index) => {
    const rawSource = remoteSources[index] || localSources[index] || "";
    const displaySrc = toDisplayImageSrc(rawSource);
    return {
      key: `${rawSource || displaySrc || "image"}-${index}`,
      rawSource,
      displaySrc,
    };
  }).filter((item) => item.displaySrc);
}
