'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Core migration complete.');
  await pool.end();
})().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
