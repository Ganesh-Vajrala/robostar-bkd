'use strict';
/**
 * Pretend to be the ESP32 box. Run this AFTER the server is up:
 *   node src/lib/machine-sim.js
 *
 * It will: list packages -> create a session -> print the QR URL -> poll status
 * until PAID, then "start the chair". Open the QR URL in a browser and pay with a
 * Razorpay TEST UPI app flow (or trigger a test webhook) to see it flip to PAID.
 */
require('dotenv').config();

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const KEY = process.env.MACHINE_API_KEY;
const MACHINE_ID = 'MC-HYD-001';

const headers = { 'Content-Type': 'application/json', 'X-Machine-Key': KEY };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Load menu
  const pkgs = await (await fetch(`${BASE}/api/v1/packages`)).json();
  console.log('Packages:', pkgs.packages.map((p) => `${p.id} ₹${p.amount_paise / 100}`).join(', '));
  const chosen = pkgs.packages[0];

  // 2. Create session (customer tapped a package)
  const create = await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST', headers,
    body: JSON.stringify({ machine_id: MACHINE_ID, package_id: chosen.id }),
  });
  const session = await create.json();
  console.log('\nSession created:', session.session_id);
  console.log('👉 SCAN / OPEN THIS QR TO PAY:', session.qr_image_url);
  console.log('   Amount ₹' + session.amount_paise / 100 + ', expires', session.expires_at);

  // 3. Poll for payment (this is what the screen does while showing the QR)
  console.log('\nWaiting for payment...');
  for (let i = 0; i < 90; i++) {
    const st = await (await fetch(
      `${BASE}/api/v1/sessions/${session.session_id}/status`, { headers })).json();
    if (st.status === 'PAID') {
      console.log('\n✅ PAID! Firing relay -> chair starts for', st.duration_sec, 'sec');
      await fetch(`${BASE}/api/v1/sessions/${session.session_id}/started`,
        { method: 'POST', headers });
      return;
    }
    if (['EXPIRED', 'CANCELLED', 'FAILED'].includes(st.status)) {
      console.log('\n❌ Ended without payment:', st.status);
      return;
    }
    process.stdout.write('.');
    await sleep(2000);
  }
  console.log('\n⏱️  Timed out waiting for payment.');
})().catch((e) => { console.error(e); process.exit(1); });
