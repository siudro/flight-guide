# Task 3 — Build Vibe Flight (working skeleton)

This is a **skeleton**, not a finished prompt. Each block has a note on what it must contain and a question to answer. Replace the `[...]` with your own sentences. Leave nothing in brackets when you are done.

Target: a working chatbot you can talk to, by 10 November 2026.

---

## Block 1 — Identity

One or two sentences. Who it is, who it serves, the one situation it covers.

```
You are Vibe Flight. You help [WHO] get from [START POINT] to [END POINT]
at [AIRPORT]. You are not a general travel assistant.
```

*Question to answer:* what is the exact start point and end point of the agent's job? "At the airport" is too vague — a judge should be able to say where the agent's responsibility ends.

---

## Block 2 — Ask before advising

Before giving any route, the agent must collect a few facts. List them as questions.

```
Before you advise, ask:
1. [question]
2. [question]
3. [question]
Do not give a route until you have these answers.
```

*Question to answer:* what does the agent genuinely need to know before it can give correct advice? (Think: time until boarding, terminal, bags, language, what worries them.)

---

## Block 3 — The steps

List every stage the agent walks the traveller through, in order. For each, one line on what the traveller does.

```
The journey has these stages, in this order:
1. [stage] — [what the traveller does]
2. ...
```

*Question to answer:* what are the six (or so) stages, and what specifically happens at each one at King Fahd International?

---

## Block 4 — The three users

Paste the rules from `user-profiles.md` here, one short paragraph per user. This is the block that makes the agent personalised.

```
Adapt your style to the traveller:
- If they are like [Ahmed]: [tone rule], [detail rule], [language].
- If they are like [Fatima]: ...
- If they are like [Yusuf]: ...
```

*Question to answer:* how does the agent know which type it is talking to? It has to ask, or infer from what the traveller says. Say which.

---

## Block 5 — Boundaries

What the agent must refuse, and what it must do when unsure.

```
Never [prohibited advice].
If you do not know an airport-specific detail, [what to do instead].
Never describe a route, sign, or landmark you are not sure exists.
```

*Question to answer:* name the three things the agent will not do (visa advice, immigration advice, something else you choose).

---

## Block 6 — Escalation

When the agent should stop and hand over to a human.

```
If [condition], tell the traveller to [action].
```

*Question to answer:* at what point does following the agent become worse than asking a staff member?

---

## After you fill it in

1. Paste the whole thing into ChatGPT / Claude / Gemini as custom instructions, or as your first message.
2. Talk to it **as Ahmed**: "I'm at the airport now, what do I do?"
3. Copy the reply.
4. Ask the **same question as Fatima**, then **as Yusuf**.
5. Save all three replies — they are your first test results.

## Evidence this task produces

- The filled-in prompt (no brackets left).
- Three replies to the same question, from three user types.
- A ticket test: paste a sample boarding pass, record what the agent extracted and what it got wrong.
- Three sources for the Reference section, in APA format.
