# Vibe Flight ✈️ — First Gate, Alone

WAICY 2026 · **LLM & AI Agent** track · Theme: *AI as a Service*
Project: `LLM_Middle_Air_Transportation`

An AI agent that walks a traveller taking their **first international flight with nobody to guide them** through check-in, security, passport control and customs to the boarding gate — at Dammam (KFIA), Riyadh (KKIA) or Jeddah (KAIA), in Arabic or English.

What connects the users is not age: it is **having nobody to ask**.

---

## What is in this repository

| Path | What it is |
|---|---|
| `app/` | **The running build** — the containerised Vibe Flight web app. Chat, interactive airport map, profile selector, Arabic/English toggle, admin control panel. Start here. |
| `design/` | The agent's written design: system prompt, the three airport skills, the three user profiles. This is the scored artifact. |
| `docs/testing/` | Screenshots from the five real user tests, including the documented Arabic/English language bug and its two fixes. |

### Running the app

```bash
cd app
npm start          # zero dependencies, no install step
```

Open <http://localhost:8080>. Routes: `/` chat · `/map` airport map · `/admin` control panel · `/healthz`.

Docker:

```bash
cd app
docker compose up --build -d
```

Full deploy notes, settings persistence and tests are in [`app/README.md`](app/README.md).

```bash
cd app && node test/run.js      # 30 passed, 0 failed
```

---

## The problem

A first international flight alone is a chain of procedures nobody has explained — check-in, security, passport control, customs, the gate, and a gate change. It is harder still when the signs are in a language you do not read.

A missed flight for a first-time traveller is not an inconvenience. It is frightening, expensive, and sometimes unsafe.

## The agent

It **asks before advising**. Four onboarding questions — which airport, which terminal, how long until boarding, have bags to drop — before it gives a single direction. Then it walks the six stages one at a time:

1. Check-in and baggage drop
2. Security screening
3. Passport control
4. Customs
5. The gate
6. **What to do if the gate changes** — the moment that breaks a first-timer

**Three communication profiles** change the wording, not the facts:

- **Nervous first-timer** — reassuring, one step at a time
- **Adult, first international flight** — efficient, full detail
- **Experienced / hurried** — fast, next action only, plus the one after

**Where is my gate?** The answer comes with a map. At Riyadh the gate is pinned on the airport's own indoor map data; at Dammam and Jeddah the map shows the airport and the gate number (live from the Dammam departure board) with a link to the airport's own map — the app never draws a gate where it has not verified one.

**Voice:** tap the microphone and speak, in Arabic or English. Cohere Transcribe turns it into text (set `COHERE_API_KEY`), and the reply is read back aloud by the phone's own voice.

**Weather and alerts:** ask "will there be a sandstorm?" or "will my flight be delayed?" and the agent checks the forecast at both ends of the flight (Open-Meteo) — a heads-up, never a promise. Once it knows a Dammam flight, it watches the airport's live board and tells the traveller the moment the gate, time or status changes.

**Show this to staff:** one tap opens a full-screen card in Arabic and English — "first flight, travelling alone, please help me get to my gate" with the flight, gate and boarding time — to hand to anyone in uniform.

**Escalation:** under 60 minutes to boarding (adjustable in `/admin`), the reply leads with *find airport staff immediately*. Safe first, navigated second.

## Honesty about what is verified

This is a deliberate design decision, not a shortcoming to hide:

- **Dammam** — verified end to end.
- **Riyadh** — partially verified from the airport's own indoor map (35 real boarding gates, floors, customs and security levels).
- **Jeddah** — procedure only. The app says so, every time, on every profile.
- Flight status is **simulated**, not live. The agent never invents a gate, a floor, or a live departure time.

One tested airport is worth more than three untested claims.

## Scope boundary

Not handled, by design: rebooking, refunds, baggage claims, ticket prices, visa or immigration advice, tourism recommendations. It is not a general travel advisor.

Where an airline's unaccompanied-minor service applies, Vibe Flight works **alongside** it and defers to airline and airport staff. It does not replace or contradict those services.

---

## Documented iteration

The `design/` prompt is the result of five real tests, not a first draft. The strongest evidence is in `docs/testing/`: the same question producing a different, better answer after a specific change. The full write-up — Idea → Advisor Design → Testing → Error Analysis → Improvement, with every failure kept — is [`docs/Flight-Guide-Iteration-Log.md`](docs/Flight-Guide-Iteration-Log.md).

| Failure observed | Change made | Verified |
|---|---|---|
| Replied in English to an Arabic message | Language made a mandatory rule, not a capability | ✅ retest in Arabic |
| Ignored a stated inability to read English | If they say they cannot read English, reply in Arabic even if they wrote in English | ✅ retest in Arabic |
| Three steps at once to a hurried traveller | For a hurrying passenger: the next step plus the one after — never more than three | ⏳ fix applied, not yet retested |

The failed replies are kept in the archive on purpose. The failure is the evidence.

## AI usage

The prototype's reply engine (`app/src/engine.js`) is **rule-based and deterministic** — it requires no AI provider key and runs anywhere. `engine.js` is the single swap point: an LLM call can replace it without touching the UI. The design in `design/` is the prompt that an LLM-backed version would run on.

## Sources

- King Fahd International Airport (Dammam) — <https://kfia.sa/ar/Flights>, <https://kfia.sa/ar/Guide/Passenger/airport-map>
- King Khalid International Airport (Riyadh) — <https://kkia.sa>, <https://maps.kkia.sa/maps/map.html>
- King Abdulaziz International Airport (Jeddah) — <https://kaia.sa>

## Team and deadline

WAICY 2026 · final submission **23 November 2026**.
