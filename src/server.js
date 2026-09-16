'use strict';
require('dotenv').config();
const express = require('express');

const { router: sessionsRouter } = require('./routes/sessions');
const { router: webhookRouter } = require('./routes/webhook');
const { router: rfidRouter } = require('./routes/rfid');
const { query } = require('./lib/db');

const app = express();

// Webhook FIRST with raw body (Razorpay signs raw bytes).
app.use('/api/v1/webhook', express.raw({ type: '*/*' }), webhookRouter);

// Everything else uses JSON.
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/v1', sessionsRouter);
app.use('/api/v1', rfidRouter);

// Read-only admin views for testing.
app.get('/api/v1/admin/sessions', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, machine_id, package_id, amount_paise, method, status, created_at
     FROM sessions ORDER BY created_at DESC LIMIT 50`
  );
  res.json({ sessions: rows });
});

app.get('/api/v1/admin/ledger', async (_req, res) => {
  const { rows } = await query(
    `SELECT customer_id, delta_paise, type, balance_after, session_id, created_at
     FROM wallet_ledger ORDER BY created_at DESC LIMIT 50`
  );
  res.json({ ledger: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Massage-box backend on :${PORT}`));
