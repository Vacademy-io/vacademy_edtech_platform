# Walkthrough generator

Turns the `docs/onboarding-guide-*.csv` task lists into **animated HTML walkthrough
videos** — one self-contained `.html` per task — with as little manual work as
possible.

A "video" here is the self-playing animated HTML file produced by an LLM from
**(a)** screenshots of the flow + **(b)** the master walkthrough prompt. This tool's
job is to make (a) and (b) effortless for all ~430 tasks; you (or, optionally, the
Claude API) run the LLM step that emits the HTML.

## Pipeline

```
docs/*.csv ──▶ [1] generate.mjs  ──▶ out/prompts/<slug>.md   (filled master prompt)
                                     out/flows/<slug>.json    (step list)
                                     out/INDEX.md / index.json

(later)   ──▶ [2] capture (Playwright) ──▶ out/screenshots/<slug>/step-NN.png

then YOU ──▶ [3] paste prompt + screenshots into Claude ──▶ <slug>.html  ← the walkthrough
```

## What you get (output, in `out/`)

| Path | What it is | Stage |
|---|---|---|
| `out/prompts/<slug>.md` | The full master prompt, pre-filled for this task (its flow description + route hint). **Paste this into Claude.** | 1 (done) |
| `out/flows/<slug>.json` | The parsed step list for the task (used by capture). | 1 (done) |
| `out/index.json`, `out/INDEX.md` | Catalog of every task with its slug + steps. | 1 (done) |
| `out/screenshots/<slug>/step-NN.png` | One clean screenshot per step. **Attach these to Claude.** | 2 (capture) |

## How to get the HTML for one flow

You run the LLM step yourself (no API key needed):

1. Open `out/prompts/<slug>.md` and copy all of it.
2. Attach the images in `out/screenshots/<slug>/`.
3. Paste into Claude (claude.ai). It returns **one self-contained `<slug>.html`**.
4. Save it as `<slug>.html` and open in a browser — that's the animated walkthrough.

### Doing ~430 of them with less effort

- **claude.ai Project (recommended manual path):** create a Project, paste
  `master-prompt.md` once as the Project's custom instructions. Then per task you
  only drop the screenshots + one line: `This covers: <title>. Route hint: <slug>.`
  No need to paste the whole prompt every time.
- **Full automation (optional, needs an API key):** with an `ANTHROPIC_API_KEY`,
  the generate step can submit all tasks as **one Claude batch** and write every
  `<slug>.html` automatically. Off by default.

## Stage 1 — generate prompts (offline, safe)

```
node tools/walkthrough-generator/generate.mjs
```

Reads only the CSVs and writes only local files. **No network, no app, no
backend, no institute/user is touched.**

## Stage 2 — capture screenshots (Playwright) — SAFETY GUARANTEES

The capture stage drives the real admin app to screenshot each step. It is built so
it **cannot affect any other institute, user, or the platform**:

- **Single-institute lock.** Runs only with the demo-institute login; asserts the
  logged-in `institute_id` equals the configured demo ID and **hard-aborts**
  otherwise. (Multi-tenant isolation already prevents cross-tenant access.)
- **Read-only capture.** Navigates and opens dialogs/fills fields for the
  screenshot, but **never clicks terminal actions** (Save / Create / Invite /
  Send / Publish / Delete / Connect / Pay). No data is created even in the demo
  institute.
- **No real payment / no outbound.** Network requests to payment gateways
  (Razorpay/Stripe/Cashfree), invoice-pay, and comms send endpoints
  (email/WhatsApp/SMS/Exotel telephony) are **blocked at the network layer**.
- Credentials live only in a **gitignored `.env`** (never committed).

Config (`.env`, gitignored):

```
VACADEMY_BASE_URL=        # the admin app URL to drive (provided by you)
VACADEMY_INSTITUTE_ID=3be88465-0100-4a34-807b-c22c80c86b87
VACADEMY_USERNAME=admin_distancelearning
VACADEMY_PASSWORD=...
```

> Nothing in this folder is committed or pushed unless you explicitly ask.

---

## Engine — authored flows → real walkthrough videos (deterministic, no LLM)

The pipeline above (CSV → prompt → paste into Claude) is the **manual** path. There is
also an **engine** path that produces a finished, self-playing video **without any LLM
in the loop** — the UI shown in the video *is* the real captured product.

```
capture/authored.mjs   (flow specs)
        │  drives the live demo, one real screenshot per step
        ▼
capture/engine.mjs  ──▶ screenshots/flows/<slug>/NN.png   (real frames)
                        screenshots/flows/<slug>/manifest.json  (cursor + caption + path per frame)
        │
        ▼
capture/build-video.mjs ──▶ walkthroughs/<slug>.html   ← the finished video (self-contained)
```

### What the engine produces

A `<slug>.html` "video" is a **faux-browser frame showing the real screenshots**, with a
**ghost cursor** that glides to each recorded click point, a tap ripple, crossfades,
captions, an address bar, and a seekable player bar. It is 100% real UI — `build-video`
only animates a cursor over the captured frames. No UI is recreated or hallucinated.
Frames are inlined as base64, so each `.html` is fully portable (one file, no assets).

### Authored vs auto

| Path | Script | Output | Use |
|---|---|---|---|
| **Authored** (end-to-end) | `capture/authored.mjs` → `engine.mjs` | full task: navigate → click → type → every step → submit → result, with ghost cursor | the real "how-to" videos |
| **Auto sweep** (landing only) | `capture/bulk-capture-auto.mjs` | one read-only landing screenshot per flow | bulk coverage / smoke |

### Realism the engine bakes in

- **Typing reads as writing.** `fillForm` types each field in a few chunks and snapshots
  after each chunk, so a name/email/description is *written out* across frames instead of
  popping in fully formed. Sub-frames play fast (`dur: 540ms`) via the per-frame `dur`,
  which `build-video` honors.
- **Dropdowns show the list.** `selectDropdown` opens the picker, **captures the open
  list** with the cursor tapping the chosen option (`dur: 1700ms`), *then* selects — so the
  viewer sees the choice being made, not just the final chip. Options are matched only in
  the popup **below** the trigger, never a same-named element in the background page.
- **Cursor lands on the target.** Each frame records a real cursor `{x,y}` from the live
  element's bounding box. `point:{firstField:true}` resolves to the **same field the fill
  will type into** (modal-scoped; it does *not* assume fields start past x=300 — modal
  fields often begin near x≈128), so the "name your …" cursor sits on the field, not on
  empty space. `build-video` maps capture-space (1440×900) → the 1080-wide stage by a
  single uniform scale (`k = 1080/1440`), so what's recorded is what's shown.

### Safety (engine = authored path)

- **Institute-locked.** Asserts the logged-in institute equals the demo ID up front and
  before steps; **hard-aborts** on drift.
- **In-demo actions allowed, 3rd-party blocked.** Per owner direction the authored flows
  may click/fill/submit *within the demo institute*, but the network guard **aborts**
  payment gateways, custom-domain/DNS, and real comms-send (WhatsApp/SMS/email) calls, and
  **never** issues `DELETE`.
- Credentials stay in the gitignored `.env`.

### Step DSL (one entry per `steps[]` in an authored flow)

Every field optional unless noted. Full reference in the header of `capture/engine.mjs`.

| Field | Meaning |
|---|---|
| `goto:'/path'` | navigate first (full navigation) |
| `navRail` / `navClick:{text,region}` | click a left-rail section / a control to advance |
| `path:'/x'` | address-bar path shown on this frame |
| `screen:'id'` | shared-screen cache: capture once, reuse the real image across flows |
| `caption:'…'` | one short line (`<b>bold</b>` the key nouns) |
| `point:{…}` | what the cursor points at: `{text,region}` · `{coords:[x,y]}` · `{firstField:true}` · `{field:'regex'}` (a control by placeholder/aria/label/id) · `{submit:true}` · add `scroll:true` to reveal an off-screen target first |
| `then:{…}` | advance after the shot: `{clickPoint}` · `{click:{text,region}}` · `{fill:true}` · `{type:{field:'regex',value,clear?}}` (clear:true replaces the value) · `{select:{trigger,option?,caption?,commit?}}` (commit:false = show the list, don't change it) · `{submit:{text?}}` · `wait:ms` |

> **Quality bar:** every video must be genuinely end-to-end — each frame moves, and the final
> frame shows the real result (never a "done" caption over a stale form). See `CONTEXT.md` §0.
| `final:true` | last frame (no advance) |

Settings screens are deep-linked by tab — `goto:'/settings?selectedTab=<value>'` (values in
`src/routes/settings/-constants/terms.ts` → `SettingsTabs`, e.g. `whiteLabel`, `invoice`,
`naming`, `leadSettings`) — rather than clicking through the Settings home grid.

### Add / capture / build a flow

```bash
# 1. author the flow in capture/authored.mjs (push a spec onto FLOWS)
# 2. capture it against the live demo (writes real frames + manifest)
node capture/authored.mjs --slugs=admin-how-to-create-a-course
# 3. build the self-contained video
node capture/build-video.mjs admin-how-to-create-a-course
# → walkthroughs/admin-how-to-create-a-course.html
```

Omit `--slugs=` to capture every authored flow. The cursor `{x,y}`, captions, and
per-frame durations all live in `screenshots/flows/<slug>/manifest.json`, so a flow can be
**rebuilt** (re-run step 3) without re-driving the browser.

### QA: see exactly where the cursor lands

```bash
node capture/overlay-cursor.mjs <flow-slug-dir>
# → render-check/<slug>/cursor-NN.png  (real frame + the ghost cursor stamped at its x,y)
```

`overlay-cursor` composites the recorded cursor onto each real frame (same placement the
player uses), so you can verify a `point:{…}` lands on the right control before — or instead
of — opening the `.html`. Pure rendering: no app, no network.
