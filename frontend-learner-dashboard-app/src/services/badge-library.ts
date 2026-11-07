/**
 * Badge Library — "Playful" tiered achievement collection (v2, generated).
 *
 * Bright, chunky, Duolingo-style circular badges: a consistent themed emblem per
 * achievement, tier conveyed by a metallic ring (bronze → silver → gold → platinum →
 * diamond). WebPs are transparent-background so they sit on any card or dark surface.
 *
 * A ready-made set of tiered reward badges. Each badge has a stable `lib:` token
 * stored in a badge's `icon` field; BadgeVisual renders it from the bundled WebP in
 * `public/badge-library/`. Because it is token-addressed, award snapshots keep their
 * look forever and the set can grow without touching render or picker code.
 *
 * KEEP THIS FILE IDENTICAL between the admin and learner apps.
 */
export type BadgeTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

export interface LibraryBadge {
    /** Stable icon token, e.g. "lib:streak-gold". Stored in a badge's `icon`. */
    token: string;
    /** Bundled asset path, served from /public. */
    url: string;
    /** Achievement key (groups the five tiers). */
    theme: string;
    /** Human label for the achievement. */
    themeLabel: string;
    tier: BadgeTier;
    /** Suggested unlock trigger for this achievement. */
    trigger: string;
    /** Short description shown on hover / in the picker. */
    description: string;
}

export const TIER_ORDER: BadgeTier[] = ["bronze", "silver", "gold", "platinum", "diamond"];

export const BADGE_LIBRARY: LibraryBadge[] = [
    { token: "lib:first_steps-bronze", url: "/badge-library/lib_first_steps_bronze.webp", theme: "first_steps", themeLabel: "First Steps", tier: "bronze", trigger: "course_count", description: "Enrol in your first courses" },
    { token: "lib:first_steps-silver", url: "/badge-library/lib_first_steps_silver.webp", theme: "first_steps", themeLabel: "First Steps", tier: "silver", trigger: "course_count", description: "Enrol in your first courses" },
    { token: "lib:first_steps-gold", url: "/badge-library/lib_first_steps_gold.webp", theme: "first_steps", themeLabel: "First Steps", tier: "gold", trigger: "course_count", description: "Enrol in your first courses" },
    { token: "lib:first_steps-platinum", url: "/badge-library/lib_first_steps_platinum.webp", theme: "first_steps", themeLabel: "First Steps", tier: "platinum", trigger: "course_count", description: "Enrol in your first courses" },
    { token: "lib:first_steps-diamond", url: "/badge-library/lib_first_steps_diamond.webp", theme: "first_steps", themeLabel: "First Steps", tier: "diamond", trigger: "course_count", description: "Enrol in your first courses" },
    { token: "lib:streak-bronze", url: "/badge-library/lib_streak_bronze.webp", theme: "streak", themeLabel: "On Fire", tier: "bronze", trigger: "streak", description: "Keep a daily learning streak" },
    { token: "lib:streak-silver", url: "/badge-library/lib_streak_silver.webp", theme: "streak", themeLabel: "On Fire", tier: "silver", trigger: "streak", description: "Keep a daily learning streak" },
    { token: "lib:streak-gold", url: "/badge-library/lib_streak_gold.webp", theme: "streak", themeLabel: "On Fire", tier: "gold", trigger: "streak", description: "Keep a daily learning streak" },
    { token: "lib:streak-platinum", url: "/badge-library/lib_streak_platinum.webp", theme: "streak", themeLabel: "On Fire", tier: "platinum", trigger: "streak", description: "Keep a daily learning streak" },
    { token: "lib:streak-diamond", url: "/badge-library/lib_streak_diamond.webp", theme: "streak", themeLabel: "On Fire", tier: "diamond", trigger: "streak", description: "Keep a daily learning streak" },
    { token: "lib:xp_master-bronze", url: "/badge-library/lib_xp_master_bronze.webp", theme: "xp_master", themeLabel: "Star Scholar", tier: "bronze", trigger: "xp_total", description: "Earn experience points" },
    { token: "lib:xp_master-silver", url: "/badge-library/lib_xp_master_silver.webp", theme: "xp_master", themeLabel: "Star Scholar", tier: "silver", trigger: "xp_total", description: "Earn experience points" },
    { token: "lib:xp_master-gold", url: "/badge-library/lib_xp_master_gold.webp", theme: "xp_master", themeLabel: "Star Scholar", tier: "gold", trigger: "xp_total", description: "Earn experience points" },
    { token: "lib:xp_master-platinum", url: "/badge-library/lib_xp_master_platinum.webp", theme: "xp_master", themeLabel: "Star Scholar", tier: "platinum", trigger: "xp_total", description: "Earn experience points" },
    { token: "lib:xp_master-diamond", url: "/badge-library/lib_xp_master_diamond.webp", theme: "xp_master", themeLabel: "Star Scholar", tier: "diamond", trigger: "xp_total", description: "Earn experience points" },
    { token: "lib:completionist-bronze", url: "/badge-library/lib_completionist_bronze.webp", theme: "completionist", themeLabel: "Completionist", tier: "bronze", trigger: "course_completion", description: "Finish courses to 100%" },
    { token: "lib:completionist-silver", url: "/badge-library/lib_completionist_silver.webp", theme: "completionist", themeLabel: "Completionist", tier: "silver", trigger: "course_completion", description: "Finish courses to 100%" },
    { token: "lib:completionist-gold", url: "/badge-library/lib_completionist_gold.webp", theme: "completionist", themeLabel: "Completionist", tier: "gold", trigger: "course_completion", description: "Finish courses to 100%" },
    { token: "lib:completionist-platinum", url: "/badge-library/lib_completionist_platinum.webp", theme: "completionist", themeLabel: "Completionist", tier: "platinum", trigger: "course_completion", description: "Finish courses to 100%" },
    { token: "lib:completionist-diamond", url: "/badge-library/lib_completionist_diamond.webp", theme: "completionist", themeLabel: "Completionist", tier: "diamond", trigger: "course_completion", description: "Finish courses to 100%" },
    { token: "lib:perfect_score-bronze", url: "/badge-library/lib_perfect_score_bronze.webp", theme: "perfect_score", themeLabel: "Perfect Score", tier: "bronze", trigger: "assessment_score", description: "Ace an assessment" },
    { token: "lib:perfect_score-silver", url: "/badge-library/lib_perfect_score_silver.webp", theme: "perfect_score", themeLabel: "Perfect Score", tier: "silver", trigger: "assessment_score", description: "Ace an assessment" },
    { token: "lib:perfect_score-gold", url: "/badge-library/lib_perfect_score_gold.webp", theme: "perfect_score", themeLabel: "Perfect Score", tier: "gold", trigger: "assessment_score", description: "Ace an assessment" },
    { token: "lib:perfect_score-platinum", url: "/badge-library/lib_perfect_score_platinum.webp", theme: "perfect_score", themeLabel: "Perfect Score", tier: "platinum", trigger: "assessment_score", description: "Ace an assessment" },
    { token: "lib:perfect_score-diamond", url: "/badge-library/lib_perfect_score_diamond.webp", theme: "perfect_score", themeLabel: "Perfect Score", tier: "diamond", trigger: "assessment_score", description: "Ace an assessment" },
    { token: "lib:live_learner-bronze", url: "/badge-library/lib_live_learner_bronze.webp", theme: "live_learner", themeLabel: "Live Learner", tier: "bronze", trigger: "live_session_count", description: "Attend live classes" },
    { token: "lib:live_learner-silver", url: "/badge-library/lib_live_learner_silver.webp", theme: "live_learner", themeLabel: "Live Learner", tier: "silver", trigger: "live_session_count", description: "Attend live classes" },
    { token: "lib:live_learner-gold", url: "/badge-library/lib_live_learner_gold.webp", theme: "live_learner", themeLabel: "Live Learner", tier: "gold", trigger: "live_session_count", description: "Attend live classes" },
    { token: "lib:live_learner-platinum", url: "/badge-library/lib_live_learner_platinum.webp", theme: "live_learner", themeLabel: "Live Learner", tier: "platinum", trigger: "live_session_count", description: "Attend live classes" },
    { token: "lib:live_learner-diamond", url: "/badge-library/lib_live_learner_diamond.webp", theme: "live_learner", themeLabel: "Live Learner", tier: "diamond", trigger: "live_session_count", description: "Attend live classes" },
    { token: "lib:scholar-bronze", url: "/badge-library/lib_scholar_bronze.webp", theme: "scholar", themeLabel: "Scholar", tier: "bronze", trigger: "slide_count", description: "Work through your lessons" },
    { token: "lib:scholar-silver", url: "/badge-library/lib_scholar_silver.webp", theme: "scholar", themeLabel: "Scholar", tier: "silver", trigger: "slide_count", description: "Work through your lessons" },
    { token: "lib:scholar-gold", url: "/badge-library/lib_scholar_gold.webp", theme: "scholar", themeLabel: "Scholar", tier: "gold", trigger: "slide_count", description: "Work through your lessons" },
    { token: "lib:scholar-platinum", url: "/badge-library/lib_scholar_platinum.webp", theme: "scholar", themeLabel: "Scholar", tier: "platinum", trigger: "slide_count", description: "Work through your lessons" },
    { token: "lib:scholar-diamond", url: "/badge-library/lib_scholar_diamond.webp", theme: "scholar", themeLabel: "Scholar", tier: "diamond", trigger: "slide_count", description: "Work through your lessons" },
];

const LIBRARY_BY_TOKEN: Record<string, LibraryBadge> = BADGE_LIBRARY.reduce(
    (acc, b) => {
        acc[b.token] = b;
        return acc;
    },
    {} as Record<string, LibraryBadge>
);

/** True when an icon value references a library badge (vs a Phosphor name or uploaded file id). */
export function isLibraryToken(icon?: string | null): boolean {
    return !!icon && icon.startsWith("lib:");
}

export function getLibraryBadge(token?: string | null): LibraryBadge | undefined {
    return token ? LIBRARY_BY_TOKEN[token] : undefined;
}

/** Bundled asset URL for a library token, or undefined if the token is unknown. */
export function getLibraryUrl(token?: string | null): string | undefined {
    return getLibraryBadge(token)?.url;
}

/**
 * Maps an unlock trigger to the library achievement whose artwork best fits it.
 * Lets every badge adopt ready-made art from its trigger alone (no per-badge wiring).
 */
export const TRIGGER_TO_LIBRARY_THEME: Record<string, string> = {
    course_count: "first_steps",
    slide_count: "scholar",
    streak: "streak",
    live_session_streak: "live_learner",
    xp_total: "xp_master",
    assessment_score: "perfect_score",
    course_completion: "completionist",
    live_session_count: "live_learner",
};

export function libraryThemeForTrigger(trigger: string): string | undefined {
    return TRIGGER_TO_LIBRARY_THEME[trigger];
}

/** Build a library token for a theme + tier, or undefined when no such asset exists. */
export function buildLibraryToken(theme: string, tier: BadgeTier): string | undefined {
    const token = `lib:${theme}-${tier}`;
    return getLibraryBadge(token) ? token : undefined;
}

/** Library badges grouped by achievement, tiers in bronze→diamond order — for the picker grid. */
export function getLibraryByTheme(): { theme: string; themeLabel: string; badges: LibraryBadge[] }[] {
    const groups: { theme: string; themeLabel: string; badges: LibraryBadge[] }[] = [];
    for (const b of BADGE_LIBRARY) {
        let g = groups.find((x) => x.theme === b.theme);
        if (!g) {
            g = { theme: b.theme, themeLabel: b.themeLabel, badges: [] };
            groups.push(g);
        }
        g.badges.push(b);
    }
    for (const g of groups) {
        g.badges.sort((a, z) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(z.tier));
    }
    return groups;
}
