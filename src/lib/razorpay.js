'use strict';
const Razorpay = require('razorpay');

const rzp = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a single-use, fixed-amount dynamic UPI QR for one session.
 * - usage=single_use  -> QR auto-closes after ONE successful payment
 * - fixed_amount=true -> customer cannot underpay/overpay
 * - close_by          -> auto-expiry (must be >= 2 min in the future)
 * - notes.session_id  -> lets us match the webhook back to our session
 */
async function createSessionQr({ sessionId, amountPaise, closeBySec, machineId }) {
  return rzp.qrCode.create({
    type: 'upi_qr',
    name: `Massage ${machineId}`,
    usage: 'single_use',
    fixed_amount: true,
    payment_amount: amountPaise,
    description: `Session ${sessionId}`,
    close_by: closeBySec,
    notes: { session_id: sessionId, machine_id: machineId },
  });
}

// Manually close a QR (used on timeout / cancel).
async function closeQr(qrCodeId) {
  return rzp.qrCode.close(qrCodeId);
}

// Refund a captured payment (full or partial). amountPaise optional = full refund.
async function refundPayment(paymentId, amountPaise) {
  const body = amountPaise ? { amount: amountPaise } : {};
  return rzp.payments.refund(paymentId, body);
}

// Static helper from the SDK: HMAC-SHA256 verification of the webhook raw body.
function verifyWebhook(rawBody, signature, secret) {
  try {
    return Razorpay.validateWebhookSignature(rawBody, signature, secret);
  } catch {
    return false;
  }
}

module.exports = { rzp, createSessionQr, closeQr, refundPayment, verifyWebhook };
