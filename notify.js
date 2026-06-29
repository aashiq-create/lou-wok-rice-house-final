// /api/notify.js
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

// ── Square deposit link ──────────────────────────────────────────────────────
// 25% of the quoted total secures a catering date. Because the exact total isn't
// known until the event is quoted, the default flow gives the admins a reusable
// Square link to send AFTER confirming availability and pricing.
//
// Set SQUARE_DEPOSIT_LINK in Vercel to a Square "Payment Link / Online Checkout"
// you create once in the Square dashboard (item: "Catering deposit", price left
// open / variable). The admin email then includes it directly.
//
// To later AUTO-CREATE a per-event link with the exact 25% amount, swap this for
// a call to Square's Checkout API (POST /v2/online-checkout/payment-links) using
// SQUARE_ACCESS_TOKEN — documented upgrade path, off by default.
function buildSquareDepositLink({ name, email, guests, pkg }) {
  const base = process.env.SQUARE_DEPOSIT_LINK;
  if (!base) return { ready: false, url: '' };
  const sep  = base.includes('?') ? '&' : '?';
  const note = encodeURIComponent(`Catering deposit — ${name} · ${guests} guests · ${pkg}`);
  return { ready: true, url: `${base}${sep}note=${note}` };
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
          `${RESTAURANT_NAME}: Order ${orderNo} received! ✅\n` +
          `Total ${total}. Ready for pickup in about ${PICKUP_ETA} min. ` +
          `We'll text you when it's ready. Reply STOP to opt out.`;
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
      // The catering form posts FLAT fields (client_name, guest_count, notes…),
      // not a nested customer object. Read them directly. Fall back to the old
      // nested shape so either payload works.
      const c     = p.customer || {};
      const name  = p.client_name  || c.name  || '—';
      const phone = p.client_phone || c.phone || '—';
      const email = p.client_email || c.email || '—';
      const date  = p.event_date   || '—';
      const time  = p.event_time   || '—';
      const guests= p.guest_count  || p.guests || '—';
      const pkg   = p.package      || '—';
      const style = p.service_style|| '—';
      const etype = p.event_type   || '—';
      const addons= p.addons       || 'None';
      const notes = p.notes || p.details || '—';
      const source= p.source       || '—';

      // 25% deposit secures the date (per site terms). We can't compute the
      // exact amount until the event is quoted, so the admin email carries a
      // one-click Square deposit-link builder instead of a fixed charge.
      const depositLink = buildSquareDepositLink({ name, email, guests, pkg });

      const smsBody =
        `🎉 CATERING INQUIRY\n` +
        `${name} · ${phone} · ${email}\n` +
        `${date} ${time} · ${guests} guests · ${etype}\n` +
        `Pkg: ${pkg} (${style})\n` +
        `Add-ons: ${addons}\n` +
        `Notes: ${notes}\n` +
        `Heard via: ${source}`;
      for (const a of adminSms) {
        results.admins.push(await sendSMS(client, smsFrom, a, smsBody));
      }

      const emailBody =
        `NEW CATERING INQUIRY\n` +
        `──────────────────────────────\n` +
        `Name:        ${name}\n` +
        `Phone:       ${phone}\n` +
        `Email:       ${email}\n` +
        `Event date:  ${date}  ${time}\n` +
        `Guests:      ${guests}\n` +
        `Event type:  ${etype}\n` +
        `Package:     ${pkg}\n` +
        `Service:     ${style}\n` +
        `Add-ons:     ${addons}\n` +
        `Notes:       ${notes}\n` +
        `Heard via:   ${source}\n` +
        `Submitted:   ${p.submit_time || ''}\n` +
        `──────────────────────────────\n\n` +
        `NEXT STEP — secure the date with a 25% deposit:\n` +
        `1. Confirm availability for ${date}.\n` +
        `2. Quote the event total, then take 25% as the deposit.\n` +
        `${depositLink.ready
            ? `3. Send this Square deposit link (set the amount in Square):\n   ${depositLink.url}\n`
            : `3. Create a Square deposit payment link and send it to ${email}.\n   (Set SQUARE_DEPOSIT_LINK in Vercel to prefill this automatically.)\n`}` +
        `\nReply within 48 hrs — that's what the site promises.`;

      results.email = await sendEmail(
        adminEmail,
        `Catering inquiry — ${name} · ${date} · ${guests} guests`,
        emailBody
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
