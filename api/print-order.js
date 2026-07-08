// /api/print-order.js
// v1.0 — 2026-07-06 — auto-print online orders to kitchen receipt printer(s)
// ────────────────────────────────────────────────────────────────────────────
// Sends an order to one or more receipt printers via PrintNode (cloud print).
// Called by /api/notify.js on every new order, and also directly by the admin
// "Send test receipt" button.
//
// ALL behavior is driven by the "printing" object in cms-data.json, which the
// admin dashboard edits:
//   printing: {
//     enabled: true,
//     printers: [ { id: 74829, name: "Kitchen Star", copies: 1, enabled: true } ],
//     header: "LOU WOK RICE HOUSE",
//     subheader: "ONLINE ORDER",
//     footer: "Fire it up! 🔥",
//     showTotal: true,
//     showCustomer: true,
//     showItemsBig: true,     // print items in double-height for line-cook legibility
//     cutPaper: true,
//     beep: true              // pulse the buzzer on new order
//   }
//
// The PrintNode API key is read from the PRINTNODE_API_KEY env var (never stored
// in cms-data.json, which is public).
// ────────────────────────────────────────────────────────────────────────────

const { loadConfig } = require('./_config');

// ── ESC/POS control codes ────────────────────────────────────────────────
const ESC = '\x1B', GS = '\x1D';
const INIT        = ESC + '@';              // initialize printer
const BOLD_ON     = ESC + 'E' + '\x01';
const BOLD_OFF    = ESC + 'E' + '\x00';
const CENTER      = ESC + 'a' + '\x01';
const LEFT        = ESC + 'a' + '\x00';
const BIG_ON      = GS  + '!' + '\x11';     // double width + height
const BIG_OFF     = GS  + '!' + '\x00';
const TALL_ON     = GS  + '!' + '\x01';     // double height only
const FEED        = '\n';
const CUT         = GS  + 'V' + '\x42' + '\x00'; // partial cut w/ feed
const BEEP        = ESC + 'B' + '\x03' + '\x02'; // buzzer: 3 pulses

function line(char = '-', n = 42) { return char.repeat(n) + '\n'; }

// Build the raw ESC/POS byte string for one order, then base64-encode it.
function buildReceipt(order, pr) {
  const {
    orderNo = 'LW', items = '', total = '', customerName = '', phone = '',
    pickupEta = '', placedAt = new Date(),
  } = order;

  let r = INIT;

  if (pr.beep) r += BEEP;

  // Header
  r += CENTER + BOLD_ON + BIG_ON;
  r += (pr.header || 'LOU WOK RICE HOUSE') + FEED;
  r += BIG_OFF + BOLD_OFF;
  if (pr.subheader) r += (pr.subheader) + FEED;
  r += LEFT + line();

  // Order number — big and bold so cooks can read it across the truck
  r += BOLD_ON + TALL_ON;
  r += 'ORDER  ' + orderNo + FEED;
  r += BIG_OFF + BOLD_OFF;

  // Timestamp
  const t = new Date(placedAt);
  const ts = t.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
  r += ts + FEED;
  if (pr.showCustomer && customerName) r += 'Customer: ' + customerName + FEED;
  if (pr.showCustomer && phone)        r += 'Phone: ' + phone + FEED;
  r += line();

  // Items — optionally double-height for legibility on the line
  if (pr.showItemsBig) r += TALL_ON;
  r += (items ? String(items) : '(no item detail)') + FEED;
  if (pr.showItemsBig) r += BIG_OFF;
  r += line();

  // Total
  if (pr.showTotal && total) {
    r += BOLD_ON + 'TOTAL: ' + total + FEED + BOLD_OFF;
  }
  if (pickupEta) r += 'Pickup ETA: ~' + pickupEta + ' min' + FEED;

  // Footer
  if (pr.footer) { r += FEED + CENTER + pr.footer + FEED + LEFT; }
  r += FEED + FEED;
  if (pr.cutPaper !== false) r += CUT;

  return Buffer.from(r, 'binary').toString('base64');
}

// Send one print job to PrintNode.
async function sendToPrintNode(apiKey, printerId, base64Content, title, copies) {
  const auth = Buffer.from(apiKey + ':').toString('base64');
  const resp = await fetch('https://api.printnode.com/printjobs', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      printerId: Number(printerId),
      title: title || 'Lou Wok Order',
      contentType: 'raw_base64',
      content: base64Content,
      source: 'louwok.com',
      options: copies && copies > 1 ? { copies: Number(copies) } : undefined,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    return { ok: false, printerId, status: resp.status, error: text.slice(0, 200) };
  }
  return { ok: true, printerId, jobId: text.replace(/"/g, '') };
}

// Main entry: print an order to all enabled printers. Returns a result summary.
// Never throws — printing must never break order submission.
async function printOrder(order, cfgOverride) {
  const apiKey = process.env.PRINTNODE_API_KEY;
  if (!apiKey) return { ok: false, reason: 'PRINTNODE_API_KEY not set' };

  let cfg = cfgOverride;
  try { if (!cfg) cfg = await loadConfig(); } catch { cfg = {}; }
  const pr = (cfg && cfg.printing) || {};

  if (!pr.enabled) return { ok: false, reason: 'printing disabled in admin' };
  const printers = (pr.printers || []).filter(p => p && p.enabled && p.id);
  if (!printers.length) return { ok: false, reason: 'no enabled printers configured' };

  const base64 = buildReceipt(order, pr);
  const results = [];
  for (const p of printers) {
    try {
      results.push(await sendToPrintNode(apiKey, p.id, base64, `Order ${order.orderNo}`, p.copies));
    } catch (err) {
      results.push({ ok: false, printerId: p.id, error: (err && err.message) || 'send failed' });
    }
  }
  return { ok: results.some(r => r.ok), results };
}

// List printers registered on the PrintNode account (for the admin picker).
async function listPrinters() {
  const apiKey = process.env.PRINTNODE_API_KEY;
  if (!apiKey) return { ok: false, reason: 'PRINTNODE_API_KEY not set' };
  const auth = Buffer.from(apiKey + ':').toString('base64');
  try {
    const resp = await fetch('https://api.printnode.com/printers', {
      headers: { 'Authorization': 'Basic ' + auth },
    });
    if (!resp.ok) return { ok: false, reason: `PrintNode HTTP ${resp.status}` };
    const arr = await resp.json();
    return {
      ok: true,
      printers: arr.map(p => ({
        id: p.id,
        name: p.name,
        computer: p.computer && p.computer.name,
        state: p.state,
      })),
    };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'listing failed' };
  }
}

// HTTP handler — used by the admin dashboard.
//   POST { action: "list" }            -> list PrintNode printers
//   POST { action: "test", printerId } -> print a sample receipt
// (Order printing is called in-process by notify.js via printOrder().)
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = body && body.action;

  if (action === 'list') {
    return res.status(200).json(await listPrinters());
  }

  if (action === 'test') {
    const cfg = await loadConfig().catch(() => ({}));
    const pr = (cfg && cfg.printing) || {};
    const apiKey = process.env.PRINTNODE_API_KEY;
    if (!apiKey) return res.status(200).json({ ok: false, reason: 'PRINTNODE_API_KEY not set in Vercel' });
    const printerId = body.printerId || (pr.printers && pr.printers[0] && pr.printers[0].id);
    if (!printerId) return res.status(200).json({ ok: false, reason: 'No printer selected' });
    const sample = {
      orderNo: 'LW-TEST-0001',
      items: '1x Chicken Fried Rice (Large)\n1x Crab Rangoon (6)\n1x Vess Soda',
      total: '$21.50',
      customerName: 'Test Ticket',
      phone: '(602) 555-0100',
      pickupEta: pr.pickupEta || '10-15',
      placedAt: new Date(),
    };
    const base64 = buildReceipt(sample, pr);
    const r = await sendToPrintNode(apiKey, printerId, base64, 'Lou Wok TEST receipt', 1);
    return res.status(200).json(r.ok ? { ok: true, jobId: r.jobId } : { ok: false, reason: r.error || `HTTP ${r.status}` });
  }

  return res.status(200).json({ ok: false, reason: `Unknown action "${action}"` });
};

// Export helpers so notify.js can print in-process.
module.exports.printOrder = printOrder;
module.exports.buildReceipt = buildReceipt;
module.exports.listPrinters = listPrinters;
