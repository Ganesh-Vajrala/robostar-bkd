'use strict';
const express = require('express');
const { withTransaction, query } = require('../lib/db');
const { verifyWebhook } = require('../lib/razorpay');

const router = express.Router();

// Mounted with express.raw() in server.js -> req.body is raw bytes (needed for signature).
router.post('/razorpay', async (req, res) => {
  const signature = req.header('X-Razorpay-Signature');
  const rawBody = req.body;

  const ok = verifyWebhook(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET);
  if (!ok) {
    console.warn('⚠️  Invalid webhook signature');
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let evt;
  try { evt = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ error: 'bad_json' }); }

  await query('INSERT INTO webhook_events (event, payload) VALUES ($1,$2)',
    [evt.event, evt]);

  try {
    if (evt.event === 'qr_code.credited') {
      await handlePaidQr(evt.payload.qr_code.entity, evt.payload.payment.entity);
    }
  } catch (err) {
    console.error('webhook handling error:', err);
  }

  res.json({ ok: true });
});

async function handlePaidQr(qr, payment) {
  await withTransaction(async (client) => {
    const dup = await client.query('SELECT 1 FROM payments WHERE payment_id=$1',
      [payment.id]);
    if (dup.rowCount > 0) return; // idempotent

    const s = await client.query(
      `SELECT id, amount_paise, status FROM sessions WHERE qr_code_id=$1 FOR UPDATE`,
      [qr.id]
    );
    if (s.rowCount === 0) {
      await client.query(
        `INSERT INTO payments (payment_id, rrn, amount_paise, status, vpa, raw)
         VALUES ($1,$2,$3,'captured',$4,$5)`,
        [payment.id, payment.acquirer_data?.rrn || null, payment.amount,
         payment.vpa || null, payment]
      );
      return;
    }

    const session = s.rows[0];
    const amountOk = payment.amount === session.amount_paise;

    await client.query(
      `INSERT INTO payments (payment_id, session_id, rrn, amount_paise, status, vpa, raw)
       VALUES ($1,$2,$3,$4,'captured',$5,$6)`,
      [payment.id, session.id, payment.acquirer_data?.rrn || null,
       payment.amount, payment.vpa || null, payment]
    );

    if (amountOk && session.status === 'PENDING') {
      await client.query(
        `UPDATE sessions SET status='PAID', updated_at=now() WHERE id=$1`,
        [session.id]);
      console.log(`✅ Session ${session.id} PAID (payment ${payment.id})`);
    }
  });
}

module.exports = { router };
