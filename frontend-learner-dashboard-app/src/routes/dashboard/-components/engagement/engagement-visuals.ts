import { createElement, type ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  BookOpenText,
  Cards,
  ChartBar,
  GameController,
  GraduationCap,
  ImageSquare,
  Lightbulb,
  ListChecks,
  PencilSimpleLine,
  Sparkle,
  UploadSimple,
  type Icon,
} from "@phosphor-icons/react";
import type { EngagementItemType } from "@/services/engagement";
import { formatDate } from "@/lib/formatters";
import artBooks from "@/assets/cleaner-play/icon-books.webp";
import artReports from "@/assets/cleaner-play/icon-reports.webp";
import artHelp from "@/assets/cleaner-play/icon-help.webp";
import artAssessments from "@/assets/cleaner-play/icon-assessments.webp";
import artBadges from "@/assets/cleaner-play/icon-badges.webp";
import artLeaderboard from "@/assets/cleaner-play/icon-leaderboard.webp";
import artCourses from "@/assets/cleaner-play/icon-courses.webp";
import artProgress from "@/assets/cleaner-play/icon-progress.webp";
import { toneClasses, type EngagementTone } from "./engagement-tone";

/**
 * Every task type the learner UI knows how to draw. `FLASHCARDS` is listed
 * explicitly so this table works whether or not the service union has picked
 * it up yet.
 */
export type EngagementVisualType = EngagementItemType | "FLASHCARDS";

/** Anything `visualFor` can describe: a type string, or an item carrying one. */
export type EngagementVisualInput =
  | EngagementVisualType
  | string
  | { itemType: string; payloadJson?: string | null };

/**
 * Per-type presentation. One place so the Today module, the runner and the
 * `/engagement` page describe a task the same way.
 */
export interface EngagementVisual {
  /** Phosphor icon for the type (format-aware for a question of the day). */
  icon: Icon;
  /** Colour family; feed it to `toneClasses(tone, part)`. */
  tone: EngagementTone;
  /** CleanerPlay illustration that replaces the icon tile in that skin. */
  art: string;
  /** Key under `dashboardEngagement:types`, e.g. `READING_HTML` or `fallback`. */
  label: string;

  /**
   * @deprecated Legacy card/dialog/history only (deleted in wave 3). Now the
   * type's icon element rather than an emoji, sized 1em so it follows the
   * surrounding font size.
   */
  glyph: ReactNode;
  /** @deprecated Legacy chip: the tone's `tile` classes. */
  chip: string;
  /** @deprecated Legacy solid accent. */
  accent: string;
  /** @deprecated Legacy row hover wash. */
  wash: string;
  /**
   * @deprecated Legacy dialog header gradient. It sits under white text, so it
   * is a dark neutral for every type (the old light gradients were ~2:1).
   */
  gradient: string;
}

interface TypeVisual {
  icon: Icon;
  tone: EngagementTone;
  art: string;
  label: string;
}

const TYPE_VISUALS: Record<EngagementVisualType, TypeVisual> = {
  READING_HTML: { icon: BookOpenText, tone: "info", art: artBooks, label: "READING_HTML" },
  VISUAL_NOTE: { icon: ImageSquare, tone: "info", art: artReports, label: "VISUAL_NOTE" },
  QUESTION_OF_DAY: { icon: Lightbulb, tone: "warn", art: artHelp, label: "QUESTION_OF_DAY" },
  QUIZ: { icon: ListChecks, tone: "neutral", art: artAssessments, label: "QUIZ" },
  GAME: { icon: GameController, tone: "danger", art: artBadges, label: "GAME" },
  POLL: { icon: ChartBar, tone: "success", art: artLeaderboard, label: "POLL" },
  COURSE_SLIDE: { icon: GraduationCap, tone: "navy", art: artCourses, label: "COURSE_SLIDE" },
  FLASHCARDS: { icon: Cards, tone: "accent", art: artProgress, label: "FLASHCARDS" },
};

const FALLBACK_VISUAL: TypeVisual = {
  icon: Sparkle,
  tone: "neutral",
  art: artProgress,
  label: "fallback",
};

/** Legacy accent per tone (literal strings for the Tailwind scanner). */
const LEGACY_ACCENT: Record<EngagementTone, string> = {
  info: "bg-info-500",
  accent: "bg-primary-500",
  warn: "bg-warning-500",
  success: "bg-success-500",
  danger: "bg-danger-500",
  navy: "bg-info-700",
  neutral: "bg-muted-foreground",
};

const LEGACY_WASH = "group-hover:bg-muted/50";
const LEGACY_GRADIENT = "from-neutral-800 to-neutral-700";

/** A question of the day's answer format, read without importing the parser. */
function questionFormat(payloadJson?: string | null): "MCQ" | "TEXT" | "UPLOAD" {
  if (!payloadJson) return "MCQ";
  try {
    const format = (JSON.parse(payloadJson) as { format?: string } | null)?.format;
    return format === "TEXT" || format === "UPLOAD" ? format : "MCQ";
  } catch {
    return "MCQ";
  }
}

const cache = new Map<string, EngagementVisual>();

function build(base: TypeVisual, icon: Icon): EngagementVisual {
  return {
    icon,
    tone: base.tone,
    art: base.art,
    label: base.label,
    glyph: createElement(icon, { weight: "duotone", "aria-hidden": true }),
    chip: toneClasses(base.tone, "tile"),
    accent: LEGACY_ACCENT[base.tone],
    wash: LEGACY_WASH,
    gradient: LEGACY_GRADIENT,
  };
}

/**
 * Presentation for a task. Accepts the type (legacy callers) or the item
 * itself; given an item, a written or uploaded question of the day gets the
 * pencil or upload icon instead of the bulb.
 */
export function visualFor(input: EngagementVisualInput): EngagementVisual {
  const type = typeof input === "string" ? input : input?.itemType;
  const base = TYPE_VISUALS[type as EngagementVisualType] ?? FALLBACK_VISUAL;
  const format =
    type === "QUESTION_OF_DAY" && typeof input !== "string"
      ? questionFormat(input?.payloadJson)
      : "MCQ";
  const icon =
    format === "TEXT" ? PencilSimpleLine : format === "UPLOAD" ? UploadSimple : base.icon;
  const key = `${base.label}:${format}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const visual = build(base, icon);
  cache.set(key, visual);
  return visual;
}

/**
 * Corporate skin: one neutral chip for every task type.
 * @deprecated Legacy components only; `toneClasses(tone, "tile")` already
 * carries the corporate variant.
 */
export const CORPORATE_CHIP = "bg-muted text-muted-foreground";

/**
 * Some older catalog strings open with a decorative emoji. Strip it where a
 * surface must not show one.
 */
export function stripLeadingEmoji(text: string): string {
  return text.replace(/^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u, "");
}

/**
 * "4h 12m left" / "18m left". Null once the deadline has passed, so the caller can
 * drop the countdown rather than render a negative one.
 */
export function timeLeftLabel(
  t: TFunction,
  closesAt?: string | null,
  now: number = Date.now()
): string | null {
  if (!closesAt) return null;
  const end = new Date(closesAt).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return t("time.daysLeft", { count: Math.floor(hours / 24) });
  if (hours > 0) return t("time.hoursLeft", { hours, minutes });
  if (totalMinutes > 0) return t("time.minutesLeft", { count: totalMinutes });
  return t("time.closingNow");
}

/** Two hours: the point where a deadline is worth nudging about. */
export const URGENT_MS = 2 * 60 * 60 * 1000;

/** True when the deadline is close enough to be worth nudging about. */
export function isUrgent(closesAt?: string | null, now: number = Date.now()): boolean {
  if (!closesAt) return false;
  const end = new Date(closesAt).getTime();
  if (!Number.isFinite(end)) return false;
  const ms = end - now;
  return ms > 0 && ms <= URGENT_MS;
}

/** "Mon 15 Sep" in the active UI locale, for a plan-local yyyy-MM-dd date. */
export function shortDateLabel(isoDate?: string | null): string {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(date, { weekday: "short", day: "numeric", month: "short", year: undefined });
}

/** Staggered entrance delay, capped so a long list never feels slow. */
export function staggerDelay(index: number): string {
  const steps = ["delay-0", "delay-75", "delay-150", "delay-200", "delay-300"];
  return steps[Math.min(index, steps.length - 1)]!;
}
