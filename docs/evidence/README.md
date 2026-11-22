# Screenshot evidence — 22 November 2026

Captured from the running app in headless Chromium by typing into the real
interface, not by mocking a response. Model: `gpt-6-luna`. Live feed: kfia.sa.

| File | What it proves |
|---|---|
| `01-home.png` | First load. Walking-mode toggle present; the note states plainly that Dammam is live while Riyadh and Jeddah are not. |
| `02-live-chat-en.png` | A real turn. The reply names the live gate (G25), the real delay and destination, and the "Trip so far" panel fills in. |
| `03-walking-mode.png` | Walking mode: noticeably larger type, toggle shown active. |
| `04-arabic-rtl.png` | UI switched to Arabic with English history in the transcript. Each bubble keeps its own direction — this is the bidi bug fixed in commit `08710dd`. |

## What is live in these shots

`XY837 → Addis Ababa · gate G25 · delayed 470 min · gate closed`

Those values came from `kfia.sa/api/aodb/flights` at capture time. They will
differ when you look at the airport today — that is the point.

## What these shots do not prove

- Nothing about Riyadh or Jeddah, which return `NOT_SUPPORTED` by design.
- Nothing after a page reload mid-conversation (history persistence is covered
  by `GET /api/history/:sessionId`, not by a screenshot).

## 05-pages-demo.png

The static GitHub Pages build, served from a subpath (`/flight-guide/`) the way
Pages serves a project site. Proves the relative-path rewrite works — before
it, `app.css` and `chat.js` 404'd and the page rendered unstyled.
