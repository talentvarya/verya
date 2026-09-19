# Veyra Vehicle Intelligence MVP

This is the local full-stack MVP built from the supplied product specification.

## Run

Requires Node.js 18+.

```bash
cd outputs
node server.js
```

Open `http://127.0.0.1:4173`.

## Use a mobile phone as a test device

Open `http://<your-computer-LAN-IP>:4173/device.html` on the phone. Enter the phone number, verify the OTP, optionally select a vehicle, and tap **Start location sharing**. The page uses the phone browser's GPS and posts normalized position events to Veyra. If Supabase Phone Auth and an SMS provider are configured, the OTP is sent by Supabase; otherwise local demo mode displays a test code. If the browser blocks GPS because the page is not HTTPS, use **Send test location** or run the app behind an HTTPS tunnel/deployment.

## Live map

The Overview dashboard now uses Leaflet with OpenStreetMap tiles. Vehicle and phone-only markers are refreshed every five seconds from the Veyra API. Green markers are moving, blue markers are stopped, and clicking a marker shows the latest speed. For production traffic, replace the public OpenStreetMap tile endpoint with a provider covered by its usage policy.

## Included API

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/session`
- `PATCH /api/session` (local demo role switcher)
- `POST /api/vehicles`
- `PATCH /api/alerts/:id/ack`
- `POST /api/group/invite`
- `PATCH /api/settings`
- `GET /api/audit`
- `GET/POST /api/geofences`
- `POST /api/simulator/tick`
- `POST /api/ingest/position` (normalized vendor-neutral webhook contract)

Data persists locally in `data/store.json`. The tracker layer is represented by seed/simulated data so a real GPS vendor can be connected later without changing the UI contracts.

## Supabase persistence

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the server environment.
3. Start the server. `/api/health` will report `persistence: "supabase"` and the app snapshot will be stored in `public.app_state`.

The secret key is read only by `server.js`; it must never be placed in `index.html`, `app.js`, or any browser-exposed environment. The relational tables in the schema are ready for the next migration from the snapshot table.

## Verification and deployment

Run the API test suite with `npm test`. A minimal Docker image is included in `Dockerfile`; set `PORT` and `DATA_FILE` for the deployment environment. Production use still requires a real identity provider, managed database, tracker credentials, TLS, and a secure secret store.

## Render deployment

`render.yaml` is included for a single Node web service. Push this folder to a GitHub, GitLab, or Bitbucket repository, create a Render Blueprint from that repository, and fill `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_PUBLISHABLE_KEY` as secret environment variables. Render will provide an HTTPS URL for both `/` and `/device.html`; phones can use mobile data or any Wi-Fi without sharing the laptop's network.

The device page is also installable as a PWA on HTTPS browsers. The PWA shell improves access from the phone home screen, but reliable screen-off/background location still requires a native Android implementation and explicit background-location permission.
