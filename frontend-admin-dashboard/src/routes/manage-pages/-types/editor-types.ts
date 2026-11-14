import type { CatalogueI18nSettings } from '../-utils/catalogue-i18n';

export type CatalogueThemePreset =
    | 'default'
    | 'ocean'
    | 'forest'
    | 'sunset'
    | 'midnight'
    | 'rose'
    | 'violet'
    | 'amber'
    | 'slate';

export type CatalogueBorderRadius = 'sharp' | 'rounded' | 'pill';

export interface GlobalSettings {
    courseCatalogeType: {
        enabled: boolean;
        value?: 'Course' | 'Product';
    };
    mode: 'light' | 'dark';
    /** Site-wide custom CSS, injected into every imported HTML page's shadow
     *  root ahead of that page's own styles.
     *
     *  A pasted multi-page bundle shares one stylesheet — the real one we
     *  tested was 64KB across 36 pages. Stored per page that is ~2MB of
     *  duplicated CSS inside a single catalogue_json; stored here it is one
     *  copy. It cannot simply live in <head>: shadow roots inherit custom
     *  properties but NOT stylesheets, so it has to be pushed into each root. */
    customCss?: string;
    theme?: {
        /** Named color preset */
        preset?: CatalogueThemePreset;
        /** Custom primary hex color — overrides preset when set */
        primaryColor?: string;
        /** Corner roundness variant */
        borderRadius?: CatalogueBorderRadius;
        /** Heading size scale */
        headingScale?: 'compact' | 'default' | 'large' | 'display';
        /** Body font size override */
        bodyFontSize?: string;
        /** Page atmosphere: canvas treatment + strength (data-catalogue-atmosphere) */
        atmosphere?: {
            canvas: 'flat' | 'soft' | 'mesh' | 'aurora';
            intensity?: 'subtle' | 'medium' | 'bold';
        };
    };
    fonts?: {
        enabled: boolean;
        /** Body font (CSS stack). */
        family?: string;
        /** Optional heading font (CSS stack) — a serif/display face over the
         *  sans body. Unset ⇒ headings use the body font. */
        headingFamily?: string;
    };
    compactness: 'small' | 'medium' | 'large';
    audience: 'children' | 'adults' | 'all';
    leadCollection: {
        enabled: boolean;
        mandatory: boolean;
        inviteLink: string | null;
        formStyle?: {
            type: 'single' | 'multiStep';
            showProgress: boolean;
            progressType: 'bar' | 'dots' | 'steps';
            transition: 'slide' | 'fade';
        };
        fields: any[];
    };
    enrquiry?: {
        enabled: boolean;
        requirePayment: boolean;
    };
    /**
     * Per-course authored landing pages: course id (or package session id) →
     * one of this catalogue's page routes. A mapped course opens that page
     * from every "View course" CTA and from a direct hit on its course URL,
     * instead of the shared course details layout; an unmapped course is
     * untouched. Edited under Global settings → Course Pages.
     */
    coursePages?: {
        enabled: boolean;
        courses?: Record<
            string,
            { mode?: 'DETAILS' | 'PAGE' | 'OUTLINE' | 'TILES'; route?: string }
        >;
        /** Pre-modes shape: course id → page route, always meaning PAGE. */
        map?: Record<string, string>;
    };
    /**
     * Step-by-step "find your course" wizard, shown once over the catalogue.
     * The OPTIONS are read live from whichever course block the page renders —
     * only the wording and the grouping are authored, under Global Settings →
     * Course Finder Wizard.
     */
    courseFinder?: {
        enabled: boolean;
        /** Asked in this fixed order; a step with no options is skipped. */
        steps?: ('level' | 'session' | 'tag')[];
        /** No skip button — the visitor must answer before seeing courses. */
        mandatory?: boolean;
        /** Per-step heading override, e.g. `{ level: 'Class' }`. */
        stepLabels?: Partial<Record<'level' | 'session' | 'tag', string>>;
        /**
         * Folds per-subject level names into one option:
         * `{ 'Class 6': ['English - Class 6', 'Mathematics - Class 6'] }`.
         * KEY ORDER IS DISPLAY ORDER — the wizard renders Object.keys()
         * unsorted, so the editor rebuilds this object rather than mutating it.
         */
        levelGroups?: Record<string, string[]>;
    };
    payment: {
        enabled: boolean;
        provider: 'razorpay' | 'stripe' | 'paypal' | 'PHONEPE';
        fields: string[];
    };
    /**
     * Site content languages. The pages stay written in the base language;
     * every other language is a dictionary in `strings[locale]` keyed by the
     * exact base text (see -utils/catalogue-i18n.ts). Absent = one language.
     */
    i18n?: CatalogueI18nSettings;
    layout?: {
        header?: any;
        footer?: any;
    };
    /**
     * Site-level search-engine settings, read by the learner app's edge
     * middleware for crawlers: keywords + verification go into <head>, the
     * organization block becomes schema.org EducationalOrganization JSON-LD
     * (footer social links are merged into sameAs automatically). Per-page
     * title/description/share image live on each page's `seo`.
     */
    seo?: {
        keywords?: string[];
        /** `content` value of Search Console's HTML-tag verification. */
        googleSiteVerification?: string;
        organization?: {
            name?: string;
            legalName?: string;
            description?: string;
            founder?: string;
            foundingDate?: string;
            email?: string;
            telephone?: string;
            address?: string;
            /** Absolute URL of a clean logo on a plain background (≥112px). */
            logo?: string;
            sameAs?: string[];
        };
    };
    /** Sticky header — sticks to top on scroll */
    stickyHeader?: boolean;
    /** Show back-to-top floating button */
    backToTop?: boolean;
    /** Motion personality — scales entrance durations/easing site-wide */
    motion?: {
        personality: 'none' | 'calm' | 'balanced' | 'dynamic';
    };
    /**
     * How a course's language versions are told apart (one card per course,
     * EN / हिं chips, a language filter). Edited under Global Settings → Course
     * languages; read by the learner's -utils/course-variants.ts. Absent =
     * every level stays its own card, exactly as before.
     */
    courseLanguages?: CourseLanguageSettings;
    /**
     * One site-wide course cart whose checkout is the store product page's.
     * Edited under Global Settings → Site cart; read by the learner's
     * -utils/site-cart.ts. On only when enabled AND a store page is chosen.
     */
    siteCart?: SiteCartSettings;
    /**
     * The site's AI assistant (Site Assistant SPEC §1). Edited under Global
     * Settings → Site Assistant; read from the PUBLISHED catalogue by
     * ai_service and the learner widget. Missing keys = the engine defaults.
     */
    siteAssistant?: SiteAssistantSettings;
}

export type SiteAssistantPersona = 'warm' | 'formal' | 'friendly' | 'concise';
export type SiteAssistantPlacementMode = 'all' | 'catalogue_and_courses' | 'routes';
export type SiteAssistantPosition = 'bottom-right' | 'bottom-left';

/** globalSettings.siteAssistant — public by nature (served with the site): nothing secret here. */
export interface SiteAssistantSettings {
    enabled?: boolean;
    name?: string;
    avatarUrl?: string | null;
    greeting?: string;
    persona?: SiteAssistantPersona;
    suggestions?: string[];
    placement?: { mode?: SiteAssistantPlacementMode; routes?: string[] };
    position?: SiteAssistantPosition;
    /** null = the site's primary colour. */
    accentColor?: string | null;
    knowledge?: {
        pages?: boolean;
        courses?: boolean;
        faqs?: boolean;
        notices?: boolean;
        liveClasses?: boolean;
        linkedKbIds?: string[];
    };
    leads?: {
        /** null = the institute's default website-leads list. */
        campaignId?: string | null;
        /** Stream slug → campaign id, for streams whose enquiries go elsewhere. */
        streamCampaigns?: Record<string, string>;
        consentText?: string | null;
    };
    support?: {
        email?: string | null;
        phone?: string | null;
        whatsapp?: string | null;
        loginUrl?: string | null;
    };
    limits?: { dailyAnswers?: number };
    /** Allow the embed snippet on the institute's verified websites. */
    embed?: { enabled?: boolean };
}

/** One language a course can be offered in (mirrors the learner CourseLanguageOption). */
export interface CourseLanguageOption {
    /** Stable code, also used in ?language= (e.g. "hi"). */
    code: string;
    /** Filter label: "Hindi". */
    label: string;
    /** Card chip: "हिं". Falls back to the label. */
    chip?: string;
    /** Words that identify this language inside a level name (case-insensitive). */
    match?: string[];
}

export interface CourseLanguageSettings {
    /** Fold a course's language levels into one card, with language chips and filter. */
    enabled?: boolean;
    /** Absent or empty = the built-in English / Hindi rules. */
    languages?: CourseLanguageOption[];
}

export interface SiteCartSettings {
    enabled?: boolean;
    /** Code of the product page whose checkout takes the whole cart. */
    storeProductPageCode?: string;
    storeProductPageName?: string;
    /**
     * Keep the store page in step with the catalogue: every few minutes the
     * server adds new course versions and switches off ones that left
     * (SiteCartStoreAutoSyncJob). On unless false.
     */
    autoSync?: boolean;
}

/**
 * props of a `learningPath` section (Knowledge Streams spec §8, read by the
 * learner's LearningPathComponent). Only codes and ids are stored — course
 * data is always read live. libraryName is the editor's own display copy.
 */
export interface LearningPathProps {
    /** single = one product page as numbered steps; list = path cards from a folder library. Default single. */
    mode?: 'single' | 'list';
    productPageCode?: string;
    productPageName?: string;
    libraryId?: string;
    libraryName?: string;
    folderId?: string;
    /** List mode: on /courses?stream=… show only that stream's paths. */
    streamFromUrl?: boolean;
    /** Address parameter "View path" sets (default 'path'). */
    pathParam?: string;
    title?: string;
    subtitle?: string;
    showStepNumbers?: boolean;
    showTotal?: boolean;
    addAllLabel?: string;
    enrolLabel?: string;
    viewPathLabel?: string;
    emptyText?: string;
    backgroundColor?: string;
    /** List mode, opt-in: "featured" = goal chips, a featured path and the other paths (learner LearningPathFeatured). */
    listLayout?: 'cards' | 'featured';
    /** Featured layout: the parts this section shows (each defaults to true). */
    showGoals?: boolean;
    showFeatured?: boolean;
    showGrid?: boolean;
    goalParam?: string;
    /** First chip label (default "All paths"). */
    allGoalsLabel?: string;
    goals?: LearningPathGoal[];
    featured?: { code?: string; badge?: string; image?: string };
    /** Per-path extras (step labels, merged steps, coming-soon steps); not edited here, always kept. */
    pathExtras?: unknown[];
    formatLabels?: Record<string, string>;
    /** "More learning paths" heading and the note on its right. */
    moreTitle?: string;
    moreNote?: string;
    /** Opt-in: read goals, the featured path and path extras from this learningPath section on the page. */
    sharedWith?: string;
}

/** A goal chip of the featured layout: matches the paths in these stream tags (folder course tag / slug). */
export interface LearningPathGoal {
    /** Kept in ?goal= */
    key: string;
    label: string;
    tags?: string[];
}

/** Show a section only for certain query strings (mirrors the learner VisibleWhenRule). */
export interface VisibleWhenRule {
    param: string;
    op: 'empty' | 'notEmpty' | 'equals' | 'notEquals';
    value?: string;
}

// Style schema now lives in the SHARED catalogue style engine (byte-synced
// with the learner renderer via scripts/check-style-engine-sync.mjs) so the
// editor and the live site can never disagree about what a style means.
export type {
    GradientStop,
    GradientConfig,
    TypographyStyle,
    AnimationEntrance,
    AnimationConfig,
    ComponentStyle,
    SectionLayoutStyle,
    SectionWidth,
    GlassConfig,
    GlowConfig,
    BorderGradientConfig,
    BackgroundLayer,
    OverlayPreset,
} from '../-utils/style-engine';
export type {
    OrnamentConfig,
    DividerConfig,
    SectionDividers,
} from '../-utils/catalogue-decorations';
import type { ComponentStyle } from '../-utils/style-engine';

export interface Component {
    id: string;
    type: string;
    enabled: boolean;
    showCondition?: {
        field: string;
        value: boolean | string;
    };
    props: Record<string, any>;
    style?: ComponentStyle;
    /** Anchor ID for in-page linking (e.g. "pricing" → #pricing) */
    anchorId?: string;
    /**
     * Show the section only when every rule holds for the page's query string,
     * e.g. [{ param: 'stream', op: 'empty' }] = only on the All courses tab (no ?stream).
     * Absent = always shown.
     */
    visibleWhen?: VisibleWhenRule[];
}

export interface Page {
    id: string;
    route: string;
    title?: string;
    published?: boolean;
    /** Page-level background color override */
    backgroundColor?: string;
    /** Hide the site header and footer on this page. An imported HTML page
     *  usually pastes in its own nav and footer, so the site's chrome would
     *  render a second set. Set automatically when a page is created as an
     *  HTML page. */
    hideSiteChrome?: boolean;
    seo?: {
        metaTitle?: string;
        metaDescription?: string;
        ogImage?: string;
    };
    components: Component[];
}

export interface CatalogueConfig {
    version?: string;
    globalSettings: GlobalSettings;
    introPage?: any;
    pages: Page[];
}

export interface CatalogueTag {
    tagName: string;
    status: 'active' | 'draft';
    lastModified?: string;
    catalogueConfig?: CatalogueConfig;
}
