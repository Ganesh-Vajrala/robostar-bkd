'use strict';
// Inserts one demo machine and three demo packages so you can test immediately.
require('dotenv').config();
const { pool } = require('./db');

(async () => {
  await pool.query(
    `INSERT INTO machines (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    ['MC-HYD-001', 'Hyderabad Demo Chair']
  );

  const pkgs = [
    ['PKG_10', '10 min Quick Relax', 600, 5000],   // Rs.50
    ['PKG_15', '15 min Full Relax', 900, 10000],   // Rs.100
    ['PKG_30', '30 min Deep Tissue', 1800, 18000], // Rs.180
  ];
  for (const [id, label, dur, amt] of pkgs) {
    await pool.query(
      `INSERT INTO packages (id, label, duration_sec, amount_paise)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [id, label, dur, amt]
    );
  }

  console.log('✅ Seed complete: 1 machine + 3 packages.');
  await pool.end();
})().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
