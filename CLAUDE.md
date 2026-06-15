# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A static website for **Lou Wok Rice House**, a Phoenix restaurant. No build step, no
framework, no package.json. It's three hand-written files served as-is by Vercel.
Everything (HTML, CSS, JS) lives inline in each `.html` file — there are no separate
`.css` or `.js` files.

## Files

- **`index.html`** (~3,760 lines) — the public site. Contains all markup, an inline
  `<style>` block, and several inline `<script>` blocks (cart, menu filtering, PWA
  install, EmailJS catering form, and the CMS loader at the bottom).
- **`admin.html`** (~2,340 lines) — a self-contained CMS dashboard. Lets the owner edit
  menu, hours, links, SEO, etc., then **publishes by writing `cms-data.json` to GitHub**
  using a personal access token stored in the browser's `localStorage`.
- **`cms-data.json`** — the content layer. Written by `admin.html`, read by `index.html`
  at runtime. Top-level keys: `menu`, `hours`, `categories`, `announcements`,
  `orderLinks`, `seo`, `location`, `branding`, `socials`, `ticker`, `footer`,
  `settings`, `users`.
- **`vercel.json`** — caching/headers. Note `cms-data.json` is set to `no-cache` so
  edits show up immediately; `.html` files are `must-revalidate`.
- **`icons/`**, **`favicon.ico`** — app/tab icons.

## How content flows (important)

```
admin.html  --writes-->  cms-data.json (on GitHub)  --fetched at runtime-->  index.html
```

`index.html` is **never overwritten** by the CMS. The owner's edits only ever change
`cms-data.json`. On page load, `index.html`'s CMS loader fetches that JSON and
re-renders the menu, hours, order links, SEO tags, and announcements. If the fetch
fails, the page falls back to whatever is hardcoded in the markup.

The loader lives at the very bottom of `index.html` (search for `LIVE CMS LOADER`).
The functions that actually apply data are `renderMenu`, `renderHours`,
`renderOrderLinks`, `renderSEO`, `renderAnnouncements`, all called from
`applyContent(d, source)`.

⚠️ **Only some CMS fields are wired into the live site.** `cms-data.json` contains
`branding`, `location`, `socials`, `ticker`, `footer`, `settings` etc., but the loader
in `index.html` currently only applies `menu`, `hours`, `orderLinks`, `seo`, and
`announcements`. If you edit those other fields in admin and they don't show up on the
site, that's why — the render function for them doesn't exist yet.

⚠️ **Repo name mismatch.** The CMS loader in `index.html` hardcodes
`GH_REPO='Lou-Wok-Rice-House'` as a remote fallback source, but this repo is
`lou-wok-rice-house-final`. The primary same-folder fetch (`./cms-data.json`) works
regardless, but the GitHub raw fallback URL points at a different repo. Keep this in
mind if the loader can't find data.

## Editing conventions

- **There is no build.** Edit the `.html` file directly and reload in a browser.
- CSS is one big inline `<style>` in `index.html`. Design tokens are CSS variables in
  `:root` (e.g. `--wok: #c8390a`, `--gold: #e8a020`, `--rice: #f5eed8`). Reuse these
  rather than hardcoding colors.
- Platform detection runs before paint and sets classes on `<html>`
  (`plat-ios`, `plat-android`, `plat-tablet`, `plat-desktop`, `is-standalone`,
  `is-touch`/`is-mouse`). Platform-specific CSS keys off these classes.
- Sections in the page body are plain `<section id="...">` blocks: `hero`, `menu`,
  `featured`, `about`, `tracker`, `catering`, `order`.
- In-page navigation uses a single `smoothTo()` handler — don't add inline
  `onclick="smoothTo(...)"` back into the markup; links are wired in JS.

## When the menu is the task

The menu grid is **rendered from `cms-data.json` at runtime**, not from the static
cards in the markup. To change menu items, edit the `menu` array in `cms-data.json`
(or use `admin.html`). Each item has fields like name, price, category, tags, and
optional option-groups. The static cards in `index.html` are only a fallback.

## Things that need real keys (currently placeholders)

- **EmailJS** (catering form) — keys near `Replace with your real EmailJS keys`.
- **Formspree** fallback — `YOUR_FORM_ID` in the catering submit handler.
- **GitHub token** for publishing — entered by the user in `admin.html`, stored in
  `localStorage` (`louwok_gh_token`). Never hardcode this.

## Deployment

Pushed to GitHub, deployed by Vercel. `cleanUrls: true` means `/admin` serves
`admin.html`. No CI, no tests, no install — a commit to `main` is a deploy.
