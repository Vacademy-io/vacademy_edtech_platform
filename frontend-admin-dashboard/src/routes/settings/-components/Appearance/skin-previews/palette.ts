import type { CSSProperties } from 'react';
import { rampHexFromHex } from '@/lib/theme-ramp';

/*
 * Colours for the learner skin scale models.
 *
 * Two kinds of value live here, and both reach the models through inline
 * style rather than admin tokens:
 *  - the institute's brand colour and its tints, which are dynamic (the admin
 *    may be editing an unsaved custom colour), and
 *  - each skin's own fixed colours, copied from the learner app's skin
 *    stylesheets. The admin theme does not carry them (they are learner skin
 *    tokens, not admin ones), and the models must show the learner app, not
 *    the admin chrome.
 * The two apps share no package, so these values are copied by convention,
 * like the axis previews in ThemeEditor. If a skin's colours change in the
 * learner app, update them here.
 */

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    const n = parseInt(h.slice(0, 6), 16);
    return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: Rgb) =>
    '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const WHITE: Rgb = [255, 255, 255];
/** The deep ink the learner app mixes into a colour to make its "lip". */
const DEEP_INK: Rgb = [17, 24, 39];

const mix = (hex: string, toward: Rgb, amount: number) => {
    const from = toRgb(hex);
    return toHex([0, 1, 2].map((i) => from[i]! + (toward[i]! - from[i]!) * amount) as Rgb);
};

const luminance = (hex: string) => {
    const lin = toRgb(hex).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
};

const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
};

/** The institute brand colour as each skin uses it. */
export interface BrandPalette {
    solid: string;
    tint50: string;
    tint100: string;
    tint200: string;
    tint300: string;
    /** Lighter top of Corporate's primary button. */
    tint400: string;
    /** Darker edge under a "lip" button (Play, Fun). */
    lip: string;
    /** Fun's brand: darkened until text on its tint passes 4.5:1, as the Fun skin does. */
    funSolid: string;
    funTint: string;
    funLip: string;
}

export function brandPalette(brandHex: string): BrandPalette {
    const ramp = rampHexFromHex(brandHex);
    const solid = ramp['500'];
    const funTint = mix(solid, WHITE, 0.88);
    let funSolid = solid;
    for (let step = 0.04; contrast(funSolid, funTint) < 4.5 && step <= 0.6; step += 0.04) {
        funSolid = mix(solid, DEEP_INK, step);
    }
    return {
        solid,
        tint50: ramp['50'],
        tint100: ramp['100'],
        tint200: ramp['200'],
        tint300: ramp['300'],
        tint400: ramp['400'],
        lip: mix(solid, DEEP_INK, 0.35),
        funSolid,
        funTint,
        funLip: mix(funSolid, DEEP_INK, 0.35),
    };
}

/* ------------------------------------------------------------------ */
/* Fixed skin colours (copied from the learner skin stylesheets)        */
/* ------------------------------------------------------------------ */

/** styles/play-theme.css */
export const PLAY = {
    success: '#58CC02', // design-lint-ignore: learner Play token --play-c-success
    successDeep: '#46A302', // design-lint-ignore: learner Play token --play-c-success-deep
    successSoft: '#EFF7E9', // design-lint-ignore: learner Play token --play-c-success-soft
    successSoftInk: '#417915', // design-lint-ignore: learner Play token --play-c-success-soft-ink
    highlight: '#FFF3CD', // design-lint-ignore: learner Play token --play-c-highlight
    highlightEdge: '#F6E3A6', // design-lint-ignore: learner Play hero edge
    navy: '#235390', // design-lint-ignore: learner Play token --play-c-navy
    navySoft: '#EDF1F8', // design-lint-ignore: learner Play token --play-c-navy-soft
    infoSoft: '#E9F6FB', // design-lint-ignore: learner Play token --play-c-info-soft
    infoSoftEdge: '#D2ECF7', // design-lint-ignore: learner Play course card edge
    infoSoftInk: '#0E78AA', // design-lint-ignore: learner Play token --play-c-info-soft-ink
    ink: '#3C3C3C', // design-lint-ignore: learner Play token --play-c-ink
} as const;

/** styles/cleaner-play-theme.css */
export const CLEANER = {
    ink: '#392F27', // design-lint-ignore: learner Cleaner Play token --cp-ink
    muted: '#7D7468', // design-lint-ignore: learner Cleaner Play token --cp-muted
    line: '#E6E0D2', // design-lint-ignore: learner Cleaner Play token --cp-border
    sage: '#7C8F63', // design-lint-ignore: learner Cleaner Play token --cp-sage
    terracotta: '#B2603A', // design-lint-ignore: learner Cleaner Play token --cp-terracotta
    terracottaTint: '#F8ECE6', // design-lint-ignore: learner Cleaner Play token --cp-terracotta-tint
    goldTint: '#FAF3E4', // design-lint-ignore: learner Cleaner Play token --cp-gold-tint
} as const;

/** styles/corporate-theme.css */
export const CORPORATE = {
    canvas: '#F7F8FA', // design-lint-ignore: learner Corporate token --canvas
    line: '#E3E6EC', // design-lint-ignore: learner Corporate token --border
} as const;

/** styles/fun/base.css and the Fun design */
export const FUN = {
    ink: '#1F2333', // design-lint-ignore: learner Fun token --fun-ink
    ink2: '#3E4456', // design-lint-ignore: learner Fun token --fun-ink-2
    muted: '#5B6275', // design-lint-ignore: learner Fun token --fun-muted
    lineCard: '#ECEEF4', // design-lint-ignore: learner Fun token --fun-line-card
    lineNav: '#F0F1F6', // design-lint-ignore: learner Fun token --fun-line-nav
    lineButton: '#D6D9E3', // design-lint-ignore: learner Fun token --fun-line-button
    success: '#16A34A', // design-lint-ignore: learner Fun token --fun-success
    successStrong: '#15803D', // design-lint-ignore: learner Fun token --fun-success-strong
    successTint: '#E9FBEF', // design-lint-ignore: learner Fun token --fun-success-tint
    successTrack: '#BBF0CC', // design-lint-ignore: learner Fun token --fun-success-track
    live: '#E11D48', // design-lint-ignore: learner Fun token --fun-live
    liveText: '#BE123C', // design-lint-ignore: learner Fun token --fun-live-text
    liveTint: '#FFEFF4', // design-lint-ignore: learner Fun token --fun-live-tint
    liveLine: '#FBD5DF', // design-lint-ignore: Fun wrong-answer row edge
    liveRow: '#FFF7F9', // design-lint-ignore: Fun wrong-answer row
    info: '#1D4ED8', // design-lint-ignore: learner Fun token --fun-info
    infoTint: '#EAF2FF', // design-lint-ignore: learner Fun token --fun-info-tint
    testTint: '#FFF7D6', // design-lint-ignore: learner Fun token --fun-test-tint
    testRing: '#FDE68A', // design-lint-ignore: learner Fun token --fun-test-icon-bg
    highlight: '#FDE047', // design-lint-ignore: learner Fun token --fun-highlight
    streakBg: '#FFF4E5', // design-lint-ignore: learner Fun token --fun-streak-bg
    streakText: '#9A3412', // design-lint-ignore: learner Fun token --fun-streak-text
    flame: '#FB923C', // design-lint-ignore: learner Fun token --fun-flame
    /** One colour per course, in list order. */
    courses: [
        { solid: '#BE185D', lip: '#831843', light: '#DB2777' }, // design-lint-ignore: Fun course colour
        { solid: '#6D28D9', lip: '#4C1D95', light: '#8B5CF6' }, // design-lint-ignore: Fun course colour
        { solid: '#0F766E', lip: '#134E4A', light: '#14B8A6' }, // design-lint-ignore: Fun course colour
        { solid: '#C2410C', lip: '#7C2D12', light: '#F97316' }, // design-lint-ignore: Fun course colour
    ],
    violetSoft: '#F6F2FF', // design-lint-ignore: Fun formula box
    violetTrack: '#F1EBFF', // design-lint-ignore: Fun lesson progress track
    violetInk: '#5B21B6', // design-lint-ignore: Fun formula text
    violetLine: '#C4B5FD', // design-lint-ignore: Fun video artwork
    confetti: ['#F472B6', '#60A5FA', '#34D399', '#A78BFA', '#FB923C'], // design-lint-ignore: Fun result confetti
} as const;

/** styles/neon-city/base.css and the Neon City design */
export const NEON = {
    night: '#120A2A', // design-lint-ignore: learner Neon City token --neon-night
    card: '#1E1342', // design-lint-ignore: learner Neon City token --neon-card
    raised: '#2A1B57', // design-lint-ignore: learner Neon City token --neon-raised
    line: '#3A2A70', // design-lint-ignore: learner Neon City token --neon-line
    text: '#FFFFFF', // design-lint-ignore: learner Neon City token --neon-text
    soft: '#E7DDFF', // design-lint-ignore: learner Neon City token --neon-text-soft
    quiet: '#C4B8E8', // design-lint-ignore: learner Neon City token --neon-text-quiet
    pink: '#FF3D8B', // design-lint-ignore: learner Neon City token --neon-pink
    pinkLip: '#A3155A', // design-lint-ignore: learner Neon City token --neon-pink-lip
    gold: '#FFC94A', // design-lint-ignore: learner Neon City token --neon-gold
    goldLip: '#A87A12', // design-lint-ignore: learner Neon City token --neon-gold-lip
    aqua: '#2EE6D6', // design-lint-ignore: learner Neon City token --neon-aqua
    coral: '#FF6B6B', // design-lint-ignore: learner Neon City token --neon-coral
    starOff: '#6E5BA8', // design-lint-ignore: Neon City empty star
    /** The sunset: sky top to horizon, the sun's two ends, the buildings. */
    sky: ['#170A36', '#4E1873', '#B8267C', '#FF6A4D'], // design-lint-ignore: Neon City scene
    sun: ['#FFE27A', '#FF3D8B'], // design-lint-ignore: Neon City scene
    building: '#1B0A36', // design-lint-ignore: Neon City scene
    palm: '#0D0520', // design-lint-ignore: Neon City scene
    /** Course colours, in list order (bright fills, night text on them). */
    courses: ['#2EE6D6', '#FF8A3D', '#9B7BFF'], // design-lint-ignore: Neon City course colours
} as const;

/** Neon City's type: Anton for headings, Manrope for the rest. */
export const NEON_DISPLAY = "Anton, Impact, 'Arial Narrow', sans-serif";
export const NEON_FONT = 'Manrope, system-ui, sans-serif';

/**
 * The use-case skins (styles/stage, styles/calm, styles/pulse in the learner
 * app): the few colours a scale model needs from each.
 */
export interface UseCaseLook {
    page: string;
    card: string;
    line: string;
    ink: string;
    quiet: string;
    /** The top band behind the greeting, and the ink on it. */
    band: string;
    bandInk: string;
    /** The resume card and the ink on it. */
    hero: string;
    heroInk: string;
    /** The main button and its label; lip under it. */
    action: string;
    actionInk: string;
    actionLip: string;
    /** The main action outside the resume card (lesson Next, result Next, active tab). */
    main: string;
    mainInk: string;
    mainLip: string;
    /** Accent for the label above the resume card and progress. */
    accent: string;
    track: string;
    courses: readonly string[];
    display: string;
    body: string;
    italic: boolean;
    upper: boolean;
    pill: boolean;
}

export const STAGE: UseCaseLook = {
    page: '#FFF8EE', // design-lint-ignore: learner Stage token --stage-ivory
    card: '#FFFFFF', // design-lint-ignore: learner Stage card
    line: '#F0DCC8', // design-lint-ignore: learner Stage token --stage-line
    ink: '#2B1630', // design-lint-ignore: learner Stage token --stage-plum
    quiet: '#6B4E64', // design-lint-ignore: learner Stage token --stage-quiet
    band: '#A3134D', // design-lint-ignore: learner Stage token --stage-magenta
    bandInk: '#FFFFFF', // design-lint-ignore: white on magenta
    hero: '#2B1630', // design-lint-ignore: learner Stage token --stage-plum
    heroInk: '#FFFFFF', // design-lint-ignore: white on plum
    action: '#F2A007', // design-lint-ignore: learner Stage token --stage-marigold
    actionInk: '#2B1630', // design-lint-ignore: plum on marigold
    actionLip: '#A86E00', // design-lint-ignore: learner Stage token --stage-marigold-lip
    main: '#A3134D', // design-lint-ignore: learner Stage token --stage-magenta
    mainInk: '#FFFFFF', // design-lint-ignore: white on magenta
    mainLip: '#6E0D34', // design-lint-ignore: learner Stage token --stage-magenta-lip
    accent: '#F2A007', // design-lint-ignore: learner Stage token --stage-marigold
    track: '#4A2E50', // design-lint-ignore: learner Stage token --stage-plum-2
    courses: ['#A3134D', '#0E7C7B', '#C2410C'], // design-lint-ignore: Stage course colours
    display: 'Fraunces, Georgia, serif',
    body: 'Outfit, system-ui, sans-serif',
    italic: true,
    upper: false,
    pill: false,
};

export const CALM: UseCaseLook = {
    page: '#F6F3EC', // design-lint-ignore: learner Calm token --calm-sand
    card: '#FFFFFF', // design-lint-ignore: learner Calm card
    line: '#E5E0D3', // design-lint-ignore: learner Calm token --calm-line
    ink: '#23302A', // design-lint-ignore: learner Calm token --calm-ink
    quiet: '#5E6B62', // design-lint-ignore: learner Calm token --calm-quiet
    band: '#E9EFE6', // design-lint-ignore: learner Calm token --calm-mist
    bandInk: '#23302A', // design-lint-ignore: learner Calm token --calm-ink
    hero: '#FFFFFF', // design-lint-ignore: learner Calm card
    heroInk: '#23302A', // design-lint-ignore: learner Calm token --calm-ink
    action: '#3F6B4F', // design-lint-ignore: learner Calm token --calm-sage
    actionInk: '#FFFFFF', // design-lint-ignore: white on sage
    actionLip: '#2E5039', // design-lint-ignore: learner Calm token --calm-sage-lip
    main: '#3F6B4F', // design-lint-ignore: learner Calm token --calm-sage
    mainInk: '#FFFFFF', // design-lint-ignore: white on sage
    mainLip: '#2E5039', // design-lint-ignore: learner Calm token --calm-sage-lip
    accent: '#3F6B4F', // design-lint-ignore: learner Calm token --calm-sage
    track: '#E3ECE1', // design-lint-ignore: learner Calm progress track
    courses: ['#3F6B4F', '#A4502F', '#2F6F73'], // design-lint-ignore: Calm course colours
    display: "'Cormorant Garamond', Georgia, serif",
    body: "'Nunito Sans', system-ui, sans-serif",
    italic: false,
    upper: false,
    pill: true,
};

export const PULSE: UseCaseLook = {
    page: '#0F1012', // design-lint-ignore: learner Pulse token --pulse-night
    card: '#1A1C20', // design-lint-ignore: learner Pulse token --pulse-card
    line: '#2F333A', // design-lint-ignore: learner Pulse token --pulse-line
    ink: '#FFFFFF', // design-lint-ignore: learner Pulse token --pulse-text
    quiet: '#A8ADB7', // design-lint-ignore: learner Pulse token --pulse-quiet
    band: '#0F1012', // design-lint-ignore: learner Pulse token --pulse-night
    bandInk: '#C8FF2E', // design-lint-ignore: learner Pulse token --pulse-volt
    hero: '#C8FF2E', // design-lint-ignore: learner Pulse token --pulse-volt
    heroInk: '#0F1012', // design-lint-ignore: charcoal on volt
    action: '#0F1012', // design-lint-ignore: charcoal button on the volt card
    actionInk: '#C8FF2E', // design-lint-ignore: volt on charcoal
    actionLip: '#000000', // design-lint-ignore: Pulse button lip
    main: '#C8FF2E', // design-lint-ignore: learner Pulse token --pulse-volt
    mainInk: '#0F1012', // design-lint-ignore: charcoal on volt
    mainLip: '#7F9E1E', // design-lint-ignore: learner Pulse token --pulse-volt-lip
    accent: '#0F1012', // design-lint-ignore: charcoal on volt
    track: '#A7D42A', // design-lint-ignore: Pulse progress track on volt
    courses: ['#C8FF2E', '#FF8A3D', '#2EE6D6'], // design-lint-ignore: Pulse course colours
    display: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    body: 'Inter, system-ui, sans-serif',
    italic: true,
    upper: true,
    pill: false,
};

/** The Play and Cleaner Play mascot, drawn as simple shapes. */
export const MASCOT = {
    skin: '#F1C7A0', // design-lint-ignore: mascot artwork
    hair: '#7A4A2A', // design-lint-ignore: mascot artwork
    shirt: '#7D8B4A', // design-lint-ignore: mascot artwork
    scarf: '#C65A2E', // design-lint-ignore: mascot artwork
    boot: '#5A3A22', // design-lint-ignore: mascot artwork
} as const;

/** The Fun skin's type: Nunito when the device has it, else a heavy system face. */
export const FUN_FONT =
    "Nunito, 'Nunito Sans', ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif";

/* ------------------------------------------------------------------ */
/* Style helpers                                                        */
/* ------------------------------------------------------------------ */
/* Each returns the one dynamic property it names, so a model reads as
   Tailwind for structure plus a colour taken from this file. */

export const bg = (color: string): CSSProperties => ({ backgroundColor: color });
export const fg = (color: string): CSSProperties => ({ color });
export const edge = (color: string): CSSProperties => ({ borderColor: color });
/** A 3D "lip": a solid shadow straight below, as Play and Fun buttons have. */
export const lip = (color: string, px = 4): CSSProperties => ({
    boxShadow: `0 ${px}px 0 ${color}`,
});
export const merge = (...styles: CSSProperties[]): CSSProperties => Object.assign({}, ...styles);
