# Kotletka

Food-review PWA for Krasnoyarsk, for a closed group of ~20–50 people. Users rate dishes 0–10 at places on a map.
README.md is for users only (no setup/deploy/dev info there).
Developer docs (setup, hosting, deploy, moderation, data model): docs-private/DEVELOPER.md (gitignored, local only).

## Stack
- Frontend: vanilla JS, no build step, no npm. Served as is from the repo root by GitHub Pages (ResicHub/kotletka).
  Leaflet in `vendor/`. Texts EN/RU in `js/i18n.js`.
- Backend: Google Apps Script (`backend/Code.gs`) attached to a Google Sheet (the database). Photos in Google Drive.
  The app POSTs JSON `{action, token, ...}` to the web app URL.
- Auth: Google Sign-In; the backend verifies the ID token (`aud` must equal `GOOGLE_CLIENT_ID`).

## Rules
- `GOOGLE_CLIENT_ID` and `API_URL` are public by nature (the browser needs them) and are committed in `js/config.js`;
  `GOOGLE_CLIENT_ID` is also hardcoded in `backend/Code.gs` and the two must match.
  Real secrets (if any appear later) must not be committed.
- The backend is deployed by hand: the user pastes `backend/*` into the Apps Script editor and makes a new deployment version.
  Agents cannot deploy it, so say when a change needs a backend redeploy.
- After changing any app file, bump `VERSION` in `sw.js` so installed apps update.
- Keep these lists in sync between frontend and backend: place types (`types` in i18n.js ↔ `PLACE_TYPES` in Code.gs),
  dish categories (`CAT_TREE`/`cats`/`groups` in i18n.js ↔ `CATEGORIES` in Code.gs), Sheet columns (`SCHEMA` in Code.gs ↔ data model in docs-private/DEVELOPER.md).
- Run locally: `python3 -m http.server 8000` from the repo root (uses the real backend, shared data).

