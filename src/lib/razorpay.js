'use strict';
const Razorpay = require('razorpay');

const rzp = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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

async function closeQr(qrCodeId) {
  return rzp.qrCode.close(qrCodeId);
}

async function refundPayment(paymentId, amountPaise) {
  const body = amountPaise ? { amount: amountPaise } : {};
  return rzp.payments.refund(paymentId, body);
}

function verifyWebhook(rawBody, signature, secret) {
  try {
    return Razorpay.validateWebhookSignature(rawBody, signature, secret);
  } catch {
    return false;
  }
}

module.exports = { rzp, createSessionQr, closeQr, refundPayment, verifyWebhook };
