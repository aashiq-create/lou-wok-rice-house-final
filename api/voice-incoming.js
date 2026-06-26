// /api/voice-incoming.js
// ────────────────────────────────────────────────────────────────────────────
// Twilio Voice webhook: screens calls to the Lou Wok business number and
// forwards them to your personal phone with a whisper announcement, so you
// always know it's a restaurant call before you pick up.
//
// HOW IT WORKS
//   1. A customer calls your Twilio business number.
//   2. Twilio POSTs the call here (set as the number's "A CALL COMES IN" webhook).
//   3. We return TwiML that:
//        - Greets the caller briefly.
//        - Dials your personal cell.
//        - Before you're connected, plays a "whisper" only YOU hear:
//          "Lou Wok call from <number>. Press any key to accept."
//        - If you don't answer / decline, it sends them to voicemail.
//   4. Voicemail recordings are emailed/texted to you via /api/voice-voicemail.
//
// ENV VARS (set in Vercel → Project → Settings → Environment Variables)
//   PERSONAL_PHONE        e.g. +16025551234   (your real cell, E.164)
//   TWILIO_CALLER_ID      your Twilio number,  e.g. +16025550000 (E.164)
//   RESTAURANT_NAME       optional, defaults to "Lou Wok Rice House"
//   SCREEN_REQUIRE_KEY    optional "1" to require pressing a key to accept
//
// SECURITY
//   Optionally validate the X-Twilio-Signature header (see validateTwilio()).
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');
const { loadConfig } = require('./_config');

const _FALLBACK_NAME = process.env.RESTAURANT_NAME || 'Lou Wok Rice House';

// Read a urlencoded or JSON body regardless of how Vercel parsed it.
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return {};
}

// Format a +1XXXXXXXXXX number into spoken digits for the whisper.
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const tw = new VoiceResponse();

  const cfg = await loadConfig();
  const RESTAURANT_NAME = cfg.restaurantName || _FALLBACK_NAME;
  const params  = readBody(req);
  const fromRaw  = params.From || '';
  const personal = cfg.personalPhone;
  const callerId = cfg.callerId;

  // Fail safe: if config is missing, take a message instead of dropping the call.
  if (!personal || !callerId) {
    tw.say(
      { voice: 'Polly.Joanna' },
      `Thank you for calling ${RESTAURANT_NAME}. We can't take your call right now. ` +
      `Please leave your name, number, and order after the tone.`
    );
    tw.record({
      action: '/api/voice-voicemail',
      method: 'POST',
      maxLength: 120,
      playBeep: true,
      transcribe: false,
    });
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(tw.toString());
  }

  // Brief greeting for the caller so they know the call connected.
  tw.say(
    { voice: 'Polly.Joanna' },
    `Thanks for calling ${RESTAURANT_NAME}. Connecting you now.`
  );

  // Dial your personal phone. The whisper plays to YOU only, via the
  // <Number>'s url attribute pointing at /api/voice-whisper.
  const requireKey = cfg.screenRequireKey;
  const proto0 = (req.headers['x-forwarded-proto'] || 'https');
  const host0  = (req.headers['x-forwarded-host'] || req.headers.host || 'louwok.com');
  const base0  = `${proto0}://${host0}`;
  const dial = tw.dial({
    callerId,                    // shows your Twilio number to your cell
    answerOnBridge: true,        // caller hears ringing, not dead air
    timeout: 20,                 // ring your cell ~20s before voicemail
    action: `${base0}/api/voice-dial-status`, // where to go if you don't answer
    method: 'POST',
  });

  // Whisper must use an ABSOLUTE URL (relative paths are silently skipped
  // by Twilio for the <Number url="..."> attribute). Reuse base0 from above.
  dial.number(
    {
      url: `${base0}/api/voice-whisper?from=${encodeURIComponent(fromRaw)}&require=${requireKey ? '1' : '0'}`,
      method: 'POST',
    },
    personal
  );

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(tw.toString());
};

// Exported for potential reuse/testing.
module.exports.spokenNumber = spokenNumber;
