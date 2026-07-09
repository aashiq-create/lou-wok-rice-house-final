// /api/cron-low-stock.js
// v1.0 — 2026-07-06 — scheduled low-stock check (Vercel Cron).
// ────────────────────────────────────────────────────────────────────────────
// Vercel Cron hits this endpoint on a schedule (see vercel.json). It:
//   1) fetches the published cms-data.json,
//   2) finds inventory items + supplies at/below their low threshold,
//   3) emails malika@louwok.com and aashiq@louwok.com if anything is low.
//
// No one needs to open the admin — this runs on its own.
//
// Vercel Cron always sends a GET with an "Authorization: Bearer <CRON_SECRET>"
// header. We verify it so a random visitor can't trigger emails.
//
// Env vars used:
//   CRON_SECRET     (auto-provisioned by Vercel when you add cron; verify header)
//   RESEND_API_KEY  (same as notify.js — enables email)
//   RESEND_FROM     (optional)
//   CMS_URL         (optional override; defaults to the public cms-data.json)
// ────────────────────────────────────────────────────────────────────────────

const ALERT_RECIPIENTS = ['malika@louwok.com', 'aashiq@louwok.com'];
const DEFAULT_LOW = 6;

// Where to read the published inventory from. Defaults to the site's own
// cms-data.json (same-origin on the production deployment).
function cmsUrl(req) {
  if (process.env.CMS_URL) return process.env.CMS_URL;
  const host = (req && req.headers && req.headers.host) || 'louwok.com';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return `${proto}://${host}/cms-data.json?_=${Date.now()}`;
}

function lowStockFrom(cms) {
  const low = [];
  const inv = cms && cms.inventory;
  if (!inv) return low;

  // Menu-item stock (keyed by id) — map ids to names via cms.menu.
  const nameById = {};
  (cms.menu || []).forEach(m => { nameById[String(m.id)] = m.name; });
  Object.entries(inv.items || {}).forEach(([id, v]) => {
    if (v && typeof v.qty === 'number' && v.qty <= (v.low != null ? v.low : DEFAULT_LOW)) {
      low.push({ name: nameById[id] || ('Item ' + id), qty: v.qty });
    }
  });

  // Supplies (plasticware, napkins, boxes, etc.)
  (inv.supplies || []).forEach(s => {
    if (s && typeof s.qty === 'number' && s.qty <= (s.low != null ? s.low : DEFAULT_LOW)) {
      low.push({ name: s.name || 'Supply', qty: s.qty });
    }
  });

  return low;
}

async function sendAlert(items) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Lou Wok <orders@louwok.com>';
  if (!key) return { ok: false, reason: 'RESEND_API_KEY not set' };

  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });
  const listText = items.map(i => `  • ${i.name} — ${i.qty} left`).join('\n');
  const listHtml = items.map(i => `<li><strong>${String(i.name).replace(/</g,'&lt;')}</strong> — ${i.qty} left</li>`).join('');

  const body = {
    from,
    to: ALERT_RECIPIENTS,
    subject: `⚠️ Lou Wok daily stock check — ${items.length} item${items.length>1?'s':''} low`,
    text: `Lou Wok Rice House — Daily Low Stock Check\n${when} (Phoenix)\n\nAt or below low-stock threshold:\n\n${listText}\n\nRestock soon. — Lou Wok admin (automatic)`,
    html: `<div style="font-family:system-ui,Arial,sans-serif;color:#1e1c18;">`
      + `<h2 style="color:#c8390a;margin:0 0 4px;">⚠️ Daily Low Stock Check</h2>`
      + `<p style="color:#8a8475;margin:0 0 12px;font-size:13px;">Lou Wok Rice House · ${when} (Phoenix)</p>`
      + `<p style="margin:0 0 8px;">These items are at or below their low-stock threshold:</p>`
      + `<ul style="margin:0 0 12px;">${listHtml}</ul>`
      + `<p style="color:#8a8475;font-size:13px;">Sent automatically by the Lou Wok admin \u2014 no action was needed to generate this.</p></div>`,
  };

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); return { ok: false, reason: `resend ${r.status} ${t.slice(0,150)}` }; }
  return { ok: true, notified: ALERT_RECIPIENTS };
}

module.exports = async (req, res) => {
  // Verify the request is from Vercel Cron (or an authorized caller).
  const secret = process.env.CRON_SECRET;
  const auth = (req.headers && req.headers.authorization) || '';
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }

  try {
    const r = await fetch(cmsUrl(req), { headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) return res.status(200).json({ ok: false, reason: `cms fetch ${r.status}` });
    const cms = await r.json();

    const low = lowStockFrom(cms);
    if (!low.length) {
      return res.status(200).json({ ok: true, low: 0, note: 'all stock above threshold — no email sent' });
    }

    const sent = await sendAlert(low);
    return res.status(200).json({ ok: sent.ok, low: low.length, items: low, email: sent });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: (err && err.message) || 'cron error' });
  }
};
