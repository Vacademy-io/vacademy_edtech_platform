/**
 * Learner home builder: the resolved home a learner receives from
 * GET /admin-core-service/learner/home/v1/resolved.
 *
 * The server has already filtered blocks by enabled flag, time window, audience,
 * dismissed state and link availability. The client still filters by device
 * (its own viewport) and by expiry (a 60 s tick), and applies the App Store
 * reader-mode rules (link-target.ts).
 *
 * JSON is snake_case, as the other admin_core learner APIs are.
 */

/** The widgets that already exist on the dashboard, placeable as blocks. */
export const BUILTIN_WIDGETS = [
  "HERO",
  "PINS",
  "NOTEBOOK_REVIEW",
  "COMPANIONS",
  "TODAY_TASKS",
  "CONTINUE_LEARNING",
  "ENROLLED_COURSES",
  "STATS_ROW",
  "LEARNING_ANALYTICS",
  "MY_MEMBERSHIP",
  "MY_BOOKS",
  "MY_ORDERS",
  "UPCOMING_LIVE_CLASSES",
  "THIS_WEEK_ATTENDANCE",
  "MY_MENTORS",
  "GET_APP",
  "GAMIFICATION",
  "RAISE_QUERY",
  "EXPLORE_BUTTONS",
] as const;

export type BuiltinWidget = (typeof BUILTIN_WIDGETS)[number];

export type HomeBlockType =
  | "BANNER_CAROUSEL"
  | "SHORTCUTS"
  | "COURSE_SHELF"
  | "NOTICE"
  | "EVENT"
  | "BUILTIN";

export type HomePlacement = "FULL" | "MAIN" | "RAIL";
export type HomeDevices = "BOTH" | "PHONE" | "DESKTOP";
export type PhoneSpacing = "COMPACT" | "COMFORTABLE";

export interface ImageRef {
  file_id?: string | null;
  alt?: string | null;
  decorative?: boolean;
  url: string;
  width?: number | null;
  height?: number | null;
  /** Width in px ("320", "640", "960", "1600") to a WebP URL. */
  renditions?: Record<string, string> | null;
}

export type FeatureKey =
  | "COURSES"
  | "LIVE_CLASSES"
  | "ASSESSMENTS"
  | "REPORTS"
  | "HOMEWORK"
  | "ATTENDANCE"
  | "NOTEBOOK"
  | "DOUBTS"
  | "REFERRAL"
  | "MENTORS"
  | "DAILY_TASKS"
  | "AI_CHAT"
  | "DOWNLOADS"
  | "MY_FILES"
  | "LEADERBOARD"
  | "PROFILE"
  | "NOTIFICATIONS"
  | "STORE_MEMBERSHIPS"
  | "STORE_BOOKS";

interface ResolvedLinkBase {
  /** True when following the link can lead to a purchase (hidden in reader mode). */
  commerce?: boolean;
  available?: boolean;
}

export type LinkTarget =
  | { kind: "COURSE"; package_id: string; owned?: boolean; package_session_id?: string | null }
  | { kind: "COURSE_LIST"; tag?: string | null }
  | { kind: "PRODUCT_PAGE"; code: string }
  | { kind: "LIVE_CLASS"; session_id: string; is_paid?: boolean; in_my_batch?: boolean }
  | { kind: "ASSESSMENT"; assessment_id: string }
  | { kind: "FEATURE"; feature: FeatureKey }
  | { kind: "URL"; url: string; sells_something?: boolean }
  | { kind: "APP_PATH"; path: string };

export type ResolvedLink = LinkTarget & ResolvedLinkBase;

export interface Cta {
  /** Null or missing when the admin set none: the app shows its own translated default. */
  label?: string | null;
  link: ResolvedLink;
}

export interface BannerSlide {
  key: string;
  image: ImageRef;
  desktop_image?: ImageRef | null;
  link?: ResolvedLink | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface BannerCarouselConfig {
  title?: string | null;
  auto_rotate?: boolean;
  slides: BannerSlide[];
}

export type ShortcutIcon =
  | { kind: "ICON"; name: string }
  | { kind: "IMAGE"; image: ImageRef };

export interface ShortcutTile {
  key: string;
  label: string;
  icon: ShortcutIcon;
  link: ResolvedLink;
}

export interface ShortcutsConfig {
  title?: string | null;
  tiles: ShortcutTile[];
}

export interface ShelfCourse {
  package_id: string;
  name: string;
  thumbnail_url?: string | null;
  price?: number | null;
  currency?: string | null;
  is_free?: boolean;
  owned?: boolean;
  link: ResolvedLink;
}

export interface CourseShelfConfig {
  title: string;
  show_price?: boolean;
  hide_owned?: boolean;
  see_all?: ResolvedLink | null;
  courses: ShelfCourse[];
}

export type NoticeTone = "NEUTRAL" | "INFO" | "SUCCESS" | "WARNING";

export interface NoticeConfig {
  title: string;
  body?: string | null;
  image?: ImageRef | null;
  button?: Cta | null;
  tone?: NoticeTone;
  dismissible?: boolean;
  require_ack?: boolean;
  ack_label?: string | null;
  state?: { dismissed?: boolean; acknowledged_at?: string | null } | null;
}

export interface EventConfig {
  title: string;
  subtitle?: string | null;
  image?: ImageRef | null;
  source?: "CUSTOM" | "LIVE_SESSION";
  live_session_id?: string | null;
  starts_at: string;
  ends_at: string;
  join_opens_at?: string | null;
  join_opens_minutes?: number;
  register_cta?: Cta | null;
  join_cta?: Cta | null;
  show_countdown?: boolean;
}

export interface BuiltinConfig {
  options?: {
    getting_started?: boolean;
    cards?: Array<"COURSES" | "LIVE_CLASSES" | "EVALUATIONS">;
    show_all?: boolean;
    memberships?: boolean;
    books?: boolean;
  } | null;
}

interface HomeBlockBase {
  key: string;
  placement: HomePlacement;
  devices: HomeDevices;
  ends_at?: string | null;
  /** Shown by the admin preview only. */
  admin_label?: string | null;
}

export type HomeBlock =
  | (HomeBlockBase & { type: "BANNER_CAROUSEL"; config: BannerCarouselConfig })
  | (HomeBlockBase & { type: "SHORTCUTS"; config: ShortcutsConfig })
  | (HomeBlockBase & { type: "COURSE_SHELF"; config: CourseShelfConfig })
  | (HomeBlockBase & { type: "NOTICE"; config: NoticeConfig })
  | (HomeBlockBase & { type: "EVENT"; config: EventConfig })
  | (HomeBlockBase & {
      type: "BUILTIN";
      builtin_widget: BuiltinWidget;
      config: BuiltinConfig;
      /** Admin preview: the widget's own data is not loaded, draw a labelled placeholder. */
      placeholder?: boolean;
    });

export interface HomeSettings {
  phone_spacing?: PhoneSpacing;
  show_header?: boolean;
  carousel_autoplay_default?: boolean;
}

export interface ResolvedHomeBuilder {
  mode: "BUILDER";
  layout_version: number;
  server_time?: string;
  settings?: HomeSettings | null;
  blocks: HomeBlock[];
  /** Set by the admin preview endpoint. */
  preview?: boolean;
}

export type ResolvedHome = { mode: "LEGACY" } | ResolvedHomeBuilder;

export const isBuilderHome = (home: ResolvedHome | null | undefined): home is ResolvedHomeBuilder =>
  !!home && home.mode === "BUILDER" && Array.isArray((home as ResolvedHomeBuilder).blocks);
