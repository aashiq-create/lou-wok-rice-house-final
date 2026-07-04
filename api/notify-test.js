// /api/notify-test.js
// v2.0 — 2026-07-04 — now verifies actual DELIVERY status, not just queueing
// ────────────────────────────────────────────────────────────────────────────
// Sends a single test text via Twilio so the admin dashboard's "Send Test
// Text" button can confirm the SMS pipeline actually works — no real order
// or catering inquiry required.
//
// POST body: { phones: ["+16025551234", ...] }
// Uses the same Twilio env vars / cms-data.json config as /api/notify.js,
// so a passing test here means real order/catering texts will work too.
//
// v2 change: after sending, we wait ~4s and fetch each message back from
// Twilio. "Sent" only means Twilio queued it — carriers can still block it
// (e.g. error 30032: unverified toll-free number). Now the dashboard shows
// the real outcome instead of a false green checkmark.
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');
const { loadConfig } = require('./_config');

// Friendly explanations for the Twilio error codes we're most likely to hit.
const ERROR_HINTS = {
  30032: 'toll-free number not verified yet — finish/await Twilio verification',
  30007: 'blocked by carrier spam filtering',
  30006: 'landline or unreachable carrier',
  30005: 'unknown or inactive destination number',
  30003: 'destination phone unreachable or off',
  21610: 'this number replied STOP — text START to it to re-subscribe',
};

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // ── Step 1: queue every message ────────────────────────────────────────
  const sent = [];    // { to, sid }
  const results = []; // final per-number outcomes
  for (const to of phones) {
    try {
      const msg = await client.messages.create({ from: cfg.callerId, to, body });
      sent.push({ to, sid: msg.sid });
    } catch (err) {
      // Failed before it even queued (bad from-number, auth, etc.)
      results.push({ ok: false, to, reason: (err && err.message) || 'send_failed' });
    }
  }

  // ── Step 2: give carriers a moment, then check what really happened ────
  if (sent.length) await sleep(4000);

  for (const { to, sid } of sent) {
    try {
      const m = await client.messages(sid).fetch();

      if (m.status === 'delivered') {
        results.push({ ok: true, to, sid, status: m.status });
      } else if (m.status === 'undelivered' || m.status === 'failed') {
        const hint = ERROR_HINTS[m.errorCode] || m.errorMessage || 'carrier rejected the message';
        results.push({
          ok: false, to, sid, status: m.status, errorCode: m.errorCode,
          reason: `${m.status} (error ${m.errorCode}: ${hint})`,
        });
      } else {
        // queued / sending / sent — Twilio pushed it out but the carrier
        // hasn't confirmed delivery yet. Treat as tentative success and
        // point at the logs for the final word.
        results.push({
          ok: true, to, sid, status: m.status,
          note: 'accepted by Twilio — final delivery pending, confirm in Twilio Monitor > Logs > Messaging',
        });
      }
    } catch (err) {
      // Couldn't fetch status — the send itself still went through.
      results.push({ ok: true, to, sid, status: 'unknown', note: 'status check failed; check Twilio logs' });
    }
  }

  const anyOk = results.some(r => r.ok);
  return res.status(200).json({ ok: anyOk, twilioReady: true, results });
};
