'use strict';
// Creates the wallet + RFID tables. Idempotent.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema_wallet.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Wallet/RFID migration complete.');
  await pool.end();
})().catch((err) => {
  console.error('❌ Wallet migration failed:', err.message);
  process.exit(1);
});
