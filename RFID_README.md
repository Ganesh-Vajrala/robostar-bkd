# RFID Wallet Flow — End to End

Same security model as UPI: **the backend is the brain**. The RFID card is only an
**identity token** — the wallet balance lives server-side and is deducted atomically.

```
Tap card (RC522) → ESP32 reads UID → POST /rfid/charge {uid, package, client_txn_id}
        │
        ▼
Backend (ONE transaction):
   idempotency check → find card→customer→wallet (row-locked)
   → balance >= price? → deduct → ledger row → create PAID session
        │
        ▼
Return PAID + duration_sec → ESP32 starts chair → /started → (countdown) → /ended
```

## Why it's safe
- **Balance never on the card** — only the UID identifies the customer.
- **Atomic deduct** — `SELECT ... FOR UPDATE` locks the wallet row, so two fast taps
  can't spend the same money twice.
- **Idempotent** — the ESP32 sends a unique `client_txn_id` per tap. A retry after a
  network timeout returns the *same* result instead of charging again.
- **Chair starts only on `PAID`** — never on the card read alone.

## Setup (adds to the core backend)
```bash
npm run migrate          # core tables (machines/packages/sessions/payments)
npm run migrate:wallet   # customers / wallets / cards / ledger / rfid_charges
npm run seed             # demo machine + 3 packages (₹100/₹200/₹300)
npm run seed:wallet      # demo customer + ₹500 wallet + demo card UID
```
Set `DEMO_CARD_UID` in `.env` to the UID your RC522 prints, then re-run `seed:wallet`.

## Test WITHOUT hardware
```bash
npm start                # terminal A
npm run sim:rfid         # terminal B  (or: node src/lib/rfid-sim.js PKG_20)
```
You'll see: balance → charge → new balance → "start chair" → "ended".
Watch money movement at `GET /api/v1/admin/ledger`.

## API
| Method | Path | Body / Note |
|---|---|---|
| GET  | `/api/v1/rfid/balance/:card_uid` | show balance on screen before selecting |
| POST | `/api/v1/rfid/charge` | `{machine_id, card_uid, package_id, client_txn_id}` |

Charge responses: `PAID` · `INSUFFICIENT_BALANCE` · `CARD_NOT_FOUND` ·
`CARD_DISABLED` · `CUSTOMER_BLOCKED`.

## Firmware
`firmware/rfid_reader_esp32s3/rfid_reader_esp32s3.ino` — RC522 read → charge →
relay/opto start → countdown → started/ended. Wiring + pins documented at the top.
Libraries: **MFRC522**, **ArduinoJson**.

## Prototype vs Production (RFID security)
- **Prototype:** MIFARE Classic 1K + RC522. We trust the UID — fine for testing, but
  a UID is clonable.
- **Production:** move to **MIFARE DESFire EV3** + a DESFire-capable reader (e.g. PN532)
  and do **AES challenge-response**, so a copied UID can't pass. The backend flow stays
  identical — only the card auth step gets stronger.

⚠️ Top-ups (adding money to a wallet) happen through your **website/app** (card/UPI →
credit wallet → `TOPUP` ledger row), never at the machine. That keeps the box simple
and cash-free.
