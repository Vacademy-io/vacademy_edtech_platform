/** @type {import('tailwindcss').Config} */
// Reusable viewport-fraction scales (shared across height/maxHeight/minHeight and width/maxWidth).
const VH = {
  "screen-28": "28vh", "screen-35": "35vh", "screen-40": "40vh", "screen-50": "50vh",
  "screen-60": "60vh", "screen-65": "65vh", "screen-70": "70vh", "screen-80": "80vh", "screen-85": "85vh", "screen-90": "90vh",
};
const VW = {
  "vw-35": "35vw", "vw-50": "50vw", "vw-60": "60vw", "vw-70": "70vw", "vw-80": "80vw", "vw-86": "86vw",
  "vw-90": "90vw", "vw-95": "95vw", "vw-100": "100vw",
};
// Fixed-pixel container sizes that fall outside Tailwind's spacing scale (which tops out at w-96/384px).
// Shared across height/minHeight/maxHeight/width/minWidth/maxWidth. Round arbitrary px to the nearest reg-*.
const REG = {
  "reg-100": "100px", "reg-120": "120px", "reg-150": "150px", "reg-180": "180px", "reg-200": "200px",
  "reg-250": "250px", "reg-280": "280px", "reg-300": "300px", "reg-320": "320px", "reg-350": "350px",
  "reg-380": "380px", "reg-400": "400px", "reg-420": "420px", "reg-450": "450px", "reg-480": "480px",
  "reg-500": "500px", "reg-550": "550px", "reg-600": "600px",
};
module.exports = {
  darkMode: ["class"],
  // Catalogue type-scale utilities are defined in catalogue-tokens.css @layer
  // utilities; safelist them so Tailwind never purges classes referenced only
  // via tenant JSON customClass values or cross-app markup.
  safelist: ["catalogue-display", "catalogue-h1", "catalogue-h2", "catalogue-h3", "catalogue-lead", "catalogue-card-glass", "catalogue-card-gradient-border", "catalogue-card-tinted", "catalogue-text-gradient", "catalogue-eyebrow", "catalogue-marquee-nopause", "catalogue-carousel-bleed", "catalogue-no-scrollbar", "catalogue-hairline-grid", "catalogue-block-anchor", "catalogue-measure-start"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        xs: "350px",
        "md-tablets": "769px",
        "2xl": "1400px",
      },
    },
    extend: {
      screens: {
        xs: "350px",
        "md-tablets": "769px",
        "2xl": "1400px",
      },
      fontFamily: {
        // `font-sans` reads the runtime CSS var so the white-label override
        // (index.html TabBranding -> --app-font-family) flows through Tailwind.
        // Default resolves to Plus Jakarta Sans (set in src/index.css :root).
        sans: [
          "var(--app-font-family, 'Plus Jakarta Sans')",
          "Plus Jakarta Sans",
          "Open Sans",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        h1: [
          "30px",
          {
            lineHeight: "38px",
            fontWeight: "600",
          },
        ],
        h2: [
          "24px",
          {
            lineHeight: "32px",
            fontWeight: "600",
          },
        ],
        h3: [
          "20px",
          {
            lineHeight: "28px",
            fontWeight: "500",
          },
        ],
        title: [
          "18px",
          {
            lineHeight: "26px",
            fontWeight: "500",
          },
        ],
        subtitle: [
          "16px",
          {
            lineHeight: "24px",
            fontWeight: "400",
          },
        ],
        body: [
          "14px",
          {
            lineHeight: "22px",
            fontWeight: "400",
          },
        ],
        caption: [
          "12px",
          {
            lineHeight: "18px",
            fontWeight: "400",
          },
        ],
        "h1-semibold": [
          "30px",
          {
            lineHeight: "38px",
            fontWeight: "500",
          },
        ],
        "h2-semibold": [
          "24px",
          {
            lineHeight: "32px",
            fontWeight: "500",
          },
        ],
        "h3-semibold": [
          "20px",
          {
            lineHeight: "28px",
            fontWeight: "500",
          },
        ],
        // Display tier — exactly ONE display-size element per screen (hero
        // number/title). Pair with `tabular-nums` for figures.
        display: ["40px", { lineHeight: "44px", fontWeight: "700" }],
        "display-sm": ["32px", { lineHeight: "38px", fontWeight: "700" }],
        // Micro text sizes below the caption (12px) floor — for dense badges/labels/metadata.
        "2xs": ["11px", { lineHeight: "16px" }],
        "3xs": ["10px", { lineHeight: "14px" }],
        // Play (gamified) micro badge label.
        "play-badge": ["8px", { lineHeight: "10px" }],
      },
      fontWeight: {
        light: "300",
        normal: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        // Page canvas (body + shell). Defaults to --background; see index.css.
        canvas: "hsl(var(--canvas))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary-500))",
          foreground: "hsl(var(--primary-foreground))",
          50: "hsl(var(--primary-50))",
          100: "hsl(var(--primary-100))",
          200: "hsl(var(--primary-200))",
          300: "hsl(var(--primary-300))",
          400: "hsl(var(--primary-400))",
          500: "hsl(var(--primary-500))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary-500))",
          50: "hsl(var(--secondary-50))",
          100: "hsl(var(--secondary-100))",
          200: "hsl(var(--secondary-200))",
          300: "hsl(var(--secondary-300))",
          400: "hsl(var(--secondary-400))",
          500: "hsl(var(--secondary-500))",
        },
        tertiary: {
          DEFAULT: "hsl(var(--tertiary-500))",
          50: "hsl(var(--tertiary-50))",
          100: "hsl(var(--tertiary-100))",
          200: "hsl(var(--tertiary-200))",
          300: "hsl(var(--tertiary-300))",
          400: "hsl(var(--tertiary-400))",
          500: "hsl(var(--tertiary-500))",
        },
        nav: {
          surface: "hsl(var(--nav-surface))",
          "surface-hover": "hsl(var(--nav-surface-hover))",
          active: "hsl(var(--nav-active))",
          "active-text": "hsl(var(--nav-active-text))",
          text: "hsl(var(--nav-text))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        warning: {
          50: "hsl(var(--warning-50))",
          100: "hsl(var(--warning-100))",
          200: "hsl(var(--warning-200))",
          300: "hsl(var(--warning-300))",
          400: "hsl(var(--warning-400))",
          500: "hsl(var(--warning-500))",
          600: "hsl(var(--warning-600))",
          700: "hsl(var(--warning-700))",
        },
        success: {
          50: "hsl(var(--success-50))",
          100: "hsl(var(--success-100))",
          200: "hsl(var(--success-200))",
          300: "hsl(var(--success-300))",
          400: "hsl(var(--success-400))",
          500: "hsl(var(--success-500))",
          600: "hsl(var(--success-600))",
          700: "hsl(var(--success-700))",
        },
        info: {
          50: "hsl(var(--info-50))",
          100: "hsl(var(--info-100))",
          200: "hsl(var(--info-200))",
          300: "hsl(var(--info-300))",
          400: "hsl(var(--info-400))",
          500: "hsl(var(--info-500))",
          600: "hsl(var(--info-600))",
          700: "hsl(var(--info-700))",
        },
        danger: {
          50: "hsl(var(--danger-50))",
          100: "hsl(var(--danger-100))",
          200: "hsl(var(--danger-200))",
          300: "hsl(var(--danger-300))",
          400: "hsl(var(--danger-400))",
          500: "hsl(var(--danger-500))",
          600: "hsl(var(--danger-600))",
          700: "hsl(var(--danger-700))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Catalogue design tokens (HSL channel vars in catalogue-tokens.css), exposed as utilities.
        catalogue: {
          "text-primary": "hsl(var(--catalogue-text-primary))",
          "text-secondary": "hsl(var(--catalogue-text-secondary))",
          "text-muted": "hsl(var(--catalogue-text-muted))",
          bg: "hsl(var(--catalogue-bg))",
          // Raised surface (cards, header, dialogs) — sits above --catalogue-bg.
          // The CSS var always existed but was never exposed here, so
          // `bg-catalogue-bg-elevated` silently produced no class at all.
          "bg-elevated": "hsl(var(--catalogue-bg-elevated))",
          "bg-subtle": "hsl(var(--catalogue-bg-subtle))",
          "bg-muted": "hsl(var(--catalogue-bg-muted))",
          "interactive-hover": "hsl(var(--catalogue-interactive-hover))",
          border: "hsl(var(--catalogue-border))",
          "border-subtle": "hsl(var(--catalogue-border-subtle))",
          "border-strong": "hsl(var(--catalogue-border-strong))",
          // Brand-colored TEXT (primary-500 is tuned as a fill and fails AA
          // as ink on white for most presets).
          "brand-ink": "hsl(var(--catalogue-brand-ink))",
        },
        // Opt-in site palette (globalSettings.theme.palette → --palette-* channel
        // vars on the page wrapper, see $tagName/-utils/catalogue-palette.ts).
        // A site without a palette falls back to the catalogue token named
        // second, so these classes are safe on any site.
        palette: {
          text: "hsl(var(--palette-text, var(--catalogue-text-primary)) / <alpha-value>)",
          body: "hsl(var(--palette-body, var(--catalogue-text-secondary)) / <alpha-value>)",
          muted: "hsl(var(--palette-muted, var(--catalogue-text-muted)) / <alpha-value>)",
          muted2: "hsl(var(--palette-muted2, var(--catalogue-text-muted)) / <alpha-value>)",
          primary: "hsl(var(--palette-primary, var(--primary-500)) / <alpha-value>)",
          gold: "hsl(var(--palette-gold, var(--primary-500)) / <alpha-value>)",
          accent: "hsl(var(--palette-accent, var(--primary-400)) / <alpha-value>)",
          olive: "hsl(var(--palette-olive, var(--primary-500)) / <alpha-value>)",
          cream: "hsl(var(--palette-cream, var(--catalogue-bg-subtle)) / <alpha-value>)",
          canvas: "hsl(var(--palette-canvas, var(--catalogue-bg)) / <alpha-value>)",
          sand: "hsl(var(--palette-sand, var(--catalogue-bg-muted)) / <alpha-value>)",
          border: "hsl(var(--palette-border, var(--catalogue-border)) / <alpha-value>)",
          "border-strong": "hsl(var(--palette-border-strong, var(--catalogue-border-strong)) / <alpha-value>)",
          // Feature "chrome": eyebrow and copy on dark bands, outlined buttons.
          "accent-on-dark": "hsl(var(--palette-accent-on-dark, var(--primary-200)) / <alpha-value>)",
          "body-on-dark": "hsl(var(--palette-body-on-dark, var(--catalogue-bg-muted)) / <alpha-value>)",
          outline: "hsl(var(--palette-outline, var(--catalogue-border-strong)) / <alpha-value>)",
        },
        // WhatsApp brand (contact CTA).
        whatsapp: "#25D366",
        "whatsapp-hover": "#20ba59",
        // Play (gamified) Duolingo palette — solid colors with a paired "deep" 3D shade.
        play: {
          success: "var(--play-c-success)",
          "success-deep": "var(--play-c-success-deep)",
          info: "var(--play-c-info)",
          "info-deep": "var(--play-c-info-deep)",
          danger: "var(--play-c-danger)",
          "danger-deep": "var(--play-c-danger-deep)",
          warn: "var(--play-c-warn)",
          "warn-deep": "var(--play-c-warn-deep)",
          accent: "var(--play-c-accent)",
          "accent-deep": "var(--play-c-accent-deep)",
          muted: "var(--play-c-muted)",
          "muted-deep": "var(--play-c-muted-deep)",
          surface: "var(--play-c-surface)",
          highlight: "var(--play-c-highlight)",
          gold: "var(--play-c-gold)",
          "gold-deep": "var(--play-c-gold-deep)",
          navy: "var(--play-c-navy)",
          "navy-deep": "var(--play-c-navy-deep)",
          // Pastel tint + ink pairs (Dashboard-only usage) — see play-theme.css.
          "success-soft": "var(--play-c-success-soft)",
          "success-soft-ink": "var(--play-c-success-soft-ink)",
          "info-soft": "var(--play-c-info-soft)",
          "info-soft-ink": "var(--play-c-info-soft-ink)",
          "danger-soft": "var(--play-c-danger-soft)",
          "danger-soft-ink": "var(--play-c-danger-soft-ink)",
          "warn-soft": "var(--play-c-warn-soft)",
          "warn-soft-ink": "var(--play-c-warn-soft-ink)",
          "accent-soft": "var(--play-c-accent-soft)",
          "accent-soft-ink": "var(--play-c-accent-soft-ink)",
          "gold-soft": "var(--play-c-gold-soft)",
          "gold-soft-ink": "var(--play-c-gold-soft-ink)",
          "navy-soft": "var(--play-c-navy-soft)",
          "navy-soft-ink": "var(--play-c-navy-soft-ink)",
          // rgb form so Tailwind alpha modifiers work (text-play-ink/80);
          // plain var() colors silently drop the /N modifier.
          ink: "rgb(60 60 60 / <alpha-value>)",
        },
        // Cleaner Play — warm cream/illustrated skin. Decorative-only;
        // brand actions still use primary-*, see cleaner-play-theme.css.
        cp: {
          bg: "hsl(var(--cp-bg))",
          "bg-deep": "hsl(var(--cp-bg-deep))",
          surface: "hsl(var(--cp-surface))",
          border: "hsl(var(--cp-border))",
          ink: "hsl(var(--cp-ink))",
          muted: "hsl(var(--cp-muted))",
          sage: "hsl(var(--cp-sage))",
          "sage-tint": "hsl(var(--cp-sage-tint))",
          terracotta: "hsl(var(--cp-terracotta))",
          "terracotta-tint": "hsl(var(--cp-terracotta-tint))",
          gold: "hsl(var(--cp-gold))",
          "gold-tint": "hsl(var(--cp-gold-tint))",
        },
      },
      // Named layout dimensions that can't use the spacing scale (viewport math, fixed art heights).
      height: {
        ...VH,
        ...REG,
        "catalog-hero": "430px",
        "filter-scroll": "calc(100vh - 300px)",
        "filter-scroll-lg": "min(600px, calc(100vh - 14rem))",
        "nav-offset": "calc(100vh - 64px)",
        "view-dialog": "calc(90vh - 120px)",
        "blob-lg": "500px",
        "blob-md": "400px",
        // Density axis. h-control == today's h-9 on inputs/buttons.
        control: "var(--ui-control-h)",
      },
      width: {
        ...VW,
        ...REG,
        "dialog-lg": "min(92vw, 720px)",
        "dialog-sm": "min(92vw, 360px)",
        "blob-lg": "500px",
        "blob-md": "400px",
        "blob-sm": "420px",
        "card-500": "500px",
        "col-600": "600px",
        "pct-95": "95%",
        "chat-panel": "32rem",
        "panel-sm": "350px",
        "calc-vw-1": "calc(100vw - 1rem)",
        "radix-popover": "var(--radix-popover-trigger-width)",
      },
      maxHeight: {
        ...VH,
        ...REG,
        "view-dialog": "calc(90vh - 120px)",
        "screen-minus-1": "calc(100vh - 1rem)",
        "preview-480": "480px",
        "pct-45": "45%",
        "pct-30": "30%",
      },
      maxWidth: {
        ...VW,
        ...REG,
        "ch-26": "26ch",
        "reg-430": "430px",
        "reg-560": "560px",
        "page": "950px",
        "pct-80": "80%",
        "pct-90": "90%",
        "pct-92": "92%",
        "pct-95": "95%",
      },
      minWidth: {
        ...REG,
        "table-wide": "800px",
      },
      zIndex: {
        "1": "1",
        "60": "60",
        "70": "70",
        "catalogue-dropdown": "var(--catalogue-z-dropdown)",
        "catalogue-fixed": "var(--catalogue-z-fixed)",
      },
      letterSpacing: {
        "wide-08": "0.08em",
        "wider-2": "0.2em",
      },
      minHeight: {
        ...VH,
        ...REG,
        "filter-scroll": "200px",
        "filter-scroll-lg": "240px",
        "parent-main": "calc(100vh - 8rem)",
        // Density axis, paired with height.control.
        control: "var(--ui-control-h)",
      },
      // Course-structure tree indents (icon + gap + icon + gap + margin).
      padding: {
        "struct-subject": "calc(18px + 0.5rem + 18px + 0.5rem + 1.5rem)",
        "struct-module": "calc(16px + 0.5rem + 16px + 0.5rem + 1.5rem)",
        "struct-base": "calc(18px + 0.5rem + 18px + 0.5rem)",
        "struct-chapter": "calc(16px + 0.5rem + 16px + 0.5rem + 1.5rem + 1.5rem)",
        // Clearance under the live test's docked tool panel (scientific
        // calculator is the tallest at ~470px) so the last option can always be
        // scrolled out from behind it.
        "tool-dock": "31rem",
        // Density axis (data-ui-density). p-card == today's p-4, p-card-lg ==
        // p-6, p-page == p-4, so swapping a primitive over is a no-op at the
        // default setting.
        card: "var(--ui-pad-card)",
        "card-lg": "var(--ui-pad-card-lg)",
        page: "var(--ui-pad-page)",
      },
      gap: {
        // Density axis. gap-stack == today's gap-3, gap-section == gap-6.
        stack: "var(--ui-gap-stack)",
        section: "var(--ui-gap-section)",
      },
      space: {
        stack: "var(--ui-gap-stack)",
        section: "var(--ui-gap-section)",
      },
      borderRadius: {
        // Catalogue radius bridge — honours data-catalogue-radius
        // (sharp/rounded/pill). Hard rounded-xl etc. ignore that setting.
        "catalogue-xs": "var(--catalogue-radius-xs)",
        "catalogue-sm": "var(--catalogue-radius-sm)",
        "catalogue-md": "var(--catalogue-radius-md)",
        "catalogue-lg": "var(--catalogue-radius-lg)",
        "catalogue-xl": "var(--catalogue-radius-xl)",
        "catalogue-2xl": "var(--catalogue-radius-2xl)",
        "catalogue-full": "var(--catalogue-radius-full)",
        // Scale per docs/design-system/01-foundations.md §4:
        //   sm = --radius - 4, md = --radius - 2, lg = --radius.
        // The learner config previously had sm = --radius - 2 and md = --radius,
        // which made rounded-md and rounded-lg BYTE-IDENTICAL (8px) across 1,494
        // usages — the distinction developers were reaching for did not exist.
        //
        // `rounded` (DEFAULT) was never declared at all, so it fell through to
        // Tailwind's stock 4px. Anchoring it to --radius - 4 keeps that exact 4px
        // at the default seed while putting those 323 usages on the corners axis.
        //
        // max(0px, ...) is load-bearing, not defensive: the corners axis sets
        // --radius to 2px on "sharp", where an unclamped calc() would evaluate
        // negative. A negative border-radius is invalid, so the whole
        // declaration would be dropped and the element would fall back to
        // whatever it inherited rather than to a square corner.
        sm: "max(0px, calc(var(--radius) - 4px))",
        DEFAULT: "max(0px, calc(var(--radius) - 4px))",
        md: "max(0px, calc(var(--radius) - 2px))",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 2px)",
        "2xl": "calc(var(--radius) + 4px)",
        "3xl": "calc(var(--radius) + 24px)",
        // Play (gamified) card + button radius tokens.
        "play-card": "var(--play-radius-card)",
        "play-card-sm": "var(--play-radius-card-sm)",
        "play-btn": "var(--play-radius-btn)",
      },
      // Tinted shadow scale (tokens defined in src/index.css :root). Upgrades every
      // existing shadow-* utility to a softer, surface-tinted elevation at once.
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        // shadow-2xl (27 usages) and shadow-inner (7) previously fell through
        // to stock Tailwind's pure-black rgb(0 0 0 / .25), the only two steps
        // in the scale not tinted to the app's cool slate. Same ink, one step
        // above --shadow-xl.
        "2xl": "var(--shadow-2xl)",
        inner: "var(--shadow-inner)",
        // Play (gamified) 3D press shadow; tracks the active theme via --primary-200.
        "play-press": "0 2px 0 hsl(var(--primary-200))",
        // Play badge inset 3D shadow.
        "play-badge": "0 2px 0 rgba(0,0,0,0.15)",
        // Play pastel-card lift (Dashboard-only "soft" surfaces) — a quiet,
        // near-flat elevation; definition comes mainly from the hairline
        // border, matching the cleaner reference look.
        "play-soft-card": "0 1px 2px rgba(60,60,60,0.04), 0 4px 12px -8px rgba(60,60,60,0.10)",
        // Play (gamified) 3D drop shadows keyed to the Duolingo deep shades.
        "play-2d-success": "0 2px 0 0 var(--play-c-success-deep)",
        "play-2d-danger": "0 2px 0 0 var(--play-c-danger-deep)",
        "play-2d-muted": "0 2px 0 0 var(--play-c-muted-deep)",
        "play-4d-success": "0 4px 0 0 var(--play-c-success-deep)",
        "play-4d-muted": "0 4px 0 0 var(--play-c-muted)",
        "play-4d-accent": "0 4px 0 0 var(--play-c-accent-deep)",
        "play-4d-surface": "0 4px 0 0 var(--play-c-surface)",
        "play-4d-info": "0 4px 0 0 var(--play-c-info-deep)",
        "play-4d-warn": "0 4px 0 0 var(--play-c-warn-deep)",
        // Catalogue play button "3D" press shadows (rest / hover / active depths).
        "play-3-primary": "0 3px 0 hsl(var(--primary-200))",
        "play-3-accent": "0 3px 0 var(--play-c-accent-deep)",
        "play-3-success": "0 3px 0 var(--play-c-success-deep)",
        "play-3-info": "0 3px 0 var(--play-c-info-deep)",
        "play-1-primary": "0 1px 0 hsl(var(--primary-400))",
        "play-4-primary": "0 4px 0 hsl(var(--primary-400))",
        "play-6-primary": "0 6px 0 hsl(var(--primary-400))",
        // Catalogue play glow shadows.
        "play-glow-success": "0 4px 14px rgba(70,163,2,0.55)",
        "play-glow-success-sm": "0 2px 8px rgba(70,163,2,0.4)",
        "play-glow-navy": "0 1px 2px rgba(26,61,109,0.25),0 16px 32px -12px rgba(35,83,144,0.45)",
        "play-glow-primary": "0 1px 2px hsl(var(--primary-300)/0.06),0 8px 24px -10px hsl(var(--primary-400)/0.14)",
        // Course-details play 3D shadows (navy / gold) + soft + colored glows.
        "play-3d-navy": "0 3px 0 var(--play-c-navy-deep)",
        "play-4d-navy": "0 4px 0 var(--play-c-navy-deep)",
        "play-2d-gold": "0 2px 0 var(--play-c-gold-deep)",
        "play-3d-gold": "0 3px 0 var(--play-c-gold-deep)",
        "play-4d-gold": "0 4px 0 var(--play-c-gold-deep)",
        "play-2d-warn": "0 2px 0 var(--play-c-warn-deep)",
        "play-2d-info": "0 2px 0 var(--play-c-info-deep)",
        "play-2d-accent": "0 2px 0 var(--play-c-accent-deep)",
        "play-2d-navy": "0 2px 0 var(--play-c-navy-deep)",
        "play-soft": "0 2px 8px rgba(0,0,0,0.12)",
        "play-glow-info": "0 1px 2px rgba(24,153,214,0.22),0 16px 32px -12px rgba(28,176,246,0.45)",
        "play-glow-success-lg": "0 1px 2px rgba(70,163,2,0.22),0 16px 32px -12px rgba(88,204,2,0.45)",
        // Sticky bottom-bar upward elevation.
        "top-bar": "0 -4px 24px rgba(0,0,0,0.08)",
        // Catalogue live-indicator glows.
        "glow-live-green": "0 0 8px rgba(34,197,94,0.6)",
        "glow-live-orange": "0 0 8px rgba(249,115,22,0.6)",
        "card-inset": "inset 0 0 0 1px rgba(180,140,80,0.15), inset 0 2px 8px rgba(180,140,80,0.08)",
      },
      transitionTimingFunction: {
        "out-soft": "var(--ease-out-soft)",
        "in-out-soft": "var(--ease-in-out-soft)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "fade-in-up": {
          from: {
            opacity: "0",
            transform: "translateY(20px)",
          },
          to: {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "gentle-pulse": {
          "0%, 100%": {
            opacity: "0.3",
          },
          "50%": {
            opacity: "0.6",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in-up": "fade-in-up 0.6s ease-out",
        "gentle-pulse": "gentle-pulse 4s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
