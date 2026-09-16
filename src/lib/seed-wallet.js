'use strict';
// Creates one demo customer with a wallet + one demo RFID card so you can test.
// Change DEMO_CARD_UID to whatever your RC522 prints when you tap a card.
require('dotenv').config();
const crypto = require('crypto');
const { pool } = require('./db');

const DEMO_CARD_UID = process.env.DEMO_CARD_UID || 'A1B2C3D4'; // <-- your card's UID
const DEMO_BALANCE_PAISE = 50000; // Rs.500

(async () => {
  const customerId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO customers (id, name, phone) VALUES ($1,$2,$3)`,
    [customerId, 'Demo Customer', '9000000000']
  );
  await pool.query(
    `INSERT INTO wallets (customer_id, balance_paise) VALUES ($1,$2)`,
    [customerId, DEMO_BALANCE_PAISE]
  );
  await pool.query(
    `INSERT INTO cards (card_uid, customer_id) VALUES ($1,$2)
     ON CONFLICT (card_uid) DO NOTHING`,
    [DEMO_CARD_UID, customerId]
  );
  // record the opening balance as a TOPUP ledger row
  await pool.query(
    `INSERT INTO wallet_ledger (customer_id, delta_paise, type, balance_after)
     VALUES ($1,$2,'TOPUP',$3)`,
    [customerId, DEMO_BALANCE_PAISE, DEMO_BALANCE_PAISE]
  );

  console.log('✅ Wallet seed complete.');
  console.log('   Customer :', customerId);
  console.log('   Card UID :', DEMO_CARD_UID, '(tap this card)');
  console.log('   Balance  : ₹' + DEMO_BALANCE_PAISE / 100);
  await pool.end();
})().catch((err) => {
  console.error('❌ Wallet seed failed:', err.message);
  process.exit(1);
});
