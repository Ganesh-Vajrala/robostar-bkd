'use strict';
const express = require('express');
const crypto = require('crypto');
const { query } = require('../lib/db');
const { createSessionQr, closeQr } = require('../lib/razorpay');

const router = express.Router();

// Simple machine auth: every box sends X-Machine-Key. Reject anyone else.
function requireMachine(req, res, next) {
  const key = req.header('X-Machine-Key');
  if (!key || key !== process.env.MACHINE_API_KEY) {
    return res.status(401).json({ error: 'unauthorized_machine' });
  }
  next();
}

// GET /api/v1/packages  -> the touchscreen loads this to render the menu.
router.get('/packages', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, label, duration_sec, amount_paise
     FROM packages WHERE active = true ORDER BY amount_paise`
  );
  res.json({ packages: rows });
});

// POST /api/v1/sessions  { machine_id, package_id }
// The ESP32 calls this when the customer taps a package. We create the session,
// generate a dynamic UPI QR, and return the QR image URL for the screen to show.
router.post('/sessions', requireMachine, async (req, res) => {
  try {
    const { machine_id, package_id } = req.body || {};
    if (!machine_id || !package_id) {
      return res.status(400).json({ error: 'machine_id and package_id required' });
    }

    // Validate machine + package server-side. NEVER trust an amount from the device.
    const m = await query('SELECT id FROM machines WHERE id=$1 AND status=$2',
      [machine_id, 'active']);
    if (m.rowCount === 0) return res.status(404).json({ error: 'machine_not_found' });

    const p = await query(
      'SELECT id, amount_paise, duration_sec FROM packages WHERE id=$1 AND active=true',
      [package_id]);
    if (p.rowCount === 0) return res.status(404).json({ error: 'package_not_found' });

    const pkg = p.rows[0];
    const sessionId = crypto.randomUUID();
    const closeBySec = Math.floor(Date.now() / 1000) + 180; // QR valid 3 minutes
    const expiresAt = new Date(closeBySec * 1000);

    // Create the pending session first...
    await query(
      `INSERT INTO sessions (id, machine_id, package_id, amount_paise, status, expires_at)
       VALUES ($1,$2,$3,$4,'PENDING',$5)`,
      [sessionId, machine_id, pkg.id, pkg.amount_paise, expiresAt]
    );

    // ...then ask Razorpay for the dynamic QR.
    const qr = await createSessionQr({
      sessionId,
      amountPaise: pkg.amount_paise,
      closeBySec,
      machineId: machine_id,
    });

    await query(
      `UPDATE sessions SET qr_code_id=$1, qr_image_url=$2, updated_at=now() WHERE id=$3`,
      [qr.id, qr.image_url, sessionId]
    );

    res.status(201).json({
      session_id: sessionId,
      amount_paise: pkg.amount_paise,
      duration_sec: pkg.duration_sec,
      qr_image_url: qr.image_url, // ESP32 downloads & renders this
      expires_at: expiresAt.toISOString(),
      status: 'PENDING',
    });
  } catch (err) {
    console.error('create session error:', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/sessions/:id/status
// The ESP32 POLLS this every ~2s while showing the QR. When status becomes PAID,
// the screen advances and the firmware fires the relay. (Phase 1 replaces polling
// with an MQTT push, but the contract stays identical.)
router.get('/sessions/:id/status', requireMachine, async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.status, s.amount_paise, p.duration_sec
     FROM sessions s JOIN packages p ON p.id = s.package_id
     WHERE s.id=$1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'session_not_found' });
  res.json(rows[0]);
});

// POST /api/v1/sessions/:id/started
// The box calls this the moment it actually starts the chair, so the backend
// flips PAID -> STARTED (useful for reporting and to prevent re-triggering).
router.post('/sessions/:id/started', requireMachine, async (req, res) => {
  const r = await query(
    `UPDATE sessions SET status='STARTED', updated_at=now()
     WHERE id=$1 AND status='PAID' RETURNING id`,
    [req.params.id]
  );
  if (r.rowCount === 0) return res.status(409).json({ error: 'not_in_paid_state' });
  res.json({ ok: true });
});

// POST /api/v1/sessions/:id/cancel  -> customer backed out; close the QR early.
router.post('/sessions/:id/cancel', requireMachine, async (req, res) => {
  const s = await query('SELECT qr_code_id, status FROM sessions WHERE id=$1',
    [req.params.id]);
  if (s.rowCount === 0) return res.status(404).json({ error: 'session_not_found' });
  if (s.rows[0].status !== 'PENDING') {
    return res.status(409).json({ error: 'cannot_cancel' });
  }
  try { if (s.rows[0].qr_code_id) await closeQr(s.rows[0].qr_code_id); } catch (_) {}
  await query(`UPDATE sessions SET status='CANCELLED', updated_at=now() WHERE id=$1`,
    [req.params.id]);
  res.json({ ok: true });
});

module.exports = { router, requireMachine };
