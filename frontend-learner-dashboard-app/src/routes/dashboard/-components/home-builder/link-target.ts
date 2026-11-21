/**
 * One resolver for every link on the builder home (banner slides, shortcut
 * tiles, shelf cards and "See all", notice buttons, event CTAs).
 *
 * `toNavigation(link, ctx)` is pure: it answers what following the link does,
 * or null when the link must not be offered to this learner (unavailable,
 * commerce in App Store reader mode, a feature this learner does not have).
 * `followNavigation(nav, deps)` performs it with injected side effects, so both
 * halves are unit-tested without a router.
 *
 * Internal targets are SPA navigations, also inside the Capacitor WebView.
 * External URLs never replace the WebView: they go through openInBrowser
 * (Capacitor Browser in the app, the system browser in Electron, a new tab on
 * the web).
 */
import type { FeatureKey, ResolvedLink } from "@/types/learner-home";
import { customWidgetLinkAction } from "@/services/student-display-settings";
import { isReaderBlockedPath } from "@/lib/reader-blocked-paths";

/** The Preferences key InstructionPage reads before the URL id (see clearStaleAssessmentKey). */
export const ASSESSMENT_INSTRUCTION_KEY = "InstructionID_and_AboutID";

export type HomeNavigation =
  | {
      kind: "route";
      to: string;
      search?: Record<string, string>;
      params?: Record<string, string>;
      /** Side effect to run first. */
      before?: "CLEAR_ASSESSMENT_KEY" | "LEVEL_FILTER_RENT" | "LEVEL_FILTER_BUY";
    }
  | { kind: "href"; href: string }
  | { kind: "external"; url: string }
  | { kind: "assign"; url: string }
  | { kind: "open-doubts" }
  | { kind: "live-class"; sessionId: string; inMyBatch: boolean };

/** Per-learner facts the client knows and the server does not. */
export interface LinkContext {
  /** shouldHidePaidPurchaseUI(): native iOS or a Mac App Store build. */
  readerMode: boolean;
  /** The play (K-12) skin hides store shortcuts, as it hides the Explore buttons. */
  playSkin: boolean;
  /** FEATURE availability; a feature missing from the map counts as available. */
  features?: Partial<Record<FeatureKey, boolean>>;
  /** The learner's primary batch, for LEADERBOARD. */
  primaryBatchId?: string | null;
}

/** Features whose availability depends on the learner (spec 6.3); the rest are always on. */
export const CONDITIONAL_FEATURES: readonly FeatureKey[] = [
  "HOMEWORK",
  "NOTEBOOK",
  "DOUBTS",
  "REFERRAL",
  "DAILY_TASKS",
  "AI_CHAT",
  "DOWNLOADS",
  "LEADERBOARD",
  "STORE_MEMBERSHIPS",
  "STORE_BOOKS",
];

const FEATURE_ROUTES: Partial<Record<FeatureKey, string>> = {
  COURSES: "/study-library/courses",
  LIVE_CLASSES: "/study-library/live-class",
  ASSESSMENTS: "/assessment/examination",
  REPORTS: "/assessment/reports",
  HOMEWORK: "/homework/list",
  ATTENDANCE: "/learning-centre/attendance",
  NOTEBOOK: "/notebook",
  REFERRAL: "/referral",
  MENTORS: "/my-mentors",
  DAILY_TASKS: "/engagement",
  AI_CHAT: "/chat",
  DOWNLOADS: "/downloads",
  MY_FILES: "/my-files",
  PROFILE: "/user-profile",
  NOTIFICATIONS: "/dashboard/notifications",
};

/** Whether a link may lead to a purchase. The server sets `commerce`; the client re-derives it as a safety net. */
export function isCommerceLink(link: ResolvedLink): boolean {
  if (link.commerce) return true;
  switch (link.kind) {
    case "PRODUCT_PAGE":
      return true;
    case "COURSE":
      return link.owned !== true;
    case "LIVE_CLASS":
      return link.is_paid === true;
    case "URL":
      return link.sells_something === true;
    case "APP_PATH":
      return isReaderBlockedPath(pathOnly(link.path));
    case "FEATURE":
      return link.feature === "STORE_MEMBERSHIPS" || link.feature === "STORE_BOOKS";
    default:
      return false;
  }
}

/**
 * A slide that exists only to sell (spec 6.4 rule 3): removed entirely in
 * reader mode rather than shown without its link.
 */
export function isSellingOnlyLink(link: ResolvedLink | null | undefined): boolean {
  if (!link) return false;
  if (link.kind === "PRODUCT_PAGE") return true;
  if (link.kind === "COURSE") return link.owned !== true;
  if (link.kind === "FEATURE") return link.feature === "STORE_MEMBERSHIPS" || link.feature === "STORE_BOOKS";
  return false;
}

const pathOnly = (path: string): string => path.split(/[?#]/)[0] ?? path;

export function toNavigation(
  link: ResolvedLink | null | undefined,
  ctx: LinkContext
): HomeNavigation | null {
  if (!link || link.available === false) return null;
  if (ctx.readerMode && isCommerceLink(link)) return null;

  switch (link.kind) {
    case "COURSE": {
      if (!link.package_id) return null;
      if (link.owned) {
        const search: Record<string, string> = { courseId: link.package_id };
        if (link.package_session_id) search.packageSessionId = link.package_session_id;
        return { kind: "route", to: "/study-library/courses/course-details", search };
      }
      return { kind: "route", to: "/courses/course-details", search: { courseId: link.package_id } };
    }
    case "COURSE_LIST": {
      const tag = (link.tag ?? "").trim();
      return tag
        ? { kind: "route", to: "/study-library/courses", search: { tag } }
        : { kind: "route", to: "/study-library/courses" };
    }
    case "PRODUCT_PAGE":
      if (!link.code) return null;
      return {
        kind: "route",
        to: "/product-pages/$productPageCode",
        params: { productPageCode: link.code },
      };
    case "LIVE_CLASS":
      if (!link.session_id) return null;
      return { kind: "live-class", sessionId: link.session_id, inMyBatch: link.in_my_batch === true };
    case "ASSESSMENT":
      if (!link.assessment_id) return null;
      return {
        kind: "route",
        to: "/assessment/examination/$assessmentId",
        params: { assessmentId: link.assessment_id },
        before: "CLEAR_ASSESSMENT_KEY",
      };
    case "FEATURE":
      return featureNavigation(link.feature, ctx);
    case "URL": {
      const action = customWidgetLinkAction(link.url);
      if (!action) return null;
      if (action.kind === "external") return { kind: "external", url: action.url };
      if (action.kind === "assign") return { kind: "assign", url: action.url };
      // A relative value is not a valid URL target (the server rejects it); never follow it.
      return null;
    }
    case "APP_PATH": {
      if (ctx.readerMode && isReaderBlockedPath(pathOnly(link.path))) return null;
      const action = customWidgetLinkAction(link.path);
      if (!action) return null;
      if (action.kind === "href") return { kind: "href", href: action.href };
      if (action.kind === "to") {
        // "/" bounces to the landing page; there is nothing to open.
        if (action.to === "/") return null;
        return { kind: "route", to: action.to };
      }
      return null;
    }
    default:
      return null;
  }
}

function featureNavigation(feature: FeatureKey, ctx: LinkContext): HomeNavigation | null {
  if (ctx.features && ctx.features[feature] === false) return null;
  if (feature === "STORE_MEMBERSHIPS" || feature === "STORE_BOOKS") {
    if (ctx.readerMode || ctx.playSkin) return null;
    return {
      kind: "route",
      to: "/collections",
      before: feature === "STORE_MEMBERSHIPS" ? "LEVEL_FILTER_RENT" : "LEVEL_FILTER_BUY",
    };
  }
  if (feature === "DOUBTS") return { kind: "open-doubts" };
  if (feature === "LEADERBOARD") {
    if (!ctx.primaryBatchId) return null;
    return {
      kind: "route",
      to: "/leaderboard/$packageSessionId",
      params: { packageSessionId: ctx.primaryBatchId },
    };
  }
  const to = FEATURE_ROUTES[feature];
  return to ? { kind: "route", to } : null;
}

/**
 * An href for the link's anchor (long-press, screen readers announcing a
 * link). The click itself always goes through followNavigation.
 */
export function navigationHref(nav: HomeNavigation): string | undefined {
  switch (nav.kind) {
    case "route": {
      let path = nav.to;
      for (const [k, v] of Object.entries(nav.params ?? {})) {
        path = path.replace("$" + k, encodeURIComponent(v));
      }
      const qs = new URLSearchParams(nav.search ?? {}).toString();
      return qs ? `${path}?${qs}` : path;
    }
    case "href":
      return nav.href;
    case "external":
    case "assign":
      return nav.url;
    case "live-class":
      return nav.inMyBatch
        ? "/study-library/live-class"
        : `/register/live-class?${new URLSearchParams({ sessionId: nav.sessionId }).toString()}`;
    default:
      return undefined;
  }
}

export interface FollowDeps {
  navigate: (opts: {
    to?: string;
    href?: string;
    search?: Record<string, string>;
    params?: Record<string, string>;
  }) => void;
  openExternal: (url: string) => Promise<void> | void;
  assign: (url: string) => void;
  openDoubts: () => void;
  /** In-app join (learner's batch has the session) or the public live-class page. */
  openLiveClass: (sessionId: string, inMyBatch: boolean) => Promise<void> | void;
  removePreference: (key: string) => Promise<void> | void;
  setSessionItem: (key: string, value: string) => void;
  /** Called before an external link leaves the app, so queued analytics go out first. */
  beforeLeave?: () => void;
}

export async function followNavigation(nav: HomeNavigation, deps: FollowDeps): Promise<void> {
  switch (nav.kind) {
    case "route": {
      if (nav.before === "CLEAR_ASSESSMENT_KEY") {
        // InstructionPage prefers this cached key over the URL id; a stale one
        // from another assessment would show the wrong instructions.
        try {
          await deps.removePreference(ASSESSMENT_INSTRUCTION_KEY);
        } catch {
          // best-effort
        }
      } else if (nav.before === "LEVEL_FILTER_RENT") {
        deps.setSessionItem("levelFilter", "rent");
      } else if (nav.before === "LEVEL_FILTER_BUY") {
        deps.setSessionItem("levelFilter", "buy");
      }
      deps.navigate({ to: nav.to, search: nav.search, params: nav.params });
      return;
    }
    case "href":
      deps.navigate({ href: nav.href });
      return;
    case "external":
      deps.beforeLeave?.();
      await deps.openExternal(nav.url);
      return;
    case "assign":
      deps.beforeLeave?.();
      deps.assign(nav.url);
      return;
    case "open-doubts":
      deps.openDoubts();
      return;
    case "live-class":
      await deps.openLiveClass(nav.sessionId, nav.inMyBatch);
      return;
  }
}
