// /api/_config.js
// ────────────────────────────────────────────────────────────────────────────
// Shared settings loader. Reads the non-secret notification settings the admin
// dashboard publishes into cms-data.json (under settings.notify), and falls back
// to environment variables when a value isn't set there.
//
// SECRETS ARE NEVER READ FROM cms-data.json. Account SID, auth token, and the
// Twilio caller ID always come from Vercel env vars only.
//
// cms-data.json shape (only the part we use):
//   { "settings": { "notify": {
//       "personalPhone":   "+1602...",
//       "adminSms":        ["+1602...", ...],
//       "pickupEtaMin":    "10-12",
//       "restaurantName":  "Lou Wok Rice House",
//       "screenRequireKey": false
//   } } }
// ────────────────────────────────────────────────────────────────────────────

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'aashiq-create';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'lou-wok-rice-house-final';
const CMS_URL =
  `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/cms-data.json`;

// Cache across warm invocations so we don't fetch GitHub on every call.
let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60 * 1000; // 60s

async function fetchNotify() {
  const now = Date.now();
  if (_cache && now - _cacheAt < TTL_MS) return _cache;
  try {
    const r = await fetch(CMS_URL + '?_=' + now);
    if (r.ok) {
      const data = await r.json();
      _cache = (data && data.settings && data.settings.notify) || {};
      _cacheAt = now;
    }
  } catch (_) {
    // Network/JSON failure → fall through to whatever we had (or {}).
  }
  return _cache || {};
}

// Resolve the full effective config: cms-data.json values win for the
// operational settings; env vars are the fallback. Secrets are env-only.
async function loadConfig() {
  const n = await fetchNotify();

  const personalPhone =
    (n.personalPhone && String(n.personalPhone).trim()) ||
    process.env.PERSONAL_PHONE || '';

  const adminSms =
    Array.isArray(n.adminSms) && n.adminSms.length
      ? n.adminSms
      : (process.env.ADMIN_SMS
          ? process.env.ADMIN_SMS.split(',').map(s => s.trim()).filter(Boolean)
          : []);

  const pickupEtaMin =
    (n.pickupEtaMin && String(n.pickupEtaMin).trim()) ||
    process.env.PICKUP_ETA_MIN || '10-12';

  const restaurantName =
    (n.restaurantName && String(n.restaurantName).trim()) ||
    process.env.RESTAURANT_NAME || 'Lou Wok Rice House';

  const screenRequireKey =
    typeof n.screenRequireKey === 'boolean'
      ? n.screenRequireKey
      : process.env.SCREEN_REQUIRE_KEY === '1';

  return {
    // operational (admin-editable)
    personalPhone,
    adminSms,
    pickupEtaMin,
    restaurantName,
    screenRequireKey,
    // secrets (env only)
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken:  process.env.TWILIO_AUTH_TOKEN  || '',
    callerId:   process.env.TWILIO_CALLER_ID   || '',
  };
}

module.exports = { loadConfig };
