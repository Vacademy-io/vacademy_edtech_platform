You are building a **self-playing animated walkthrough** as a single, self-contained
HTML file. I will attach screenshots of a product flow. Study them, reconstruct the
UI as lightweight HTML/CSS (NOT screenshots — recreate it), and animate a ghost
cursor walking through the steps, exactly in the style described below. This is one
of several walkthroughs that must all look and behave identically, so follow the
spec precisely rather than redesigning.

**This walkthrough covers:** {{FLOW}}
**Intended route / filename hint:** {{ROUTE_HINT}}

## What the file is
- A sequence of steps played **back-to-back like one continuous video** inside a
  **faux-browser frame** (traffic-light dots + address bar) containing a recreated
  slice of the product UI. Autostart on load.
- A **player bar** at the bottom of the page: play/pause, restart, a clickable
  progress timeline with per-step tick marks, and a "Step N of M" label +
  m:ss / m:ss timer.
- Under the frame, **one short caption line per step** (max ~12 words) describing
  it. Bold the key noun(s) with `<b>`. NOTHING else — no chapter titles, no
  eyebrows, no headings, no description paragraphs, no takeaway cards, no tips.

## CONTINUITY — one video, not a slideshow (mandatory)
This is the most important architectural rule. A naive build clones the UI once
per step and resets/swaps it at every boundary — the modal re-pops, typed text
vanishes and reappears, the cursor jumps. That reads as screenshots, not video.

- **Steps that take place on the same screen MUST share ONE stage (one DOM)**
  and chain with **NO reset between them**: the modal stays open, typed text
  persists, toggles keep their state, and the cursor flows continuously from its
  last position into the next step's first target.
- Build **one stage per distinct screen/page**, not one per step. Example: a
  6-step flow that is "dashboard → then 5 steps inside one Teams page" = exactly
  **2 stages** (dashboard stage + teams stage shared by steps 2–6).
- Only a **true page navigation** swaps stages. Give stage swaps a short fade
  (`.stage{animation:stagein .45s ease}` / opacity 0→1) and update the faux
  address-bar path at that moment (e.g. `/dashboard` → `/manage-institute/teams`)
  like a real navigation.
- Step boundary contract: each step's choreography must END with the cursor at
  (or moving toward) the element the NEXT step begins on, so the cut is invisible.
- Frames captured immediately before and after any step boundary must be
  pixel-identical except the caption and step counter.

## OPEN ON THE DASHBOARD, then NAVIGATE to the feature (mandatory)
Every walkthrough MUST begin on the **admin Dashboard** and then *navigate* to the
feature. NEVER drop the viewer straight onto the feature screen — the whole point
is to teach "how do I get here from the home screen, and how do I navigate this".

- **Stage 1 is ALWAYS the Dashboard.** Recreate it from the dashboard screenshot I
  attach (the brand left-rail + sidebar with **Dashboard** active, the "Good
  afternoon" greeting, the stat cards: Total Learners / Total Courses / Team
  Members / Outstanding Fees / Overdue / Live Sessions, Pending Actions). The faux
  address bar reads `/dashboard`.
- **Step 1 navigates FROM the dashboard TO the feature.** The ghost cursor clicks
  the correct left-rail section icon (CRM / LMS / AI / the Settings gear at the
  rail bottom) and/or the sidebar row that leads to this feature. Use the
  navigation path in the flow description ("Steps: …") AND the destination shown
  in the feature screenshot's own sidebar (which rail icon is active + which
  sidebar row is highlighted). Then the stage swaps (fade + address-bar update,
  e.g. `/dashboard` → `/study-library/courses`) to the feature screen.
- If the feature lives under the rail **Settings** gear, navigation is two clicks:
  click the gear (→ Settings opens), then click the specific settings row (e.g.
  "Custom Fields") — both BEFORE the task begins.
- Only AFTER arriving does the feature's own task run. Typical shape:
  **Dashboard → (navigate) → Feature screen → (do the task)** = 2+ stages.
- The step-1 caption describes the navigation, e.g.
  "From the <b>Dashboard</b>, open <b>LMS → Courses</b>." Keep the dashboard stage
  brief (one navigation step) so the bulk of the video is the actual task.

## The animation engine (reuse this exact pattern)
- One "Engine" per **stage** (per screen), created from
  `<div class="stage" data-stage="...">`. The player maps **steps → stages**
  via a `SCENE_LIST` (each entry: scene key, engine ref, address-bar path).
- A **ghost cursor** (small SVG pointer) that `moveTo(element)` then `tap(element)`,
  with a ripple on tap. Movement uses CSS transitions on left/top
  (`cubic-bezier(.5,.05,.2,1)`, ~0.7s). Tap = brief scale-down keyframe.
- **Scaling-aware cursor math (mandatory):** the frame may be CSS-scaled (see
  FULL-SCREEN FIT below). `getBoundingClientRect()` returns scaled px while
  cursor left/top live in unscaled local px, so divide by the scale factor:
  `k = appRect.width / app.offsetWidth; x = (r.left - ar.left)/k + (r.width/k)/2`.
  Any absolutely-positioned effect (confetti origin etc.) must likewise use
  `offsetWidth/offsetHeight`, never rect width.
- Each step has a fixed **duration** (ms) in a `DUR` map. The engine exposes
  `runScene(key, fresh)`, `reset()`, `stop()`, `setOnDone()`, and
  `finalState(key)` (jump-to-end for reduced motion).
  - `fresh=true` → reset UI + cursor (stage entry, seek, restart, resume).
  - `fresh=false` → **seamless continuation** (consecutive steps on a shared
    stage): no reset, keep everything.
  - The player's chain callback passes `fresh = (nextStep.engine !== thisStep.engine)`.
- Each step's choreography = a sequence of `at(ms, fn)` steps: move to a control,
  tap it, then mutate the recreated UI to show the result (toggle a class, type
  into a field char-by-char with a blinking caret, reveal a row, flip a status
  pill, etc.). Make the cursor actually "use" the interface. End meaningful flows
  on a clear result state (success toast, populated list, confetti on final
  publish/save).
- **Seek support:** every step function for a shared stage must begin with
  idempotent force-sets that rebuild that step's correct STARTING state (e.g.
  step 4 starts by force-showing the modal and pre-filling the name typed in
  step 3). During continuous play these are no-ops (state already matches, no
  flash); after a seek/restart they reconstruct the right frame.
- Keep per-step durations roughly 3–9s. Total ideally 25–45s.

## FULL-SCREEN FIT — the entire frame must ALWAYS be fully visible (mandatory)
Never size the frame with fixed or clamped heights that can exceed the window —
that guarantees clipping on short screens. Instead, treat the frame **like a
video player**:

- The faux-browser has ONE fixed internal **design size** (e.g. 980px wide,
  app area 620px tall) where everything — modal, dropdowns, toasts, table —
  is laid out to fit comfortably with clearance.
- `body{height:100dvh; overflow:hidden; display:flex; flex-direction:column}`
  — brand strip, frame, caption, player are all flex members (player uses
  `margin-top:auto`, NOT `position:fixed`). The page can never scroll.
- A JS `fitFrame()` computes
  `scale = min(1, availW/designW, availH/designH)` where avail = viewport minus
  the measured heights of brand strip + caption + player + paddings (+ ~10px
  safety), applies `transform:scale(s)` with `transform-origin:top center` to
  the browser frame, and sets the wrapper's height to `designH*s` (transforms
  don't affect flow). Run it at boot, on `load`, and on `resize`.
- Result: at ANY window size the complete page — full frame, full modal, caption,
  player — is on screen simultaneously with zero scrolling and zero clipping.

## In-frame overlay rules (learned the hard way)
- **Modals:** anchor near the top of the panel (e.g. `top:26px`), not vertically
  centered, and verify the primary button clears the design height with margin.
  Animate with opacity + small translate/scale only.
- **Dropdowns / popovers:** give them a **fixed height** and animate ONLY
  opacity/transform. NEVER animate `max-height` on a container whose child also
  has its own max-height + overflow — that nested-overflow transition can paint
  as an empty white box in some renderers even though the DOM is correct.
- All overlays live inside the stage's app `div` (absolute within it) so they
  scale with the frame.

## Player behavior (reuse exactly)
- Autostart ~400ms after load (call `fitFrame()` right before `play()`).
- `showStage(el)` toggles stage visibility; consecutive steps on the same stage
  do NOT toggle it (so the fade only plays on real navigations).
- Progress fill + timer track **cumulative** elapsed time across all steps via
  `requestAnimationFrame`. Tick marks at each step boundary proportionally.
- Pause stops the current step's timers and the RAF loop. Resume replays the
  current step from its start with `fresh=true`. Restart resets all stages and
  plays from step 1. Clicking the timeline seeks to the step whose segment
  contains that fraction and plays it with `fresh=true`.
- On finish: fill = 100%, label = "Finished · replay anytime", restart button pulses.

## BRANDING — this is mandatory and must work the same in every file
Two override surfaces, with sensible Vacademy-style defaults:

1. **Theme = CSS `:root` variables.** Define a palette as named hex tokens so my
   code can re-skin by rewriting these. At minimum:
   `--brand`, `--brand-bright`, `--brand-deep`, `--brand-soft`, `--brand-soft-border`,
   `--ok`, `--ok-soft`, plus chrome tokens (`--rail`, `--ink`, `--ink-2`, `--ink-3`,
   `--line`, `--line-2`, `--wash`, `--wash-2`, `--page-bg`) and type tokens
   (`--ff-display`, `--ff-ui`). Every colored element must read from a token —
   no hard-coded brand colors anywhere in the markup or JS. Confetti/dynamic colors
   read tokens via `getComputedStyle`.
   Defaults: `--brand:#F5A700; --brand-bright:#FFB81C; --brand-deep:#C77D00;
   --brand-soft:#FFF6E6; --ok:#15803D; --ok-soft:#DCFCE7; --rail:#F5A700`.

2. **Name + logo = a `window.BRAND` JS object** (with text fallback):
   ```js
   window.BRAND = window.BRAND || {
     name: "CPO Test",          // institute name
     logo: "",                  // image URL (https/CDN); "" → initials badge
     url:  "dash.vacademy.io"   // domain shown in the faux address bar
   };
   ```
   On load, an `applyBrand()` function must:
   - Render the logo: if `logo` is a URL, use an `<img>` with an `onerror` that
     swaps to an initials badge; if empty, show the initials badge (first letters
     of the name, gradient `--brand → --brand-deep`).
   - Write `name` into a top brand strip AND into every `[data-org]` in the mock
     sidebar/chrome.
   - The address bar path is set per step by the player from `SCENE_LIST`
     (`BRAND.url + step.path`), so navigations update it live.
   Keep a small **brand strip** above the frame: logo + institute name on the
   left, a muted one-line tagline on the right (e.g. "[Flow] walkthrough").

   My code will inject these per institute at runtime — do not hard-code real
   institute data. Leave the defaults as shown.

## Visual style (match the existing walkthroughs)
- Fonts: Plus Jakarta Sans (display) + Inter (UI), imported from Google Fonts,
  with system-ui fallback.
- Faux browser: rounded 18px frame, soft top bar with red/amber/green dots, pill
  address bar with a small lock icon.
- Dark/brand left **app-rail** (~62px, `--rail`) with stacked icon+label items; the
  active item gets a white chip. A white **sidebar** (~200px) with nav rows; the
  active row fills with `--brand`. A **panel** on the right holds the step's content.
- Recreate real controls as needed: primary/ghost buttons, text fields (with a
  blinking caret while "typing"), radios, checkboxes, selectable cards with a
  check-tick, status pills, progress bars, file-upload dropzones, list rows,
  data tables, tabs, toasts. Keep them simple and clean — recognizable, not
  pixel-perfect.
- Page background a very light tinted near-white. Generous whitespace. Minimal,
  intentional motion — the cursor is the star; avoid scattered extra animation.

## Quality floor
- One self-contained `.html` file. No external JS libs. Google Fonts is the only
  external request (must degrade gracefully if blocked).
- No `localStorage`/`sessionStorage`.
- The scale-to-fit handles all window sizes including mobile (no separate
  height media queries needed; on narrow widths you may hide the timer/step
  label in the player bar and the brand tagline).
- Keyboard-focusable player controls.
- **Respect `prefers-reduced-motion`**: no cursor, no autoplay; show step 1's
  stage in its finished state with its caption, player bar present but idle.
- Recreate the UI from MY screenshots — match their layout, labels, and order.
  Don't invent steps that aren't in the flow. If a screenshot is ambiguous, make
  a reasonable choice and keep moving.

## Self-check before delivering (do these, don't skip)
1. Count distinct screens in the flow → that's your stage count. Steps sharing
   a screen share a stage and chain with `fresh=false`.
2. Confirm the modal/overlay bottom edge + primary button fit inside the design
   height with clearance; confirm dropdowns use fixed-height + opacity/transform.
3. Confirm cursor coordinates divide by the live scale factor.
4. Confirm seeking to each step reconstructs its correct starting state.
5. If you can render headlessly, screenshot frames just before/after each step
   boundary — they must differ only in caption + step counter.

Output the finished HTML file. Keep your explanation short.
