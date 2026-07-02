// /api/notify-test.js
// ────────────────────────────────────────────────────────────────────────────
// Sends a single test text via Twilio so the admin dashboard's "Send Test
// Text" button can confirm the SMS pipeline actually works — no real order
// or catering inquiry required.
//
// POST body: { phones: ["+16025551234", ...] }
// Uses the same Twilio env vars / cms-data.json config as /api/notify.js,
// so a passing test here means real order/catering texts will work too.
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');
const { loadConfig } = require('./_config');

function toE164(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s[0] === '+') { const d = s.replace(/[^\d]/g, ''); return d ? '+' + d : ''; }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
  }
  return {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const p = readBody(req);
  const requested = Array.isArray(p.phones) ? p.phones : [];
  const phones = Array.from(new Set(requested.map(toE164).filter(Boolean)));

  if (!phones.length) {
    return res.status(400).json({ error: 'no_valid_numbers' });
  }

  const cfg = await loadConfig();
  const twilioReady = !!(cfg.accountSid && cfg.authToken && cfg.callerId);

  if (!twilioReady) {
    // Report exactly which env var is missing so the dashboard can say
    // something more useful than just "failed".
    const missing = [];
    if (!cfg.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!cfg.authToken)  missing.push('TWILIO_AUTH_TOKEN');
    if (!cfg.callerId)   missing.push('TWILIO_CALLER_ID');
    return res.status(200).json({
      ok: false,
      twilioReady: false,
      missingEnvVars: missing,
      results: phones.map(to => ({ ok: false, to, reason: 'twilio_not_configured' })),
    });
  }

  const client = twilio(cfg.accountSid, cfg.authToken);
  const body = `${cfg.restaurantName || 'Lou Wok Rice House'}: this is a test text from your admin dashboard ✅ If you got this, order & catering alerts will reach this number too.`;

  const results = [];
  for (const to of phones) {
    try {
      const msg = await client.messages.create({ from: cfg.callerId, to, body });
      results.push({ ok: true, to, sid: msg.sid });
    } catch (err) {
      results.push({ ok: false, to, reason: (err && err.message) || 'send_failed' });
    }
  }

  const anyOk = results.some(r => r.ok);
  return res.status(200).json({ ok: anyOk, twilioReady: true, results });
};
