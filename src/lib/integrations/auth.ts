export function normalizeApiKey(rawValue?: string) {
  if (!rawValue) {
    return "";
  }

  let value = rawValue.trim();
  value = value.replace(/^[`'"]+|[`'"]+$/g, "");

  value = value.replace(/^Bearer\s+/i, "");
  value = value.replace(/^[A-Za-z0-9_-]+\s*[:：]\s*/u, "");

  return value.trim();
}

export interface AuthHeaderCandidate {
  label: string;
  headers: Record<string, string>;
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

export function buildAuthHeaderCandidates(apiKey?: string): AuthHeaderCandidate[] {
  const normalizedApiKey = normalizeApiKey(apiKey);
  const baseHeaders = {
    "Content-Type": "application/json",
  };

  if (!normalizedApiKey) {
    return [{ label: "none", headers: baseHeaders }];
  }

  return [
    {
      label: "authorization-bearer",
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${normalizedApiKey}`,
      },
    },
    {
      label: "x-api-key",
      headers: {
        ...baseHeaders,
        "x-api-key": normalizedApiKey,
      },
    },
    {
      label: "api-key",
      headers: {
        ...baseHeaders,
        "api-key": normalizedApiKey,
      },
    },
  ];
}
