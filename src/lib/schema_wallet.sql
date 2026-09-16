-- ============================================================
--  Wallet + RFID card tables (Phase: RFID wallet payment)
--  Same "server is source of truth" rule as UPI:
--  the card is only an IDENTITY token. Balance lives HERE.
-- ============================================================

-- A customer who owns a wallet.
CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | blocked
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wallet balance per customer. amount in PAISE (100 = Rs.1).
CREATE TABLE IF NOT EXISTS wallets (
  customer_id   UUID PRIMARY KEY REFERENCES customers(id),
  balance_paise INTEGER NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Physical RFID cards mapped to a customer.
-- card_uid = the UID read by the RC522 (hex string, e.g. "A1B2C3D4").
-- NOTE: for the prototype we trust the UID. For PRODUCTION move to
-- DESFire challenge-response so a cloned UID cannot pass (see notes).
CREATE TABLE IF NOT EXISTS cards (
  card_uid      TEXT PRIMARY KEY,
  customer_id   UUID NOT NULL REFERENCES customers(id),
  status        TEXT NOT NULL DEFAULT 'active',   -- active | lost | disabled
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cards_customer ON cards(customer_id);

-- Append-only money movement log. NEVER change a balance without a row here.
-- type: TOPUP (+) | DEBIT (-) | REFUND (+)
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   UUID NOT NULL REFERENCES customers(id),
  delta_paise   INTEGER NOT NULL,                 -- +topup / -debit
  type          TEXT NOT NULL,
  session_id    UUID,                             -- linked session for a DEBIT
  balance_after INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON wallet_ledger(customer_id);

-- Idempotency guard: the ESP32 sends a unique client_txn_id per tap.
-- If the same id arrives twice (retry after timeout), we DON'T double-charge.
CREATE TABLE IF NOT EXISTS rfid_charges (
  client_txn_id TEXT PRIMARY KEY,                 -- nonce from the machine
  session_id    UUID,
  card_uid      TEXT,
  amount_paise  INTEGER,
  result        TEXT,                             -- PAID | INSUFFICIENT | ERROR
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
