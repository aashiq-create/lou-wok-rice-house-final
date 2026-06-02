# Lou Wok Rice House — Site + Admin

Your existing `index.html` is **unchanged** and served as-is. It already contains a CMS
loader that fetches `/cms-data.json` and applies menu, hours, announcements, order links,
and SEO — without ever modifying the page structure. This project simply gives that loader
a reliable, database-backed source for `/cms-data.json`, plus a Gmail-gated dashboard to edit it.

## Why this fixes the old errors
The previous admin tried to COMMIT cms-data.json to GitHub — that's what threw
"publish failed: not found". Here, publishing just writes to a database and the content is
served live at `/cms-data.json`. No GitHub commit, no redeploy, no 404.

## Architecture
- **`public/index.html`** — your real front end, untouched. Served at `/` via a rewrite.
- **`/cms-data.json`** (`app/cms-data.json/route.ts`) — serves DB content in the EXACT shape
  index.html expects. The front end needs zero changes.
- **`/admin`** (`app/admin/page.tsx`) — Gmail sign-in → tabbed editor (Menu / Hours /
  Announcements / Order Links / SEO / Analytics) → "Publish updates" saves to the DB instantly.
- **`/api/content`** — GET (public) + POST (protected save).
- **`/api/auth/[...nextauth]`** — email + password login (no Google needed).
- **`/api/users`** — protected: list / add / remove admin users (passwords hashed with bcrypt).
- **`/api/analytics`** — Vercel Web Analytics for the dashboard (near-real-time).
- **`lib/content.ts`** — content shape (matches index.html) + DB layer, seeded with your menu.

## Content shape (must match index.html — already does)
```
menu:          [{ name, desc, category, tag, priceHalf, priceFull }]
hours:         [{ open:"HH:MM", close:"HH:MM", location, area, street }]   // Mon→Sun
announcements: [{ type:"active"|"inactive", text }]
orderLinks:    { <key>: { enabled, url, label } }   // key = data-order-key in your HTML
seo:           { title, description, keywords }
```

## Setup checklist (do these in Claude Code)
1. `npm install` then `cp .env.example .env.local` and fill values.
2. **Login (email + password)** — set in env vars:
   - `NEXTAUTH_SECRET` = `openssl rand -base64 32`
   - `NEXTAUTH_URL` = your URL (https://louwok.com in prod)
   - `BOOTSTRAP_ADMIN_EMAIL` = aashiq@louwok.com
   - `BOOTSTRAP_ADMIN_PASSWORD` = a strong password (used ONCE on first run to
     create your account). After first deploy you can delete these two env vars and
     manage everyone from the dashboard's **Users** tab.
3. (No Google setup needed — auth is fully self-contained.)
4. **Vercel Postgres**: Storage → Create → Postgres → connect to project →
   `vercel env pull .env.local`. Table auto-creates on first save.
5. **Vercel Analytics** (optional): enable Web Analytics; set VERCEL_API_TOKEN,
   VERCEL_PROJECT_ID, VERCEL_TEAM_ID.
6. **⚠ Domain**: confirm which Vercel project owns louwok.com (its team currently shows
   zero projects to the connected account). Deploy THIS repo as that project, or move the
   domain onto it. Otherwise the live site won't pick up the new /cms-data.json.
7. `vercel --prod`, and set all env vars in Vercel → Settings → Environment Variables.

## Verify after deploy
- `louwok.com` looks identical to now.
- `louwok.com/admin` → email + password login; correct credentials get in, others rejected.
- Edit a price → Publish → reload louwok.com → the menu reflects it. No deploy ran.
- `louwok.com/cms-data.json` returns your live JSON.

## Order-link keys
Your dashboard's Order Links tab uses keys that must match the `data-order-key`
attributes in index.html. Add the keys your buttons use (e.g. doordash, ubereats, grubhub).
