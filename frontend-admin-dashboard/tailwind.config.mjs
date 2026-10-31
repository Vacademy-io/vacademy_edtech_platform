const flowbiteReact = require("flowbite-react/plugin/tailwindcss");

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    // Catalogue type-scale utilities live in catalogue-tokens.css @layer
    // utilities (byte-synced with the learner app); safelist so the canvas
    // emits them even when no admin source file references the literals.
    safelist: ['catalogue-display', 'catalogue-h1', 'catalogue-h2', 'catalogue-h3', 'catalogue-lead', 'catalogue-card-glass', 'catalogue-card-gradient-border', 'catalogue-card-tinted', 'catalogue-text-gradient', 'catalogue-eyebrow', 'catalogue-marquee-nopause', 'catalogue-carousel-bleed', 'catalogue-no-scrollbar', 'catalogue-hairline-grid', 'catalogue-block-anchor', 'catalogue-measure-start'],
    content: [
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
        ".flowbite-react/class-list.json",
        ".flowbite-react\\class-list.json"
    ],
    prefix: '',
    theme: {
        container: {
            center: true,
            padding: '2rem',
            screens: {
                '2xl': '1400px',
            },
        },
        extend: {
            zIndex: {
                'popover-above-modal': '1200',
                // For popovers/menus inside the few dialogs that stack at 10000
                // (edit course, image cropper). The 1200 tier is not enough there.
                'popover-above-top-modal': '10001',
            },
            height: {
                // AI intake chat surface inside the create-page dialog — a
                // named token because the design system bans arbitrary values.
                'dialog-chat': 'min(65vh, 42rem)',
                // Sandboxed live previews of the public audience form. Named for
                // the same reason: the inline one sits beside the controls, the
                // dialog one is the "show me properly" view.
                'preview-inline': '22rem',
                'preview-dialog': 'min(72vh, 44rem)',
                // Full-height document dialogs (the answer-sheet viewer): a
                // fixed height, not just a cap, so the PDF viewer inside has
                // something to fill. Mirrors maxHeight.dialog-tall.
                'dialog-tall': 'min(88vh, 56rem)',
            },
            maxHeight: {
                // Tall dialogs that scroll their own body (section-variant
                // previews). Named for the same reason as dialog-chat above.
                'dialog-tall': 'min(88vh, 56rem)',
                // A file / row list inside a dialog: scrolls itself so a
                // 200-file upload never pushes the dialog's buttons off-screen.
                'list-md': '16rem',
            },
            width: {
                // DialogContent's base class is `w-[400px] max-w-[90vw]` — a
                // FIXED width. Passing max-w-* therefore does nothing: it raises
                // a ceiling the dialog never reaches. These override the width
                // itself (tailwind-merge replaces w-[400px]) and fold the
                // small-screen guard into the same min(), so no second class is
                // needed and nothing is left as an arbitrary value.
                'dialog-md': 'min(92vw, 42rem)',
                'dialog-lg': 'min(92vw, 48rem)',
                'dialog-xl': 'min(94vw, 64rem)',
                // The internal sidebar shell: the desktop panel and the drawer
                // it becomes on mobile. Named because several places (the
                // slides footer bar among them) have to match the panel exactly
                // — guessing the width is what made that footer misalign.
                'internal-sidebar': '307px',
                'internal-sidebar-drawer': '280px',
            },
            minWidth: {
                // Floors for the slide-type dialogs in the slides sidebar. These
                // are minimums, unlike the width.dialog-* tokens above which are
                // viewport-capped fixed widths — hence the separate names.
                'slide-dialog-sm': '25rem',
                'slide-dialog-md': '31.25rem',
                'slide-dialog-lg': '32.5rem',
                // A data table inside an overflow-x-auto wrapper: below this it
                // scrolls sideways instead of crushing its columns on a phone.
                'table-sm': '40rem',
            },
            minHeight: {
                // Floor for the multi-step send/compose dialogs, whose steps
                // differ wildly in height. Without it the panel is only as tall
                // as a closed template picker, so opening the list or moving to
                // the message preview makes the whole dialog jump. Always below
                // maxHeight.dialog-tall, at every viewport.
                'dialog-md': 'min(80vh, 40rem)',
            },
            fontFamily: {
                sans: ['Open Sans', 'sans-serif'],
                // Institute-configured font: index.tsx sets `--app-font-family` on
                // :root from the institute's fontFamily, falling back to the system
                // default. Use `font-app` on portaled surfaces (profile overlay,
                // side view) so they follow the institute font even though they
                // render outside the main app tree.
                app: ['var(--app-font-family, "Open Sans", sans-serif)'],
            },
            fontSize: {
                h1: [
                    '30px',
                    {
                        lineHeight: '38px',
                        fontWeight: '400',
                    },
                ],
                h2: [
                    '24px',
                    {
                        lineHeight: '32px',
                        fontWeight: '400',
                    },
                ],
                h3: [
                    '20px',
                    {
                        lineHeight: '28px',
                        fontWeight: '400',
                    },
                ],
                title: [
                    '18px',
                    {
                        lineHeight: '26px',
                        fontWeight: '400',
                    },
                ],
                subtitle: [
                    '16px',
                    {
                        lineHeight: '24px',
                        fontWeight: '400',
                    },
                ],
                body: [
                    '14px',
                    {
                        lineHeight: '22px',
                        fontWeight: '400',
                    },
                ],
                caption: [
                    '12px',
                    {
                        lineHeight: '18px',
                        fontWeight: '400',
                    },
                ],
                '2xs': [
                    '11px',
                    {
                        lineHeight: '14px',
                        fontWeight: '400',
                    },
                ],
                'h1-semibold': [
                    '30px',
                    {
                        lineHeight: '38px',
                        fontWeight: '500',
                    },
                ],
                'h2-semibold': [
                    '24px',
                    {
                        lineHeight: '32px',
                        fontWeight: '500',
                    },
                ],
                'h3-semibold': [
                    '20px',
                    {
                        lineHeight: '28px',
                        fontWeight: '500',
                    },
                ],
            },
            fontWeight: {
                regular: '400',
                semibold: '500',
            },
            colors: {
        catalogue: {
          "text-primary": "hsl(var(--catalogue-text-primary))",
          "text-secondary": "hsl(var(--catalogue-text-secondary))",
          "text-muted": "hsl(var(--catalogue-text-muted))",
          bg: "hsl(var(--catalogue-bg))",
          // Raised surface (cards, canvas, dialogs) — sits above --catalogue-bg.
          // Mirrors the learner config; the CSS vars already exist in
          // catalogue-tokens.css for both light and dark.
          "bg-elevated": "hsl(var(--catalogue-bg-elevated))",
          "bg-subtle": "hsl(var(--catalogue-bg-subtle))",
          "bg-muted": "hsl(var(--catalogue-bg-muted))",
          "interactive-hover": "hsl(var(--catalogue-interactive-hover))",
          border: "hsl(var(--catalogue-border))",
          "border-subtle": "hsl(var(--catalogue-border-subtle))",
          "border-strong": "hsl(var(--catalogue-border-strong))",
          "brand-ink": "hsl(var(--catalogue-brand-ink))",
        },
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                sidebar: {
                    background: `hsl(var(--sidebar-background))`,
                },
                primary: {
                    50: 'hsl(var(--primary-50))',
                    100: 'hsl(var(--primary-100))',
                    200: 'hsl(var(--primary-200))',
                    300: 'hsl(var(--primary-300))',
                    400: 'hsl(var(--primary-400))',
                    500: 'hsl(var(--primary-500))',
                    600: 'hsl(var(--primary-600))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                nav: {
                    surface: 'hsl(var(--nav-surface))',
                    'surface-hover': 'hsl(var(--nav-surface-hover))',
                    active: 'hsl(var(--nav-active))',
                    'active-text': 'hsl(var(--nav-active-text))',
                    text: 'hsl(var(--nav-text))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))',
                },
                warning: {
                    50: 'hsl(var(--warning-50))',
                    100: 'hsl(var(--warning-100))',
                    200: 'hsl(var(--warning-200))',
                    300: 'hsl(var(--warning-300))',
                    400: 'hsl(var(--warning-400))',
                    500: 'hsl(var(--warning-500))',
                    600: 'hsl(var(--warning-600))',
                    700: 'hsl(var(--warning-700))',
                },
                success: {
                    50: 'hsl(var(--success-50))',
                    100: 'hsl(var(--success-100))',
                    200: 'hsl(var(--success-200))',
                    300: 'hsl(var(--success-300))',
                    400: 'hsl(var(--success-400))',
                    500: 'hsl(var(--success-500))',
                    600: 'hsl(var(--success-600))',
                    700: 'hsl(var(--success-700))',
                },
                info: {
                    50: 'hsl(var(--info-50))',
                    100: 'hsl(var(--info-100))',
                    200: 'hsl(var(--info-200))',
                    300: 'hsl(var(--info-300))',
                    400: 'hsl(var(--info-400))',
                    500: 'hsl(var(--info-500))',
                    600: 'hsl(var(--info-600))',
                    700: 'hsl(var(--info-700))',
                },
                danger: {
                    50: 'hsl(var(--danger-50))',
                    100: 'hsl(var(--danger-100))',
                    200: 'hsl(var(--danger-200))',
                    300: 'hsl(var(--danger-300))',
                    400: 'hsl(var(--danger-400))',
                    500: 'hsl(var(--danger-500))',
                    600: 'hsl(var(--danger-600))',
                    700: 'hsl(var(--danger-700))',
                },
            },
            // Catalogue design tokens — MUST mirror the learner app's group
            // (frontend-learner-dashboard-app/tailwind.config.js). Without these the
            // editor canvas silently drops every text-catalogue-*/bg-catalogue-* class.
            // Tailwind configs are hand-mirrored, NOT byte-synced.

            borderRadius: {
        "catalogue-xs": "var(--catalogue-radius-xs)",
        "catalogue-sm": "var(--catalogue-radius-sm)",
        "catalogue-md": "var(--catalogue-radius-md)",
        "catalogue-lg": "var(--catalogue-radius-lg)",
        "catalogue-xl": "var(--catalogue-radius-xl)",
        "catalogue-2xl": "var(--catalogue-radius-2xl)",
        "catalogue-full": "var(--catalogue-radius-full)",
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
            },
            keyframes: {
                'accordion-down': {
                    from: {
                        height: '0',
                    },
                    to: {
                        height: 'var(--radix-accordion-content-height)',
                    },
                },
                'accordion-up': {
                    from: {
                        height: 'var(--radix-accordion-content-height)',
                    },
                    to: {
                        height: '0',
                    },
                },
                'border-beam': {
                    '100%': {
                        'offset-distance': '100%',
                    },
                },
                'shimmer-slide': {
                    to: {
                        transform: 'translate(calc(100cqw - 100%), 0)',
                    },
                },
                'spin-around': {
                    '0%': {
                        transform: 'translateZ(0) rotate(0)',
                    },
                    '15%, 35%': {
                        transform: 'translateZ(0) rotate(90deg)',
                    },
                    '65%, 85%': {
                        transform: 'translateZ(0) rotate(270deg)',
                    },
                    '100%': {
                        transform: 'translateZ(0) rotate(360deg)',
                    },
                },
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
                'border-beam': 'border-beam calc(var(--duration)*1s) infinite linear',
                'shimmer-slide': 'shimmer-slide var(--speed) ease-in-out infinite alternate',
                'spin-around': 'spin-around calc(var(--speed) * 2) infinite linear',
            },
        },
    },
    plugins: [require('tailwindcss-animate'), flowbiteReact],
};