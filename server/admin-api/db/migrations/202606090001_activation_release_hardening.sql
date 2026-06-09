ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS code_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS issued_to TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS disabled_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE device_license_bindings ADD COLUMN IF NOT EXISTS machine_code TEXT NOT NULL DEFAULT '';
ALTER TABLE device_license_bindings ADD COLUMN IF NOT EXISTS app_version TEXT NOT NULL DEFAULT '';
ALTER TABLE device_license_bindings ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS license_codes_status_idx ON license_codes(status);
CREATE INDEX IF NOT EXISTS device_license_bindings_status_idx ON device_license_bindings(status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'release_metadata_sha256_format_chk'
  ) THEN
    ALTER TABLE release_metadata
      ADD CONSTRAINT release_metadata_sha256_format_chk
      CHECK (sha256 ~ '^[A-Fa-f0-9]{64}$');
  END IF;
END $$;
