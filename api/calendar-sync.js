// v-CALENDAR-SYNC2 2026-07-16 — pushes BOOKED events to Google Calendar + emails aashiq@ and malika@ on each sync.
// ────────────────────────────────────────────────────────────────────────────
// Server-to-server sync using a Google service account (no interactive OAuth).
// The admin calls this when an event is marked Booked (and has a date). We
// create — or update, if a googleEventId is supplied — a calendar event.
//
// REQUIRED Vercel environment variables:
//   GCAL_SERVICE_EMAIL   the service account email (…@…iam.gserviceaccount.com)
//   GCAL_PRIVATE_KEY     the service account private key (PEM). Paste the whole
//                        key incl. BEGIN/END lines. Literal "\n" sequences are
//                        converted to real newlines automatically.
//   GCAL_CALENDAR_ID     the target calendar ID (e.g. your Gmail address, or a
//                        dedicated calendar's ID). The calendar MUST be shared
//                        with GCAL_SERVICE_EMAIL as "Make changes to events".
//   CALENDAR_SYNC_TOKEN  a shared secret; the admin sends it as x-cal-token so
//                        randoms can't create events on your calendar.
//
// The function is a no-op-safe: if env vars are missing it returns a clear
// error rather than throwing, so the admin can surface a helpful message.
// ────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE     = 'https://www.googleapis.com/auth/calendar';

// Notify both owners whenever a booked event is synced to the calendar.
const NOTIFY_EMAILS = ['aashiq@louwok.com', 'malika@louwok.com'];
const LOGO_URL = 'https://louwok.com/favicon-512.png';

// Send an email via Resend (same setup as notify.js). Never throws.
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
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, reason: 'resend ' + r.status + ' ' + t };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Build and sign a JWT, then exchange it for an access token.
async function getAccessToken() {
  const email = process.env.GCAL_SERVICE_EMAIL;
  let key = process.env.GCAL_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error('Google Calendar not configured (missing GCAL_SERVICE_EMAIL or GCAL_PRIVATE_KEY).');
  }
  // Env vars often store the PEM with literal \n — restore real newlines.
  key = key.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(key)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const jwt = unsigned + '.' + signature;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error('Google token exchange failed: ' + (j.error_description || j.error || r.status));
  }
  return j.access_token;
}

// Turn an admin event into a Google Calendar event resource.
// Events use a date + optional time. If a time is present we make a 2-hour
// timed event; otherwise an all-day event.
function toCalendarResource(ev) {
  const summary = ev.title || ev.location || 'Lou Wok Booked Event';
  const location = ev.location || '';
  const descParts = [];
  if (ev.notes) descParts.push(ev.notes);
  descParts.push('Booked via Lou Wok admin.');
  const description = descParts.join('\n\n');

  // Timezone: Phoenix (no DST).
  const TZ = 'America/Phoenix';

  if (ev.time && /^\d{1,2}:\d{2}/.test(ev.time)) {
    // Timed event: start at ev.time, 2 hours long.
    const [hh, mm] = ev.time.split(':').map(n => parseInt(n, 10));
    const start = `${ev.date}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
    const endH = (hh + 2) % 24;
    const end = `${ev.date}T${String(endH).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
    return {
      summary, location, description,
      start: { dateTime: start, timeZone: TZ },
      end:   { dateTime: end,   timeZone: TZ },
    };
  }
  // All-day event.
  const next = new Date(ev.date + 'T00:00:00');
  next.setDate(next.getDate() + 1);
  const endDate = next.toISOString().slice(0, 10);
  return {
    summary, location, description,
    start: { date: ev.date },
    end:   { date: endDate },
  };
}

module.exports = async (req, res) => {
  // CORS for the admin page.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cal-token');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok:false, error:'Method not allowed' }); return; }

  // Shared-secret gate.
  const expected = process.env.CALENDAR_SYNC_TOKEN;
  const provided = req.headers['x-cal-token'];
  if (expected && provided !== expected) {
    res.status(401).json({ ok:false, error:'Unauthorized (bad or missing x-cal-token).' });
    return;
  }

  const calendarId = process.env.GCAL_CALENDAR_ID;
  if (!calendarId) {
    res.status(500).json({ ok:false, error:'GCAL_CALENDAR_ID not set in Vercel.' });
    return;
  }

  // Parse body (Vercel usually parses JSON, but be defensive).
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const ev = body.event || body;
  if (!ev || !ev.date) {
    res.status(400).json({ ok:false, error:'Event must include a date (YYYY-MM-DD).' });
    return;
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
    return;
  }

  const resource = toCalendarResource(ev);
  const base = 'https://www.googleapis.com/calendar/v3/calendars/' +
               encodeURIComponent(calendarId) + '/events';

  try {
    let r, j;
    if (ev.googleEventId) {
      // Update existing event (idempotent re-publish).
      r = await fetch(base + '/' + encodeURIComponent(ev.googleEventId), {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(resource),
      });
      j = await r.json();
      if (r.status === 404) {
        // The stored ID is stale (event deleted in Google) — create fresh.
        r = await fetch(base, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(resource),
        });
        j = await r.json();
      }
    } else {
      // Create new event.
      r = await fetch(base, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(resource),
      });
      j = await r.json();
    }

    if (!r.ok) {
      res.status(500).json({ ok:false, error: (j.error && j.error.message) || ('Calendar API error ' + r.status) });
      return;
    }

    // Notify both owners that a booked event landed on the calendar.
    // Non-blocking for the response's success — but we await so the serverless
    // function doesn't get torn down before the email is sent.
    const summary = ev.title || ev.location || 'Booked Event';
    const whenTxt = ev.time ? (ev.date + ' at ' + ev.time) : ev.date;
    const locTxt  = ev.location || '(no location set)';
    const wasUpdate = !!ev.googleEventId;
    const verb = wasUpdate ? 'updated on' : 'added to';
    const subject = 'Lou Wok: "' + summary + '" ' + verb + ' the calendar';
    const text =
      'A booked event was ' + verb + ' the Lou Wok Google Calendar.\n\n' +
      'Event:    ' + summary + '\n' +
      'When:     ' + whenTxt + '\n' +
      'Location: ' + locTxt + '\n' +
      (j.htmlLink ? ('\nView: ' + j.htmlLink + '\n') : '') +
      '\nSynced from the Lou Wok admin.';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#141410;color:#f5eed8;border-radius:8px;overflow:hidden;">' +
        '<div style="text-align:center;padding:1.4rem 1rem 0.8rem;">' +
          '<img src="' + LOGO_URL + '" alt="Lou Wok" width="64" height="64" style="border-radius:50%;display:inline-block;" />' +
        '</div>' +
        '<div style="padding:0 1.5rem 1.5rem;">' +
          '<h2 style="color:#e8a020;font-size:1.2rem;margin:0 0 0.8rem;">Event ' + verb + ' the calendar</h2>' +
          '<table style="width:100%;font-size:0.92rem;line-height:1.7;color:#f5eed8;">' +
            '<tr><td style="color:#8a8475;width:90px;">Event</td><td><strong>' + summary + '</strong></td></tr>' +
            '<tr><td style="color:#8a8475;">When</td><td>' + whenTxt + '</td></tr>' +
            '<tr><td style="color:#8a8475;">Location</td><td>' + locTxt + '</td></tr>' +
          '</table>' +
          (j.htmlLink
            ? '<p style="margin:1.1rem 0 0;"><a href="' + j.htmlLink + '" style="background:#c8390a;color:#fff;text-decoration:none;padding:0.6rem 1.1rem;border-radius:4px;font-size:0.9rem;display:inline-block;">Open in Google Calendar</a></p>'
            : '') +
          '<p style="color:#8a8475;font-size:0.75rem;margin:1.2rem 0 0;">Synced from the Lou Wok admin.</p>' +
        '</div>' +
      '</div>';

    let emailResult = { ok: false, reason: 'not_attempted' };
    try {
      emailResult = await sendEmail(NOTIFY_EMAILS, subject, text, html);
    } catch (_) { /* email failure must not fail the sync */ }

    res.status(200).json({ ok:true, googleEventId: j.id, htmlLink: j.htmlLink, emailed: emailResult.ok });
  } catch (e) {
    res.status(500).json({ ok:false, error: 'Calendar sync failed: ' + e.message });
  }
};
