// ═══════════════════════════════════════════════════════════════
//  notify.js — real OTP delivery (email + WhatsApp)
//  Provider-agnostic on purpose: swap either function's internals
//  without touching auth-api.js, which only calls sendEmail/sendWhatsApp.
//
//  Email    → SMTP via Nodemailer. Works with Gmail (app password),
//             SendGrid, Mailgun, Resend's SMTP relay, etc. — just
//             fill in SMTP_* env vars (see .env.example).
//  WhatsApp → Twilio's WhatsApp API (REST, no SDK dependency).
//             NOTE: Twilio's free sandbox requires each recipient to
//             first send "join <sandbox-word>" to the sandbox number
//             once before they can receive messages. For production,
//             you need an approved WhatsApp Business sender.
//
//  Neither provider is configured out of the box — until you set the
//  env vars, both functions throw a clear error (caught by the OTP
//  routes and returned as a 503), never a fake/demo code.
// ═══════════════════════════════════════════════════════════════

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function sendEmail(to, subject, text) {
  const t = getTransporter();
  if (!t) throw new Error('Email delivery is not configured on the server yet. Please try again later.');
  await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
}

async function sendWhatsApp(toE164, text) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM)
    throw new Error('WhatsApp delivery is not configured on the server yet. Please try again later.');

  const from = TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? TWILIO_WHATSAPP_FROM : `whatsapp:${TWILIO_WHATSAPP_FROM}`;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({ From: from, To: `whatsapp:${toE164}`, Body: text });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('Could not deliver the WhatsApp message. Please try again shortly.' +
      (process.env.NODE_ENV !== 'production' ? ` (${res.status}: ${detail.slice(0, 200)})` : ''));
  }
}

module.exports = { sendEmail, sendWhatsApp };
