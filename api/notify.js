// /api/notify.js
// v-EMOJI-TRIM2 2026-07-04 — customer confirmation trimmed for segment headroom (~17 chars spare)
// ────────────────────────────────────────────────────────────────────────────
// The endpoint index-5.html already POSTs to. Handles two payload types:
//
//   type: 'order'     → texts the CUSTOMER their order number + confirmation,
//                       texts/emails the ADMINS the full order ticket.
//   type: 'catering'  → texts/emails the ADMINS a catering inquiry.
//
// SMS via Twilio. Email via Resend (optional — only fires if RESEND_API_KEY set).
//
// ENV VARS
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_CALLER_ID        your Twilio number (E.164), used as SMS "from"
//   RESEND_API_KEY          optional; enables email
//   RESEND_FROM             optional; e.g. "Lou Wok <orders@louwok.com>"
//   RESTAURANT_NAME         optional; defaults "Lou Wok Rice House"
//   PICKUP_ETA_MIN          optional; defaults "10-12"
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');
const { loadConfig } = require('./_config');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fall through */ }
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

async function sendSMS(client, from, to, body) {
  const dest = toE164(to);
  if (!dest) return { ok: false, reason: 'bad_number', to };
  try {
    const msg = await client.messages.create({ from, to: dest, body });
    return { ok: true, sid: msg.sid, to: dest };
  } catch (err) {
    console.error('SMS failed to', dest, err && err.message);
    return { ok: false, reason: err && err.message, to: dest };
  }
}

async function sendEmail(to, subject, text) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Lou Wok <orders@louwok.com>';
  if (!key || !to || !to.length) return { ok: false, reason: 'email_disabled' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, reason: `resend ${r.status} ${t}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const cfg = await loadConfig();
  const accountSid = cfg.accountSid;
  const authToken  = cfg.authToken;
  const smsFrom    = cfg.callerId;
  const RESTAURANT_NAME = cfg.restaurantName;
  const PICKUP_ETA      = cfg.pickupEtaMin;

  if (!accountSid || !authToken || !smsFrom) {
    return res.status(500).json({ error: 'Twilio not configured' });
  }
  const client = twilio(accountSid, authToken);

  const p    = readBody(req);
  const type = p.type || 'order';
  const recipients = p.recipients || { email: [], sms: [] };
  // Admin SMS = numbers from the dashboard (cms-data.json) merged with anything
  // the front end passed, de-duplicated. Dashboard is the source of truth.
  const fromPage   = Array.isArray(recipients.sms) ? recipients.sms : [];
  const adminSms   = Array.from(new Set([...cfg.adminSms, ...fromPage]));
  const adminEmail = Array.isArray(recipients.email) ? recipients.email : [];

  const results = { customer: null, admins: [], email: null };

  try {
    if (type === 'order') {
      const cust    = p.customer || {};
      const orderNo = p.order_number || 'LW';
      const items   = p.order_items || '';
      const total   = p.total || '';

      // 1) Customer confirmation — the order number + pickup ETA.
      if (cust.phone) {
        const custBody =
          `${RESTAURANT_NAME}: Order ${orderNo} received. ` +
          `Total ${total}. Pickup ready in ~${PICKUP_ETA} min. ` +
          `We'll text when it's ready. Reply STOP to opt out.`;
        results.customer = await sendSMS(client, smsFrom, cust.phone, custBody);
      }

      // 2) Admin ticket — full order details to each admin cell.
      const adminBody =
        `🍚 NEW ORDER ${orderNo}\n` +
        `${cust.name || '—'} · ${cust.phone || '—'}\n` +
        `${items}\n` +
        `Total: ${total}\n` +
        `Notes: ${p.notes || '—'}\n` +
        `${p.order_time || ''}`;
      for (const a of adminSms) {
        results.admins.push(await sendSMS(client, smsFrom, a, adminBody));
      }

      // 3) Admin email (optional).
      results.email = await sendEmail(
        adminEmail,
        `New order ${orderNo} — ${cust.name || 'Guest'}`,
        adminBody
      );
    } else if (type === 'catering') {
      const c    = p.customer || {};
      const body =
        `🎉 CATERING INQUIRY\n` +
        `${c.name || '—'} · ${c.phone || '—'} · ${c.email || '—'}\n` +
        `Event: ${p.event_date || '—'} · Guests: ${p.guests || '—'}\n` +
        `${p.details || ''}`;
      for (const a of adminSms) {
        results.admins.push(await sendSMS(client, smsFrom, a, body));
      }
      results.email = await sendEmail(
        adminEmail,
        `Catering inquiry — ${c.name || 'Guest'}`,
        body
      );
    } else {
      return res.status(400).json({ error: 'Unknown type: ' + type });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('notify error:', err && err.message);
    return res.status(500).json({ error: 'notify_failed', detail: err && err.message });
  }
};
