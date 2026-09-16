'use strict';
/**
 * Pretend to be the ESP32 + RC522. Run AFTER the server is up:
 *   node src/lib/rfid-sim.js
 * Simulates: read balance -> tap card -> charge -> "start chair" -> "ended".
 * Uses the DEMO_CARD_UID from your .env (same one seed-wallet used).
 */
require('dotenv').config();
const crypto = require('crypto');

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const KEY = process.env.MACHINE_API_KEY;
const MACHINE_ID = 'MC-HYD-001';
const CARD_UID = process.env.DEMO_CARD_UID || 'A1B2C3D4';
const PACKAGE_ID = process.argv[2] || 'PKG_10';

const headers = { 'Content-Type': 'application/json', 'X-Machine-Key': KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Show balance (what the screen does when a card is tapped)
  const bal = await (await fetch(
    `${BASE}/api/v1/rfid/balance/${CARD_UID}`, { headers })).json();
  console.log('Card:', CARD_UID, '| Balance now: ₹' + (bal.balance_paise ?? 0) / 100,
    bal.name ? `(${bal.name})` : '');

  // 2. Customer selects a package -> charge the card
  const client_txn_id = crypto.randomUUID(); // unique per tap (idempotency)
  const chargeRes = await fetch(`${BASE}/api/v1/rfid/charge`, {
    method: 'POST', headers,
    body: JSON.stringify({ machine_id: MACHINE_ID, card_uid: CARD_UID,
                           package_id: PACKAGE_ID, client_txn_id }),
  });
  const charge = await chargeRes.json();
  console.log('Charge result:', charge.status,
    charge.balance_paise != null ? `| New balance: ₹${charge.balance_paise / 100}` : '');

  if (charge.status !== 'PAID') {
    console.log('❌ Not starting chair. Reason:', charge.status);
    return;
  }

  // 3. Backend confirmed PAID -> fire relay / trigger chair program
  console.log(`✅ Starting chair for ${charge.duration_sec}s (session ${charge.session_id})`);
  await fetch(`${BASE}/api/v1/sessions/${charge.session_id}/started`,
    { method: 'POST', headers });

  // 4. (Simulated) program finishes + chair returns home -> report ENDED
  await sleep(1500);
  await fetch(`${BASE}/api/v1/sessions/${charge.session_id}/ended`,
    { method: 'POST', headers });
  console.log('🏁 Session ENDED (chair returned home).');
})().catch((e) => { console.error(e); process.exit(1); });
