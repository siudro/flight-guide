# Vibe Flight — WAICY 2026 Submission
## LLM & AI Agent Track

**Team:** yoyo.sheco · mosa3dalsayyar · nassir
**Date:** November 2026

---

## 1. What Specific Service Our AI Provides

**Status: DRAFTED — copy from the project description, then edit into your own voice.**

Vibe Flight is an AI agent that helps a traveller taking their first international flight with nobody to guide them. It walks them through check-in, security, passport control and customs, and on to their boarding gate — at Dammam (KFIA), Riyadh (KKIA) or Jeddah (KAIA) — in Arabic or English.

The problem it addresses: a first international flight alone is a chain of procedures nobody has explained. The signs are in a language the traveller may not read, and there is nobody to ask.

The value: the traveller reaches the gate calm and on time, without a staff member having to rescue them.

**Scope — what it does not do:** no rebooking, refunds, baggage claims, ticket prices, visa or immigration advice, or tourism recommendations.

**Not too broad:** not "a travel advisor" — it covers one situation (first international flight, alone) and one stretch of the journey (airport entrance to boarding gate).

*Write 1–2 sentences in your own words for each italic paragraph.*

---

## 2. Motivation

**Status: NEEDS WRITING — you have the raw material.**

Your own line: *"so the trip doesn't miss you because we care."*

Answer these three questions:
- What made the team think of this? (a real experience? someone you know?)
- Why does it matter that it is a *first* flight specifically?
- What is the cost of getting it wrong? (fear, money, safety)

> *Write 1 paragraph, 120–180 words.*

---

## 3. Chat History

**Status: NEEDS DOING — 20 minutes.**

Have a conversation with the agent of **at least 10 exchanged messages**. Screenshot it, or paste the transcript here.

Suggested flow:
1. "I'm at Dammam airport, first flight alone" → agent asks questions
2. Answer the questions
3. Ask "what do I do first?"
4. Ask "how long will security take?"
5. Ask "what if the gate changes?"
6. Ask "I don't read English well" (tests the language rule)

**Paste the transcript or a link here.**

---

## 4. Chatbot Prototype

**Status: BLOCKED — one attempt at Gemini Gems, then use the fallback statement.**

*If you get a link:* paste it here.

*If not,* use this:
> The prototype is demonstrated through the chat transcript in Section 3. Hosted-agent creation was unavailable on the team's account during the submission window, so the working prototype is shown through recorded conversations against the final instruction set reproduced in Section 5.

---

## 5. Iterative AI Design Process

**Status: WRITTEN — copy [`docs/Vibe-Flight-Iteration-Log.md`](../docs/Vibe-Flight-Iteration-Log.md) in, then edit into your own voice.**

Structure: **Idea → Advisor Design → Testing → Error Analysis → Improvement.** The log is already in that order and already carries the four screenshots inline.

| Test | Result |
|---|---|
| Arabic message | Replied in English ✗ → fixed, retested ✓ |
| "I don't read English well" | Replied in English ✗ → fixed, retested ✓ |
| Hurried, 70 min | Right tone and facts, three steps at once ⚠ |

**Include all four screenshots, including the failures.** `docs/Vibe-Flight-Iteration-Log.md` embeds them in place.

> Before pasting: the third fix is logged as *applied but not retested*. Keep that wording — it is more credible than claiming a verification that did not happen. If you retest it before 23 Nov, update the table and add the screenshot.

---

## 6. Limitations

**Status: NEEDS WRITING — facts already known.**

Cover:
- **Flight status is simulated.** The airports' live departure pages block automated access (HTTP 403), so the agent cannot observe real delays or gate changes.
- **Jeddah is unverified.** Only the general procedure is described; no gate numbers or floor locations.
- **Arabic/English only.**
- **No indoor GPS.** The map shows locations, not the traveller's live position.
- **Never gives visa or immigration advice** — directs to staff.

> *Write 1 paragraph per limitation, 2–3 sentences each.*

---

## 7. Future Development

**Status: NEEDS WRITING — one paragraph.**

- Connect a live flight-status feed so delays and gate changes reach the traveller in real time.
- Send an email or WhatsApp alert when a delay is confirmed.
- Verify Jeddah's terminals and gates.
- Add voice input for travellers who cannot type comfortably.
- Extend to Arabic dialects.

> *Write 1 paragraph, 100–150 words.*

---

## 8. Conclusion

**Status: NEEDS WRITING — short.**

Summarise: the service, the problem, what was built and tested, and what it means.

> *Write 1 paragraph, 100 words.*

---

## 9. References

**Status: NEARLY READY — format as APA.**

- King Fahd International Airport. (n.d.). *Flights — departures*. https://kfia.sa/ar/Flights
- King Fahd International Airport. (n.d.). *Passenger guide — airport map*. https://kfia.sa/ar/Guide/Passenger/airport-map
- King Khalid International Airport. (n.d.). *Interactive airport map*. https://maps.kkia.sa/maps/map.html
- King Khalid International Airport. (n.d.). *Departures and arrivals*. https://www.kkia.sa/en/flights/departures-and-arrivals
- King Abdulaziz International Airport. (n.d.). *Flights*. https://www.kaia.sa/ar-SA/Flights

*Add any sources you used for security or customs procedure.*

---

## Checklist before submitting

- [ ] All nine sections present
- [ ] Chat history has ≥ 10 exchanged messages
- [ ] Screenshots included (including the failed tests)
- [ ] References in APA
- [ ] Exported as one PDF
- [ ] File named `LLM_ProjectName.pdf`
