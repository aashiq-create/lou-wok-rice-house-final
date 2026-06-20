// /api/voice-dial-status.js
// ────────────────────────────────────────────────────────────────────────────
// Runs after the <Dial> in /api/voice-incoming.js finishes. If you answered
// and hung up normally, we just end the call. If the call was NOT answered
// (no-answer, busy, failed, or you declined the whisper), we send the caller
// to voicemail.
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');

const RESTAURANT_NAME = process.env.RESTAURANT_NAME || 'Lou Wok Rice House';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return {};
}

module.exports = async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const tw = new VoiceResponse();

  const params = readBody(req);
  const status = params.DialCallStatus || '';

  if (status === 'completed') {
    // You took the call and it's over. Nothing more to do.
    tw.hangup();
  } else {
    // no-answer | busy | failed | canceled → voicemail.
    tw.say(
      { voice: 'Polly.Joanna' },
      `Sorry, we can't take your call right now. Please leave your name, number, ` +
      `and order after the tone, and we'll call you right back.`
    );
    tw.record({
      action: '/api/voice-voicemail',
      method: 'POST',
      maxLength: 120,
      playBeep: true,
      transcribe: true,                       // Twilio transcription (best-effort)
      transcribeCallback: '/api/voice-voicemail',
    });
    tw.say({ voice: 'Polly.Joanna' }, 'We did not receive a recording. Goodbye.');
    tw.hangup();
  }

  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(tw.toString());
};
