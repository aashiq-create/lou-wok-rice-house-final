// /api/notify.js
// v-EMAIL-BRAND 2026-07-09 — branded HTML emails w/ circular logo for admin+customer (order & catering); SMS stays text-only; on top of v-SMS-COPY + v-PRINT
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
let printOrder;
try { printOrder = require('./print-order').printOrder; } catch (e) { printOrder = null; }

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

const LOGO_URL = 'https://louwok.com/favicon-512.png';
const BRAND = { black:'#0a0a08', rice:'#f5eed8', wok:'#c8390a', gold:'#e8a020', smoke:'#1e1c18' };

// HTML-escape for safe insertion into email templates.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Builds a branded HTML email with the circular Lou Wok logo up top.
// `rows` is an array of [label, value] pairs rendered as a clean ticket.
function emailHTML({ heading, intro, rows, footerNote }) {
  const rowHtml = (rows || [])
    .filter(r => r && r[1] != null && String(r[1]).trim() !== '')
    .map(r => `<tr>
        <td style="padding:6px 0;color:${BRAND.gold};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;vertical-align:top;white-space:nowrap;">${esc(r[0])}</td>
        <td style="padding:6px 0 6px 18px;color:${BRAND.black};font-size:15px;font-weight:600;vertical-align:top;">${esc(r[1]).replace(/\n/g,'<br>')}</td>
      </tr>`).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${BRAND.smoke};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.smoke};padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${BRAND.rice};border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr><td align="center" style="padding:28px 24px 8px;">
            <img src="${LOGO_URL}" width="84" height="84" alt="Lou Wok Rice House" style="display:block;border-radius:50%;border:3px solid ${BRAND.wok};" />
          </td></tr>
          <tr><td align="center" style="padding:4px 24px 0;">
            <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.wok};font-weight:700;">Lou Wok Rice House</div>
          </td></tr>
          <tr><td align="center" style="padding:10px 24px 2px;">
            <div style="font-size:26px;font-weight:800;color:${BRAND.black};letter-spacing:0.02em;">${esc(heading)}</div>
          </td></tr>
          ${intro ? `<tr><td align="center" style="padding:6px 32px 12px;"><div style="font-size:14px;color:#4a463c;line-height:1.6;">${esc(intro)}</div></td></tr>` : ''}
          <tr><td style="padding:8px 32px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed ${BRAND.wok};border-bottom:1px dashed ${BRAND.wok};margin:4px 0;">
              ${rowHtml}
            </table>
          </td></tr>
          <tr><td align="center" style="padding:16px 32px 28px;">
            <div style="font-size:12px;color:#7a7466;line-height:1.6;">${esc(footerNote || 'St. Louis-style Chinese-American · Phoenix, AZ')}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

async function sendEmail(to, subject, text, html) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Lou Wok <orders@louwok.com>';
  if (!key || !to || !to.length) return { ok: false, reason: 'email_disabled' };
  try {
    const payload = { from, to, subject, text };
    if (html) payload.html = html;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
          `${RESTAURANT_NAME}: We received your order #${orderNo}! ` +
          `Your total is ${total}. Every order is cooked fresh and wok-fired to order. ` +
          `Your pickup time is approximately ${PICKUP_ETA} minutes. ` +
          `We'll send you another text as soon as your order is ready. ` +
          `Reply STOP to opt out.`;
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

      // 3) Admin email — branded HTML ticket with logo.
      const orderRows = [
        ['Order #', orderNo],
        ['Customer', cust.name || '—'],
        ['Phone', cust.phone || '—'],
        ['Items', items],
        ['Total', total],
        ['Notes', p.notes || ''],
        ['Placed', p.order_time || ''],
      ];
      results.email = await sendEmail(
        adminEmail,
        `New order ${orderNo} — ${cust.name || 'Guest'}`,
        adminBody,
        emailHTML({
          heading: 'New Order',
          intro: `A new online order just came in.`,
          rows: orderRows,
          footerNote: 'Kitchen ticket · Lou Wok Rice House',
        })
      );

      // 3b) Customer email confirmation — branded, if we have their email.
      if (cust.email) {
        results.customerEmail = await sendEmail(
          [cust.email],
          `${RESTAURANT_NAME}: Order ${orderNo} received`,
          `We received your order #${orderNo}. Total ${total}. Pickup ready in ~${PICKUP_ETA} min. We'll text you when it's ready.`,
          emailHTML({
            heading: `Order Received!`,
            intro: `Thanks ${(cust.name || '').split(' ')[0] || 'friend'}! Every order is cooked fresh and wok-fired to order. We'll text you the moment it's ready for pickup.`,
            rows: [
              ['Order #', orderNo],
              ['Items', items],
              ['Total', total],
              ['Pickup', `~${PICKUP_ETA} min`],
            ],
            footerNote: 'Wok-fired fresh · St. Louis-style · Phoenix, AZ',
          })
        );
      }

      // 4) Auto-print the kitchen ticket (PrintNode). Never let a printer
      //    problem break order submission — wrapped and non-fatal.
      if (printOrder) {
        try {
          results.print = await printOrder({
            orderNo,
            items,
            total,
            customerName: cust.name || '',
            phone: cust.phone || '',
            pickupEta: PICKUP_ETA,
            placedAt: new Date(),
          }, cfg);
        } catch (e) {
          results.print = { ok: false, reason: (e && e.message) || 'print error' };
        }
      }
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
        body,
        emailHTML({
          heading: 'Catering Inquiry',
          intro: 'A new catering inquiry just came in.',
          rows: [
            ['Name', c.name || '—'],
            ['Phone', c.phone || '—'],
            ['Email', c.email || '—'],
            ['Event', p.event_date || '—'],
            ['Guests', p.guests || '—'],
            ['Package', p.package || ''],
            ['Add-Ons', p.addons || ''],
            ['Details', p.details || ''],
          ],
          footerNote: 'Catering inquiry · Lou Wok Rice House',
        })
      );

      // Customer auto-reply — confirms we received the inquiry (STOP required).
      if (c.phone) {
        const firstName = (c.name || '').trim().split(/\s+/)[0] || 'there';
        const custBody =
          `${RESTAURANT_NAME}: Thanks ${firstName}! ` +
          `We received your catering inquiry` +
          (p.event_date ? ` for ${p.event_date}` : '') +
          (p.guests ? ` (${p.guests} guests)` : '') + `. ` +
          `We'll reach out shortly to plan the details. ` +
          `Reply STOP to opt out.`;
        results.customer = await sendSMS(client, smsFrom, c.phone, custBody);
      }

      // Customer catering confirmation — branded HTML, if we have their email.
      if (c.email) {
        const firstName = (c.name || '').trim().split(/\s+/)[0] || 'there';
        results.customerEmail = await sendEmail(
          [c.email],
          `${RESTAURANT_NAME}: We got your catering inquiry`,
          `Thanks ${firstName}! We received your catering inquiry. We'll follow up within 48 hours to confirm your date and finalize details.`,
          emailHTML({
            heading: 'Inquiry Received!',
            intro: `Thanks ${firstName}! We got your catering request and we're fired up. Within 48 hours we'll confirm your date and email a secure link to pay your 25% deposit — that's what locks it in.`,
            rows: [
              ['Event', p.event_date || ''],
              ['Guests', p.guests || ''],
              ['Package', p.package || ''],
              ['Add-Ons', p.addons || ''],
            ],
            footerNote: 'Questions? catering@louwok.com',
          })
        );
      }
    } else {
      return res.status(400).json({ error: 'Unknown type: ' + type });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('notify error:', err && err.message);
    return res.status(500).json({ error: 'notify_failed', detail: err && err.message });
  }
};
