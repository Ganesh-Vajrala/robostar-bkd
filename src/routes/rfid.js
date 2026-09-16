'use strict';
const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../lib/db');
const { requireMachine } = require('./sessions');

const router = express.Router();

/**
 * POST /api/v1/rfid/charge
 * Body: { machine_id, card_uid, package_id, client_txn_id }
 *
 * The ESP32 calls this the instant a card is tapped. Everything is decided
 * server-side and ATOMICALLY:
 *   1. idempotency: same client_txn_id twice => return the first result, no double charge
 *   2. look up card -> customer -> wallet (row-locked)
 *   3. if balance >= price: deduct, write ledger, create a PAID session
 *   4. return PAID + duration so the box can start the chair
 * The card is only an IDENTITY. The balance never lives on the card.
 */
router.post('/rfid/charge', requireMachine, async (req, res) => {
  const { machine_id, card_uid, package_id, client_txn_id } = req.body || {};
  if (!machine_id || !card_uid || !package_id || !client_txn_id) {
    return res.status(400).json({
      error: 'machine_id, card_uid, package_id, client_txn_id required',
    });
  }

  try {
    // ---- 1. Idempotency: was this exact tap already processed? ----
    const prior = await query(
      'SELECT session_id, amount_paise, result FROM rfid_charges WHERE client_txn_id=$1',
      [client_txn_id]
    );
    if (prior.rowCount > 0) {
      const p = prior.rows[0];
      // Re-fetch duration so the box can still start if it missed the first reply.
      const dur = await query(
        `SELECT p.duration_sec FROM sessions s
         JOIN packages p ON p.id = s.package_id WHERE s.id=$1`,
        [p.session_id]
      );
      return res.json({
        status: p.result,
        session_id: p.session_id,
        amount_paise: p.amount_paise,
        duration_sec: dur.rows[0] ? dur.rows[0].duration_sec : null,
        idempotent_replay: true,
      });
    }

    // ---- Validate machine + package (never trust device amounts) ----
    const m = await query('SELECT id FROM machines WHERE id=$1 AND status=$2',
      [machine_id, 'active']);
    if (m.rowCount === 0) return res.status(404).json({ error: 'machine_not_found' });

    const pk = await query(
      'SELECT id, amount_paise, duration_sec FROM packages WHERE id=$1 AND active=true',
      [package_id]);
    if (pk.rowCount === 0) return res.status(404).json({ error: 'package_not_found' });
    const pkg = pk.rows[0];

    // ---- 2-4. Atomic charge in a single transaction ----
    const outcome = await withTransaction(async (client) => {
      // find the card + owning customer
      const c = await client.query(
        `SELECT c.customer_id, c.status AS card_status, cu.status AS cust_status
         FROM cards c JOIN customers cu ON cu.id = c.customer_id
         WHERE c.card_uid = $1`,
        [card_uid]
      );
      if (c.rowCount === 0) return { http: 404, body: { status: 'CARD_NOT_FOUND' } };
      if (c.rows[0].card_status !== 'active')
        return { http: 403, body: { status: 'CARD_DISABLED' } };
      if (c.rows[0].cust_status !== 'active')
        return { http: 403, body: { status: 'CUSTOMER_BLOCKED' } };

      const customerId = c.rows[0].customer_id;

      // lock the wallet row so two taps can't both spend the same balance
      const w = await client.query(
        'SELECT balance_paise FROM wallets WHERE customer_id=$1 FOR UPDATE',
        [customerId]
      );
      if (w.rowCount === 0) return { http: 404, body: { status: 'WALLET_NOT_FOUND' } };

      const balance = w.rows[0].balance_paise;

      if (balance < pkg.amount_paise) {
        await client.query(
          `INSERT INTO rfid_charges (client_txn_id, card_uid, amount_paise, result)
           VALUES ($1,$2,$3,'INSUFFICIENT')`,
          [client_txn_id, card_uid, pkg.amount_paise]
        );
        return {
          http: 402,
          body: { status: 'INSUFFICIENT_BALANCE',
                  balance_paise: balance, required_paise: pkg.amount_paise },
        };
      }

      // enough money -> deduct atomically
      const newBalance = balance - pkg.amount_paise;
      await client.query(
        `UPDATE wallets SET balance_paise=$1, updated_at=now() WHERE customer_id=$2`,
        [newBalance, customerId]
      );

      // create a session already in PAID state (RFID is instant)
      const sessionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO sessions (id, machine_id, package_id, amount_paise, method, status)
         VALUES ($1,$2,$3,$4,'rfid','PAID')`,
        [sessionId, machine_id, pkg.id, pkg.amount_paise]
      );

      // ledger row (money movement audit)
      await client.query(
        `INSERT INTO wallet_ledger (customer_id, delta_paise, type, session_id, balance_after)
         VALUES ($1,$2,'DEBIT',$3,$4)`,
        [customerId, -pkg.amount_paise, sessionId, newBalance]
      );

      // idempotency record
      await client.query(
        `INSERT INTO rfid_charges (client_txn_id, session_id, card_uid, amount_paise, result)
         VALUES ($1,$2,$3,$4,'PAID')`,
        [client_txn_id, sessionId, card_uid, pkg.amount_paise]
      );

      return {
        http: 200,
        body: {
          status: 'PAID',
          session_id: sessionId,
          amount_paise: pkg.amount_paise,
          duration_sec: pkg.duration_sec,
          balance_paise: newBalance,
        },
      };
    });

    return res.status(outcome.http).json(outcome.body);
  } catch (err) {
    console.error('rfid charge error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/rfid/balance/:card_uid  -> show balance on screen before selecting
router.get('/rfid/balance/:card_uid', requireMachine, async (req, res) => {
  const r = await query(
    `SELECT w.balance_paise, cu.name
     FROM cards c
     JOIN wallets w   ON w.customer_id = c.customer_id
     JOIN customers cu ON cu.id = c.customer_id
     WHERE c.card_uid=$1 AND c.status='active'`,
    [req.params.card_uid]
  );
  if (r.rowCount === 0) return res.status(404).json({ status: 'CARD_NOT_FOUND' });
  res.json({ status: 'OK', name: r.rows[0].name, balance_paise: r.rows[0].balance_paise });
});

module.exports = { router };
