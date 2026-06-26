// /api/voice-whisper.js
// ────────────────────────────────────────────────────────────────────────────
// The "whisper" the OWNER hears before the caller is bridged in. This is what
// turns a forwarded call into a *screened* call: you hear who's calling and
// (optionally) press a key to accept, so a restaurant call never looks like a
// random personal call.
//
// Reached via the <Number url="..."> attribute in /api/voice-incoming.js.
// Query params:
//   from     = caller's number (E.164)
//   require  = "1" to require pressing a key to accept the call
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');

const RESTAURANT_NAME = process.env.RESTAURANT_NAME || 'Lou Wok Rice House';

function spokenNumber(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  const last10 = d.length >= 10 ? d.slice(-10) : d;
  if (last10.length !== 10) return 'an unknown number';
  const area = last10.slice(0, 3).split('').join(' ');
  const pre  = last10.slice(3, 6).split('').join(' ');
  const line = last10.slice(6).split('').join(' ');
  return `${area}, ${pre}, ${line}`;
}

module.exports = async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const tw = new VoiceResponse();

  const from       = (req.query && req.query.from) || '';
  const requireKey = ((req.query && req.query.require) || '0') === '1';
  const spoken     = spokenNumber(from);

  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host  = (req.headers['x-forwarded-host'] || req.headers.host || 'louwok.com');
  const base  = `${proto}://${host}`;

  if (requireKey) {
    // You must press any key to accept; otherwise the caller goes to voicemail.
    const gather = tw.gather({
      numDigits: 1,
      timeout: 6,
      // If you press a key, just hang up this <Gather> doc — the bridge
      // completes and you're connected. If you don't, we <Reject> below.
      action: `${base}/api/voice-whisper-accept`,
      method: 'POST',
    });
    gather.say(
      { voice: 'Polly.Joanna' },
      `${RESTAURANT_NAME} call from ${spoken}. Press any key to accept, or hang up to send to voicemail.`
    );
    // No key pressed → don't connect; let the parent <Dial> fall through.
    tw.hangup();
  } else {
    // Simple announcement, then auto-connect.
    tw.say(
      { voice: 'Polly.Joanna' },
      `${RESTAURANT_NAME} call from ${spoken}. Connecting now.`
    );
  }

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(tw.toString());
};
