// v-DEPOSIT 2026-07-09 — Creates a Square Payment Link for a catering deposit.
// Takes a reference number + total quote amount, generates a link for 25%
// (or a custom deposit %), labeled with the reference. Admin-only (key-gated).
//
// Required Vercel env vars:
//   SQUARE_ACCESS_TOKEN   — Square production access token
//   SQUARE_LOCATION_ID    — Square production location ID
//   ADMIN_DEPOSIT_KEY     — a shared secret so only your admin tool can call this
// Optional:
//   SQUARE_ENV            — 'production' (default) or 'sandbox'

const SQUARE_VERSION = '2026-05-20';

function money(dollars) {
  // Square expects integer cents (BIGINT). Round to avoid float drift.
  return Math.round(Number(dollars) * 100);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Parse body (Vercel may hand it as string or object).
  let p = req.body;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
  p = p || {};

  // ── Admin gate ──────────────────────────────────────────────
  const adminKey = process.env.ADMIN_DEPOSIT_KEY;
  if (adminKey && p.adminKey !== adminKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token    = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_TOKEN;
  const location = process.env.SQUARE_LOCATION_ID;
  if (!token || !location) {
    return res.status(500).json({
      error: 'square_not_configured',
      detail: 'Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in environment.',
    });
  }

  // ── Inputs ──────────────────────────────────────────────────
  const reference = (p.reference || '').toString().trim();
  const total     = Number(p.total);
  const depositPct = p.depositPct ? Number(p.depositPct) : 25;
  const customerName = (p.customerName || '').toString().trim();

  if (!reference) return res.status(400).json({ error: 'missing_reference' });
  if (!total || isNaN(total) || total <= 0) {
    return res.status(400).json({ error: 'invalid_total' });
  }
  if (depositPct <= 0 || depositPct > 100) {
    return res.status(400).json({ error: 'invalid_deposit_pct' });
  }

  const depositAmount = Math.round(total * (depositPct / 100) * 100) / 100; // 2dp
  const host = process.env.SQUARE_ENV === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';

  const nameLine = customerName ? ` — ${customerName}` : '';

  try {
    const r = await fetch(`${host}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        'Square-Version': SQUARE_VERSION,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: `${reference}-${Date.now()}`,
        quick_pay: {
          name: `Catering Deposit (${depositPct}%) · ${reference}${nameLine}`,
          price_money: {
            amount: money(depositAmount),
            currency: 'USD',
          },
          location_id: location,
        },
        checkout_options: {
          redirect_url: 'https://louwok.com/#catering',
          ask_for_shipping_address: false,
        },
        description: `Lou Wok Rice House catering deposit for ${reference}. ` +
          `${depositPct}% of quoted total $${total.toFixed(2)} = $${depositAmount.toFixed(2)}.`,
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: 'square_error',
        detail: data && data.errors ? data.errors : data,
      });
    }

    const link = data && data.payment_link;
    return res.status(200).json({
      ok: true,
      reference,
      total: total.toFixed(2),
      depositPct,
      depositAmount: depositAmount.toFixed(2),
      url: link && link.url,
      long_url: link && link.long_url,
      paymentLinkId: link && link.id,
      orderId: link && link.order_id,
    });
  } catch (err) {
    return res.status(500).json({ error: 'request_failed', detail: err && err.message });
  }
};
