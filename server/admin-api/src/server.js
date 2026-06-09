import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PORT ?? 8080);
const releaseBaseUrl = (process.env.RELEASE_BASE_URL ?? "http://8.134.115.153").replace(/\/$/, "");
const releasesDir = process.env.RELEASES_DIR ?? "/var/www/releases";
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

function trimString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
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
    url: `${releaseBaseUrl}/releases/${artifactPath}`,
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
    url: String(windows.url ?? (artifactPath ? `${releaseBaseUrl}/releases/${artifactPath}` : "")),
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
    response.set("WWW-Authenticate", "Basic realm=\"GEO Admin\"");
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
}

async function upsertDevice(fingerprint, platform) {
  if (!fingerprint) {
    return;
  }

  await pool.query(
    `
      INSERT INTO devices (fingerprint, device_label, last_seen_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (fingerprint)
      DO UPDATE SET last_seen_at = NOW()
    `,
    [fingerprint, platform],
  );
}

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/feedback", async (request, response) => {
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
    response.status(500).json({ error: error instanceof Error ? error.message : "Failed to save feedback" });
  }
});

app.get("/api/releases/latest", async (request, response) => {
  const platform = trimString(request.query.platform, 40) || "win32";
  const arch = trimString(request.query.arch, 40) || "x64";
  const currentVersion = trimString(request.query.version, 80) || "0.0.0";

  try {
    const result = await pool.query(
      `
        SELECT *
        FROM release_metadata
        WHERE platform = $1 AND arch = $2
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

app.get("/api/admin/feedback", requireAdmin, async (request, response) => {
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

app.get("/api/admin/feedback/:id", requireAdmin, async (request, response) => {
  const result = await pool.query("SELECT * FROM feedback_submissions WHERE id = $1", [request.params.id]);
  if (result.rowCount === 0) {
    response.status(404).json({ error: "Feedback not found" });
    return;
  }

  response.json({ feedback: toFeedback(result.rows[0]) });
});

app.patch("/api/admin/feedback/:id", requireAdmin, async (request, response) => {
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

app.get("/api/admin/devices", requireAdmin, async (_request, response) => {
  const result = await pool.query("SELECT * FROM devices ORDER BY last_seen_at DESC LIMIT 200");
  response.json({ devices: result.rows });
});

app.get("/api/admin/license-codes", requireAdmin, async (_request, response) => {
  const result = await pool.query("SELECT * FROM license_codes ORDER BY created_at DESC LIMIT 200");
  response.json({ licenseCodes: result.rows });
});

app.get("/api/admin/device-license-bindings", requireAdmin, async (_request, response) => {
  const result = await pool.query(
    `
      SELECT b.*, d.fingerprint, l.code
      FROM device_license_bindings b
      JOIN devices d ON d.id = b.device_id
      JOIN license_codes l ON l.id = b.license_code_id
      ORDER BY b.bound_at DESC
      LIMIT 200
    `,
  );
  response.json({ bindings: result.rows });
});

await migrate();
app.listen(port, () => {
  console.log(`GEO admin API listening on ${port}`);
});
