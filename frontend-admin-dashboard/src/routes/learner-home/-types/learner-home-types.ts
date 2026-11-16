/**
 * Learner home builder: the wire shapes of the admin API
 * (`/admin-core-service/v1/learner-home/admin`). JSON is snake_case, as the
 * server sends it. Nothing here is transformed on the way in or out, so the
 * same objects are stored in the editor and sent back on save.
 */

export const BLOCK_TYPES = [
    'BANNER_CAROUSEL',
    'SHORTCUTS',
    'COURSE_SHELF',
    'NOTICE',
    'EVENT',
    'BUILTIN',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** The block types an admin creates (everything except the built-in widgets). */
export const CONTENT_BLOCK_TYPES = [
    'BANNER_CAROUSEL',
    'SHORTCUTS',
    'COURSE_SHELF',
    'NOTICE',
    'EVENT',
] as const;
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

/** Spec 2.6: one value per existing learner dashboard widget (19). */
export const BUILTIN_WIDGETS = [
    'HERO',
    'PINS',
    'NOTEBOOK_REVIEW',
    'COMPANIONS',
    'TODAY_TASKS',
    'CONTINUE_LEARNING',
    'ENROLLED_COURSES',
    'STATS_ROW',
    'LEARNING_ANALYTICS',
    'MY_MEMBERSHIP',
    'MY_BOOKS',
    'MY_ORDERS',
    'UPCOMING_LIVE_CLASSES',
    'THIS_WEEK_ATTENDANCE',
    'MY_MENTORS',
    'GET_APP',
    'GAMIFICATION',
    'RAISE_QUERY',
    'EXPLORE_BUTTONS',
] as const;
export type BuiltinWidget = (typeof BUILTIN_WIDGETS)[number];

export const DESKTOP_PLACEMENTS = ['FULL', 'MAIN', 'RAIL'] as const;
export type DesktopPlacement = (typeof DESKTOP_PLACEMENTS)[number];

export const DEVICES = ['BOTH', 'PHONE', 'DESKTOP'] as const;
export type Devices = (typeof DEVICES)[number];

export type TemplateKey = 'COURSES_ONLY' | 'CLASSROOM' | 'STOREFRONT' | 'CURRENT' | 'BLANK';

export type LayoutStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

// ─── Shared value types (spec 3.1) ───────────────────────────────────────────

export interface ImageRef {
    /** Media-service file id. Null only for an image that came in as a bare URL. */
    file_id: string | null;
    alt: string;
    decorative: boolean;
    url: string;
    width?: number | null;
    height?: number | null;
    /** Filled by the server at publish. The editor never writes it. */
    renditions?: Record<string, string> | null;
}

/** Spec 6.3: in-app features a link can open. */
export const FEATURE_KEYS = [
    'COURSES',
    'LIVE_CLASSES',
    'ASSESSMENTS',
    'REPORTS',
    'HOMEWORK',
    'ATTENDANCE',
    'NOTEBOOK',
    'DOUBTS',
    'REFERRAL',
    'MENTORS',
    'DAILY_TASKS',
    'AI_CHAT',
    'DOWNLOADS',
    'MY_FILES',
    'LEADERBOARD',
    'PROFILE',
    'NOTIFICATIONS',
    'STORE_MEMBERSHIPS',
    'STORE_BOOKS',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type LinkTarget =
    | { kind: 'COURSE'; package_id: string }
    | { kind: 'COURSE_LIST'; tag?: string | null }
    | { kind: 'PRODUCT_PAGE'; code: string }
    | { kind: 'LIVE_CLASS'; session_id: string }
    | { kind: 'ASSESSMENT'; assessment_id: string }
    | { kind: 'FEATURE'; feature: FeatureKey }
    | { kind: 'URL'; url: string; sells_something: boolean }
    | { kind: 'APP_PATH'; path: string };
export type LinkKind = LinkTarget['kind'];

export interface Cta {
    label: string;
    link: LinkTarget;
}

// ─── Audience (spec 3.2) ─────────────────────────────────────────────────────

export type AudienceCondition =
    | { kind: 'PACKAGE_SESSION'; ids: string[] }
    | { kind: 'ENROLLED_IN_COURSE'; package_ids: string[] }
    | { kind: 'NOT_ENROLLED_IN_COURSE'; package_ids: string[] }
    | { kind: 'USER_TAG'; tag_ids: string[] };
export type AudienceConditionKind = AudienceCondition['kind'];

export type Audience = { mode: 'EVERYONE' } | { mode: 'RULES'; all_of: AudienceCondition[] };

// ─── Per-type config (spec 3.3) ──────────────────────────────────────────────

export interface BannerSlide {
    key: string;
    /** Required to publish; null while the slide is a placeholder. */
    image: ImageRef | null;
    desktop_image: ImageRef | null;
    link: LinkTarget | null;
    starts_at: string | null;
    ends_at: string | null;
}

export interface BannerCarouselConfig {
    title: string;
    auto_rotate: boolean;
    slides: BannerSlide[];
}

/** IMAGE with a null image is a placeholder the publish checks flag. */
export type ShortcutIcon =
    | { kind: 'ICON'; name: string }
    | { kind: 'IMAGE'; image: ImageRef | null };

export interface ShortcutTile {
    key: string;
    label: string;
    icon: ShortcutIcon;
    /** Required to publish; null while the tile is a placeholder. */
    link: LinkTarget | null;
}

export interface ShortcutsConfig {
    title: string;
    tiles: ShortcutTile[];
}

export type ShelfSource = 'TAG' | 'HAND_PICKED' | 'NEWEST' | 'FREE';

export interface CourseShelfConfig {
    title: string;
    source: ShelfSource;
    tags: string[];
    package_ids: string[];
    limit: number;
    hide_owned: boolean;
    show_price: boolean;
    see_all: LinkTarget | null;
}

export type NoticeTone = 'NEUTRAL' | 'INFO' | 'SUCCESS' | 'WARNING';

export interface NoticeConfig {
    title: string;
    body: string;
    image: ImageRef | null;
    button: Cta | null;
    tone: NoticeTone;
    dismissible: boolean;
    require_ack: boolean;
    ack_label: string;
}

export type EventSource = 'CUSTOM' | 'LIVE_SESSION';

export interface EventConfig {
    title: string;
    subtitle: string;
    image: ImageRef | null;
    source: EventSource;
    live_session_id: string | null;
    starts_at: string | null;
    ends_at: string | null;
    register_cta: Cta | null;
    join_cta: Cta | null;
    join_opens_minutes: number;
    show_countdown: boolean;
}

export type StatsCard = 'COURSES' | 'LIVE_CLASSES' | 'EVALUATIONS';

export interface BuiltinOptions {
    getting_started?: boolean;
    cards?: StatsCard[];
    show_all?: boolean;
    memberships?: boolean;
    books?: boolean;
}

export interface BuiltinConfig {
    options: BuiltinOptions;
}

export interface BlockConfigByType {
    BANNER_CAROUSEL: BannerCarouselConfig;
    SHORTCUTS: ShortcutsConfig;
    COURSE_SHELF: CourseShelfConfig;
    NOTICE: NoticeConfig;
    EVENT: EventConfig;
    BUILTIN: BuiltinConfig;
}

interface BlockEnvelope {
    /** Stable across versions; analytics and learner state key on it. */
    block_key: string;
    desktop_placement: DesktopPlacement;
    devices: Devices;
    enabled: boolean;
    admin_label: string | null;
    /** True instants (ISO-8601 with offset). Null = no bound. */
    starts_at: string | null;
    ends_at: string | null;
    audience: Audience;
}

export type HomeBlockOf<T extends BlockType> = BlockEnvelope & {
    type: T;
    builtin_widget: T extends 'BUILTIN' ? BuiltinWidget : null;
    config: BlockConfigByType[T];
};

export type HomeBlock = { [T in BlockType]: HomeBlockOf<T> }[BlockType];

// ─── Layout (spec 2.1, 5.2) ──────────────────────────────────────────────────

export type PhoneSpacing = 'COMPACT' | 'COMFORTABLE';

export interface LayoutSettings {
    phone_spacing: PhoneSpacing;
    show_header: boolean;
    carousel_autoplay_default: boolean;
}

export interface Layout {
    id: string;
    status: LayoutStatus;
    version: number;
    base_version: number | null;
    revision: number;
    template_key: TemplateKey | null;
    settings: LayoutSettings;
    blocks: HomeBlock[];
    updated_at?: string | null;
    updated_by?: string | null;
}

export interface PublishedSummary {
    version: number;
    published_at: string | null;
    published_by: string | null;
    block_count?: number | null;
    /**
     * The live blocks, for the publish change summary and Results names.
     * Not in spec 5.2; used when the server sends it.
     */
    blocks?: HomeBlock[] | null;
}

export interface DraftResponse {
    module_enabled: boolean;
    /** The institute keeps its hard-coded home (decision Q1): start and publish answer 409. */
    holistic: boolean;
    draft: Layout | null;
    published: PublishedSummary | null;
}

export interface CreateDraftRequest {
    template_key: TemplateKey;
    settings: LayoutSettings;
    blocks: HomeBlock[];
}

export interface SaveDraftRequest {
    revision: number;
    settings: LayoutSettings;
    blocks: HomeBlock[];
}

/** Contract deviation 1: PUT /draft also returns the canonical layout. */
export interface SaveDraftResponse {
    revision: number;
    updated_at?: string | null;
    layout?: unknown;
}

/** GET /publish-checks: the server's dry run over the saved draft. */
export interface PublishChecksResponse {
    errors: CheckIssue[];
    warnings: CheckIssue[];
}

export interface PublishResponse {
    version: number;
    warnings: CheckIssue[];
}

export interface VersionRow {
    version: number;
    status: LayoutStatus;
    published_at: string | null;
    published_by: string | null;
    block_count: number;
}

// ─── Checks (spec 6.6) ───────────────────────────────────────────────────────

export type CheckSeverity = 'error' | 'warning';

export interface CheckIssue {
    /** Null for a layout-wide issue. */
    block_key: string | null;
    /** Field path inside the block, e.g. "config.slides[0].image.alt". */
    path: string | null;
    code: string;
    severity?: CheckSeverity;
    /** Server text, shown when the code is not one the editor knows. */
    message?: string | null;
    /** Values for the message (limits, counts). */
    params?: Record<string, string | number>;
}

// ─── Preview (spec 5.2 POST /preview) ────────────────────────────────────────

export type PreviewDevice = 'PHONE' | 'DESKTOP';

export interface PreviewRequest {
    source: 'DRAFT' | 'PUBLISHED' | 'INLINE';
    blocks?: HomeBlock[];
    settings?: LayoutSettings;
    as: { package_session_ids: string[]; user_tag_ids: string[] };
    device: PreviewDevice;
    at?: string;
}

/** The learner's resolved shape (spec 5.3). The editor only forwards it. */
export interface ResolvedHome {
    mode: 'BUILDER' | 'LEGACY';
    layout_version?: number;
    server_time?: string;
    settings?: Partial<LayoutSettings>;
    blocks?: Array<Record<string, unknown>>;
    preview?: boolean;
}

// ─── Results (spec 5.2 GET /analytics, /acks) ────────────────────────────────

export interface DeviceCounts {
    views: number;
    clicks: number;
}

export interface AnalyticsItemRow {
    item_key: string;
    label: string | null;
    views: number;
    clicks: number;
}

export interface AnalyticsBlockRow {
    block_key: string;
    admin_label: string | null;
    type: BlockType;
    views: number;
    clicks: number;
    ctr: number | null;
    by_device: Partial<Record<'PHONE' | 'TABLET' | 'DESKTOP', DeviceCounts>>;
    items: AnalyticsItemRow[];
    dismisses: number;
    acks: number;
}

export interface AnalyticsResponse {
    blocks: AnalyticsBlockRow[];
}

export interface AckRow {
    user_id: string;
    full_name: string | null;
    email: string | null;
    acknowledged_at: string;
}

export interface AcksResponse {
    total: number;
    rows: AckRow[];
}
