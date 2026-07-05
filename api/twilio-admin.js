// /api/twilio-admin.js
// v1.0 — 2026-07-04 — full messaging & voice control for the admin dashboard
// ────────────────────────────────────────────────────────────────────────────
// One endpoint, many actions. POST { action, ...params } with header
// "x-admin-token" matching the ADMIN_API_TOKEN env var, or you get a 401.
//
// Actions:
//   "number_get"       → current config on the Twilio number
//   "number_update"    → { voiceUrl?, smsUrl?, friendlyName? }
//   "messages_recent"  → last 20 SMS with REAL status + error codes
//   "calls_recent"     → last 20 calls
//   "sms_send"         → { to, body } — send any text from the business number
//
// Auth to Twilio uses an API Key (TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET)
// so the master auth token can stay untouched; falls back to the account
// SID + auth token if the key vars aren't set.
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
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

function toE164(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s[0] === '+') { const d = s.replace(/[^\d]/g, ''); return d ? '+' + d : ''; }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}

function makeClient(cfg) {
  const keySid    = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;
  if (keySid && keySecret && cfg.accountSid) {
    return twilio(keySid, keySecret, { accountSid: cfg.accountSid });
  }
  return twilio(cfg.accountSid, cfg.authToken); // fallback
}

async function findNumberSid(client, phoneNumber) {
  const list = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  return list.length ? list[0].sid : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ── Gate: admin token required ─────────────────────────────────────────
  const expected = process.env.ADMIN_API_TOKEN || '';
  const provided = req.headers['x-admin-token'] || '';
  if (!expected) {
    return res.status(200).json({ ok: false, reason: 'ADMIN_API_TOKEN is not set in Vercel — add it and redeploy.' });
  }
  if (provided !== expected) {
    return res.status(401).json({ ok: false, reason: 'bad_admin_token' });
  }

  const cfg = await loadConfig();
  if (!cfg.accountSid || !cfg.callerId) {
    return res.status(200).json({ ok: false, reason: 'Twilio env vars missing (TWILIO_ACCOUNT_SID / TWILIO_CALLER_ID).' });
  }

  const client = makeClient(cfg);
  const { action } = readBody(req);
  const p = readBody(req);

  try {
    // ── Number: read current config ──────────────────────────────────────
    if (action === 'number_get') {
      const sid = await findNumberSid(client, cfg.callerId);
      if (!sid) return res.status(200).json({ ok: false, reason: `Number ${cfg.callerId} not found on this account.` });
      const n = await client.incomingPhoneNumbers(sid).fetch();
      return res.status(200).json({
        ok: true,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        voiceUrl: n.voiceUrl || '',
        smsUrl: n.smsUrl || '',
      });
    }

    // ── Number: update webhooks / name ───────────────────────────────────
    if (action === 'number_update') {
      const sid = await findNumberSid(client, cfg.callerId);
      if (!sid) return res.status(200).json({ ok: false, reason: `Number ${cfg.callerId} not found on this account.` });
      const update = {};
      if (p.voiceUrl) {
        if (!isValidHttpsUrl(p.voiceUrl)) return res.status(200).json({ ok: false, reason: 'voiceUrl must be a valid https:// URL' });
        update.voiceUrl = p.voiceUrl;
      }
      if (p.smsUrl) {
        if (!isValidHttpsUrl(p.smsUrl)) return res.status(200).json({ ok: false, reason: 'smsUrl must be a valid https:// URL' });
        update.smsUrl = p.smsUrl;
      }
      if (p.friendlyName) update.friendlyName = String(p.friendlyName).slice(0, 64);
      if (!Object.keys(update).length) return res.status(200).json({ ok: false, reason: 'Nothing to update.' });
      const n = await client.incomingPhoneNumbers(sid).update(update);
      return res.status(200).json({ ok: true, voiceUrl: n.voiceUrl || '', smsUrl: n.smsUrl || '', friendlyName: n.friendlyName });
    }

    // ── Messaging: recent log with real delivery status ──────────────────
    if (action === 'messages_recent') {
      const msgs = await client.messages.list({ limit: 20 });
      return res.status(200).json({
        ok: true,
        messages: msgs.map(m => ({
          date: m.dateSent || m.dateCreated,
          direction: m.direction,
          from: m.from, to: m.to,
          status: m.status,
          errorCode: m.errorCode || null,
          segments: m.numSegments,
          body: (m.body || '').slice(0, 80),
        })),
      });
    }

    // ── Voice: recent calls ──────────────────────────────────────────────
    if (action === 'calls_recent') {
      const calls = await client.calls.list({ limit: 20 });
      return res.status(200).json({
        ok: true,
        calls: calls.map(c => ({
          date: c.startTime || c.dateCreated,
          direction: c.direction,
          from: c.from, to: c.to,
          status: c.status,
          duration: c.duration,
        })),
      });
    }

    // ── Messaging: send an arbitrary SMS from the business number ────────
    if (action === 'sms_send') {
      const to = toE164(p.to);
      const body = String(p.body || '').trim();
      if (!to)   return res.status(200).json({ ok: false, reason: 'Invalid "to" number.' });
      if (!body) return res.status(200).json({ ok: false, reason: 'Message body is empty.' });
      const msg = await client.messages.create({ from: cfg.callerId, to, body });
      return res.status(200).json({ ok: true, sid: msg.sid, status: msg.status });
    }

    return res.status(200).json({ ok: false, reason: `Unknown action "${action}".` });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: (err && err.message) || 'twilio_error' });
  }
};
