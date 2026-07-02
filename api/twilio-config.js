// /api/twilio-config.js
// ────────────────────────────────────────────────────────────────────────────
// Lets the admin dashboard push Voice/SMS webhook URLs straight to the
// Twilio phone number configured as TWILIO_CALLER_ID — no manual trip to
// the Twilio Console required.
//
// GET  → returns the URLs currently configured on the Twilio number.
// POST → body: { voiceUrl, smsUrl } — updates the Twilio number to point
//        at those URLs (both optional; only the ones provided are changed).
//
// Uses the same TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_CALLER_ID
// env vars as /api/notify.js and /api/notify-test.js — no separate secrets
// or "access grant" needed beyond what's already in Vercel.
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');
const { loadConfig } = require('./_config');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
  }
  return {};
}

function isValidHttpsUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function findNumberSid(client, phoneNumber) {
  const list = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  return list.length ? list[0].sid : null;
}

module.exports = async (req, res) => {
  const cfg = await loadConfig();
  const twilioReady = !!(cfg.accountSid && cfg.authToken && cfg.callerId);

  if (!twilioReady) {
    const missing = [];
    if (!cfg.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!cfg.authToken)  missing.push('TWILIO_AUTH_TOKEN');
    if (!cfg.callerId)   missing.push('TWILIO_CALLER_ID');
    return res.status(200).json({ ok: false, twilioReady: false, missingEnvVars: missing });
  }

  const client = twilio(cfg.accountSid, cfg.authToken);

  let sid;
  try {
    sid = await findNumberSid(client, cfg.callerId);
  } catch (err) {
    return res.status(200).json({ ok: false, twilioReady: true, reason: (err && err.message) || 'lookup_failed' });
  }

  if (!sid) {
    return res.status(200).json({
      ok: false,
      twilioReady: true,
      reason: `No Twilio phone number matching TWILIO_CALLER_ID (${cfg.callerId}) was found on this account.`,
    });
  }

  if (req.method === 'GET') {
    try {
      const num = await client.incomingPhoneNumbers(sid).fetch();
      return res.status(200).json({
        ok: true,
        twilioReady: true,
        phoneNumber: cfg.callerId,
        voiceUrl: num.voiceUrl || '',
        smsUrl: num.smsUrl || '',
      });
    } catch (err) {
      return res.status(200).json({ ok: false, twilioReady: true, reason: (err && err.message) || 'fetch_failed' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const p = readBody(req);
  const voiceUrl = String(p.voiceUrl || '').trim();
  const smsUrl   = String(p.smsUrl   || '').trim();

  if (!voiceUrl && !smsUrl) {
    return res.status(400).json({ ok: false, error: 'Provide at least one of voiceUrl or smsUrl' });
  }
  if (voiceUrl && !isValidHttpsUrl(voiceUrl)) {
    return res.status(400).json({ ok: false, error: 'voiceUrl must be a valid https:// URL' });
  }
  if (smsUrl && !isValidHttpsUrl(smsUrl)) {
    return res.status(400).json({ ok: false, error: 'smsUrl must be a valid https:// URL' });
  }

  const update = { voiceMethod: 'POST', smsMethod: 'POST' };
  if (voiceUrl) update.voiceUrl = voiceUrl;
  if (smsUrl)   update.smsUrl   = smsUrl;

  try {
    const num = await client.incomingPhoneNumbers(sid).update(update);
    return res.status(200).json({
      ok: true,
      twilioReady: true,
      phoneNumber: cfg.callerId,
      voiceUrl: num.voiceUrl || '',
      smsUrl: num.smsUrl || '',
    });
  } catch (err) {
    return res.status(200).json({ ok: false, twilioReady: true, reason: (err && err.message) || 'update_failed' });
  }
};
