# Find the Truck — deploy notes

## What changed in index.html
The old "Hours & Location" section (Google-Maps embed + weekly hours) is replaced
by a **Find the Truck** tracker:
- A dark-themed interactive map (Leaflet + OpenStreetMap, no API key, no billing).
- A live "Serving Now / Not Serving Yet / Off Today" status pill based on today's hours.
- A "Right now" panel showing today's spot, address, and a Get Directions button.
- A tappable weekly schedule — tapping any day flies the map to that stop.
- "Today's stop" recenter button.

The section still lives at `id="hours"` so your existing nav links keep working.

## To deploy
Replace `index.html` in your repo root with this file, commit, and let Vercel redeploy.
Leaflet loads from a CDN (unpkg + CARTO tiles) — nothing to install.

## Preview before deploy
Open `truck-tracker-preview.html` in any browser to see the live interactive version
with demo data (map, day-switching, popups all work there).

## Driving it from the admin / cms-data.json
The tracker reads `data.schedule` from cms-data.json. Until you add that, it shows the
built-in DEFAULT_SCHEDULE (Phoenix-area demo stops). Add a `schedule` array shaped like:

```json
"schedule": [
  { "day":"Monday", "spot":"Downtown Phoenix", "addr":"Cityscape, 1 E Washington St",
    "open":"11:00", "close":"14:00", "lat":33.4480, "lng":-112.0731, "closed":false },
  { "day":"Sunday", "spot":"Closed", "addr":"", "open":"", "close":"",
    "lat":33.4484, "lng":-112.0740, "closed":true }
]
```

- `open`/`close` are 24-hour "HH:MM".
- `lat`/`lng` are the pin location (get them by right-clicking a spot in Google Maps).
- `closed:true` greys the day out and hides the pin/directions for it.

## Next step (optional)
Add a "Truck Schedule" panel in admin.html so you can edit these stops without touching
JSON — same pattern as the Calls & Texts panel. Say the word and I'll build it.
