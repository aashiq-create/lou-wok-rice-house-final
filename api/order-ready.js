// /api/order-ready.js
// ────────────────────────────────────────────────────────────────────────────
// Call this from the admin dashboard ("Order Ready" button) to text a customer
// that their food is ready for pickup. Keeps the order number consistent with
// the confirmation they already got.
//
// POST body (JSON):
//   { order_number: "LW-260620-1234", phone: "+16025551234", name: "Sam" }
//
// Protect with a shared secret so randoms can't spam your customers:
//   header  x-admin-key: <ADMIN_API_KEY>
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');

const RESTAURANT_NAME = process.env.RESTAURANT_NAME || 'Lou Wok Rice House';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* ignore */ }
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return {};
}

function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  if (String(raw || '').startsWith('+')) return String(raw);
  return '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Shared-secret gate.
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const smsFrom    = process.env.TWILIO_CALLER_ID;
  if (!accountSid || !authToken || !smsFrom) {
    return res.status(500).json({ error: 'Twilio not configured' });
  }

  const p     = readBody(req);
  const dest  = toE164(p.phone);
  const order = p.order_number || '';
  const name  = p.name ? p.name.split(' ')[0] : '';

  if (!dest) return res.status(400).json({ error: 'bad_phone' });

  const body =
    `${RESTAURANT_NAME}: ${name ? name + ', y' : 'Y'}our order ${order} is ready for pickup! 🍚 ` +
    `Come grab it while it's hot. See you soon!`;

  try {
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({ from: smsFrom, to: dest, body });
    return res.status(200).json({ ok: true, sid: msg.sid });
  } catch (err) {
    console.error('order-ready failed:', err && err.message);
    return res.status(500).json({ error: 'sms_failed', detail: err && err.message });
  }
};
