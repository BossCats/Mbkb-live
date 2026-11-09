# MBKB Live

Phone web app for live men's college basketball projections from the MBKB model.

- **Scores:** ESPN's public scoreboard, refreshed every 30 seconds while games are live. To use a relay instead,
  set `localStorage["mbkb.src"]` to its URL (it must return the same JSON).
- **Model:** `core.js` is copied unchanged from `MBKB/pipeline/web/core.js`; `params.json` is the nightly model from
  `MBKB/pipeline/work/out/params.json`.
- **Pregame numbers:** your own line or spread for a game if you entered one, otherwise the market line (DraftKings via ESPN;
  remembered from before tip-off, or looked up once from the game summary), otherwise the model's pregame projection.
- **Install on iPhone:** open the site in Safari, tap Share, then Add to Home Screen.

Projections are estimates, not guarantees.
