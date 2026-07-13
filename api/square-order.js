// v-SQUARE-ORDER 2026-07-11 — Charges a card via Square and creates a PAID order
// with a PICKUP fulfillment, so it appears in Square Order Manager and on the
// Kitchen Display System (Fresh KDS / Square KDS) alongside kiosk orders.
//
// WHY IT MUST BE PAID + HAVE FULFILLMENT:
//   Square only pushes an order to POS/Dashboard/KDS when BOTH are true:
//     (1) the order includes a fulfillment, and (2) the order is paid.
//   An unpaid order is invisible to the kitchen. So this endpoint does both in
//   one shot: CreateOrder (with PICKUP fulfillment) -> CreatePayment (order_id).
//
// Required Vercel env vars:
//   SQUARE_ACCESS_TOKEN   — Square access token (SANDBOX token while testing)
//   SQUARE_LOCATION_ID    — Square location ID (must match the token's env)
// Optional:
//   SQUARE_ENV            — 'sandbox' (DEFAULT — safe) or 'production'
//                           Left unset/sandbox so real cards are never charged
//                           until you explicitly opt in.
//
// NOTE: sandbox token must pair with a sandbox location ID, and production with
// production. Mixing them is the #1 cause of "unauthorized"/"not found" errors.

const SQUARE_VERSION = '2026-05-20';

function centsFrom(dollars) {
  return Math.round(Number(dollars) * 100);
}

function apiHost() {
  // DEFAULT TO SANDBOX. Only production when explicitly requested.
  return process.env.SQUARE_ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

async function squareFetch(path, token, body) {
  const r = await fetch(apiHost() + path, {
    method: 'POST',
    headers: {
      'Square-Version': SQUARE_VERSION,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let p = req.body;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
  p = p || {};

  const token    = process.env.SQUARE_ACCESS_TOKEN || process.env.SQUARE_TOKEN;
  const location = process.env.SQUARE_LOCATION_ID;
  if (!token || !location) {
    return res.status(500).json({
      error: 'square_not_configured',
      detail: 'Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in Vercel, then redeploy.',
    });
  }

  // ── Inputs from the checkout ────────────────────────────────
  const sourceId  = p.sourceId;                 // card nonce from Web Payments SDK
  const items     = Array.isArray(p.items) ? p.items : [];
  const orderNo   = (p.orderNumber || '').toString().trim();
  const cust      = p.customer || {};
  const pickupEta = Number(p.pickupEtaMin) || 15;

  if (!sourceId) return res.status(400).json({ error: 'missing_payment_token' });
  if (!items.length) return res.status(400).json({ error: 'empty_cart' });
  if (!cust.name) return res.status(400).json({ error: 'missing_customer_name' });

  // Ad-hoc line items (we don't require a Square catalog to be set up).
  const lineItems = items.map(i => ({
    name: String(i.name || 'Item').slice(0, 500),
    quantity: String(Math.max(1, Number(i.qty) || 1)),
    base_price_money: {
      amount: centsFrom(i.price || 0),
      currency: 'USD',
    },
    ...(i.sizeMeta ? { note: String(i.sizeMeta).slice(0, 500) } : {}),
  }));

  // Pickup time = now + prep window. Square wants RFC3339.
  const pickupAt = new Date(Date.now() + pickupEta * 60 * 1000).toISOString();

  const idem = `${orderNo || 'LW'}-${Date.now()}`;

  try {
    // ── 1) Create the ORDER with a PICKUP fulfillment ─────────
    // The fulfillment is what makes it a kitchen ticket rather than a bare sale.
    const orderReq = {
      idempotency_key: `order-${idem}`,
      order: {
        location_id: location,
        reference_id: orderNo || undefined,
        source: { name: 'louwok.com' },
        line_items: lineItems,
        fulfillments: [{
          type: 'PICKUP',
          state: 'PROPOSED',
          pickup_details: {
            recipient: {
              display_name: String(cust.name).slice(0, 255),
              ...(cust.phone ? { phone_number: String(cust.phone) } : {}),
              ...(cust.email ? { email_address: String(cust.email) } : {}),
            },
            schedule_type: 'ASAP',
            pickup_at: pickupAt,
            prep_time_duration: `PT${pickupEta}M`,
            ...(p.notes ? { note: String(p.notes).slice(0, 500) } : {}),
          },
        }],
      },
    };

    const created = await squareFetch('/v2/orders', token, orderReq);
    if (!created.ok) {
      return res.status(created.status).json({
        error: 'square_create_order_failed',
        detail: created.data && created.data.errors ? created.data.errors : created.data,
      });
    }

    const order = created.data.order || {};
    const orderId = order.id;
    const due = (order.total_money && order.total_money.amount) || 0;

    if (!orderId) {
      return res.status(500).json({ error: 'no_order_id', detail: created.data });
    }

    // ── 2) PAY for it — this is what makes it visible to the KDS ──
    const payReq = {
      idempotency_key: `pay-${idem}`,
      source_id: sourceId,
      order_id: orderId,
      location_id: location,
      amount_money: { amount: due, currency: 'USD' },
      autocomplete: true,
      ...(cust.email ? { buyer_email_address: String(cust.email) } : {}),
      note: `louwok.com online order ${orderNo}`.slice(0, 500),
    };

    const paid = await squareFetch('/v2/payments', token, payReq);
    if (!paid.ok) {
      // Order exists but payment failed — report clearly so the UI can retry
      // without double-charging (idempotency keys protect us).
      return res.status(paid.status).json({
        error: 'square_payment_failed',
        orderId,
        detail: paid.data && paid.data.errors ? paid.data.errors : paid.data,
      });
    }

    const payment = paid.data.payment || {};
    return res.status(200).json({
      ok: true,
      env: process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox',
      orderId,
      orderNumber: orderNo,
      paymentId: payment.id,
      status: payment.status,
      amount: (due / 100).toFixed(2),
      receiptUrl: payment.receipt_url || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'request_failed', detail: err && err.message });
  }
};
