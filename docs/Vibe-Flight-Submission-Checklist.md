# Vibe Flight — Submission Checklist

**Track:** LLM & AI Agent (theme: AI as a Service)
**Team:** yoyo.sheco · mosa3dalsayyar · nassir
**Hard deadline:** 23 November 2026
**Audited:** 19 November 2026 against `main` @ `61d7d13`

Legend: `[x]` done and verified · `[ ]` not done · `[!]` blocked or at risk

---

## Where you actually stand

| Section | Status | Blocker |
|---|---|---|
| 1. Specific AI Service | Drafted | Needs your own voice |
| 2. Motivation | **Not written** | — |
| 3. Chat History (≥10 msgs) | **Not done** | Bot link must exist first |
| 4. Chatbot live link | **Not done** | No public deploy |
| 5. Iterative Design Process | **Written** (`docs/Flight-Guide-Iteration-Log.md`) | Paste into PDF |
| 6. Limitations | **Not written** | — |
| 7. Future Development | **Not written** | — |
| 8. Conclusion | **Not written** | — |
| 9. References | Nearly ready | Citation style |
| Final PDF | **Not built** | Everything above |

**Verdict: you are 4 of 9 sections short, and the two links judges click are both missing.** The app is finished and tested (30/30). The written submission is not.

---

## 1. Specific AI Service

- [x] Service named and scoped: first international flight, alone, three Saudi airports, gate-to-gate
- [x] Explicit "what it does not do" boundary written
- [x] Narrower than "travel advisor" — argued in the text
- [ ] Rewrite the drafted paragraphs **in your own words** (the skeleton marks it `DRAFTED — copy from the project description, then edit into your own voice`)

> Judges score originality here. Text that reads like an AI wrote it loses that row.

---

## 2. Motivation

- [ ] Explain why you built this
- [ ] Name what inspired it — a real person, a real fear, your own first flight
- [ ] Say who it protects and what going wrong costs them

> The skeleton says `NEEDS WRITING — you have the raw material`. Use it. A first flight alone is a specific, believable fear; say it plainly.

---

## 3. Chat History — at least 10 exchanged messages

- [ ] **Get the chatbot live first** (see §4) — a transcript from a dead bot is worthless
- [ ] Run a conversation of **≥10 exchanged messages** against the **final** build
- [ ] Cover: first flight alone → terminal → time → bags → "what do I do first" → gate change → Arabic switch
- [ ] Save a **shareable link** (not just a screenshot)
- [ ] Verify the link opens in a private window while logged out

> Track rule: messages must be against the **final edition**. Counts from an older draft do not count.

---

## 4. Chatbot — live link

- [ ] Deploy the app somewhere public
- [ ] Confirm the URL loads with no login
- [ ] Test as a judge would: fresh browser, no context, English then Arabic
- [ ] Confirm `/admin` does not expose anything it shouldn't
- [ ] Put the URL in the PDF

**Current blocker:** `docker build` has never succeeded in this environment (buildah cannot create its build root). The `Dockerfile` and `docker-compose.yml` are written and `docker compose config` validates. **One build on a machine with a working Docker daemon** — then push to Render, Railway, Fly.io, or any VPS.

> This is the critical path. Everything else can be written while it deploys.

---

## 5. Iterative AI Design Process

- [x] **Iteration log written:** `docs/Flight-Guide-Iteration-Log.md` — Idea → Advisor Design → Testing → Error Analysis → Improvement
- [x] Full conversation record published (`docs/Flight-Guide-Conversation-Record.md`, 127 messages)
- [x] Test screenshots captured (`docs/testing/01`–`04`), embedded inline in the log
- [x] Three distinct user profiles (`design/user-profiles.md`)
- [x] Before/after shown for the two verified failures
- [ ] Paste the log into the PDF (it is written in the team's own measured voice — read it once and edit anything that does not sound like you)
- [ ] **Open item:** the third fix (hurried traveller, max three steps) is logged as *applied, not retested*. Either retest it and update the table, or submit with the honest "unverified" wording — do not claim it.

> The log is the scored artifact. It keeps the failed replies on purpose, and it is explicit about which fixes were verified and which were not — that distinction is what the rubric's error-analysis row is looking for.

---

## 6. Limitations & ethical considerations

- [ ] Practical: no live flight data (status is simulated)
- [ ] Practical: Dammam tested end-to-end; Riyadh and Jeddah unverified
- [ ] Ethical: a wrong instruction could make someone miss a flight
- [ ] Ethical: people who cannot read the language at all
- [ ] Ethical: what happens offline, or on a dead battery
- [ ] State clearly that staff always override the app

> Score band narrows hard here. "No limitations" reads as naive.

---

## 7. Future Development

- [ ] Each item must **answer a limitation from §6**
- [ ] Live departure feeds from `kfia.sa` / `kkia.sa` / `kaia.sa`
- [ ] Verify Riyadh and Jeddah to Dammam's depth
- [ ] Offline mode / installable app
- [ ] Any considered move to a real LLM — and why you did or did not

> Judges check that §7 addresses §6. A fog of unrelated ideas scores poorly.

---

## 8. Conclusion

- [ ] Summarize the service, the problem, the value
- [ ] State the impact: fewer stranded first-time travellers
- [ ] Keep it short and human

---

## 9. References

- [x] Sources collected: `kfia.sa`, `kkia.sa`, `kaia.sa`, `maps.kkia.sa`
- [ ] Format in **one** style — APA is easiest
- [ ] Every claim in the PDF traces to a source
- [ ] Access dates included (sites change)

---

## Packaging

- [ ] Assemble **one PDF**
- [ ] Name it exactly `LLM_VibeFlight.pdf` (or your final project name)
- [ ] Drive folder named `LLM_ProjectName` — the LLM track has **no** Middle/High subfolder
- [ ] Folder placed directly in the LLM parent folder
- [ ] Sharing set so the **WAICY judging team** can open it
- [ ] Open the final folder in a logged-out window and click every link

---

## The three things that will sink this

1. **No chatbot link.** It is a required, pass/fail deliverable and it cannot be faked. Deploy first.
2. **§§2, 6, 7, 8 unwritten.** That is roughly half the Design & Impact score (40 of 100 points).
3. **Voice.** If the PDF reads like it was generated, you lose Originality and Presentation. Write it as yourselves — the story of a first flight alone is one you can tell better than any model.

---

## Suggested order, today to 23 Nov

| Day | Work |
|---|---|
| 19 Nov | Deploy the app · confirm public URL |
| 20 Nov | Record the ≥10-message chat · save shareable link |
| 21 Nov | Write §2, §6, §7, §8 in your own words |
| 22 Nov | Assemble PDF · format references · pull iteration evidence |
| 23 Nov | Package, share, verify every link logged out — **submit** |
