# Flight Guide ✈️

A containerised prototype that walks a first-time international traveller — alone, possibly not reading the signs — through check-in, security, passport control and customs to the boarding gate at **Dammam (KFIA)**, **Riyadh (KKIA)** or **Jeddah (KAIA)**. Arabic and English.

This is the **testable prototype**: the reply engine is rule-based and deterministic, with no AI provider key required. `src/engine.js` is the single swap point for a future LLM.

## Try it fastest (no Docker needed)

If you just want to open the app and click through it, you only need Node.js:

```bash
cd flight-guide-app     # the folder with this README inside it
npm start
```

Open **http://localhost:8080**. Leave the terminal window open; press `Ctrl+C` to stop.
Settings are saved to a `.data/` folder beside the code.

This needs no Docker, no build step and no internet. The app has zero
dependencies, so there is nothing to `npm install` first.

## Deploy (Docker)

```bash
cp .env.example .env            # optional — defaults work as-is
docker compose up --build -d
open http://localhost:8080      # chat · /map · /admin · /healthz
```

Without compose:

```bash
docker build -t flight-guide .
docker run -d -p 8080:8080 -v flight-guide-data:/data --name flight-guide flight-guide
open http://localhost:8080
```

Stop with `docker compose down` (keeps settings) or `docker compose down -v` (resets them).

## What you get

| Route | What it is |
|---|---|
| `/` | The chat. Asks four onboarding questions (airport, terminal, time to boarding, bags) before giving any directions, then walks the six stages one at a time. |
| `/map` | The interactive airport map — 404 real locations, 35 Riyadh boarding gates, Arabic and English names, floor levels, category filters, sources panel. |
| `/admin` | Control panel: edit guidance text per stage per language, enable/disable profiles, set the escalation threshold, show/hide the map, read the conversation log. |
| `/healthz` | `200` + JSON. Used by the Docker `HEALTHCHECK`. |

**Profiles** change the wording, not the facts: nervous first-timer (reassuring, one step), adult first international flight (efficient, full detail), experienced/hurried (next action only, plus the one after).

**Escalation**: when the traveller has ≤ 60 minutes to boarding (adjustable in `/admin`), the reply leads with *find airport staff immediately*. Safe first, navigated second.

**Honesty**: Dammam is verified end to end. Riyadh is partially verified from the airport's own indoor map. Jeddah is procedure only — the app says so, every time, on every profile. It never invents a gate, a floor or live flight status.

## Layout

```
├── Dockerfile              multi-stage, node:22-alpine, runs as uid 1000
├── docker-compose.yml      one service, port 8080, named volume for /data
├── .env.example            every variable, documented, no secrets
├── config/defaults.js      shipped stage text, profiles, airports
├── src/
│   ├── server.js           HTTP layer, zero dependencies
│   ├── engine.js           ★ rule-based reply engine — the AI swap point
│   └── store.js            persisted settings + bounded conversation log
├── public/                 chat UI, /admin, shared CSS
├── map/                    existing map asset, served at /map
└── test/run.js             engine tests — node test/run.js
```

## Settings persistence

`/admin` writes to `settings.json` inside the volume. Only values the operator changed are stored, so a new image can still improve defaults nobody touched. Writes are atomic; a corrupt file is moved aside on boot instead of crashing the container.

## Tests

```bash
node test/run.js     # or: npm test
```

Covers onboarding-before-advice, the six-stage order, per-profile wording, Arabic output, the escalation threshold, airport honesty, admin-edited text, disabled stages and determinism.

## Scope boundary

Not handled, by design: rebooking, refunds, baggage claims, pricing, visa or immigration advice, tourism recommendations. Flight status is **simulated** — the map is not live indoor GPS, and the traveller is always told to confirm the gate on the departure screens.
