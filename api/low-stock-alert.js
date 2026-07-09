// /api/low-stock-alert.js
// v1.0 — 2026-07-06 — emails a low-stock alert to the Lou Wok team.
// ────────────────────────────────────────────────────────────────────────────
// Called by the admin dashboard when inventory is published and one or more
// items/supplies are at or below their low-stock threshold.
//
// POST { items: [ { name, qty }, ... ] }
// Emails malika@louwok.com and aashiq@louwok.com via Resend.
//
// Uses RESEND_API_KEY (same env var as notify.js). If it's not set, the call
// no-ops gracefully so publishing never breaks.
// ────────────────────────────────────────────────────────────────────────────

const ALERT_RECIPIENTS = ['malika@louwok.com', 'aashiq@louwok.com'];

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }

  const p = readBody(req);
  const items = Array.isArray(p.items) ? p.items.filter(i => i && i.name) : [];
  if (!items.length) return res.status(200).json({ ok: true, skipped: 'no low items' });

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Lou Wok <orders@louwok.com>';
  if (!key) return res.status(200).json({ ok: false, reason: 'RESEND_API_KEY not set' });

  const listText = items.map(i => `  • ${i.name} — ${i.qty} left`).join('\n');
  const listHtml = items.map(i => `<li><strong>${String(i.name).replace(/</g,'&lt;')}</strong> — ${i.qty} left</li>`).join('');
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });

  const subject = `⚠️ Lou Wok low stock — ${items.length} item${items.length>1?'s':''} need restock`;
  const text =
    `Lou Wok Rice House — Low Stock Alert\n` +
    `${when} (Phoenix)\n\n` +
    `The following items are at or below their low-stock threshold:\n\n` +
    `${listText}\n\n` +
    `Restock soon. — Lou Wok admin`;
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#1e1c18;">` +
    `<h2 style="color:#c8390a;margin:0 0 4px;">⚠️ Low Stock Alert</h2>` +
    `<p style="color:#8a8475;margin:0 0 12px;font-size:13px;">Lou Wok Rice House · ${when} (Phoenix)</p>` +
    `<p style="margin:0 0 8px;">These items are at or below their low-stock threshold:</p>` +
    `<ul style="margin:0 0 12px;">${listHtml}</ul>` +
    `<p style="color:#8a8475;font-size:13px;">Restock soon. Sent automatically from the Lou Wok admin dashboard.</p>` +
    `</div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: ALERT_RECIPIENTS, subject, text, html }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(200).json({ ok: false, reason: `resend ${r.status} ${t.slice(0,150)}` });
    }
    return res.status(200).json({ ok: true, notified: ALERT_RECIPIENTS });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: (err && err.message) || 'email failed' });
  }
};
