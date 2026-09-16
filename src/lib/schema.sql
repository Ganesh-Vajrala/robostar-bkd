-- ============================================================
--  Massage Box - core schema (machines, packages, sessions, payments)
-- ============================================================

CREATE TABLE IF NOT EXISTS machines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS packages (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  duration_sec  INTEGER NOT NULL,
  amount_paise  INTEGER NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  machine_id    TEXT NOT NULL REFERENCES machines(id),
  package_id    TEXT NOT NULL REFERENCES packages(id),
  amount_paise  INTEGER NOT NULL,
  method        TEXT NOT NULL DEFAULT 'upi',      -- upi | rfid | wallet_qr
  status        TEXT NOT NULL DEFAULT 'PENDING',
                -- PENDING -> PAID -> STARTED -> ENDED / EXPIRED / FAILED / CANCELLED
  qr_code_id    TEXT,
  qr_image_url  TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_qr   ON sessions(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mach ON sessions(machine_id);

CREATE TABLE IF NOT EXISTS payments (
  payment_id    TEXT PRIMARY KEY,
  session_id    UUID REFERENCES sessions(id),
  rrn           TEXT,
  amount_paise  INTEGER NOT NULL,
  status        TEXT NOT NULL,
  vpa           TEXT,
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  event         TEXT,
  payload       JSONB,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
