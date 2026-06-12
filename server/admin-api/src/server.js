import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { adminLicense, hashLicenseCode, publicLicense } from "./license-presenter.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT ?? 8080);
const releaseBaseUrl = (process.env.RELEASE_BASE_URL ?? "").replace(/\/$/, "");
const releasesDir = process.env.RELEASES_DIR ?? "/var/www/releases";
const releaseUploadLimit = process.env.RELEASE_UPLOAD_LIMIT ?? "500mb";
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const publicRateLimitMax = Number(process.env.PUBLIC_RATE_LIMIT_MAX ?? 60);
const adminRateLimitMax = Number(process.env.ADMIN_RATE_LIMIT_MAX ?? 300);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const feedbackTypes = new Set([
  "模型连接问题",
  "内容生成问题",
  "账号登录问题",
  "发布失败问题",
  "界面体验问题",
  "其他问题",
]);

const feedbackStatuses = new Set(["new", "processing", "resolved", "ignored"]);
const licenseStatuses = new Set(["available", "active", "expired", "disabled"]);
const allowedReleaseExtensions = new Set([".exe", ".msi", ".zip", ".7z"]);
const rateLimitBuckets = new Map();

function trimString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function jsonLog(level, message, fields = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    service: "geo-admin-api",
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

function getClientIp(request) {
  return (
    String(request.headers["x-forwarded-for"] ?? "")
      .split(",")[0]
      .trim() ||
    request.ip ||
    request.socket.remoteAddress ||
    "unknown"
  );
}

function createRateLimiter({ name, max }) {
  return (request, response, next) => {
    const now = Date.now();
    const ip = getClientIp(request);
    const key = `${name}:${ip}`;
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      response.set("Retry-After", String(retryAfter));
      response.status(429).json({ error: "Too many requests" });
      jsonLog("warn", "rate_limit_exceeded", { route: request.path, method: request.method, ip, limiter: name });
      return;
    }

    next();
  };
}

function compareVersions(left, right) {
  const leftParts = String(left)
    .split(".")
    .map((part) => Number.parseInt(part.replace(/\D.*/, ""), 10) || 0);
  const rightParts = String(right)
    .split(".")
    .map((part) => Number.parseInt(part.replace(/\D.*/, ""), 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function normalizeReleasePath(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return "";
  }
  return normalized.startsWith("releases/") ? normalized.slice("releases/".length) : normalized;
}

function safeFileName(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160) || "";
}

function decodeHeader(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function generateLicenseCode() {
  const bytes = crypto.randomBytes(12).toString("hex").toUpperCase();
  return `GEO-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 24)}`;
}

function buildReleaseUrl(artifactPath) {
  const normalizedPath = `/releases/${artifactPath}`;
  return releaseBaseUrl ? `${releaseBaseUrl}${normalizedPath}` : normalizedPath;
}

function toRelease(row) {
  const artifactPath = normalizeReleasePath(row.artifact_path);
  return {
    id: row.id,
    version: row.version,
    platform: row.platform,
    arch: row.arch,
    channel: row.channel,
    artifactPath,
    downloadUrl: artifactPath ? buildReleaseUrl(artifactPath) : "",
    sha256: row.sha256,
    size: Number(row.size ?? 0),
    notesPath: row.notes_path,
    minSupportedVersion: row.min_supported_version,
    mandatory: Boolean(row.mandatory),
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

async function readTextIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function buildReleaseManifestFromRow(row, currentVersion) {
  const artifactPath = normalizeReleasePath(row.artifact_path);
  const notesPath = normalizeReleasePath(row.notes_path);
  if (!artifactPath) {
    throw new Error("Release artifact path is invalid");
  }

  const artifactStats = await fs.stat(path.join(releasesDir, artifactPath)).catch(() => null);
  const notes = notesPath ? await readTextIfPresent(path.join(releasesDir, notesPath)) : "";

  const asset = {
    url: buildReleaseUrl(artifactPath),
    sha256: row.sha256,
    size: artifactStats?.size ?? Number(row.size ?? 0),
  };

  return {
    version: row.version,
    channel: row.channel ?? "stable",
    minSupportedVersion: row.min_supported_version || undefined,
    publishedAt: row.published_at,
    notes,
    platform: row.platform,
    arch: row.arch,
    asset,
    windows: asset,
    mandatory: Boolean(row.mandatory),
    updateAvailable: compareVersions(row.version, currentVersion) > 0,
    currentVersion,
  };
}

async function readStaticLatestManifest(currentVersion) {
  const manifestPath = path.join(releasesDir, "latest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const windows = manifest.windows ?? {};
  const artifactPath = normalizeReleasePath(windows.path ?? "");

  const platform = String(manifest.platform ?? "win32");
  const arch = String(manifest.arch ?? "x64");
  const asset = {
    url: String(windows.url || (artifactPath ? buildReleaseUrl(artifactPath) : "")),
    sha256: String(windows.sha256 ?? ""),
    size: Number(windows.size ?? 0),
  };

  return {
    version: String(manifest.version ?? ""),
    channel: String(manifest.channel ?? "stable"),
    minSupportedVersion: manifest.minSupportedVersion,
    publishedAt: manifest.publishedAt,
    notes: String(manifest.notes ?? ""),
    platform,
    arch,
    asset,
    windows: asset,
    mandatory: Boolean(manifest.mandatory),
    updateAvailable: compareVersions(String(manifest.version ?? "0.0.0"), currentVersion) > 0,
    currentVersion,
  };
}

function requireAdmin(request, response, next) {
  const configuredUser = process.env.ADMIN_USERNAME;
  const configuredPassword = process.env.ADMIN_PASSWORD;

  if (!configuredUser || !configuredPassword) {
    response.status(503).json({ error: "Admin credentials are not configured" });
    return;
  }

  const header = request.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    response.set("WWW-Authenticate", 'Basic realm="GEO Admin"');
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  const [username, password] = Buffer.from(encoded, "base64").toString("utf8").split(":");
  if (username !== configuredUser || password !== configuredPassword) {
    response.status(403).json({ error: "Invalid credentials" });
    return;
  }

  next();
}

function toFeedback(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    contact: row.contact,
    appVersion: row.app_version,
    deviceFingerprint: row.device_fingerprint,
    deviceLabel: row.device_label,
    os: row.os,
    clientTime: row.client_time,
    serverTime: row.server_time,
    status: row.status,
    handlerNote: row.handler_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function migrate() {
  const schema = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(schema);

  const migrationsDir = path.join(__dirname, "..", "db", "migrations");
  const entries = await fs.readdir(migrationsDir).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });

  for (const fileName of entries.filter((item) => item.endsWith(".sql")).sort()) {
    const version = fileName.replace(/\.sql$/, "");
    const existing = await pool.query("SELECT version FROM schema_migrations WHERE version = $1", [version]);
    if (existing.rowCount > 0) {
      continue;
    }

    const migrationSql = await fs.readFile(path.join(migrationsDir, fileName), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(migrationSql);
      await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await pool.query("COMMIT");
      jsonLog("info", "migration_applied", { version });
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

async function upsertDevice(fingerprint, platform, machineCode = "") {
  if (!fingerprint) {
    return null;
  }

  const result = await pool.query(
    `
      INSERT INTO devices (fingerprint, machine_code, device_label, last_seen_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (fingerprint)
      DO UPDATE SET
        machine_code = COALESCE(NULLIF(EXCLUDED.machine_code, ''), devices.machine_code),
        device_label = COALESCE(NULLIF(EXCLUDED.device_label, ''), devices.device_label),
        last_seen_at = NOW()
      RETURNING *
    `,
    [fingerprint, machineCode, platform],
  );
  return result.rows[0];
}

const app = express();
const publicRateLimit = createRateLimiter({ name: "public", max: publicRateLimitMax });
const adminRateLimit = createRateLimiter({ name: "admin", max: adminRateLimitMax });
const releaseUpload = express.raw({ type: "application/octet-stream", limit: releaseUploadLimit });

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "64kb" }));
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    jsonLog("info", "http_request", {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
      ip: getClientIp(request),
    });
  });
  next();
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/feedback", publicRateLimit, async (request, response) => {
  const payload = request.body ?? {};
  const type = trimString(payload.type, 40);
  const message = trimString(payload.message, 4000);
  const id = trimString(payload.id, 120);

  if (!id || !feedbackTypes.has(type) || !message) {
    response.status(400).json({ error: "Invalid feedback payload" });
    return;
  }

  const contact = trimString(payload.contact, 200);
  const appVersion = trimString(payload.appVersion, 80);
  const deviceFingerprint = trimString(payload.deviceFingerprint, 200);
  const platform = trimString(payload.platform, 120);
  const clientTime = trimString(payload.clientTime, 80);
  const createdAt = trimString(payload.createdAt, 80);

  try {
    await upsertDevice(deviceFingerprint, platform);
    const result = await pool.query(
      `
        INSERT INTO feedback_submissions (
          id, type, message, contact, app_version, device_fingerprint,
          device_label, os, client_time, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, COALESCE($9::timestamptz, NOW()), NOW())
        ON CONFLICT (id)
        DO UPDATE SET updated_at = NOW()
        RETURNING *
      `,
      [id, type, message, contact, appVersion, deviceFingerprint, platform, clientTime || null, createdAt || null],
    );

    response.status(201).json({ feedback: toFeedback(result.rows[0]) });
  } catch (error) {
    jsonLog("error", "feedback_save_failed", { error: error instanceof Error ? error.message : String(error) });
    response.status(500).json({ error: error instanceof Error ? error.message : "Failed to save feedback" });
  }
});

app.get("/api/releases/latest", publicRateLimit, async (request, response) => {
  const platform = trimString(request.query.platform, 40) || "win32";
  const arch = trimString(request.query.arch, 40) || "x64";
  const currentVersion = trimString(request.query.version, 80) || "0.0.0";

  try {
    const result = await pool.query(
      `
        SELECT *
        FROM release_metadata
        WHERE platform = $1 AND arch = $2 AND published_at IS NOT NULL
        ORDER BY string_to_array(version, '.')::int[] DESC, published_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `,
      [platform, arch],
    );

    if (result.rowCount > 0) {
      response.json(await buildReleaseManifestFromRow(result.rows[0], currentVersion));
      return;
    }

    response.json(await readStaticLatestManifest(currentVersion));
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.status(404).json({ error: "Release manifest not found" });
      return;
    }

    response.status(500).json({ error: error instanceof Error ? error.message : "Failed to read release manifest" });
  }
});

app.post("/api/licenses/activate", publicRateLimit, async (request, response) => {
  const payload = request.body ?? {};
  const code = trimString(payload.licenseCode, 160);
  const deviceFingerprint = trimString(payload.deviceFingerprint, 200);
  const machineCode = trimString(payload.machineCode, 200);
  const deviceLabel = trimString(payload.deviceLabel, 200);
  const appVersion = trimString(payload.appVersion, 80);

  if (!code || !deviceFingerprint) {
    response.status(400).json({ error: "License code and device fingerprint are required" });
    return;
  }

  try {
    const licenseResult = await pool.query("SELECT * FROM license_codes WHERE code = $1", [code]);
    if (licenseResult.rowCount === 0) {
      response.status(404).json({ error: "License code not found" });
      return;
    }

    const license = licenseResult.rows[0];
    if (license.status === "disabled") {
      response.status(403).json({ error: "License code is disabled" });
      return;
    }
    if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
      await pool.query("UPDATE license_codes SET status = 'expired' WHERE id = $1", [license.id]);
      response.status(403).json({ error: "License code has expired" });
      return;
    }

    const device = await upsertDevice(deviceFingerprint, deviceLabel, machineCode);
    if (!device || device.status === "disabled") {
      response.status(403).json({ error: "Device is disabled" });
      return;
    }

    const activeBindings = await pool.query(
      "SELECT COUNT(*)::int AS count FROM device_license_bindings WHERE license_code_id = $1 AND status = 'active' AND revoked_at IS NULL",
      [license.id],
    );
    const existingBinding = await pool.query(
      "SELECT * FROM device_license_bindings WHERE license_code_id = $1 AND device_id = $2 AND status = 'active' AND revoked_at IS NULL",
      [license.id, device.id],
    );

    if (existingBinding.rowCount === 0 && activeBindings.rows[0].count >= license.max_devices) {
      response.status(409).json({ error: "License device limit reached" });
      return;
    }

    const bindingResult = await pool.query(
      `
        INSERT INTO device_license_bindings (device_id, license_code_id, machine_code, app_version, last_checked_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (device_id, license_code_id)
        DO UPDATE SET
          machine_code = EXCLUDED.machine_code,
          app_version = EXCLUDED.app_version,
          last_checked_at = NOW(),
          revoked_at = NULL,
          status = 'active'
        RETURNING *
      `,
      [device.id, license.id, machineCode, appVersion],
    );

    const updatedLicense = await pool.query(
      "UPDATE license_codes SET status = 'active', activated_at = COALESCE(activated_at, NOW()) WHERE id = $1 RETURNING *",
      [license.id],
    );

    response.json({
      license: publicLicense(updatedLicense.rows[0]),
      binding: bindingResult.rows[0],
      status: "active",
    });
  } catch (error) {
    jsonLog("error", "license_activation_failed", { error: error instanceof Error ? error.message : String(error) });
    response.status(500).json({ error: error instanceof Error ? error.message : "Failed to activate license" });
  }
});

app.get("/api/licenses/status", publicRateLimit, async (request, response) => {
  const deviceFingerprint = trimString(request.query.deviceFingerprint, 200);
  if (!deviceFingerprint) {
    response.status(400).json({ error: "Device fingerprint is required" });
    return;
  }

  const result = await pool.query(
    `
      SELECT b.*, l.code, l.max_devices, l.expires_at, l.status AS license_status, l.issued_to, l.created_at, l.activated_at
      FROM device_license_bindings b
      JOIN devices d ON d.id = b.device_id
      JOIN license_codes l ON l.id = b.license_code_id
      WHERE d.fingerprint = $1 AND b.status = 'active' AND b.revoked_at IS NULL
      ORDER BY b.bound_at DESC
      LIMIT 1
    `,
    [deviceFingerprint],
  );

  if (result.rowCount === 0) {
    response.json({ status: "inactive" });
    return;
  }

  const row = result.rows[0];
  const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
  response.json({
    status: expired || row.license_status === "expired" ? "expired" : row.license_status === "disabled" ? "disabled" : "active",
    license: {
      codeHash: hashLicenseCode(row.code),
      maxDevices: row.max_devices,
      expiresAt: row.expires_at,
      issuedTo: row.issued_to,
      createdAt: row.created_at,
      activatedAt: row.activated_at,
    },
    binding: {
      boundAt: row.bound_at,
      lastCheckedAt: row.last_checked_at,
      appVersion: row.app_version,
    },
  });
});

app.get("/api/admin/feedback", adminRateLimit, requireAdmin, async (request, response) => {
  const clauses = [];
  const values = [];

  const filterMap = [
    ["type", "type"],
    ["status", "status"],
    ["version", "app_version"],
    ["device", "device_fingerprint"],
  ];

  for (const [queryKey, column] of filterMap) {
    const value = trimString(request.query[queryKey], 200);
    if (value) {
      values.push(value);
      clauses.push(`${column} = $${values.length}`);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM feedback_submissions ${where} ORDER BY created_at DESC LIMIT 200`,
    values,
  );

  response.json({ feedback: result.rows.map(toFeedback) });
});

app.get("/api/admin/feedback/:id", adminRateLimit, requireAdmin, async (request, response) => {
  const result = await pool.query("SELECT * FROM feedback_submissions WHERE id = $1", [request.params.id]);
  if (result.rowCount === 0) {
    response.status(404).json({ error: "Feedback not found" });
    return;
  }

  response.json({ feedback: toFeedback(result.rows[0]) });
});

app.patch("/api/admin/feedback/:id", adminRateLimit, requireAdmin, async (request, response) => {
  const status = trimString(request.body?.status, 40);
  const handlerNote = trimString(request.body?.handlerNote, 2000);

  if (!feedbackStatuses.has(status)) {
    response.status(400).json({ error: "Invalid feedback status" });
    return;
  }

  const result = await pool.query(
    `
      UPDATE feedback_submissions
      SET status = $1, handler_note = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `,
    [status, handlerNote, request.params.id],
  );

  if (result.rowCount === 0) {
    response.status(404).json({ error: "Feedback not found" });
    return;
  }

  response.json({ feedback: toFeedback(result.rows[0]) });
});

app.get("/api/admin/devices", adminRateLimit, requireAdmin, async (_request, response) => {
  const result = await pool.query("SELECT * FROM devices ORDER BY last_seen_at DESC LIMIT 200");
  response.json({ devices: result.rows });
});

app.get("/api/admin/license-codes", adminRateLimit, requireAdmin, async (_request, response) => {
  const result = await pool.query("SELECT * FROM license_codes ORDER BY created_at DESC LIMIT 200");
  response.json({ licenseCodes: result.rows.map(adminLicense) });
});

app.post("/api/admin/license-codes", adminRateLimit, requireAdmin, async (request, response) => {
  const code = trimString(request.body?.code, 160) || generateLicenseCode();
  const maxDevices = Math.max(1, Number.parseInt(String(request.body?.maxDevices ?? "1"), 10) || 1);
  const expiresAt = trimString(request.body?.expiresAt, 80) || null;
  const issuedTo = trimString(request.body?.issuedTo, 200);
  const notes = trimString(request.body?.notes, 2000);

  if (!code) {
    response.status(400).json({ error: "License code is required" });
    return;
  }

  const result = await pool.query(
    `
      INSERT INTO license_codes (code, code_hash, max_devices, expires_at, issued_to, notes)
      VALUES ($1, $2, $3, $4::timestamptz, $5, $6)
      RETURNING *
    `,
    [code, hashLicenseCode(code), maxDevices, expiresAt, issuedTo, notes],
  );
  response.status(201).json({ license: adminLicense(result.rows[0]) });
});

app.patch("/api/admin/license-codes/:id", adminRateLimit, requireAdmin, async (request, response) => {
  const status = trimString(request.body?.status, 40);
  const disabledReason = trimString(request.body?.disabledReason, 500);
  if (!licenseStatuses.has(status)) {
    response.status(400).json({ error: "Invalid license status" });
    return;
  }

  const result = await pool.query(
    "UPDATE license_codes SET status = $1, disabled_reason = $2 WHERE id = $3 RETURNING *",
    [status, disabledReason, request.params.id],
  );
  if (result.rowCount === 0) {
    response.status(404).json({ error: "License not found" });
    return;
  }
  response.json({ license: adminLicense(result.rows[0]) });
});

app.get("/api/admin/device-license-bindings", adminRateLimit, requireAdmin, async (_request, response) => {
  const result = await pool.query(
    `
      SELECT b.*, d.fingerprint, d.device_label, l.code
      FROM device_license_bindings b
      JOIN devices d ON d.id = b.device_id
      JOIN license_codes l ON l.id = b.license_code_id
      ORDER BY b.bound_at DESC
      LIMIT 200
    `,
  );
  response.json({ bindings: result.rows });
});

app.post("/api/admin/license-codes/:id/reset-binding", adminRateLimit, requireAdmin, async (request, response) => {
  await pool.query("BEGIN");
  try {
    const licenseResult = await pool.query("SELECT * FROM license_codes WHERE id = $1 FOR UPDATE", [request.params.id]);
    if (licenseResult.rowCount === 0) {
      await pool.query("ROLLBACK");
      response.status(404).json({ error: "License not found" });
      return;
    }

    const license = licenseResult.rows[0];
    await pool.query(
      `
        UPDATE device_license_bindings
        SET status = 'revoked', revoked_at = NOW()
        WHERE license_code_id = $1 AND status = 'active' AND revoked_at IS NULL
      `,
      [license.id],
    );

    const nextStatus = license.status === "disabled" || license.status === "expired" ? license.status : "available";
    const updatedLicense = await pool.query(
      "UPDATE license_codes SET status = $1, activated_at = NULL WHERE id = $2 RETURNING *",
      [nextStatus, license.id],
    );

    await pool.query("COMMIT");
    response.json({ license: adminLicense(updatedLicense.rows[0]) });
  } catch (error) {
    await pool.query("ROLLBACK");
    jsonLog("error", "license_reset_failed", { error: error instanceof Error ? error.message : String(error) });
    response.status(500).json({ error: error instanceof Error ? error.message : "Failed to reset license binding" });
  }
});

app.get("/api/admin/releases", adminRateLimit, requireAdmin, async (_request, response) => {
  const result = await pool.query(
    `
      SELECT *
      FROM release_metadata
      ORDER BY created_at DESC
      LIMIT 200
    `,
  );
  response.json({ releases: result.rows.map(toRelease) });
});

app.post("/api/admin/releases", adminRateLimit, requireAdmin, releaseUpload, async (request, response) => {
  const fileBuffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  const version = trimString(request.get("x-release-version"), 80);
  const platform = trimString(request.get("x-release-platform"), 40) || "win32";
  const arch = trimString(request.get("x-release-arch"), 40) || "x64";
  const channel = trimString(request.get("x-release-channel"), 40) || "stable";
  const originalName = safeFileName(decodeHeader(request.get("x-release-file-name")));
  const notes = decodeHeader(request.get("x-release-notes"));
  const minSupportedVersion = trimString(request.get("x-release-min-supported-version"), 80);
  const mandatory = request.get("x-release-mandatory") === "true";
  const extension = path.extname(originalName).toLowerCase();

  if (!version || !fileBuffer.length || !originalName) {
    response.status(400).json({ error: "Release version, file name, and package body are required" });
    return;
  }
  if (!allowedReleaseExtensions.has(extension)) {
    response.status(400).json({ error: "Release package type is not allowed" });
    return;
  }

  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const releaseFolder = path.join(releasesDir, version, platform, arch);
  const artifactName = `${version}-${Date.now()}-${originalName}`;
  const artifactPath = path.posix.join(version, platform, arch, artifactName);
  const notesPath = notes ? path.posix.join(version, platform, arch, `notes-${version}.md`) : "";

  try {
    await fs.mkdir(releaseFolder, { recursive: true });
    await fs.writeFile(path.join(releaseFolder, artifactName), fileBuffer);
    if (notesPath) {
      await fs.writeFile(path.join(releaseFolder, `notes-${version}.md`), notes, "utf8");
    }

    const result = await pool.query(
      `
        INSERT INTO release_metadata (
          version, platform, arch, channel, artifact_path, sha256, size,
          notes_path, min_supported_version, mandatory
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (version, platform, arch)
        DO UPDATE SET
          channel = EXCLUDED.channel,
          artifact_path = EXCLUDED.artifact_path,
          sha256 = EXCLUDED.sha256,
          size = EXCLUDED.size,
          notes_path = EXCLUDED.notes_path,
          min_supported_version = EXCLUDED.min_supported_version,
          mandatory = EXCLUDED.mandatory,
          published_at = NULL
        RETURNING *
      `,
      [version, platform, arch, channel, artifactPath, sha256, fileBuffer.length, notesPath, minSupportedVersion, mandatory],
    );

    response.status(201).json({ release: toRelease(result.rows[0]) });
  } catch (error) {
    jsonLog("error", "release_upload_failed", { error: error instanceof Error ? error.message : String(error), version, platform, arch });
    response.status(500).json({ error: error instanceof Error ? error.message : "Failed to upload release" });
  }
});

app.post("/api/admin/releases/:id/publish", adminRateLimit, requireAdmin, async (request, response) => {
  const result = await pool.query(
    "UPDATE release_metadata SET published_at = NOW() WHERE id = $1 RETURNING *",
    [request.params.id],
  );
  if (result.rowCount === 0) {
    response.status(404).json({ error: "Release not found" });
    return;
  }
  response.json({ release: toRelease(result.rows[0]) });
});

app.patch("/api/admin/releases/:id", adminRateLimit, requireAdmin, async (request, response) => {
  const mandatory = Boolean(request.body?.mandatory);
  const minSupportedVersion = trimString(request.body?.minSupportedVersion, 80);
  const result = await pool.query(
    `
      UPDATE release_metadata
      SET mandatory = $1, min_supported_version = $2
      WHERE id = $3
      RETURNING *
    `,
    [mandatory, minSupportedVersion, request.params.id],
  );
  if (result.rowCount === 0) {
    response.status(404).json({ error: "Release not found" });
    return;
  }
  response.json({ release: toRelease(result.rows[0]) });
});

await migrate();
app.listen(port, () => {
  jsonLog("info", "server_started", { port });
});
