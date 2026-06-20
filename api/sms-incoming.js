// /api/sms-incoming.js
// ────────────────────────────────────────────────────────────────────────────
// Twilio Messaging webhook: when a customer texts your business number back
// (a reply to an order, a question, etc.), forward it to your personal phone
// so you see it. Twilio auto-handles STOP/UNSUBSCRIBE opt-outs at the carrier
// level, but we also reply politely to HELP.
//
// Set as the number's "A MESSAGE COMES IN" webhook (HTTP POST).
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
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const tw = new MessagingResponse();

  const params = readBody(req);
  const from   = params.From || '';
  const text   = (params.Body || '').trim();
  const upper  = text.toUpperCase();

  // HELP keyword — reply with info (Twilio also handles this, but be explicit).
  if (upper === 'HELP') {
    tw.message(
      `${RESTAURANT_NAME}: For order help call us. Reply STOP to unsubscribe. Msg & data rates may apply.`
    );
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(tw.toString());
  }

  // Forward the customer's message to the owner's cell.
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const smsFrom    = process.env.TWILIO_CALLER_ID;
  const personal   = process.env.PERSONAL_PHONE;

  if (accountSid && authToken && smsFrom && personal && text && upper !== 'STOP') {
    try {
      const client = twilio(accountSid, authToken);
      await client.messages.create({
        from: smsFrom,
        to: personal,
        body: `💬 ${RESTAURANT_NAME} text from ${from}:\n${text}`,
      });
    } catch (err) {
      console.error('forward inbound SMS failed:', err && err.message);
    }
  }

  // No auto-reply to the customer (avoid loops); just acknowledge to Twilio.
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(tw.toString());
};
