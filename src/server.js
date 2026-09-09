'use strict';
require('dotenv').config();
const express = require('express');

const { router: sessionsRouter } = require('./routes/sessions');
const { router: webhookRouter } = require('./routes/webhook');
const { query } = require('./lib/db');

const app = express();

// ---- Webhook route FIRST, with a raw body parser ----
// Razorpay signs the raw bytes, so this route must NOT use express.json().
app.use('/api/v1/webhook', express.raw({ type: '*/*' }), webhookRouter);

// ---- Everything else uses normal JSON parsing ----
app.use(express.json());

// Health check (also lets Railway/Render know the app is alive).
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Main API.
app.use('/api/v1', sessionsRouter);

// Tiny admin read-only endpoint to watch sessions during testing.
app.get('/api/v1/admin/sessions', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, machine_id, package_id, amount_paise, status, created_at
     FROM sessions ORDER BY created_at DESC LIMIT 50`
  );
  res.json({ sessions: rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Massage-box backend listening on :${PORT}`);
});
