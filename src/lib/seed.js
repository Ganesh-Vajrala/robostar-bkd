'use strict';
require('dotenv').config();
const { pool } = require('./db');

(async () => {
  await pool.query(
    `INSERT INTO machines (id, name) VALUES ($1,$2)
     ON CONFLICT (id) DO NOTHING`,
    ['MC-HYD-001', 'Hyderabad Demo Chair']
  );

  const pkgs = [
    ['PKG_10', '10 min Quick Relax', 600, 10000],  // Rs.100
    ['PKG_20', '20 min Full Relax', 1200, 20000],  // Rs.200
    ['PKG_30', '30 min Deep Tissue', 1800, 30000], // Rs.300
  ];
  for (const [id, label, dur, amt] of pkgs) {
    await pool.query(
      `INSERT INTO packages (id, label, duration_sec, amount_paise)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [id, label, dur, amt]
    );
  }
  console.log('✅ Core seed complete: 1 machine + 3 packages.');
  await pool.end();
})().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
