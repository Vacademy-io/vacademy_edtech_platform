# CONTEXT — walkthrough-generator (read me first)

This file is the **handoff brief**: hand someone (or a fresh AI chat) *this folder* + this
file and they have everything needed to understand the task and continue it. For the
mechanics of the engine, see `README.md`; this file is the *state, conventions, and
gotchas*.

---

## 1. The goal

Turn the institute's onboarding task lists (`/docs/onboarding-guide-*.csv`, ~432 tasks)
into **self-contained animated HTML "videos"** — one `.html` per task. A "video" is a
faux-browser frame playing **real product screenshots** with an animated **ghost cursor**
that moves to each step, types into fields, opens dropdowns, with captions + a player bar.
No real video file, no screen recording, no AI re-drawing the UI — the UI shown *is* the
captured product.

Each video is built deterministically by driving the **live demo institute** with
Playwright (one real screenshot per step) and then compositing the cursor over those
frames.

---

## 2. Where things stand (state)

| Stage | Status |
|---|---|
| **Prompts/flows generated** for all 432 tasks (`out/`) | ✅ done (the manual-LLM path) |
| **Engine** (authored flows → real video) | ✅ working, hardened |
| **First 10 admin onboarding videos** → `walkthroughs/` | ✅ first pass (some are thin — see below) |
| **v2 end-to-end videos** → `walkthroughs-v2/` | ✅ 4 done: portal-tab-title, rename-terminology, currency, lead-settings |
| **+20 more end-to-end videos** (batch 2, distinct from the 5 above) | 🔄 IN PROGRESS — see §9 batch log |
| **Remaining ~400 task videos** | ⏳ TODO — use the v2 convention + the §0 quality bar |

**Reworked to the §0 quality bar (the good versions live in `walkthroughs-v2/`):**
- **rename terminology** — clears the Course field and types "Programme", shows the
  "unsaved changes" banner, points at Save.
- **set currency** — opens the Currency dropdown and shows the full currency list (read-only).
- **lead settings** — a 3-stop tour, cursor moving down the page.
- **create a course** — the full thing: fill name/description → Next → pick a flat structure
  (No sessions, No levels via the `#sessions-no`/`#levels-no` radios) → **click Create** →
  the final frame is the REAL result: a "Course created successfully" toast on the new
  "Foundation Science" Course Details page. This is the model for "action → true success".

The old thin/early versions of these still sit in `walkthroughs/` — **superseded; delete or
ignore them.** Each capture of `create a course` makes one real demo course (that's fine).

> `walkthroughs/` also contains a few earlier one-off videos from before the first-10 batch.
> Treat `walkthroughs/` as "the original 10 + legacy" and **leave it alone**; all NEW work
> goes to `walkthroughs-v2/`.

### The first 10 (in `walkthroughs/`, deep-linked, DONE — don't redo)
dashboard tour · invite team members · white-label branding · upload logo · theme color ·
custom domain · favicon · set currency · rename terminology · lead settings.
(`capture/authored.mjs` holds their specs.)

**Honesty note baked into the first 10:** the idealized CSV listed flows that don't exist in
the real app — *dark mode* (not implemented), *institute name / time-zone* (no dedicated
screen). Those were **substituted** with real essential flows, not faked. When you continue:
verify a task maps to real UI before authoring; if it doesn't, substitute and say so. Never
fabricate a screen.

---

## 3. Conventions & the quality bar (apply to ALL future videos)

### ⭐ (0) THE QUALITY BAR — every video must be genuinely end-to-end

This is the most important rule, learned the hard way from review feedback. A walkthrough
is a *video*, not a slideshow. It must read as a complete how-to where **every frame is the
next step of the previous one**.

- **MOVE every frame.** Each frame must visibly advance: navigate to a new screen, move the
  cursor to a *different* control, click into a field, type text, open a dropdown, select an
  option. **Never two near-identical stills** with the cursor parked in the same place.
  (Bad example we fixed: a "rename terminology" video that was just two identical Naming
  screenshots — Step 1 and Step 2 looked the same, nothing happened.)
- **The final frame must show the REAL result.** If the caption says "…is created", "…is
  saved", "…done", the frame must actually show that outcome — a success screen, a toast,
  the new item in a list, the changed value, an "unsaved changes" banner, etc. **Never put a
  "done/created" caption over a stale, unchanged form.** (Bad example we caught: a
  "create a course" video whose last 3 frames were the *same open Add-Course modal*, with
  "Your course is created and ready" over a form that was never submitted.)
- **If you can't capture a true result, don't fake it.** End the flow honestly
  ("Review the details, then click Create to finish.") rather than claiming success over an
  unchanged screen. (Submitting may be blocked by the safety guard, or may clutter the demo —
  that's fine; just don't lie in the caption.)
- **Show the interaction, not just the destination.** Use the engine features built for this:
  `then:{type:{…,clear:true}}` to *type out* a value (and replace an existing one),
  `then:{select:{…,commit:false}}` to *open a dropdown and show the options*,
  `point:{…,scroll:true}` to bring an off-screen control into view first. A "set currency"
  video should OPEN the currency dropdown and show the list; a "rename" video should CLEAR
  the field and TYPE the new word.
- **No silent dead frames.** If a `point` resolves to `NULL` (control not found) or a frame
  comes back blank, that's a defect — fix the selector/settle and re-capture; never ship it.

> Verify with `overlay-cursor.mjs` (§4): scan the frames in order — if two consecutive
> overlays look the same, the flow isn't end-to-end yet.

### (a) Full navigation — start on the Dashboard, walk the whole path
The first 10 *deep-linked* straight to a settings tab (`/settings?selectedTab=…`). Going
forward, **every flow starts on the Dashboard and navigates step-by-step** so the viewer
learns how to *get* there:

```
Dashboard → click Settings (left rail) → Settings sidebar → click the tab → the action
```

Use the **`dashToSettings(tabValue, opts)`** helper in `capture/authored-v2.mjs`. It emits
the two shared opener frames (rail → sidebar). `tabValue` is the EXACT sidebar/card label
from `frontend-admin-dashboard/src/routes/settings/-utils/utils.ts → getAvailableSettingsTabs()`
(e.g. `'White-Label Setup'`, `'Lead Settings'`, `'Invoice Settings'`, `'Naming Settings'`,
`'Custom Fields'`, `'Coupon Settings'`). The settings sidebar is long/alphabetical, so the
tab click uses `point:{…, scroll:true}` to bring the item into view first.

### (b) Separate output folder
New videos build into **`walkthroughs-v2/`**, leaving the original `walkthroughs/` untouched:

```
node capture/build-video.mjs <slug> --out=walkthroughs-v2
```

Frames + manifest still go to `screenshots/flows/<slug>/` (shared intermediate). Give every
new flow its **own unique slug** so it never collides with the first 10.

> **The template is already built**: `admin-how-to-set-your-portal-tab-title`
> (in `authored-v2.mjs` → `walkthroughs-v2/`) demonstrates the complete
> Dashboard → Settings → White-Label → expand → type pattern. Copy it.

---

## 4. The authoring loop (how to make one video)

```bash
# 1. Author the flow spec in capture/authored-v2.mjs  (push onto FLOWS; start with dashToSettings(...))
# 2. Capture it against the live demo (writes real frames + manifest):
node capture/authored-v2.mjs --slugs=<your-slug>
# 3. QA the cursor placement WITHOUT opening the html:
node capture/overlay-cursor.mjs <your-slug>      # → render-check/<slug>/cursor-NN.png
#    -> view those PNGs; each shows the ghost cursor stamped at its recorded x,y.
#    -> if a cursor is NULL or off-target, fix the point in the spec and re-capture.
# 4. Build the video into the v2 folder:
node capture/build-video.mjs <your-slug> --out=walkthroughs-v2
```

The `manifest.json` holds cursor `{x,y}`, captions, and per-frame durations, so step 4 can
be re-run to **rebuild** without re-driving the browser. Caption-only fixes can edit the
manifest directly + rebuild.

### Verifying a batch
A good final pass is an adversarial audit: for each video, look at every
`render-check/<slug>/cursor-NN.png` and confirm the cursor lands on the control the caption
names, no frame is blank, and the caption matches the screen. (The first-10 batch was
audited this way; 7/10 passed first time, 3 were fixed.)

---

## 5. Step DSL (what you write in a flow spec)

Full reference is in the header of `capture/engine.mjs`. Quick map:

- **Navigate:** `goto:'/path'` · `navRail:'CRM'` · `navClick:{text,region}` · `settle:ms`
- **Address bar:** `path:'/x'`  ·  **Shared screen cache:** `screen:'dashboard'`
- **Caption:** `caption:'… <b>bold nouns</b> …'`
- **Point the cursor (`point:{…}`):**
  `{text,region}` · `{coords:[x,y]}` · `{firstField:true}` · `{field:'regex'}` (a control by
  placeholder/aria/label/id) · `{sel:'css'}` (a precise element, e.g. `'#sessions-no'`) ·
  `{submit:true}` · add `scroll:true` to reveal a below-the-fold target first.
- **Advance after the shot (`then:{…}`):** `{clickPoint}` · `{click:{text,region}}` ·
  `{clickSel:'css'}` (click a precise element, e.g. a radio by id) ·
  `{fill:true}` · `{type:{field:'regex',value,clear?}}` (clear:true replaces the existing
  value — for renames) · `{select:{trigger,option?,caption?,commit?}}` (commit:false = open &
  show the list but DON'T change the setting) · `{submit:{text?}}` · `wait:ms`

These are the levers that make a flow end-to-end (§0): `type` writes a value out progressively,
`type.clear` does a clean rename, `select` opens a real dropdown, `select.commit:false` keeps
it read-only, `point.scroll` reveals an off-screen target. The `dashToSettings()` helper in
`authored-v2.mjs` emits the shared Dashboard→Settings→sidebar opener.
- **End:** `final:true`

`region` = where to look: `rail` (far-left icon rail, x<74) · `sidebar` (x<300) ·
`content` (x>300) · `any`. Text matches are case-insensitive regex on the element's first
line, so `'^Settings$'` is exact, `'theme|#4F46E5'` is fuzzy.

### Reference facts you'll reuse
- **Settings tab deep-link values** (only if you ever bypass navigation):
  `frontend-admin-dashboard/src/routes/settings/-constants/terms.ts → SettingsTabs`
  (`whiteLabel`, `invoice`, `naming`, `leadSettings`, `customFields`, `coupons`, …).
- **Settings sidebar/card labels** (what `dashToSettings` clicks):
  `…/settings/-utils/utils.ts → getAvailableSettingsTabs()` (the `value` field).
- **Invoice Settings renders slowly** — give it `settle: ~5200` (or `tabWait`) or its first
  frame captures blank.
- White-Label branding fields (Tab Title/Icon, Theme/Color) are behind a per-domain
  **"Settings"** expand button — click `point:{text:'^Settings$',region:'content'}` first.

---

## 6. Safety (the engine is institute-locked)

- Runs only against the demo institute; asserts the logged-in `institute_id` up front and
  **hard-aborts** on drift.
- **In-demo writes are allowed and encouraged** (owner-confirmed): create courses, chapters,
  users, admins, and click **Save / Submit** so a flow reaches a REAL result screen (that's
  how `create a course` now ends on a true success page). The only hard limits are
  **third-party / outbound** calls — the network guard **aborts** payment gateways,
  custom-domain/DNS, and real comms-send (WhatsApp/SMS/email), and never issues `DELETE`. So:
  complete the action and show the true result; just don't trigger payment/DNS/comms (e.g.
  don't Save a custom domain, don't Send a WhatsApp).
- Credentials live only in the gitignored `.env`
  (`VACADEMY_BASE_URL`, `VACADEMY_INSTITUTE_ID`, `VACADEMY_USERNAME`, `VACADEMY_PASSWORD`).
  Auth session is cached in `auth-state.json` (gitignored). Nothing in this folder is
  committed unless explicitly asked.

---

## 7. File map

```
capture/
  engine.mjs          # the driver: runs a flow spec, writes real frames + manifest. Step DSL in its header.
  authored.mjs        # the original 10 flows (deep-linked). DONE — leave as-is.
  authored-v2.mjs     # NEW flows (dashboard-start). dashToSettings() helper + the demo. ADD HERE.
  build-video.mjs     # frames + manifest -> one self-contained .html.  --out=<folder> to target a folder.
  overlay-cursor.mjs  # QA: stamps the cursor onto each real frame -> render-check/<slug>/cursor-NN.png
  env.mjs             # loads .env, exposes TOOL_ROOT
screenshots/flows/<slug>/   # real frames (NN.png) + manifest.json   (shared intermediate)
render-check/<slug>/        # cursor-overlay QA images
walkthroughs/               # the original 10 + legacy videos  (LEAVE ALONE)
walkthroughs-v2/            # NEW videos go here
out/                        # generated prompts/flows for all 432 tasks (manual-LLM path)
README.md                   # engine mechanics + the manual-LLM pipeline
```

---

## 8. Next steps for whoever continues

0. **Internalize the §0 quality bar.** Every video is end-to-end, every frame moves, the last
   frame shows the real result. This is the bar reviewers hold the work to.
1. Pick the next tasks from `out/INDEX.md` (or the `docs/onboarding-guide-*.csv`).
2. For each, **confirm it maps to real UI** (grep `frontend-admin-dashboard/src/routes/…`);
   substitute truthfully if it doesn't.
3. Author it in `authored-v2.mjs` starting with `dashToSettings(<tab label>, …)`, then action
   steps that actually *do* the task (click in, `type`/`type.clear`, `select`, reach a result
   frame); run the loop in §4; build into `walkthroughs-v2/`.
4. Audit the batch (§4 "Verifying") **against §0** — scan the overlays in order; if two
   consecutive frames look the same, or the final frame doesn't show the result, it's not done.

Learner-side videos need a learner base URL (`VACADEMY_LEARNER_BASE_URL`) and a learner
session — not set up yet.

---

## 9. Batch log (real-time status)

**Batch 1 — DONE (5, in `walkthroughs-v2/`):** create-a-course · rename-system-terminology ·
set-your-time-zone-and-currency (currency) · configure-lead-scoring-rules (lead) ·
set-your-portal-tab-title.

**Batch 2 — IN PROGRESS (+20 end-to-end, distinct from batch 1):** mapped real routes /
triggers / fields / submit-enablers / success states for ~22 candidate tasks via a research
workflow (full data in the workflow transcript), then authoring → capturing → verifying each
to the §0 bar. Status:

| Slug | Status |
|---|---|
| create-a-coupon | ✅ built — toast "Coupon WELCOME20 created" + ACTIVE row |
| create-a-payment-plan | ✅ built — toast "Payment plan created successfully" + plan in list |
| add-a-tax-rate | ⚠️ reaches "Invoice settings saved" toast, but field-targeting types into a persisted row (CGSTCGST) — fix: target the NEW/last tax row, and the demo has accumulated test rows |
| create-a-custom-field | 🔁 flaky — succeeded once, then a re-capture left the dialog open. Build the run that closes the dialog + shows the field in the list |
| set-up-custom-lead-statuses | 🔁 "Add status" is at the bottom of the Configuration tab; loosened the text match + scroll, re-capturing |
| (audience-list, session, batch, note-to-lead, enroll-learner, live-session, question-bank) | ⏳ authored data ready (research) — not yet captured |
| (custom-role, automation, email-template, certificate, workflow, subject/module/chapter/slide) | ⏳ hardest — canvas/drag-drop/upload/deep-context; may not auto-drive to a clean success |
| add-a-contact | ❌ dropped — feature doesn't exist (Manage Contacts is view-only) |

### Batch 2/3 progress — 14 end-to-end videos built (was 8)
The breakthrough was making capture resilient to the flaky app, then a diagnose→fix→re-grind loop:

- **`capture/grind.mjs`** — the reliable runner. Gives EACH flow its OWN fresh browser +
  health-gate + up to N retries, and **auto-builds** on success. A mid-run app hang now costs
  one retry, not the whole queue (that single change took the count from stuck to climbing).
  `node capture/grind.mjs --slugs=<full-slugs> --attempts=8`
- **`flow.expect`** (a success-toast regex, top-level on a flow) — a flow only counts as done
  when that toast actually appears. **Make it SPECIFIC** (the real toast text), not a generic
  word — `'Audience'` matched the page title and gave a false success.
- **Systemic fixes found by the diagnosis workflow (apply to new flows):**
  - **Unique names** — the demo accumulates real data across runs; a hardcoded "Guardian Phone"
    / "Content Reviewer" / "North Zone Pool" hits the backend "already exists" guard on re-run.
    Use the `uniq('Base')` helper in authored-v2.mjs for any created entity's name.
  - **Radix controls** — checkboxes are `button[role="checkbox"]` (not `<input>`); Radix Select /
    custom dropdowns close themselves on click — the engine no longer presses Escape after
    selecting (Escape was closing the parent dialog).
  - **Full-width buttons** (>560px) are rejected by `findByText` — target them with
    `point:{sel:'button:has-text("…")'}` + `then:{clickSel}` instead.
  - **Save POSTs need time** — give a Save/submit `wait: ~4000` so the toast/clean-state render
    before the final frame; and when a page has TWO "Save" buttons, point at the right one
    (`text:'^Save$'` is top-most via `clickPoint`, not the `submit`/preferBottom one).

**18 end-to-end videos built (walkthroughs-v2/)** — more than doubled from 8:
the 5 batch-1 + create-course + coupon + payment + lead-statuses + assessment-settings +
custom-field + session + custom-role + doubt-category + lead-pool + content-protection +
custom-team + live-session-settings + course-settings.

The reliable recipe: author from research → `grind.mjs` → if a flow fails, run the diagnosis
workflow (reads its overlay frames + the real component code → exact root cause + fix) → apply
→ re-grind. Every failure this far has had a precise, real cause (duplicate name, Radix
selector, an Escape that closed a dialog, a "Clear All Fields" menu item, a wrong/`Save now`
button, a faded toast). Systemic fixes that benefit all flows now live in the engine.

**The two reliable high-yield categories (largely mined out):**
1. **Settings "create X" with a clear toast** (coupon, payment-plan, custom-field, custom-role,
   doubt-category, lead-pool, lead-statuses) — done.
2. **Settings "toggle a switch → Save → toast"** — works ONLY for tabs with a single global
   save banner (live-session-settings, course-settings, content-protection, assessment-settings
   landed). Tabs that are multi-section pages with per-card save buttons (student-display,
   notification, lms) do NOT fit and need custom per-tab authoring.

**What's left needs custom per-flow work (not a reusable pattern):**
- multi-step wizards still stuck after 2 fix rounds: **audience-list** (campaign-type commit),
  **batch** (3-step dropdown wizard), **referral-reward** (tier config).
- the 3 multi-section settings tabs above.
- course-content (subject/module/chapter/level — need a course open + sometimes uploads).
- **genuinely infeasible** (won't auto-reach a real success, don't fake): the **workflow
  ReactFlow canvas**, **certificate + email drag-drop designers**, **PDF/file-upload slides**.

**Realistic ceiling ≈ 20–25** clean, non-faked videos. Each beyond ~18 is a custom dig.

### Resource note (real blocker on this machine)
Capturing launches a headless chromium per flow; with the demo's own large Chrome session the
box ran to ~1.5 GB free RAM and `fork`/CreateFileMapping failures killed runs. Mitigations:
grind one flow at a time (it's already sequential), don't leave detached grinds (`&`) running,
and kill orphaned capture-`node` procs (match cmdline `walkthrough-generator\\capture|grind.mjs`)
— never the harness/MCP. Freeing the demo's Chrome tabs lets several flows run in parallel again.

### ⚠️ Two realities learned in batch 2 (important for whoever continues)
1. **The demo app intermittently HANGS on load** → a flow then resolves almost no cursors
   (all-NULL frames = a blank/spinner page). The engine now **self-heals**: `runFlows` retries
   a flow up to 3× when it resolves `<2` cursors, re-warming `/dashboard` between tries, plus a
   3.5s startup warmup and an 0.8s breather between flows. Capture is still a roll of the dice —
   **build a flow the moment it reaches success; don't blindly re-capture a good one** (a bad
   re-capture overwrites the good frames).
2. **Repeated captures POLLUTE the demo** with real test data (coupons, plans, tax rows, …).
   That's allowed, but it accumulates and can confuse field-targeting (e.g. typing into an
   existing row). Prefer targeting the NEW/last element, and don't re-run a create more than
   needed.
