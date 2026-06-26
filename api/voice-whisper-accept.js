// /api/voice-whisper-accept.js
// ────────────────────────────────────────────────────────────────────────────
// Reached when the OWNER presses a key during the whisper (require-key mode).
// Returning an empty <Response> simply ends the whisper document, which lets
// Twilio bridge the caller and owner together.
// ────────────────────────────────────────────────────────────────────────────

const twilio = require('twilio');

module.exports = async (req, res) => {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const tw = new VoiceResponse();
  // Empty response = whisper finished = call bridges. Nothing else needed.
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(tw.toString());
};
