CREATE TABLE IF NOT EXISTS feedback_submissions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  device_fingerprint TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  client_time TIMESTAMPTZ,
  server_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'processing', 'resolved', 'ignored')),
  handler_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_type_idx ON feedback_submissions(type);
CREATE INDEX IF NOT EXISTS feedback_submissions_status_idx ON feedback_submissions(status);
CREATE INDEX IF NOT EXISTS feedback_submissions_app_version_idx ON feedback_submissions(app_version);
CREATE INDEX IF NOT EXISTS feedback_submissions_device_fingerprint_idx ON feedback_submissions(device_fingerprint);

CREATE TABLE IF NOT EXISTS devices (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  machine_code TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending'))
);

CREATE TABLE IF NOT EXISTS license_codes (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL DEFAULT '',
  max_devices INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'active', 'expired', 'disabled')),
  issued_to TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  disabled_reason TEXT NOT NULL DEFAULT '',
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_license_bindings (
  id BIGSERIAL PRIMARY KEY,
  device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  license_code_id BIGINT NOT NULL REFERENCES license_codes(id) ON DELETE CASCADE,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_code TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  last_checked_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  UNIQUE (device_id, license_code_id)
);

CREATE TABLE IF NOT EXISTS release_metadata (
  id BIGSERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'stable',
  artifact_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  notes_path TEXT NOT NULL DEFAULT '',
  min_supported_version TEXT NOT NULL DEFAULT '',
  mandatory BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (version, platform, arch)
);

ALTER TABLE release_metadata ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'stable';
ALTER TABLE release_metadata ADD COLUMN IF NOT EXISTS size BIGINT NOT NULL DEFAULT 0;
ALTER TABLE release_metadata ADD COLUMN IF NOT EXISTS min_supported_version TEXT NOT NULL DEFAULT '';
ALTER TABLE release_metadata ADD COLUMN IF NOT EXISTS mandatory BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS code_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS issued_to TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS disabled_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE device_license_bindings ADD COLUMN IF NOT EXISTS machine_code TEXT NOT NULL DEFAULT '';
ALTER TABLE device_license_bindings ADD COLUMN IF NOT EXISTS app_version TEXT NOT NULL DEFAULT '';
ALTER TABLE device_license_bindings ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS release_metadata_lookup_idx ON release_metadata(platform, arch, published_at DESC);
CREATE INDEX IF NOT EXISTS license_codes_status_idx ON license_codes(status);
CREATE INDEX IF NOT EXISTS device_license_bindings_status_idx ON device_license_bindings(status);
