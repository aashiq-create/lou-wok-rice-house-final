# Lou Wok — Twilio Voice + SMS Backend

This adds a `/api` folder of Vercel serverless functions to your existing project
(`aashiq-create/lou-wok-rice-house-final`). It does two things:

1. **Call screening** — calls to your Twilio business number ring your personal
   cell with a whisper ("Lou Wok call from …"), and roll to voicemail (texted to
   you) if you don't pick up.
2. **Order + pickup SMS** — your site already POSTs orders to `/api/notify`. That
   endpoint now texts the customer their order number, texts/emails you the
   ticket, and an admin "Order Ready" button can text the customer when food's up.

There was no separate "twilio GitHub" repo to pull from — these files are the
backend, written to match what your `index-5.html` front end already calls.

---

## 1. Drop the files into your repo

Copy the contents of this package into the **root** of your project repo:

```
lou-wok-rice-house-final/
├── api/
│   ├── notify.js               ← order + catering notifications (front end calls this)
│   ├── order-ready.js          ← admin-triggered "order is ready" text
│   ├── voice-incoming.js       ← Twilio "A CALL COMES IN" webhook
│   ├── voice-whisper.js        ← whisper played to you before connecting
│   ├── voice-whisper-accept.js ← completes the bridge if you press a key
│   ├── voice-dial-status.js    ← sends caller to voicemail if you miss it
│   ├── voice-voicemail.js      ← texts you the voicemail + recording link
│   └── sms-incoming.js         ← forwards customer texts to your cell
├── package.json                ← declares the `twilio` dependency
└── vercel.json                 ← pins the Node 20 runtime for /api
```

If you already have a `package.json`, just add `"twilio": "^5.3.0"` to its
`dependencies` instead of overwriting the file.

Commit and push. Vercel will redeploy automatically.

---

## 2. Set environment variables in Vercel

Vercel → your project → **Settings → Environment Variables**. Add these for
**Production** (and Preview if you test there):

| Variable | Required | Example / Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | ✅ | Starts with `AC…` — Twilio Console dashboard |
| `TWILIO_AUTH_TOKEN` | ✅ | Twilio Console dashboard (keep secret) |
| `TWILIO_CALLER_ID` | ✅ | Your Twilio business number, E.164: `+1602…`. Also used as the SMS "from". |
| `PERSONAL_PHONE` | ✅ | Your real cell, E.164: `+1602…` |
| `RESTAURANT_NAME` | optional | Defaults to "Lou Wok Rice House" |
| `PICKUP_ETA_MIN` | optional | Defaults to "10-12" |
| `SCREEN_REQUIRE_KEY` | optional | Set to `1` to force pressing a key before a call connects (max screening) |
| `RESEND_API_KEY` | optional | Enables admin email. From resend.com. Leave unset to skip email. |
| `RESEND_FROM` | optional | e.g. `Lou Wok <orders@louwok.com>` (domain must be verified in Resend) |
| `ADMIN_API_KEY` | optional | If set, `/api/order-ready` requires header `x-admin-key: <value>` |

After adding vars, **redeploy** (Vercel → Deployments → ⋯ → Redeploy) so the
functions pick them up.

---

## 3. Point your Twilio number at the webhooks

Twilio Console → **Phone Numbers → Manage → Active numbers →** click your number.

**Voice Configuration**
- *A call comes in*: **Webhook**, `https://louwok.com/api/voice-incoming`, **HTTP POST**

**Messaging Configuration**
- *A message comes in*: **Webhook**, `https://louwok.com/api/sms-incoming`, **HTTP POST**

(Use your actual deployed domain if different from `louwok.com`.) Save.

That's the whole call-screening flow — no other Twilio config needed. Test by
calling your business number; your cell should ring with the whisper.

---

## 4. Add your admin cell number(s) to the site

So you (and Malika) get the order ticket by text, edit **`index-5.html`** around
line 2831:

```js
const ADMIN_RECIPIENTS = {
  email: ['aashiq@louwok.com', 'malika@louwok.com'],
  sms  : ['+16025551234', '+16025555678']   // ← add your real cells, E.164
};
```

Customers always get their order-number text regardless of this — this array is
only for *your* internal ticket alerts. Commit + push.

---

## 5. (Optional) Wire the "Order Ready" button in admin

`/api/order-ready` is ready to text a customer that their food is up. POST:

```js
fetch('/api/order-ready', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // include only if you set ADMIN_API_KEY:
    'x-admin-key': 'YOUR_ADMIN_API_KEY'
  },
  body: JSON.stringify({
    order_number: 'LW-260620-1234',
    phone: '+16025551234',
    name: 'Jordan'
  })
});
```

Your `admin-2.html` doesn't currently show a live order feed, so there's no
button hooked up yet. When you add an orders list, drop a "Mark Ready" button on
each row that fires the call above. Until then you can trigger it manually.

---

## 6. Business SMS compliance (do this before heavy texting)

US carriers require **A2P 10DLC registration** for business texting from a normal
10-digit number. Without it, your texts may be filtered/blocked at volume.

Twilio Console → **Messaging → Regulatory Compliance → A2P 10DLC**:
register a Brand (your business) and a Campaign (transactional / order
notifications). Approval is usually quick for low-volume transactional use.
Every outbound text already includes "Reply STOP to opt out," which keeps you
compliant on opt-outs.

---

## Quick reference — the call flow

```
Customer dials Twilio # ──▶ /api/voice-incoming
                              │  greets caller, dials your cell
                              ▼
                          your cell rings ──▶ /api/voice-whisper
                              │                 "Lou Wok call from 6 0 2…"
            ┌─────────────────┴─────────────────┐
       you answer                          you miss it (20s)
            │                                   │
   /api/voice-whisper-accept          /api/voice-dial-status
       call connects                  record voicemail ──▶ /api/voice-voicemail
                                                            texts you the message
```
