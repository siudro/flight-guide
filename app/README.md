# Flight Guide ✈️

A prototype that walks a first-time international traveller — alone, possibly not reading the signs — through check-in, security, passport control and customs to the boarding gate at **Dammam (KFIA)**, **Riyadh (KKIA)** or **Jeddah (KAIA)**. Arabic and English.

Two reply engines ship in the same app:

- **Rule engine** (`src/engine.js`) — deterministic, always available, no key. It owns conversation state, the four-facts gate, the safety escalation and every airport fact.
- **LLM** (`src/llm.js`) — when a key is present, the model writes the words. It cannot change what the rule engine decided, so it cannot advance a stage, invent a gate, or skip the "find staff" warning.

With no key the app works exactly as before. That is a design rule, not a fallback accident.

---

## ⚡ Add your OpenAI key (one file, one line)

The key goes in **`app/.env`** and nowhere else. It is git-ignored, so it cannot
be committed or pushed, and `docker build` never copies it into an image.

```bash
cd app
cp .env.example .env          # 1. create the file
open .env                     # 2. paste your key after OPENAI_API_KEY=
npm start                     # 3. start normally
```

That is the whole setup. In `.env`, the only line you must change is:

```ini
OPENAI_API_KEY=sk-proj-...your-key...
```

On boot you will see, at the top of the log:

```
  [env] loaded .env  (4 variables applied)

  Running tests…
  Tests ......... 39 passed, 0 failed

──────────────────────────────────────────────────────────
  REPLY ENGINE
──────────────────────────────────────────────────────────
  Mode ......... LLM WRITES REPLIES  (OpenAI)
  Model ........ gpt-4o-mini
  Key .......... sk-pro…MNMA   from env
  Vision ....... yes — ticket photos are read by the model
  Prompts ...... v2 (versions in src/prompts.js)
  Live check ... OK  Connected to openai (gpt-4o-mini).  848ms
──────────────────────────────────────────────────────────
```

### How the key stays safe

| Risk | Protection |
|---|---|
| Pushed to GitHub | `.env` is in `.gitignore` (repo root and `app/`) |
| Baked into a Docker image | `.dockerignore` excludes `.env`; the Dockerfile copies only code |
| Leaked to the browser | `/api/settings` reports `hasKey: true/false`, never the value |
| Printed in logs | Only the first 6 and last 4 characters are shown |
| Committed by accident | Run `git status` — `.env` must never appear |

Do **not** put the key in the admin panel for deployment. The panel exists for
an operator without shell access; `.env` is the deployment path.

---

## Is it the AI or the rules?

You never have to guess. Every turn prints one line:

```
[llm] LLM   turn 1  stage=checkin  prompt=v2  gpt-4o-mini  2221ms  700 tok
[llm] RULES turn 2  stage=security  (BAD_KEY: OpenAI returned 401) — rule-engine reply kept
[llm] TICKET openai/gpt-4o-mini  1850ms  read: flight, airline, terminal, gate, seat, boarding
```

- `LLM` — the model wrote this reply.
- `RULES` — the rule engine answered, and the bracket says why.
- `TICKET` — a photo was read, and the fields it extracted.

---

## Tests run on every start

`npm start`, `node src/server.js` and `docker run` all run the suite before the
server listens, and print the result. Run it alone with:

```bash
npm test
```

39 tests cover the rule engine and the LLM layer — including prompt assembly,
key resolution, key masking, the invented-gate guard and ticket JSON parsing.
All of them run **offline**: a laptop with no key and no internet still passes.

Set `FG_SKIP_BOOT_TESTS=1` to skip the suite at boot (the config report still runs).

---

## Ticket photos (vision)

Tap 📷 beside the message box. On a phone this opens the rear camera; on a
desktop it opens the file picker.

The browser downscales the photo, sends it to **our** server, and the server
calls OpenAI with the key. The browser never sees the key. The model returns
only the fields it can actually read, and the traveller confirms them before
anything is used — an unreadable gate stays empty rather than being guessed.

---

## Prompt versions

Every revision of what the model is told lives in **`src/prompts.js`**, in
order, with the reason it changed. Nothing is edited in place: you add a
version and bump `ACTIVE_VERSION`.

The live list and the most recent assembled prompts are at:

```
http://localhost:8080/api/prompts
```

---

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
