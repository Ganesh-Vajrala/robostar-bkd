# Massage Box — Phase 0 Backend (Direct UPI)

The **brain** of the smart massage-chair box. It generates a **dynamic UPI QR** per
session via Razorpay, verifies the **real payment** through a signed webhook, and
only then marks the session `PAID` so the ESP32 is allowed to start the chair.

> **Golden rule:** the chair NEVER starts because someone pressed "I Paid". It starts
> only after the backend confirms a verified Razorpay payment for that exact session
> and amount.

---

## What's inside

```
src/
  server.js            # Express app: mounts routes, raw body for webhook
  routes/
    sessions.js        # /packages, create session (+QR), status, started, cancel
    webhook.js         # Razorpay webhook: verify signature -> mark PAID (idempotent)
  lib/
    db.js              # pg pool + transaction helper
    schema.sql         # machines, packages, sessions, payments, webhook_events
    migrate.js         # create tables
    seed.js            # 1 demo machine + 3 packages
    razorpay.js        # create/close/refund QR + signature verify
    machine-sim.js     # pretend-ESP32 to test end-to-end without hardware
```

### The session state machine
```
PENDING ──(verified webhook)──► PAID ──(box starts chair)──► STARTED ──► ENDED
   │
   ├─(3-min timeout / QR close)─► EXPIRED
   └─(customer backs out)───────► CANCELLED
```

---

## 1. Run it locally

**Prereqs:** Node 18+ (for built-in `fetch`), PostgreSQL 14+.

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env
#   -> fill DATABASE_URL, RAZORPAY_KEY_ID/SECRET (TEST keys), RAZORPAY_WEBHOOK_SECRET,
#      and a long random MACHINE_API_KEY

# 3. create a local db (one option)
createdb massagebox

# 4. build tables + seed demo data
npm run migrate
npm run seed

# 5. start
npm start        # or: npm run dev   (auto-restart)
```

Health check: open http://localhost:3000/health

---

## 2. Get Razorpay test keys + enable UPI QR

1. Create a free Razorpay account → **Dashboard → Settings → API Keys → Generate Key**
   in **Test mode**. Put them in `.env`.
2. The **QR Code (upi_qr) API is an on-demand feature** — from the dashboard/support,
   request that `upi_qr` be enabled on your account. Until then `qrCode.create` errors.
3. **Webhook:** Dashboard → Settings → Webhooks → *Add New Webhook*
   - URL: your public URL + `/api/v1/webhook/razorpay`
   - Secret: a value **you choose** → put the same value in `RAZORPAY_WEBHOOK_SECRET`
   - Active events: **`qr_code.credited`** (add `refund.processed` later)

### Exposing localhost for webhooks
Razorpay can't reach `localhost`, and it **blacklists ngrok/localtunnel**. Use
**`zrok`** (their recommended tunnel) or deploy to a host (below) and test there.

---

## 3. Test the whole flow without hardware

Terminal A:
```bash
npm start
```
Terminal B:
```bash
node src/lib/machine-sim.js
```
It prints a **QR image URL**. Open it, pay via the Razorpay test flow. Razorpay fires
the `qr_code.credited` webhook → backend marks the session `PAID` → the simulator sees
`PAID` and "starts the chair". Watch `GET /api/v1/admin/sessions` to see state changes.

---

## 4. API contract (what the ESP32 will call)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/v1/packages` | menu for the touchscreen |
| `POST` | `/api/v1/sessions` | `{machine_id, package_id}` → creates QR, returns `qr_image_url` |
| `GET`  | `/api/v1/sessions/:id/status` | poll until `PAID` |
| `POST` | `/api/v1/sessions/:id/started` | box tells backend the chair started |
| `POST` | `/api/v1/sessions/:id/cancel` | customer backed out, close QR |
| `POST` | `/api/v1/webhook/razorpay` | Razorpay → backend (signed) |

All box endpoints require header **`X-Machine-Key: <MACHINE_API_KEY>`**.

---

## 5. Where to host

**Recommended for this project: Railway** — services stay **always-on (no cold
starts)**, which matters because webhooks and (later) MQTT must reach your box
instantly. Render's free tier **sleeps after 15 min** and cold-starts 30–60s, which
would drop webhooks. Railway is ~$5/mo (Hobby) and gives you a one-click Postgres.

Alternatives: **Render** ($7/mo per always-on service + $7 Postgres) if you prefer
flat, predictable billing; **Neon/Supabase** for a free managed Postgres you point
`DATABASE_URL` at from any host.

### Deploy to Railway (quick)
1. Push this folder to a GitHub repo.
2. railway.app → **New Project → Deploy from GitHub repo**.
3. **Add a Postgres** service (one click). Copy its `DATABASE_URL`.
4. In your service **Variables**, set: `DATABASE_URL`, `DATABASE_SSL=true`,
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   `MACHINE_API_KEY`.
5. Railway gives you a public HTTPS URL → put `.../api/v1/webhook/razorpay` in the
   Razorpay webhook settings.
6. Run migrate/seed once (Railway shell or a temporary `railway run npm run migrate`).

> Later phases add: MQTT-over-TLS push instead of polling, the customer wallet
> (QR + RFID), OTA firmware updates, and an admin dashboard.
```
