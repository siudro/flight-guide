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
