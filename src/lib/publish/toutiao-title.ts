export const TOUTIAO_TITLE_MAX_LENGTH = 30;

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function countToutiaoTitleLength(title: string) {
  return compactText(title).length;
}

export function normalizeToutiaoTitle(title: string, fallback = "") {
  const normalized = compactText(title || fallback).replace(/^[\s\-:：|]+|[\s\-:：|]+$/g, "");
  if (!normalized) {
    return compactText(fallback).slice(0, TOUTIAO_TITLE_MAX_LENGTH);
  }
  if (normalized.length <= TOUTIAO_TITLE_MAX_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, TOUTIAO_TITLE_MAX_LENGTH);
}
