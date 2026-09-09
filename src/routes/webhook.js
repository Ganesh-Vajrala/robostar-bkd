'use strict';
const express = require('express');
const { withTransaction, query } = require('../lib/db');
const { verifyWebhook } = require('../lib/razorpay');

const router = express.Router();

// IMPORTANT: this route is mounted with express.raw() in server.js so that
// req.body is the RAW bytes. Razorpay signs the raw body; parsing it first
// would break signature verification.
router.post('/razorpay', async (req, res) => {
  const signature = req.header('X-Razorpay-Signature');
  const rawBody = req.body; // Buffer

  // 1) Verify the signature BEFORE trusting anything in the payload.
  const ok = verifyWebhook(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET);
  if (!ok) {
    console.warn('⚠️  Invalid webhook signature');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let evt;
  try { evt = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ error: 'bad_json' }); }

  // Always log the event for audit/debugging.
  await query('INSERT INTO webhook_events (event, payload) VALUES ($1,$2)',
    [evt.event, evt]);

  try {
    // We care about a successful UPI QR credit.
    if (evt.event === 'qr_code.credited') {
      const qr = evt.payload.qr_code.entity;
      const payment = evt.payload.payment.entity;
      await handlePaidQr(qr, payment);
    }
    // (Optional) handle refunds later: evt.event === 'refund.processed'
  } catch (err) {
    console.error('webhook handling error:', err);
    // Still return 200 so Razorpay does not spam retries for a bug on our side;
    // the event is logged and can be reprocessed. Return 500 only for infra errors.
  }

  // Must respond 2xx within 5 seconds or Razorpay marks it failed & retries.
  res.json({ ok: true });
});

async function handlePaidQr(qr, payment) {
  // The whole thing runs in ONE transaction so "record payment" and
  // "mark session paid" either both happen or neither does.
  await withTransaction(async (client) => {
    // Idempotency guard: if we've already stored this payment_id, stop.
    const dup = await client.query('SELECT 1 FROM payments WHERE payment_id=$1',
      [payment.id]);
    if (dup.rowCount > 0) {
      console.log(`↩️  Duplicate webhook for ${payment.id}, ignoring.`);
      return;
    }

    // Find the session this QR belongs to (we stored qr.id at creation time).
    const s = await client.query(
      `SELECT id, amount_paise, status FROM sessions WHERE qr_code_id=$1 FOR UPDATE`,
      [qr.id]
    );
    if (s.rowCount === 0) {
      console.warn(`No session for qr ${qr.id}`);
      // Record the payment anyway so a manual refund is traceable.
      await client.query(
        `INSERT INTO payments (payment_id, rrn, amount_paise, status, vpa, raw)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [payment.id, payment.acquirer_data?.rrn || null, payment.amount,
         'captured', payment.vpa || null, payment]
      );
      return;
    }

    const session = s.rows[0];

    // Amount must match exactly. If not, record but DO NOT start the chair.
    const amountOk = payment.amount === session.amount_paise;

    await client.query(
      `INSERT INTO payments (payment_id, session_id, rrn, amount_paise, status, vpa, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [payment.id, session.id, payment.acquirer_data?.rrn || null,
       payment.amount, 'captured', payment.vpa || null, payment]
    );

    if (amountOk && session.status === 'PENDING') {
      await client.query(
        `UPDATE sessions SET status='PAID', updated_at=now() WHERE id=$1`,
        [session.id]
      );
      console.log(`✅ Session ${session.id} PAID (payment ${payment.id})`);
    } else {
      console.warn(`Amount mismatch or bad state for session ${session.id}: ` +
        `paid=${payment.amount} expected=${session.amount_paise} status=${session.status}`);
    }
  });
}

module.exports = { router };
