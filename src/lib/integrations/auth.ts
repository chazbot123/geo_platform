export function normalizeApiKey(rawValue?: string) {
  if (!rawValue) {
    return "";
  }

  let value = rawValue.trim();

  value = value.replace(/^Bearer\s+/i, "");
  value = value.replace(/^[A-Za-z0-9_-]+\s*[:：]\s*/u, "");

  return value.trim();
}

export function buildJsonAuthHeaders(apiKey?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const normalizedApiKey = normalizeApiKey(apiKey);
  if (normalizedApiKey) {
    headers.Authorization = `Bearer ${normalizedApiKey}`;
  }

  return headers;
}
