// /api/voice-voicemail.js
// ────────────────────────────────────────────────────────────────────────────
// Receives the voicemail recording (and transcription, if ready) and texts
// YOU a heads-up with the caller's number, a transcript snippet, and a link
// to the recording. Twilio may call this twice: once with the recording,
// once with the transcription — we handle both.
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
  const params = readBody(req);

  const from          = params.From || params.Caller || 'unknown';
  const recordingUrl  = params.RecordingUrl ? params.RecordingUrl + '.mp3' : '';
  const transcript    = params.TranscriptionText || '';

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_CALLER_ID;
  const toNumber   = process.env.PERSONAL_PHONE;

  // Always 200 the webhook so Twilio doesn't retry endlessly.
  const done = () => res.status(200).send('<Response/>');

  if (!accountSid || !authToken || !fromNumber || !toNumber) {
    console.warn('voicemail: missing Twilio env vars; skipping SMS alert');
    return done();
  }

  // Only text once we actually have something to say.
  if (!recordingUrl && !transcript) return done();

  let body = `📞 ${RESTAURANT_NAME} voicemail from ${from}`;
  if (transcript) body += `\n"${transcript.slice(0, 300)}"`;
  if (recordingUrl) body += `\nListen: ${recordingUrl}`;

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({ from: fromNumber, to: toNumber, body });
  } catch (err) {
    console.error('voicemail SMS failed:', err && err.message);
  }

  return done();
};
