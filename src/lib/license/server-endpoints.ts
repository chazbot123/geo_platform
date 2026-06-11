const DEFAULT_ADMIN_API_HOST = "127.0.0.1";
const DEFAULT_ADMIN_API_PORT = "8080";

function readEnv(name: string) {
  return process.env[name]?.trim() || "";
}

function localAdminApiBaseUrl() {
  const configuredBaseUrl = readEnv("GEO_ADMIN_API_BASE_URL");
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const host = readEnv("GEO_ADMIN_API_HOST") || DEFAULT_ADMIN_API_HOST;
  const port = readEnv("GEO_ADMIN_API_PORT") || DEFAULT_ADMIN_API_PORT;
  return `http://${host}:${port}`;
}

export function resolveLicenseEndpoint(kind: "activate" | "status") {
  const configuredEndpoint =
    kind === "activate" ? readEnv("GEO_LICENSE_ACTIVATION_ENDPOINT") : readEnv("GEO_LICENSE_STATUS_ENDPOINT");
  if (configuredEndpoint) {
    return configuredEndpoint;
  }

  if (process.env.NODE_ENV === "production") {
    return "";
  }

  return `${localAdminApiBaseUrl()}/api/licenses/${kind}`;
}
