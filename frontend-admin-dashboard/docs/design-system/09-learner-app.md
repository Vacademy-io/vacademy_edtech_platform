# 09 — Learner App Token Contract

`frontend-learner-dashboard-app` shares the same **base** system as admin (same Open Sans, same
`primary`/`danger`/`warning`/`success`/`info` semantics, same `react-hook-form`/`MyTable` patterns,
same governance rules) **plus** the extras below. These extras are valid **only** in the learner app.

> The `ui-design-guardian` agent is app-aware: it allows the tokens below in
> `frontend-learner-dashboard-app/**` and flags them as violations in `frontend-admin-dashboard/**`.

## Learner-only tokens

**Color**
- `primary-50…500` (no `600` — don't use `primary-600` in learner).
- `secondary-50…500` and `tertiary-50…500` (tertiary is a neutral support scale; admin has neither
  as full scales).
- Extra text/surface tokens: `--text-primary/secondary/muted`, `--surface`, `--surface-muted`.

**Typography**
- Font weights **300–700** available (admin only 400/500). Headings use 600 (`h1`/`h2` weight 600,
  `h3` weight 500) per the learner config. Still no arbitrary font sizes — use the `h1…caption` tokens.

**Radius**
- Adds `rounded-xl` and `rounded-2xl` on top of `sm/md/lg`.
- The whole family (including bare `rounded` and `rounded-3xl`) derives from the single `--radius`
  seed, which the corners axis below moves. `rounded-full` is deliberately exempt — avatars, pills
  and badges stay circular at every setting. Don't reintroduce a literal radius.

**Breakpoints**
- Adds `xs` (350px) and `md-tablets` (769px) in addition to the Tailwind defaults. Use them for
  fine-grained mobile/tablet handling. Don't use them in admin.

**Spacing / z-index (catalogue system)** — `src/styles/catalogue-tokens.css`
- `--space-0 … --space-24` scale, sizing tokens, a documented **z-index scale**
  (`--catalogue-z-dropdown:10 … --catalogue-z-tooltip:70`), and transition tokens
  (`--catalogue-transition-fast/base/slow`). Prefer these within catalogue/course-card surfaces.

## Themes (learner only)

**Catalogue themes** — `src/styles/catalogue-themes.css`, applied via `data-catalogue-theme`:
`default, ocean, forest, sunset, midnight, rose, violet, amber, slate`. Each overrides the primary
scale + foreground. Also `data-catalogue-radius` = `sharp | rounded | pill`.

- Build catalogue UI against the **primary tokens** so it themes automatically. Don't hardcode a
  theme's color — let the active theme drive it.

**Play theme (gamified)** — `src/styles/play-theme.css`: `--play-gold/fire/green/purple/blue/pink/dark`,
`--play-radius-card/btn/badge`, and animations (`wiggle`, `bounce-in`, `xp-pop`, …).

- Use `play-*` tokens **only** inside the gamified ("Play") experience. Don't leak them into standard
  learner screens, and never into admin.

## What's intentional vs. drift

| Difference | Status |
|---|---|
| `tertiary`, catalogue themes, play-theme | **Intentional** — learner product needs them |
| Extra breakpoints (`xs`, `md-tablets`) | **Intentional** |
| Primary `600` missing in learner | Minor drift — converge later |
| Font-weight range (300–700 vs 400/500) | Minor drift — acceptable, learner needs lighter/bolder |
| Radius offset differences (`md = --radius` vs `--radius − 2px`) | Drift — converge later |
| Presentation axes (`data-ui-*`) | **Intentional** — learner-only; admin chrome must not ride them |
| Hardcoded pastel palette (`#afd9e8`, …) | **Debt** — promote to tokens ([08-modernization.md](./08-modernization.md)) |

Convergence work is tracked in [08-modernization.md](./08-modernization.md) (P4). Until then: in the
learner app, use the extras above freely; everywhere, the [governance rules](./06-governance.md)
(no raw hex, no arbitrary values, reuse components, one icon library) still apply.

---

## Institute presentation axes (learner only)

Three institute-controllable axes, set in the admin under **Settings → Appearance** and stored in
`THEME_SETTING.roles`. They are applied as `data-ui-*` attributes on `<html>` by
`applyInstituteUiAxes()` (`src/utils/institute-theme-roles.ts`); the token flips live in
`src/styles/ui-axes.css`.

| Axis | Attribute | Values (default **bold**) | Moves |
|---|---|---|---|
| Corners | `data-ui-corners` | `sharp`, **`rounded`**, `pill` | `--radius` seed |
| Density | `data-ui-density` | `compact`, **`default`**, `comfortable` | `--ui-pad-card`, `--ui-pad-card-lg`, `--ui-pad-page`, `--ui-gap-stack`, `--ui-gap-section`, `--ui-control-h` |
| Surface | `data-ui-gradient` | `flat`, `subtle`, **`full`** | `--ui-gradient-from` / `--ui-gradient-to` |

**Every default reproduces the app's current look exactly.** An institute that never opens the
Appearance tab must see no change — treat that as a hard invariant when adding an axis value.

### Writing axis-aware UI

- **Spacing:** prefer `p-card` / `p-card-lg` / `p-page` / `gap-stack` / `gap-section` / `h-control`
  over the literals they replace (`p-4`, `p-6`, `p-4`, `gap-3`, `gap-6`, `h-9`). They are exact
  equivalents at the default density, so swapping one in is never a visual change on its own.
- **Do not** tokenize every spacing utility. Leaf-level `gap-2` between an icon and its label is not
  density — it is layout. The axis is wired at the shared primitives (card, button, input, dialog,
  modern-card) and page shells, which is where the perceived density actually lives.
- **Gradients:** use `.bg-app-gradient` / `.bg-app-gradient-x` for brand surface gradients. These
  follow both the institute's brand color and the surface axis. A hand-written
  `bg-gradient-to-br from-blue-50 to-white` does neither.
  The surface axis deliberately does **not** globally strip `bg-gradient-*`: roughly three quarters
  of the app's gradient stops are fixed Tailwind palette families rather than brand tokens, and many
  carry white text, so blanket removal would strand white-on-white. Collapsing the two stops of an
  opted-in brand gradient cannot break legibility; that is why the axis is opt-in by utility.

### Deliberately off the axes

- `rounded-full` — avatars, pills, badges.
- `--play-radius-badge` — same reasoning inside the Play skin.
- `.vsr` (`src/components/common/my-reports/report-card.css`) — the printed-report stylesheet, which
  declares its own `--radius: 14px` and must keep matching the generated PDF.
- The **admin dashboard's own chrome**. The admin writes these settings; it never renders with them.

### Skin

Five skins, applied as a class on `<html>`:

| Skin | Class | Character |
|---|---|---|
| `default` | *(none)* | neutral product UI |
| `vibrant` | `.ui-vibrant` | pastel, friendly accents |
| `play` | `.ui-play` | gamified, bold, 3D press, 20px radii |
| `cleanerPlay` | `.ui-cleaner-play` | warm felted-clay, illustrated, generous |
| `corporate` | `.ui-corporate` | modern B2B product UI — layered off-white canvas, raised white surfaces, 10px geometry, soft shadows |

**Canvas vs surface.** `--canvas` is the page behind cards (painted only by `body` and the shell's
`SidebarInset`); it defaults to `--background`. A skin that wants a tinted page must set `--canvas`,
never `--background` — ~100 `bg-background` usages across 12 shared primitives (dialogs, sheets,
toasts, active tabs, switch thumbs, outline buttons) mean "white surface" and would all go grey. An
institute's page-background role writes both inline, so it still beats any skin's canvas tint.

**Skin vs axes.** A skin's token values are DEFAULTS; an explicitly-chosen axis
overrides them. `applyInstituteUiAxes()` writes a `data-ui-*` attribute only when
the institute actually picked that axis, and `styles/ui-axes.css` is imported
after the skin stylesheets — both selectors are specificity (0,1,1), so the axis
wins on the tie. A skin proposes, an explicit choice decides. When adding a skin,
put its stylesheet's `@import` BEFORE `ui-axes.css` or it will stomp institute
settings.

Adding a skin touches 13 places: the two type unions in each app, the
`resolveUiSkin` allowlist, the class add/remove lists and DEBUG override
allowlists in `__root.tsx` and `services/student-display-settings.ts`, the admin
`SKIN_OPTIONS`, and i18n for four locales. The add and remove lists must stay
symmetric or switching away from the skin leaves its class stuck on `<html>`.

`THEME_SETTING.roles.skin` replaces the old
`STUDENT_DISPLAY_SETTINGS.ui.type`. Always read it through `resolveUiSkin()`, which falls back to the
legacy field — there was no data migration, so institutes configured before the move still hold their
skin only in the old location.
