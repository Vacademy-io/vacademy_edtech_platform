/**
 * What the builder home shows on THIS device, now, to THIS learner.
 *
 * The server already filtered by enabled flag, schedule, audience, dismissed
 * state and link availability. The client adds what only it knows (spec 7.1.4,
 * 6.3, 6.4, 7.6):
 * - the device class of its own viewport (no refetch on rotate or resize);
 * - expiry, re-checked by a 60 s tick (block window, slide window, event end);
 * - App Store reader mode: commerce links and unowned courses disappear;
 * - FEATURE targets the learner does not have;
 * - the Fun skin's leave-outs for built-in widgets.
 * Blocks left with nothing to show are dropped here, so a column never keeps
 * an empty slot.
 */
import type {
  BannerSlide,
  BuiltinWidget,
  Cta,
  HomeBlock,
  HomeDevices,
  ResolvedLink,
  ShelfCourse,
} from "@/types/learner-home";
import { funHomeKeeps } from "../fun/home-widgets";
import { isSellingOnlyLink, toNavigation, type LinkContext } from "./link-target";
import type { StudentDashboardWidgetId } from "@/types/student-display-settings";

/** Max slides a carousel shows (the server enforces it too). */
export const MAX_SLIDES = 5;

export interface PrepareContext extends LinkContext {
  isPhone: boolean;
  nowMs: number;
  /** The Fun skin is on (and the institute is not the Holistic one). */
  funSkin: boolean;
}

export const deviceAllows = (devices: HomeDevices | null | undefined, isPhone: boolean): boolean =>
  !devices || devices === "BOTH" || (devices === "PHONE" ? isPhone : !isPhone);

/** True once `iso` is in the past. A missing or unreadable instant never expires. */
export function hasEnded(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= nowMs;
}

/**
 * The legacy dashboard widget id each built-in stands for: the Fun skin's
 * leave-out list and the classic visibility checks are keyed by these.
 */
export const BUILTIN_LEGACY_IDS: Partial<Record<BuiltinWidget, string>> = {
  TODAY_TASKS: "todayTasks",
  CONTINUE_LEARNING: "continueLearning",
  ENROLLED_COURSES: "enrolledCourses",
  STATS_ROW: "statsRow",
  LEARNING_ANALYTICS: "learningAnalytics",
  MY_MEMBERSHIP: "myMembership",
  MY_BOOKS: "myBooks",
  MY_ORDERS: "myOrders",
  UPCOMING_LIVE_CLASSES: "upcomingLiveClasses",
  THIS_WEEK_ATTENDANCE: "thisWeekAttendance",
  MY_MENTORS: "myMentors",
  GET_APP: "getApp",
  GAMIFICATION: "gamification",
};

/** False for a built-in the Fun home leaves out (FUN_HOME_LEAVES_OUT). */
export function funKeepsBuiltin(widget: BuiltinWidget): boolean {
  const legacyId = BUILTIN_LEGACY_IDS[widget];
  return legacyId ? funHomeKeeps(legacyId) : true;
}

/**
 * The built-in a classic widget switch belongs to in builder mode. The three
 * stat cards share STATS_ROW (its `cards` option picks them), the two Explore
 * buttons share EXPLORE_BUTTONS, and Getting started is a HERO option.
 */
export function builtinForLegacyWidget(id: StudentDashboardWidgetId): BuiltinWidget | null {
  switch (id) {
    case "todayTasks":
      return "TODAY_TASKS";
    case "continueLearning":
      return "CONTINUE_LEARNING";
    case "enrolledCourses":
      return "ENROLLED_COURSES";
    case "coursesStat":
    case "liveClasses":
    case "evaluationStat":
      return "STATS_ROW";
    case "learningAnalytics":
      return "LEARNING_ANALYTICS";
    case "myMembership":
      return "MY_MEMBERSHIP";
    case "myBooks":
      return "MY_BOOKS";
    case "myOrders":
      return "MY_ORDERS";
    case "upcomingLiveClasses":
      return "UPCOMING_LIVE_CLASSES";
    case "thisWeekAttendance":
      return "THIS_WEEK_ATTENDANCE";
    case "myMentors":
      return "MY_MENTORS";
    case "getApp":
      return "GET_APP";
    case "gamification":
      return "GAMIFICATION";
    case "exploreMemberships":
    case "exploreBooks":
      return "EXPLORE_BUTTONS";
    case "gettingStarted":
      return "HERO";
    default:
      return null;
  }
}

const linkOrNull = (link: ResolvedLink | null | undefined, ctx: LinkContext) =>
  link && toNavigation(link, ctx) ? link : null;

// A CTA without a label is kept: the block shows its translated default label.
const ctaOrNull = (cta: Cta | null | undefined, ctx: LinkContext): Cta | null =>
  cta && linkOrNull(cta.link, ctx) ? cta : null;

function prepareSlides(slides: readonly BannerSlide[], ctx: PrepareContext): BannerSlide[] {
  return slides
    .filter((s) => s && s.image && s.image.url)
    .filter((s) => !hasEnded(s.ends_at, ctx.nowMs))
    .filter((s) => !(ctx.readerMode && isSellingOnlyLink(s.link)))
    .slice(0, MAX_SLIDES)
    .map((s) => ({ ...s, link: linkOrNull(s.link, ctx) }));
}

function prepareCourses(courses: readonly ShelfCourse[], ctx: PrepareContext): ShelfCourse[] {
  return courses.filter((c) => c && c.package_id && (!ctx.readerMode || c.owned === true));
}

/** One block as this device and learner see it, or null when nothing is left to show. */
export function prepareBlock(block: HomeBlock, ctx: PrepareContext): HomeBlock | null {
  if (!deviceAllows(block.devices, ctx.isPhone)) return null;
  if (hasEnded(block.ends_at, ctx.nowMs)) return null;

  switch (block.type) {
    case "BANNER_CAROUSEL": {
      const slides = prepareSlides(block.config?.slides ?? [], ctx);
      return slides.length ? { ...block, config: { ...block.config, slides } } : null;
    }
    case "SHORTCUTS": {
      const tiles = (block.config?.tiles ?? []).filter(
        (t) => t && t.label && t.icon && toNavigation(t.link, ctx)
      );
      return tiles.length ? { ...block, config: { ...block.config, tiles } } : null;
    }
    case "COURSE_SHELF": {
      const courses = prepareCourses(block.config?.courses ?? [], ctx);
      if (!courses.length) return null;
      return {
        ...block,
        config: { ...block.config, courses, see_all: linkOrNull(block.config.see_all, ctx) },
      };
    }
    case "NOTICE": {
      if (!block.config?.title) return null;
      if (block.config.state?.dismissed) return null;
      return { ...block, config: { ...block.config, button: ctaOrNull(block.config.button, ctx) } };
    }
    case "EVENT": {
      const c = block.config;
      if (!c || !c.title || !c.starts_at || !c.ends_at) return null;
      if (hasEnded(c.ends_at, ctx.nowMs)) return null;
      return {
        ...block,
        config: {
          ...c,
          register_cta: ctaOrNull(c.register_cta, ctx),
          join_cta: ctaOrNull(c.join_cta, ctx),
        },
      };
    }
    case "BUILTIN": {
      if (ctx.funSkin && !funKeepsBuiltin(block.builtin_widget)) return null;
      return block;
    }
    default:
      // A block type this build does not know (a newer server): skip it.
      return null;
  }
}

export function prepareBlocks(blocks: readonly HomeBlock[], ctx: PrepareContext): HomeBlock[] {
  const out: HomeBlock[] = [];
  const seenBuiltins = new Set<BuiltinWidget>();
  for (const block of blocks ?? []) {
    if (!block || !block.key) continue;
    if (block.type === "BUILTIN") {
      // Each built-in renders once: a duplicate would mount the same widget twice.
      if (seenBuiltins.has(block.builtin_widget)) continue;
      seenBuiltins.add(block.builtin_widget);
    }
    const prepared = prepareBlock(block, ctx);
    if (prepared) out.push(prepared);
  }
  return out;
}

/** The built-ins on screen; drives the classic widgets' data gates in builder mode. */
export function builtinsOnScreen(blocks: readonly HomeBlock[]): Map<BuiltinWidget, HomeBlock> {
  const map = new Map<BuiltinWidget, HomeBlock>();
  for (const b of blocks) if (b.type === "BUILTIN") map.set(b.builtin_widget, b);
  return map;
}
