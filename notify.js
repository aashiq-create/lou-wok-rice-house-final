// /api/notify-test.js
// ────────────────────────────────────────────────────────────────────────────
// Diagnostic endpoint for the order-confirmation SMS pipeline.
//
// Usage (in a browser or curl):
//   /api/notify-test                      → reports config status only (no SMS)
//   /api/notify-test?to=+16025551234      → also sends a real test SMS to that #
//                                            and returns Twilio's exact result.
//
// This surfaces the ACTUAL reason a customer text fails — missing env vars,
// trial-account restrictions, unverified numbers, A2P 10DLC blocking, a bad
// caller ID, etc. — instead of failing silently like a normal order does.
//
// Safe to leave deployed: it never exposes secret values, only whether each is
// present, and it only texts the number you explicitly pass in.
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');
const { loadConfig } = require('./_config');

function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  if (String(raw || '').startsWith('+')) return String(raw);
  return '';
}

module.exports = async (req, res) => {
  const cfg = await loadConfig();

  const status = {
    env: {
      TWILIO_ACCOUNT_SID: cfg.accountSid ? 'set (' + cfg.accountSid.slice(0, 6) + '…)' : 'MISSING',
      TWILIO_AUTH_TOKEN:  cfg.authToken ? 'set' : 'MISSING',
      TWILIO_CALLER_ID:   cfg.callerId || 'MISSING',
      RESEND_API_KEY:     process.env.RESEND_API_KEY ? 'set' : 'not set (email disabled)',
    },
    settings: {
      restaurantName: cfg.restaurantName,
      pickupEtaMin:   cfg.pickupEtaMin,
      adminSms:       cfg.adminSms,
    },
    twilioReady: !!(cfg.accountSid && cfg.authToken && cfg.callerId),
  };

  // If not asked to send, just report config.
  const to = (req.query && req.query.to) || '';
  if (!to) {
    return res.status(200).json({
      ok: status.twilioReady,
      note: status.twilioReady
        ? 'Twilio is configured. Add ?to=+1YOURNUMBER to send a live test SMS.'
        : 'Twilio is NOT fully configured — see env. Fix the MISSING vars in Vercel.',
      ...status,
    });
  }

  if (!status.twilioReady) {
    return res.status(500).json({ ok: false, error: 'Twilio not configured', ...status });
  }

  const dest = toE164(to);
  if (!dest) {
    return res.status(400).json({ ok: false, error: 'Bad ?to number; use E.164 like +16025551234', ...status });
  }

  // Send a real test message and return Twilio's exact response/error.
  try {
    const client = twilio(cfg.accountSid, cfg.authToken);
    const msg = await client.messages.create({
      from: cfg.callerId,
      to: dest,
      body: `${cfg.restaurantName}: test message ✅ If you got this, order confirmations will work.`,
    });
    return res.status(200).json({
      ok: true,
      sent: { sid: msg.sid, to: dest, status: msg.status },
      hint: 'Message accepted by Twilio. If it never arrives on the phone, check the Twilio console > Monitor > Logs > Messaging for delivery status (often A2P 10DLC or carrier filtering).',
      ...status,
    });
  } catch (err) {
    // Twilio errors carry a numeric code that pinpoints the cause.
    return res.status(500).json({
      ok: false,
      error: 'Twilio send failed',
      twilioCode: err && err.code,
      twilioMessage: err && err.message,
      commonCauses: {
        '21608': 'Trial account: the destination number is unverified. Verify it in Twilio, or upgrade the account.',
        '21211': 'Invalid "to" number.',
        '21212': 'Invalid "from"/caller ID — TWILIO_CALLER_ID is not a valid SMS-capable Twilio number.',
        '21606': 'The "from" number cannot send SMS (not SMS-capable or not owned).',
        '30034': 'A2P 10DLC: the number/campaign is not registered for US messaging — carriers block it.',
      },
      ...status,
    });
  }
};
