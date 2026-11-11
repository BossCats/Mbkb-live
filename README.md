# MBKB Live

Phone web app for live men's college basketball projections from the MBKB model.

- **Scores:** ESPN's public scoreboard, refreshed every 30 seconds while games are live. To use a relay instead,
  set `localStorage["mbkb.src"]` to its URL (it must return the same JSON).
- **Model:** `core.js` is copied unchanged from `MBKB/pipeline/web/core.js`; `params.json` is the nightly model from
  `MBKB/pipeline/work/out/params.json`.
- **Pregame numbers:** your own line or spread for a game if you entered one, otherwise the market line (DraftKings via ESPN;
  remembered from before tip-off, or looked up once from the game summary), otherwise the model's pregame projection.
- **Refresh:** re-checks the model file as well as the scores, and says so when a newer model arrives. Requests carry a
  cache-buster so a CDN copy cannot be served back. It does not update the app's own code; that needs a page reload.
- **Model pregame line:** live and finished games also show the model's own pregame total and spread, so you can see how
  far the live projection has moved. Omitted when a team has no rating (a non-Division I opponent).
- **Freshness:** the footer shows when the model was built, the last date of games in it, and when the app received the
  file (the server's Last-Modified). Older than two days, it turns red and says the model may be out of date.
- **Install on iPhone:** open the site in Safari, tap Share, then Add to Home Screen.

Projections are estimates, not guarantees.
