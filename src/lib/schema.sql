-- ============================================================
--  Massage Box - Phase 0 schema (Direct UPI only)
--  Source of truth for machines, packages, sessions, payments.
-- ============================================================

-- Machines / boxes in the field.
CREATE TABLE IF NOT EXISTS machines (
  id            TEXT PRIMARY KEY,              -- e.g. 'MC-HYD-001'
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',-- active | disabled
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Massage packages (duration + price). Amount is in PAISE (100 = Rs.1).
CREATE TABLE IF NOT EXISTS packages (
  id            TEXT PRIMARY KEY,              -- e.g. 'PKG_15'
  label         TEXT NOT NULL,                 -- '15 min Relax'
  duration_sec  INTEGER NOT NULL,             -- 900
  amount_paise  INTEGER NOT NULL,             -- 10000 = Rs.100
  active        BOOLEAN NOT NULL DEFAULT true
);

-- One row per customer tap-to-pay attempt.
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  machine_id    TEXT NOT NULL REFERENCES machines(id),
  package_id    TEXT NOT NULL REFERENCES packages(id),
  amount_paise  INTEGER NOT NULL,
  method        TEXT NOT NULL DEFAULT 'upi',   -- upi (wallet/rfid added later)
  status        TEXT NOT NULL DEFAULT 'PENDING',
                -- PENDING -> PAID -> STARTED -> ENDED
                -- or PENDING -> EXPIRED / FAILED / CANCELLED
  qr_code_id    TEXT,                          -- Razorpay qr_xxx id
  qr_image_url  TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_qr   ON sessions(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_sessions_mach ON sessions(machine_id);

-- One row per real money movement. payment_id is unique => idempotency,
-- so a replayed/duplicate webhook can never start a chair twice.
CREATE TABLE IF NOT EXISTS payments (
  payment_id    TEXT PRIMARY KEY,              -- Razorpay pay_xxx
  session_id    UUID REFERENCES sessions(id),
  rrn           TEXT,                          -- bank reference number
  amount_paise  INTEGER NOT NULL,
  status        TEXT NOT NULL,                 -- captured | failed | refunded
  vpa           TEXT,
  raw           JSONB,                         -- full webhook entity for audit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only log of every webhook we received (debugging + audit trail).
CREATE TABLE IF NOT EXISTS webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  event         TEXT,
  payload       JSONB,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
