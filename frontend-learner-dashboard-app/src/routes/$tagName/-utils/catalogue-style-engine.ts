/**
 * CATALOGUE STYLE ENGINE — canonical, shared by BOTH apps.
 * =========================================================
 * Byte-identical copies live at:
 *   learner: frontend-learner-dashboard-app/src/routes/$tagName/-utils/catalogue-style-engine.ts
 *   admin:   frontend-admin-dashboard/src/routes/manage-pages/-utils/style-engine.ts
 *
 * Edit ONE copy, then run `node scripts/check-style-engine-sync.mjs --fix`
 * (repo root) to propagate; CI/lint runs the same script without --fix and
 * fails on drift. Do NOT let the copies diverge — that is exactly the bug
 * class this file exists to kill (the previous style-utils copies drifted:
 * visibility-only CSS was silently dropped in the admin copy).
 *
 * Converts ComponentStyle JSON (authored in the admin page-builder) into
 * React.CSSProperties / CSS strings for the learner renderer AND the admin
 * canvas, so what admins see is what learners get.
 */

import type { OrnamentConfig, SectionDividers } from './catalogue-decorations';

export interface GradientStop {
    color: string;
    position: number;
}

export interface GradientConfig {
    type: 'linear' | 'radial';
    angle?: number;
    stops: GradientStop[];
}

export interface TypographyStyle {
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: string;
    lineHeight?: string;
    letterSpacing?: string;
    textColor?: string;
    textAlign?: 'left' | 'center' | 'right';
    textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface AnimationEntrance {
    type: string;
    duration?: number;
    delay?: number;
    easing?: string;
    /** Cascade the entrance across child items (elements marked
     *  data-stagger-item by the section renderer). interval = ms between
     *  items; maxItems caps the total delay ramp (default 8). */
    stagger?: {
        interval: number;
        maxItems?: number;
    };
}

export interface AnimationConfig {
    entrance?: AnimationEntrance;
    hover?: { type: string };
    scroll?: { parallax?: boolean; parallaxSpeed?: number };
}

/** Glassmorphism: backdrop blur + translucent token surface/border. */
export interface GlassConfig {
    blur: 'sm' | 'md' | 'lg';
    /** 0–1 border translucency (default 0.6). */
    borderOpacity?: number;
}

/** Soft colored glow shadow, keyed to the active primary by default. */
export interface GlowConfig {
    intensity: 'sm' | 'md' | 'lg';
    /** Any CSS color; defaults to the primary-keyed glow token. */
    color?: string;
}

/** Gradient border via the padding-box/border-box double-background trick
 *  (single node — but it OWNS the background: it overrides backgroundLayers/
 *  gradient/backgroundImage on the same component). */
export interface BorderGradientConfig {
    from: string;
    to: string;
    angle?: number;
    /** Border thickness (default "1px"). */
    width?: string;
}

/** One layer of a composed background (top-first, comma-joined). */
export interface BackgroundLayer {
    type: 'linear' | 'radial' | 'image' | 'color';
    /** linear: start/end colors. */
    from?: string;
    to?: string;
    angle?: number;
    /** radial blob: color + position + size. */
    color?: string;
    posX?: string;
    posY?: string;
    size?: string;
    /** image layer. */
    url?: string;
}

/** Legible-text-over-image presets, composited above backgroundImage. */
export type OverlayPreset = 'scrim-dark' | 'scrim-bottom' | 'scrim-light' | 'brand-tint';

/** Content-column width presets for the section shell. */
export type SectionWidth = 'text' | 'narrow' | 'default' | 'wide' | 'full';

/**
 * Section Shell — opt-in two-node rendering: a full-width background canvas
 * with a centered, width-constrained content column inside it. Enables
 * full-bleed atmosphere (mesh/gradient/image backgrounds) behind readable
 * contained content, plus section overlap and stacking control.
 * Absent field ⇒ legacy single-node rendering, byte-identical to before.
 */
export interface SectionLayoutStyle {
    /** Content column width preset (canvas is always full-width). */
    width?: SectionWidth;
    /** Custom max-width overriding the preset (e.g. "820px"). */
    contentMaxWidth?: string;
    /** Stack order of the section canvas (for overlaps). */
    zIndex?: number;
    /** Pull the section up over the previous one (e.g. "-80px"). */
    overlapTop?: string;
}

export interface ComponentStyle {
    // Spacing
    paddingTop?: string;
    paddingBottom?: string;
    paddingLeft?: string;
    paddingRight?: string;
    marginTop?: string;
    marginBottom?: string;
    // Background
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundSize?: 'cover' | 'contain' | 'auto';
    backgroundPosition?: string;
    backgroundOverlay?: string;
    gradient?: GradientConfig;
    // Border
    borderWidth?: string;
    borderColor?: string;
    borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
    borderRadius?: string;
    // Shadow & Effects
    boxShadow?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | (string & {});
    opacity?: number;
    maxWidth?: string;
    minHeight?: string;
    customClass?: string;
    // Premium surface effects (all optional/additive)
    glass?: GlassConfig;
    glow?: GlowConfig;
    borderGradient?: BorderGradientConfig;
    backgroundLayers?: BackgroundLayer[];
    overlayPreset?: OverlayPreset;
    // Decorations — ambient shapes + shaped section edges, rendered by the
    // wrappers via catalogue-decorations (never compiled into CSS here)
    ornaments?: OrnamentConfig[];
    dividers?: SectionDividers;
    // Position — sticky rails (enroll cards in column slots) and vertical
    // content alignment inside an authored minHeight
    sticky?: { enabled: boolean; top?: number };
    contentAlign?: 'start' | 'center' | 'end';
    // Section shell (see SectionLayoutStyle)
    layout?: SectionLayoutStyle;
    // Typography
    typography?: TypographyStyle;
    // Animation
    animation?: AnimationConfig;
    // Responsive overrides
    responsive?: {
        tablet?: Partial<ComponentStyle>;
        mobile?: Partial<ComponentStyle>;
    };
    visibility?: {
        desktop?: boolean;
        tablet?: boolean;
        mobile?: boolean;
    };
}

const SHADOW_MAP: Record<string, string> = {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0,0,0,0.05)',
    md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
    lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
    xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
    '2xl': '0 25px 50px -12px rgba(0,0,0,0.25)',
};

/** Max-width per SectionWidth preset ('full' has no constraint). */
const SECTION_WIDTH_MAP: Record<Exclude<SectionWidth, 'full'>, string> = {
    text: '65ch',
    narrow: 'var(--catalogue-container-md)',
    default: 'var(--catalogue-container-xl)',
    wide: 'var(--catalogue-container-2xl)',
};

const GLASS_BLUR_MAP: Record<GlassConfig['blur'], string> = {
    sm: '8px',
    md: '16px',
    lg: '24px',
};

const GLOW_MAP: Record<GlowConfig['intensity'], (color: string) => string> = {
    sm: (c) => `0 0 24px -8px ${c}`,
    md: (c) => `0 8px 40px -8px ${c}`,
    lg: (c) => `0 12px 64px -10px ${c}`,
};

const DEFAULT_GLOW_COLOR = 'hsl(var(--primary-400) / 0.35)';

/** Scrim/tint gradients composited ABOVE a background image for legible text. */
const OVERLAY_PRESET_MAP: Record<OverlayPreset, string> = {
    'scrim-dark': 'linear-gradient(rgba(2, 6, 23, 0.55), rgba(2, 6, 23, 0.55))',
    'scrim-bottom': 'linear-gradient(180deg, rgba(2, 6, 23, 0) 30%, rgba(2, 6, 23, 0.72))',
    'scrim-light': 'linear-gradient(rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.6))',
    'brand-tint': 'linear-gradient(hsl(var(--primary-500) / 0.4), hsl(var(--primary-500) / 0.4))',
};

/** Compiles one BackgroundLayer to a CSS background-image entry. */
function layerToCss(layer: BackgroundLayer): string | null {
    switch (layer.type) {
        case 'linear':
            if (!layer.from || !layer.to) return null;
            return `linear-gradient(${layer.angle ?? 180}deg, ${layer.from}, ${layer.to})`;
        case 'radial': {
            if (!layer.color) return null;
            // A lone percentage is NOT a valid radial-gradient <size> (the
            // single-value form only allows lengths) — normalize to the
            // two-value ellipse form so blobs actually paint.
            const raw = (layer.size ?? '50%').trim();
            const size = raw.includes(' ') ? raw : `${raw} ${raw}`;
            return `radial-gradient(${size} at ${layer.posX ?? '50%'} ${layer.posY ?? '50%'}, ${layer.color}, transparent 70%)`;
        }
        case 'image':
            return layer.url ? `url(${layer.url})` : null;
        case 'color':
            // Solid color as a gradient layer so it can participate in the stack.
            return layer.color ? `linear-gradient(${layer.color}, ${layer.color})` : null;
        default:
            return null;
    }
}

export function buildComponentStyle(style?: ComponentStyle): React.CSSProperties {
    if (!style) return {};

    const css: React.CSSProperties = {};

    // Spacing
    if (style.paddingTop) css.paddingTop = style.paddingTop;
    if (style.paddingBottom) css.paddingBottom = style.paddingBottom;
    if (style.paddingLeft) css.paddingLeft = style.paddingLeft;
    if (style.paddingRight) css.paddingRight = style.paddingRight;
    if (style.marginTop) css.marginTop = style.marginTop;
    if (style.marginBottom) css.marginBottom = style.marginBottom;

    // Background — precedence: backgroundLayers > gradient (legacy) >
    // backgroundImage (optionally under an overlayPreset scrim).
    if (style.backgroundColor) css.backgroundColor = style.backgroundColor;
    if (style.backgroundLayers?.length) {
        const imgs = style.backgroundLayers.map(layerToCss).filter(Boolean) as string[];
        if (imgs.length) {
            css.backgroundImage = imgs.join(', ');
            css.backgroundRepeat = 'no-repeat';
            css.backgroundSize = style.backgroundSize || 'cover';
            css.backgroundPosition = style.backgroundPosition || 'center center';
        }
    } else if (style.gradient && style.gradient.stops.length >= 2) {
        // Legacy single gradient (kept byte-compatible)
        const { type, angle, stops } = style.gradient;
        const stopsStr = stops.map((s) => `${s.color} ${s.position}%`).join(', ');
        css.backgroundImage =
            type === 'linear'
                ? `linear-gradient(${angle ?? 180}deg, ${stopsStr})`
                : `radial-gradient(circle, ${stopsStr})`;
    } else if (style.backgroundImage && !style.gradient) {
        // `!style.gradient` preserves legacy behavior byte-for-byte: a config
        // carrying ANY gradient object (even a degenerate one with <2 stops)
        // plus an image painted nothing before this engine existed.
        const image = `url(${style.backgroundImage})`;
        const scrim = style.overlayPreset ? OVERLAY_PRESET_MAP[style.overlayPreset] : undefined;
        css.backgroundImage = scrim ? `${scrim}, ${image}` : image;
        css.backgroundSize = style.backgroundSize || 'cover';
        css.backgroundPosition = style.backgroundPosition || 'center center';
        css.backgroundRepeat = 'no-repeat';
    }

    // Border
    if (style.borderWidth && style.borderWidth !== '0') {
        css.borderWidth = style.borderWidth;
        css.borderColor = style.borderColor || '#E5E7EB'; // design-lint-ignore: default border color
        css.borderStyle = style.borderStyle || 'solid';
    }
    if (style.borderRadius) css.borderRadius = style.borderRadius;

    // Shadow
    if (style.boxShadow) {
        css.boxShadow = SHADOW_MAP[style.boxShadow] ?? style.boxShadow;
    }

    // Glow — composes with (does not replace) any configured shadow.
    if (style.glow) {
        const glow = GLOW_MAP[style.glow.intensity](style.glow.color || DEFAULT_GLOW_COLOR);
        css.boxShadow = css.boxShadow && css.boxShadow !== 'none' ? `${css.boxShadow}, ${glow}` : glow;
    }

    // Glass — backdrop blur + translucent token surface/border when the
    // author hasn't painted their own.
    if (style.glass) {
        const blur = GLASS_BLUR_MAP[style.glass.blur];
        css.backdropFilter = `blur(${blur})`;
        css.WebkitBackdropFilter = `blur(${blur})`;
        if (!style.backgroundColor && !style.backgroundLayers?.length && !style.gradient) {
            css.backgroundColor = 'hsl(var(--catalogue-glass-bg))';
        }
        if (!style.borderWidth) {
            css.borderWidth = '1px';
            css.borderStyle = 'solid';
            css.borderColor = `hsl(var(--catalogue-glass-border) / ${style.glass.borderOpacity ?? 0.35})`;
        }
    }

    // Gradient border — the padding-box/border-box double-background trick.
    // Single-node, but it OWNS the background stack: it intentionally
    // overrides backgroundLayers/gradient/backgroundImage on this component.
    if (style.borderGradient) {
        const bg = style.borderGradient;
        const base = style.backgroundColor || 'hsl(var(--catalogue-card-bg))';
        css.border = `${bg.width ?? '1px'} solid transparent`;
        // Never mix border/background shorthands with longhands in one style
        // object (React warns and application order becomes nondeterministic).
        css.borderWidth = undefined;
        css.borderStyle = undefined;
        css.borderColor = undefined;
        css.backgroundColor = undefined;
        css.backgroundImage = undefined;
        css.backgroundSize = undefined;
        css.backgroundPosition = undefined;
        css.backgroundRepeat = undefined;
        css.background = `linear-gradient(${base}, ${base}) padding-box, linear-gradient(${bg.angle ?? 135}deg, ${bg.from}, ${bg.to}) border-box`;
    }

    // Effects
    if (style.opacity !== undefined && style.opacity !== 1) css.opacity = style.opacity;
    if (style.maxWidth) css.maxWidth = style.maxWidth;
    if (style.minHeight) css.minHeight = style.minHeight;

    // Sticky rail — alignSelf keeps it from stretching (and thus never
    // moving) when the component sits in a grid/flex column slot.
    if (style.sticky?.enabled) {
        css.position = 'sticky';
        css.top = `${style.sticky.top ?? 88}px`;
        css.alignSelf = 'start';
    }

    // Vertical alignment of content inside an authored min-height.
    if (style.minHeight && style.contentAlign) {
        css.display = 'flex';
        css.flexDirection = 'column';
        css.justifyContent =
            style.contentAlign === 'center' ? 'center' : style.contentAlign === 'end' ? 'flex-end' : 'flex-start';
    }

    // Typography
    if (style.typography) {
        const t = style.typography;
        if (t.fontFamily) css.fontFamily = t.fontFamily;
        if (t.fontSize) css.fontSize = t.fontSize;
        if (t.fontWeight) css.fontWeight = t.fontWeight;
        if (t.lineHeight) css.lineHeight = t.lineHeight;
        if (t.letterSpacing) css.letterSpacing = t.letterSpacing;
        if (t.textColor) css.color = t.textColor;
        if (t.textAlign) css.textAlign = t.textAlign;
        if (t.textTransform) css.textTransform = t.textTransform;
    }

    return css;
}

/** True when the component opted into two-node section-shell rendering. */
export function hasSectionShell(style?: ComponentStyle): boolean {
    return !!style?.layout;
}

export interface SectionShellStyles {
    /** Full-width outer node: background surface, overlap, stacking. */
    canvasStyle: React.CSSProperties;
    /** Centered inner node: content column with width + padding + type. */
    contentStyle: React.CSSProperties;
}

/**
 * Splits a ComponentStyle into canvas (full-bleed surface) + content
 * (contained column) styles for section-shell rendering.
 *
 * Rules: the CANVAS owns background/border/radius/shadow/margins/min-height/
 * overlap/z-index (it *is* the section surface); the CONTENT owns padding,
 * typography and the width constraint. When the author sets no horizontal
 * padding and the column is constrained, a default inline padding keeps text
 * off the viewport edge on small screens.
 *
 * Note: responsive overrides (buildResponsiveCSS) target the canvas node
 * ([data-cid]); content-level responsive overrides are a later layer.
 */
export function buildSectionShellStyles(style: ComponentStyle): SectionShellStyles {
    const layout = style.layout ?? {};
    const compiled = buildComponentStyle(style);

    const canvasStyle: React.CSSProperties = {
        // sticky is also a positioned context, so absolute children (overlay,
        // decorations) keep resolving against the canvas
        position: (compiled.position as 'sticky' | undefined) ?? 'relative',
        top: compiled.top,
        alignSelf: compiled.alignSelf,
        // contentAlign flex centering (only emitted when minHeight is set)
        display: compiled.display,
        flexDirection: compiled.flexDirection,
        justifyContent: compiled.justifyContent,
        width: '100%',
        backgroundColor: compiled.backgroundColor,
        backgroundImage: compiled.backgroundImage,
        backgroundSize: compiled.backgroundSize,
        backgroundPosition: compiled.backgroundPosition,
        backgroundRepeat: compiled.backgroundRepeat,
        // Effect outputs must ride the canvas too: borderGradient emits the
        // `background`/`border` shorthands (its compiler clears the longhands,
        // so shorthand+longhand never coexist), glass emits backdrop filters.
        background: compiled.background,
        border: compiled.border,
        backdropFilter: compiled.backdropFilter,
        WebkitBackdropFilter: compiled.WebkitBackdropFilter,
        borderWidth: compiled.borderWidth,
        borderColor: compiled.borderColor,
        borderStyle: compiled.borderStyle,
        borderRadius: compiled.borderRadius,
        boxShadow: compiled.boxShadow,
        opacity: compiled.opacity,
        minHeight: compiled.minHeight,
        marginTop: layout.overlapTop ?? compiled.marginTop,
        marginBottom: compiled.marginBottom,
        zIndex: layout.zIndex,
    };

    const width = layout.width ?? 'default';
    const maxWidth =
        layout.contentMaxWidth ??
        (width === 'full' ? undefined : SECTION_WIDTH_MAP[width]) ??
        style.maxWidth;

    const contentStyle: React.CSSProperties = {
        paddingTop: compiled.paddingTop,
        paddingBottom: compiled.paddingBottom,
        paddingLeft: compiled.paddingLeft ?? (width !== 'full' ? 'var(--space-4)' : undefined),
        paddingRight: compiled.paddingRight ?? (width !== 'full' ? 'var(--space-4)' : undefined),
        maxWidth,
        marginLeft: maxWidth ? 'auto' : undefined,
        marginRight: maxWidth ? 'auto' : undefined,
        fontFamily: compiled.fontFamily,
        fontSize: compiled.fontSize,
        fontWeight: compiled.fontWeight,
        lineHeight: compiled.lineHeight,
        letterSpacing: compiled.letterSpacing,
        color: compiled.color,
        textAlign: compiled.textAlign,
        textTransform: compiled.textTransform,
    };

    return { canvasStyle, contentStyle };
}

/**
 * Merges base style with responsive overrides for a given viewport
 * (admin canvas viewport switching).
 */
export function mergeResponsiveStyle(
    style: ComponentStyle | undefined,
    viewport: 'desktop' | 'tablet' | 'mobile',
): ComponentStyle | undefined {
    if (!style) return undefined;
    if (viewport === 'desktop') return style;
    const overrides = viewport === 'tablet' ? style.responsive?.tablet : style.responsive?.mobile;
    if (!overrides) return style;
    return { ...style, ...overrides };
}

/** Whether a component is visible at the given viewport. */
export function isVisibleAtViewport(
    style: ComponentStyle | undefined,
    viewport: 'desktop' | 'tablet' | 'mobile',
): boolean {
    if (!style?.visibility) return true;
    return style.visibility[viewport] !== false;
}

/**
 * Generates responsive CSS media queries for a component.
 * Handles visibility-only configs too (no `responsive` key required).
 */
export function buildResponsiveCSS(componentId: string, style?: ComponentStyle): string {
    if (!style) return '';

    const lines: string[] = [];
    const selector = `[data-cid="${componentId}"]`;

    if (style.responsive?.tablet) {
        const tabletCSS = buildComponentStyle(style.responsive.tablet as ComponentStyle);
        const tabletStr = cssPropertiesToString(tabletCSS);
        if (tabletStr) {
            lines.push(`@media (max-width: 768px) { ${selector} { ${tabletStr} } }`);
        }
    }

    if (style.responsive?.mobile) {
        const mobileCSS = buildComponentStyle(style.responsive.mobile as ComponentStyle);
        const mobileStr = cssPropertiesToString(mobileCSS);
        if (mobileStr) {
            lines.push(`@media (max-width: 480px) { ${selector} { ${mobileStr} } }`);
        }
    }

    // Viewport-relative minHeight is a DESKTOP art-direction device. On a phone
    // an 80vh section with centred content wastes most of the screen (measured:
    // an 884px-tall hero holding 480px of content, ~400px of dead space). Relax
    // it below the tablet breakpoint so the section sizes to its content. Applies
    // retroactively to every already-published page.
    if (typeof style.minHeight === 'string' && /\d\s*(?:vh|svh|dvh|lvh|%)/.test(style.minHeight)) {
        lines.push(`@media (max-width: 768px) { ${selector} { min-height: 0 !important; } }`);
    }

    if (style.visibility) {
        if (style.visibility.tablet === false) {
            lines.push(`@media (max-width: 768px) { ${selector} { display: none !important; } }`);
        }
        if (style.visibility.mobile === false) {
            lines.push(`@media (max-width: 480px) { ${selector} { display: none !important; } }`);
        }
        if (style.visibility.desktop === false) {
            lines.push(`@media (min-width: 769px) { ${selector} { display: none !important; } }`);
        }
    }

    // Overlap sections flatten on small screens (overlaps assume desktop
    // scale). !important is required: the overlap margin is an INLINE style
    // on the canvas node, which otherwise always wins over stylesheet rules.
    if (style.layout?.overlapTop) {
        lines.push(
            `@media (max-width: 768px) { ${selector} { margin-top: 0 !important; } }`,
        );
    }

    return lines.join('\n');
}

function cssPropertiesToString(css: React.CSSProperties): string {
    return Object.entries(css)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => {
            const kebab = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
            return `${kebab}: ${value}`;
        })
        .join('; ');
}

/** CSS class name for hover effects. */
export function getHoverClass(style?: ComponentStyle): string {
    if (!style?.animation?.hover?.type || style.animation.hover.type === 'none') return '';
    const map: Record<string, string> = {
        lift: 'catalogue-hover-lift',
        glow: 'catalogue-hover-glow',
        scale: 'catalogue-hover-scale',
        brighten: 'catalogue-hover-brighten',
    };
    return map[style.animation.hover.type] || '';
}

/* ─── Custom primary brand color (globalSettings.theme.primaryColor) ────────
 * The theme panel stores a hex override; renderers apply it as INLINE CSS
 * variables on the catalogue wrapper so it beats the preset's stylesheet
 * values ([data-catalogue-theme="…"] { --primary-*: … }). The ramp mirrors
 * the preset scale stops: 500 = the brand color, 50–300 are tints on the
 * same hue. Returns {} for missing/invalid hex → preset stays in charge. */
export function buildPrimaryScaleVars(hex?: string | null): Record<string, string> {
    const raw = (hex || '').trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return {};
    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    const H = Math.round(h * 360);
    const S = Math.round(s * 100);
    const L = Math.round(l * 100);
    // Tints walk lightness toward near-white on the same hue; light stops get
    // slightly desaturated so muted brand colors don't turn pastel-neon.
    const stop = (lightness: number, satMul = 1) =>
        `${H} ${Math.round(Math.min(100, S * satMul))}% ${Math.round(lightness)}%`;
    const l50 = L + (97 - L) * 0.94;
    const l100 = L + (97 - L) * 0.85;
    const l200 = L + (97 - L) * 0.68;
    const l300 = L + (97 - L) * 0.45;
    const l400 = Math.min(97, L + 7);
    return {
        '--primary-50': stop(l50, 0.75),
        '--primary-100': stop(l100, 0.8),
        '--primary-200': stop(l200, 0.85),
        '--primary-300': stop(l300, 0.95),
        '--primary-400': stop(l400),
        '--primary-500': stop(L),
        // Legible text on the brand color: white on dark brands, ink on light.
        '--primary-foreground': L < 62 ? '0 0% 100%' : '222 47% 11%',
    };
}

/* ─── Dark author surfaces ─────────────────────────────────────────────────
 * True when a #rrggbb colour is dark enough to need light ink on top
 * (Rec. 601 luminance < 0.55). Components that paint their copy with theme
 * TOKEN classes (the hero's title/description, the eyebrow, the secondary
 * button) cannot be recoloured by a props.textColor — a navy hero authored
 * with a white textColor still rendered navy-on-navy. Adding the `dark`
 * class to the band flips every token inside it, so a renderer that calls
 * this gets a legible dark band from the colour alone, with no author
 * knowledge of the customClass trick. Same threshold as JsonRenderer's
 * section text pairing and the AI service's is_hex_dark. */
export function isHexDark(hex?: string | null): boolean {
    const raw = (hex || '').trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return false;
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}
