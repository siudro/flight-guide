# Flight Guide — deployment handoff

**Audience:** the Okal developer deploying this agent to an Okal subdomain.
**State:** runs locally, all 39 tests pass, live AI and live airport data verified on 2026-11-22.

---

## 1. What this is

A Node 22 app with **zero runtime dependencies** (only the standard library).
It serves a chat UI, calls OpenAI, and reads King Fahd International's live
departures feed.

```
app/
  src/server.js    HTTP layer + routes
  src/engine.js    rule engine: owns conversation state (never the model)
  src/llm.js       OpenAI adapter: replies + ticket vision
  src/status.js    live departures from kfia.sa
  src/prompts.js   system prompt assembly
  src/store.js     settings + durable chat sessions
  public/          the chat UI (no build step, no framework)
  test/run.js      39 assertions, run on every boot
```

**Architecture rule that must not be broken:** the rule engine decides *what*
to say; the model only decides *how* to say it. A model failure always falls
back to the deterministic reply. The traveller never gets a dead end.

### Gate map and voice (added 2026-11)

- **Gate map.** When the traveller asks where their gate is ("where is my gate",
  "وين بوابتي", "gate 404 where is it") or reports a gate change with the new
  number, `/api/chat` returns a `map` object and the chat draws it under the
  reply (Leaflet + OpenStreetMap, loaded on first use). `src/gatemap.js`
  decides. **Riyadh** gates are pinned exactly from `map/mapdata.json`.
  **Dammam / Jeddah** have no gate coordinates, so the card shows the airport,
  the gate number and the airport's own map link — never a guessed pin. For
  Dammam the gate comes from the live kfia.sa feed when the flight is known.
  The admin "map visible" switch hides these cards too.
- **Voice.** The mic button records 16 kHz mono WAV in the browser (Cohere
  accepts wav/flac/mp3/ogg, not the webm/mp4 MediaRecorder produces), posts it
  to `/api/voice`, and the server calls Cohere's
  `POST /v2/audio/transcriptions` with the UI language (`en`/`ar`). The text
  is then sent as an ordinary chat message. The microphone needs HTTPS.
- **Read aloud.** Replies are spoken with the browser's own voice (Web Speech
  API) when "Read aloud" is on, and always after a voice message. No key.
- **Weather heads-up.** A weather or delay question ("will there be a
  sandstorm?", "هل في غبار؟", "will my flight be delayed?") fetches the
  Open-Meteo forecast (free, no key for non-commercial use) for the departure
  airport around departure time and the destination over the next hours, and
  shows a weather card. Thunderstorms, fog, sand/dust storms, strong gusts,
  heavy rain and snow are flagged. It never says a flight WILL be delayed —
  every answer sends the traveller back to the departure board. Destination
  comes from the live board, the ticket, or a city named in the message
  (`src/weather.js` has the airport list).
- **Flight-change alerts.** Once a Dammam flight number is known, the chat
  polls `GET /api/watch/:sessionId` every 2 minutes while the page is open.
  The server compares the live board with the last snapshot and the chat
  announces gate changes, status changes (boarding, final call, cancelled)
  and delays of 10+ minutes: red message, vibration, read aloud if on, a map
  for a new gate, and a phone notification if the traveller allowed it
  (`public/sw.js` exists only for that; it caches nothing).
- **Show this to staff.** "Ask staff" in the top bar (and a button under every
  urgent message) opens a full-screen card in Arabic and English: first
  flight, travelling alone, please help me reach my gate, plus flight, gate,
  boarding time, terminal and airport. Fixed text, never written by the model. After a cancellation it asks for the airline desk instead; at
  final call it asks for help to hurry.
- **Reload-safe.** On load the chat asks `/api/history/:sessionId` for the
  stored conversation and redraws it (alerts stay red), refills the trip
  card and resumes the flight watch. Phones reload background tabs often.
- **Red means danger.** Only the "boarding is close, find staff" warning
  and flight alerts are red; the server marks it per message (`urgent`).
- **Other airports.** "I am at Abha / in Madinah / at Dubai airport" is
  recognised (`OTHER_AIRPORTS` in `src/engine.js`). The traveller is told
  once that the app only knows Dammam, Riyadh and Jeddah, and gets general
  steps — never Dammam's map, links, live board or flight watch. Naming a
  destination ("flying to Dubai") does not count.

---

## 2. Deploy in five steps

```bash
git clone https://github.com/siudro/flight-guide.git
cd flight-guide/app

# 1. the key — never commit this
cp .env.example .env
#    edit .env, set OPENAI_API_KEY=sk-proj-...

# 2. run
docker compose up --build -d

# 3. verify the live AI actually connected
docker compose logs -f | grep -E "Live check|Tests|Model"
#    expect:  Tests ......... 39 passed, 0 failed
#             Live check ... OK  Connected to openai (gpt-6-luna).

# 4. verify the live airport feed
curl -s localhost:8080/api/flights/dmm/XY837 | jq '.flight.gate, .flight.status'

# 5. health for the platform probe
curl -s localhost:8080/healthz
```

Then point the Okal subdomain at port **8080** and terminate TLS upstream.

---

## 3. Environment variables

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required.** Server-side only; never reaches the browser. |
| `OPENAI_MODEL` | `gpt-6-luna` | Reads text and images. |
| `LLM_ENABLED` | `1` | `0` forces the rule-engine-only mode. |
| `LLM_TIMEOUT_MS` | `15000` | Per-request timeout before fallback. |
| `FG_DATA_DIR` | `./.data` | Persistence root. Docker sets `/data` (a volume). |
| `FG_STATUS_TTL_MS` | `90000` | Live departures cache window. |
| `FG_STATUS_TIMEOUT_MS` | `12000` | Live feed timeout. |
| `FG_MAX_CONVERSATIONS` | `200` | Rotating operator log. |
| `COHERE_API_KEY` | — | Optional. Turns on voice messages (Cohere Transcribe). Without it the mic button is hidden. Server-side only. |
| `COHERE_TRANSCRIBE_MODEL` | `cohere-transcribe-03-2026` | Cohere speech-to-text model. |
| `VOICE_TIMEOUT_MS` | `20000` | Per-recording timeout before the traveller is asked to retry or type. |
| `FG_WEATHER_TTL_MS` | `900000` | Forecast cache per airport (15 min). |
| `FG_WEATHER_TIMEOUT_MS` | `8000` | Open-Meteo timeout; on failure the reply says the weather could not be checked. |
| `FG_WATCH_DELAY_STEP` | `10` | Minimum delay change (minutes) worth an alert. |

---

## 4. Model gotchas (these cost hours if you do not know them)

`gpt-6-luna` is **not** a drop-in replacement for `gpt-4o-mini`:

1. **`max_tokens` is rejected.** Use `max_completion_tokens`. Sending
   `max_tokens` returns HTTP 400 on every call.
2. **Only `temperature: 1`** is accepted. `0` returns 400. The adapter omits
   the parameter entirely for these models.
3. **Reasoning tokens are spent before output.** A budget under ~1500 returns
   an empty string even though the call "succeeds".

All three are handled in `src/llm.js` by detecting the model name
(`usesCompletionTokens()`). A different model family needs a check there.

---

## 5. Data sources, and how honest they are

| Airport | Live departures | Status |
|---|---|---|
| **Dammam (DMM)** | `kfia.sa/api/aodb/flights?arr_dep=D` | **Live, verified.** Gate, delay, terminal, check-in counters. |
| Riyadh (RUH) | — | Returns `NOT_SUPPORTED`. Never a fabricated gate. |
| Jeddah (JED) | — | Returns `NOT_SUPPORTED`. Never a fabricated gate. |

The feed is public and unauthenticated. It is cached 90 s, and a stale copy is
served (labelled `stale:true`) rather than nothing if their server is down.

**Do not add a third airport by guessing an endpoint.** Verify a real JSON feed
first, then add it to `FEEDS` in `src/status.js`.

---

## 6. Routes

| Route | Purpose |
|---|---|
| `GET /` | chat UI |
| `GET /healthz` | liveness probe |
| `GET /api/flights/:airport` | shaped departures (max 60) |
| `GET /api/flights/:airport/:flight` | one flight: gate, status, delay, counters |
| `GET /api/history/:sessionId` | stored transcript for a session |
| `POST /api/chat` | one turn |
| `POST /api/ticket` | ticket photo → extracted fields (vision) |
| `POST /api/voice` | voice recording (16 kHz WAV, base64) → text, via Cohere Transcribe |
| `GET /api/watch/:sessionId` | flight-change check for the traveller's Dammam flight (polled by the chat) |
| `GET /admin` | operator panel (settings, key test, logs) |

---

## 7. What to watch in the logs

Every turn prints exactly one line saying which path ran:

```
[llm] LLM   turn 3  stage=checkin  prompt=v2  gpt-6-luna  842ms  1203 tok
[llm] RULES turn 4  stage=security  (BAD_KEY: ...) — rule-engine reply kept
[status] lookup dmm XY837 -> gate=G25 status=DELAYED delay=410m
[status] grounded turn 3 flight=XY837 gate=G25 delay=410m
```

- `[llm] RULES` on every turn means the key is missing or rejected — check
  `/admin`, not the code.
- `[status] not-supported` is expected for RUH/JED.
- `[status] feed-error` means kfia.sa is unreachable; the app still answers,
  just without live gate data.

---

## 8. Security posture

- The API key lives in `.env` (git-ignored) or the host environment. It is
  never logged in full — only `sk-pro…MNMA` — and never sent to the browser.
- The container runs as uid 1000 (`node`), never root, with `no-new-privileges`.
- `/data` is the only writable path.
- Ticket photos are held **in memory only** and never written to disk. Only the
  extracted fields persist, which the traveller already sees.
- Chat sessions persist under `/data/sessions/`, one small JSON file each.

---

## 9. Known limits — state these, do not paper over them

- **Riyadh and Jeddah are not connected.** The UI says so.
- **No authentication.** Anyone with the URL can chat. Fine for a demo, not for
  public launch — add a rate limit and a session cookie first.
- **No WebSocket push.** Gate changes appear on the traveller's next message,
  not as an alert. A real deploy should poll and push.
- **Arabic UI text is only partly done** for the new walking-mode strings.
- The 39 tests cover the rule engine, not the network paths.

---

## 10. Rollback

```bash
docker compose down          # keeps the data volume
docker compose up --build -d # previous image
```

The data volume survives, so conversations and settings remain.
