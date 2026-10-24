import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Tone and skin classes for every Daily Engagement surface.
 *
 * One layout serves all five skins (default, vibrant, play, cleanerPlay,
 * corporate). A skin changes only the classes, through `[.ui-<skin>_&]:`
 * variants, so no component needs a skin hook just to restyle itself.
 *
 * Every value below is a LITERAL class string. Tailwind's JIT scanner reads
 * this file as text: a class assembled at runtime ("bg-play-" + tone + "-soft")
 * never appears in the source, so it is never generated and silently renders
 * as nothing. Keep new entries fully spelled out.
 *
 * Token notes:
 * - The learner primary scale stops at 500; no darker primary shade exists here.
 * - `play-*` values are declared only under `.ui-play`, and `cp-*` only under
 *   `.ui-cleaner-play`, so they are always written behind that skin's variant.
 */

/** A task type's colour family. Type is told by icon + label; tone is only a cue. */
export type EngagementTone =
  | "info"
  | "accent"
  | "warn"
  | "success"
  | "danger"
  | "navy"
  | "neutral";

/**
 * - `tile`: the square icon tile beside a title (sets the icon's colour too).
 * - `icon`: a bare icon's colour, with no tile behind it.
 * - `surface`: a tinted block, e.g. the Up next row or the runner header band.
 * - `option`: one answer option in `ChoiceOptions`, including its selected
 *   (`aria-checked`) state.
 * - `segment`: a filled progress segment.
 * - `points`: the points chip.
 */
export type EngagementTonePart = "tile" | "icon" | "surface" | "option" | "segment" | "points";

/** Skin-level classes that do not vary by tone. */
export type EngagementSkinPart =
  | "card"
  | "segmentTrack"
  | "segment"
  | "points"
  | "divider"
  | "ink"
  | "mutedInk";

export const ENGAGEMENT_TONES: readonly EngagementTone[] = [
  "info",
  "accent",
  "warn",
  "success",
  "danger",
  "navy",
  "neutral",
];

// --- Tone-independent pieces (shared by every tone entry below) -------------

const SEGMENT =
  "bg-primary-500 [.ui-play_&]:bg-play-success [.ui-cleaner-play_&]:bg-cp-sage";

const POINTS =
  "border-border bg-muted text-foreground [.ui-vibrant_&]:border-primary-100 [.ui-vibrant_&]:bg-primary-50 [.ui-vibrant_&]:text-primary-500 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-gold-soft [.ui-play_&]:text-play-gold-soft-ink [.ui-cleaner-play_&]:border-transparent [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-ink [.ui-corporate_&]:bg-transparent [.ui-corporate_&]:border-transparent [.ui-corporate_&]:px-0 [.ui-corporate_&]:text-muted-foreground";

// --- Per-tone table -----------------------------------------------------------

const TONE_CLASSES: Record<EngagementTone, Record<EngagementTonePart, string>> = {
  info: {
    tile: "bg-muted text-info-600 [.ui-vibrant_&]:bg-info-50 [.ui-play_&]:bg-play-info-soft [.ui-play_&]:text-play-info-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage [.ui-corporate_&]:bg-muted [.ui-corporate_&]:text-muted-foreground",
    icon: "text-info-600 [.ui-play_&]:text-play-info-soft-ink [.ui-cleaner-play_&]:text-cp-sage [.ui-corporate_&]:text-muted-foreground",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-info-soft [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-info-deep [.ui-play_&]:aria-checked:bg-play-info-soft [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-sage [.ui-cleaner-play_&]:aria-checked:bg-cp-sage-tint",
    segment: SEGMENT,
    points: POINTS,
  },
  accent: {
    tile: "bg-muted text-primary-500 [.ui-vibrant_&]:bg-primary-50 [.ui-play_&]:bg-play-accent-soft [.ui-play_&]:text-play-accent-soft-ink [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-cleaner-play_&]:text-cp-terracotta [.ui-corporate_&]:bg-muted [.ui-corporate_&]:text-muted-foreground",
    icon: "text-primary-500 [.ui-play_&]:text-play-accent-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta [.ui-corporate_&]:text-muted-foreground",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-accent-soft [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-accent-deep [.ui-play_&]:aria-checked:bg-play-accent-soft [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-terracotta [.ui-cleaner-play_&]:aria-checked:bg-cp-terracotta-tint",
    segment: SEGMENT,
    points: POINTS,
  },
  warn: {
    tile: "bg-muted text-warning-700 [.ui-vibrant_&]:bg-warning-50 [.ui-play_&]:bg-play-warn-soft [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-gold [.ui-corporate_&]:bg-muted [.ui-corporate_&]:text-muted-foreground",
    icon: "text-warning-700 [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:text-cp-gold [.ui-corporate_&]:text-muted-foreground",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-warn-soft [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-warn-deep [.ui-play_&]:aria-checked:bg-play-warn-soft [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-gold [.ui-cleaner-play_&]:aria-checked:bg-cp-gold-tint",
    segment: SEGMENT,
    points: POINTS,
  },
  success: {
    tile: "bg-muted text-success-700 [.ui-vibrant_&]:bg-success-50 [.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage [.ui-corporate_&]:bg-muted [.ui-corporate_&]:text-muted-foreground",
    icon: "text-success-700 [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:text-cp-sage [.ui-corporate_&]:text-muted-foreground",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-success-soft [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-success-deep [.ui-play_&]:aria-checked:bg-play-success-soft [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-sage [.ui-cleaner-play_&]:aria-checked:bg-cp-sage-tint",
    segment: SEGMENT,
    points: POINTS,
  },
  danger: {
    tile: "bg-muted text-danger-700 [.ui-vibrant_&]:bg-danger-50 [.ui-play_&]:bg-play-danger-soft [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-cleaner-play_&]:text-cp-terracotta [.ui-corporate_&]:bg-muted [.ui-corporate_&]:text-muted-foreground",
    icon: "text-danger-700 [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta [.ui-corporate_&]:text-muted-foreground",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-danger-soft [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-danger-deep [.ui-play_&]:aria-checked:bg-play-danger-soft [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-terracotta [.ui-cleaner-play_&]:aria-checked:bg-cp-terracotta-tint",
    segment: SEGMENT,
    points: POINTS,
  },
  navy: {
    tile: "bg-muted text-info-700 [.ui-vibrant_&]:bg-info-50 [.ui-play_&]:bg-play-navy-soft [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage [.ui-corporate_&]:bg-muted [.ui-corporate_&]:text-muted-foreground",
    icon: "text-info-700 [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:text-cp-sage [.ui-corporate_&]:text-muted-foreground",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-navy-soft [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-navy-deep [.ui-play_&]:aria-checked:bg-play-navy-soft [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-sage [.ui-cleaner-play_&]:aria-checked:bg-cp-sage-tint",
    segment: SEGMENT,
    points: POINTS,
  },
  neutral: {
    tile: "bg-muted text-muted-foreground [.ui-play_&]:bg-play-surface [.ui-play_&]:text-play-ink [.ui-cleaner-play_&]:bg-cp-bg-deep [.ui-cleaner-play_&]:text-cp-muted",
    icon: "text-muted-foreground [.ui-play_&]:text-play-ink/75 [.ui-cleaner-play_&]:text-cp-muted",
    surface:
      "bg-muted/40 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep [.ui-corporate_&]:bg-card",
    option:
      "border border-border bg-card hover:border-primary-300 aria-checked:border-primary-500 aria-checked:ring-2 aria-checked:ring-primary-500 [.ui-vibrant_&]:aria-checked:bg-primary-50 [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-play-press [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:aria-checked:ring-0 [.ui-play_&]:aria-checked:border-play-muted-deep [.ui-play_&]:aria-checked:bg-play-surface [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:aria-checked:ring-0 [.ui-cleaner-play_&]:aria-checked:border-cp-muted [.ui-cleaner-play_&]:aria-checked:bg-cp-bg-deep",
    segment: SEGMENT,
    points: POINTS,
  },
};

const SKIN_CLASSES: Record<EngagementSkinPart, string> = {
  /** The module / page card. Default: hairline Card. `cp-card` is inert outside
   *  cleanerPlay and corporate, whose stylesheets style it. */
  card: "cp-card rounded-lg border border-border bg-card [.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300 [.ui-vibrant_&]:bg-primary-50/50 [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card",
  /** An empty progress segment. 4 px by default, 8 px in play. */
  segmentTrack: "h-1 rounded-full bg-muted [.ui-play_&]:h-2 [.ui-play_&]:bg-play-surface [.ui-cleaner-play_&]:bg-cp-bg-deep",
  segment: SEGMENT,
  points: POINTS,
  divider: "border-border [.ui-cleaner-play_&]:border-cp-border",
  /** Primary text ink. */
  ink: "text-foreground [.ui-play_&]:text-play-ink [.ui-cleaner-play_&]:text-cp-ink",
  /** Secondary text ink. */
  mutedInk: "text-muted-foreground [.ui-play_&]:text-play-ink/60 [.ui-cleaner-play_&]:text-cp-muted",
};

/** Literal classes for one tone and part. Unknown tones fall back to neutral. */
export function toneClasses(tone: EngagementTone, part: EngagementTonePart): string {
  return (TONE_CLASSES[tone] ?? TONE_CLASSES.neutral)[part];
}

/** Literal classes for a tone-independent, skin-aware part. */
export function skinClasses(part: EngagementSkinPart): string {
  return SKIN_CLASSES[part];
}

/**
 * Outcome colours used by results and answered options. Semantic tokens in the
 * standard skins, the play palette in play, the clay tints in cleanerPlay.
 */
export type EngagementOutcomeTone = "correct" | "wrong" | "pending" | "done";

const OUTCOME_CLASSES: Record<EngagementOutcomeTone, { circle: string; ink: string; option: string }> = {
  correct: {
    circle:
      "bg-success-100 text-success-700 [.ui-play_&]:bg-play-success [.ui-play_&]:text-white [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage",
    ink: "text-success-700 [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:text-cp-sage",
    option:
      "border-success-500 bg-success-50 [.ui-play_&]:border-play-success-deep [.ui-play_&]:bg-play-success-soft [.ui-cleaner-play_&]:border-cp-sage [.ui-cleaner-play_&]:bg-cp-sage-tint",
  },
  wrong: {
    circle:
      "bg-danger-100 text-danger-700 [.ui-play_&]:bg-play-danger [.ui-play_&]:text-white [.ui-cleaner-play_&]:bg-cp-terracotta-tint [.ui-cleaner-play_&]:text-cp-terracotta",
    ink: "text-danger-700 [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta",
    option:
      "border-danger-500 bg-danger-50 [.ui-play_&]:border-play-danger-deep [.ui-play_&]:bg-play-danger-soft [.ui-cleaner-play_&]:border-cp-terracotta [.ui-cleaner-play_&]:bg-cp-terracotta-tint",
  },
  pending: {
    circle:
      "bg-muted text-foreground [.ui-play_&]:bg-play-navy-soft [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-ink",
    ink: "text-foreground [.ui-play_&]:text-play-navy-soft-ink [.ui-cleaner-play_&]:text-cp-ink",
    option:
      "border-primary-500 bg-primary-50 [.ui-play_&]:border-play-navy-deep [.ui-play_&]:bg-play-navy-soft [.ui-cleaner-play_&]:border-cp-gold [.ui-cleaner-play_&]:bg-cp-gold-tint",
  },
  done: {
    circle:
      "bg-primary-50 text-primary-500 [.ui-play_&]:bg-play-success [.ui-play_&]:text-white [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage",
    ink: "text-foreground [.ui-play_&]:text-play-ink [.ui-cleaner-play_&]:text-cp-ink",
    option:
      "border-primary-500 bg-primary-50 [.ui-play_&]:border-play-info-deep [.ui-play_&]:bg-play-info-soft [.ui-cleaner-play_&]:border-cp-sage [.ui-cleaner-play_&]:bg-cp-sage-tint",
  },
};

export function outcomeClasses(
  outcome: EngagementOutcomeTone,
  part: "circle" | "ink" | "option"
): string {
  return OUTCOME_CLASSES[outcome][part];
}

/**
 * `cn()` that knows this app's custom tokens.
 *
 * The app's `cn()` uses stock tailwind-merge, which reads `text-caption` /
 * `text-body` as a text COLOUR and silently drops it when a real colour class
 * (`text-muted-foreground`) comes later in the same call; it also cannot tell
 * `p-card` from `p-4`. Engagement components merge through this instead, so a
 * type token and a colour token always survive together.
 */
const mergeEngagementClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "h1",
            "h2",
            "h3",
            "h1-semibold",
            "h2-semibold",
            "h3-semibold",
            "title",
            "subtitle",
            "body",
            "caption",
            "display",
            "display-sm",
            "2xs",
            "3xs",
            "play-badge",
          ],
        },
      ],
      p: [{ p: ["card", "card-lg", "page"] }],
      gap: [{ gap: ["stack", "section"] }],
      h: [{ h: ["control"] }],
      "min-h": [{ "min-h": ["control"] }],
      rounded: [{ rounded: ["play-card", "play-card-sm", "play-btn"] }],
    },
  },
});

export function ecn(...inputs: ClassValue[]): string {
  return mergeEngagementClasses(clsx(inputs));
}
