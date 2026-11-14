import type {
    SiteAssistantPersona,
    SiteAssistantPlacementMode,
    SiteAssistantPosition,
    SiteAssistantSettings,
} from '../../-types/editor-types';

/**
 * globalSettings.siteAssistant helpers (Site Assistant SPEC §1).
 *
 * The card stores only what the admin changed: a missing key means the engine
 * default below, exactly as ai_service and the learner widget read it. These
 * defaults are only for showing the form.
 */

export const SITE_ASSISTANT_DEFAULTS = {
    enabled: false,
    persona: 'warm' as SiteAssistantPersona,
    placementMode: 'all' as SiteAssistantPlacementMode,
    position: 'bottom-right' as SiteAssistantPosition,
    knowledge: { pages: true, courses: true, faqs: true, notices: true, liveClasses: true },
    dailyAnswers: 300,
    embed: false,
};

export const MAX_SUGGESTIONS = 6;
export const MAX_SUGGESTION_LENGTH = 80;
export const MAX_DAILY_ANSWERS = 10_000;

export const PERSONA_OPTIONS: { value: SiteAssistantPersona; label: string; hint: string }[] = [
    { value: 'warm', label: 'Warm', hint: 'Kind and welcoming, like a helpful counsellor' },
    { value: 'friendly', label: 'Friendly', hint: 'Casual and upbeat' },
    { value: 'formal', label: 'Formal', hint: 'Polite and professional' },
    { value: 'concise', label: 'Short and direct', hint: 'Fewest words possible' },
];

export const PLACEMENT_OPTIONS: { value: SiteAssistantPlacementMode; label: string }[] = [
    { value: 'all', label: 'Every page of the site' },
    { value: 'catalogue_and_courses', label: 'Courses page and course pages only' },
    { value: 'routes', label: 'Only the pages I pick' },
];

export const POSITION_OPTIONS: { value: SiteAssistantPosition; label: string }[] = [
    { value: 'bottom-right', label: 'Bottom right' },
    { value: 'bottom-left', label: 'Bottom left' },
];

export type KnowledgeSwitch = keyof typeof SITE_ASSISTANT_DEFAULTS.knowledge;

export const KNOWLEDGE_SWITCHES: { key: KnowledgeSwitch; label: string; hint: string }[] = [
    {
        key: 'pages',
        label: 'Pages of this site',
        hint: 'What your pages say: about, policies, contact.',
    },
    { key: 'courses', label: 'Courses', hint: 'Prices, formats, languages and course pages.' },
    { key: 'faqs', label: 'Your FAQs', hint: 'Questions and answers you write in Site Assistant.' },
    {
        key: 'notices',
        label: 'Your notices',
        hint: 'New batches, holidays, events, until their end date.',
    },
    {
        key: 'liveClasses',
        label: 'Public live classes',
        hint: 'Upcoming classes marked public, with their sign-up link.',
    },
];

export const isKnowledgeOn = (value: SiteAssistantSettings | undefined, key: KnowledgeSwitch) =>
    value?.knowledge?.[key] ?? SITE_ASSISTANT_DEFAULTS.knowledge[key];

/** Shallow-merges `patch` into one nested object of the settings, keeping every other key. */
export function patchNested<
    K extends 'placement' | 'knowledge' | 'leads' | 'support' | 'limits' | 'embed',
>(
    value: SiteAssistantSettings | undefined,
    key: K,
    patch: NonNullable<SiteAssistantSettings[K]>
): SiteAssistantSettings {
    const current = (value?.[key] ?? {}) as NonNullable<SiteAssistantSettings[K]>;
    return { ...value, [key]: { ...current, ...patch } };
}

/** Trim, drop blanks and repeats (case-insensitive), cap the length and count. */
export function cleanSuggestions(list: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
        const text = String(raw ?? '')
            .trim()
            .slice(0, MAX_SUGGESTION_LENGTH);
        const key = text.toLowerCase();
        if (!text || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every node of the site's pages with `type === wanted` (sections can nest inside columns). */
export function findSections(config: unknown, wanted: string): Json[] {
    const found: Json[] = [];
    const visit = (node: unknown, depth: number) => {
        if (depth > 8) return;
        if (Array.isArray(node)) {
            node.forEach((n) => visit(n, depth + 1));
            return;
        }
        if (!isObject(node)) return;
        if (node.type === wanted && isObject(node.props)) found.push(node);
        for (const key of ['pages', 'components', 'children', 'columns', 'props']) {
            if (key in node) visit(node[key], depth + 1);
        }
    };
    visit(isObject(config) ? config.pages : null, 0);
    return found;
}

const labelText = (v: unknown): string => {
    if (typeof v === 'string') return v;
    // A localized text is { en: '…', hi: '…' }: the first one is the base language.
    if (isObject(v)) {
        const first = Object.values(v).find((x) => typeof x === 'string');
        return typeof first === 'string' ? first : '';
    }
    return '';
};

/**
 * The "Popular:" chips of the courses page header (courseCatalog props.hero.popular),
 * the default suggested questions: they are what visitors already look for.
 */
export function popularSearchesFromSite(config: unknown): string[] {
    const labels: string[] = [];
    for (const section of findSections(config, 'courseCatalog')) {
        const hero = (section.props as Json).hero;
        const popular = isObject(hero) && Array.isArray(hero.popular) ? hero.popular : [];
        for (const chip of popular) {
            if (isObject(chip)) labels.push(labelText(chip.label));
        }
    }
    return cleanSuggestions(labels);
}

/** The first courses section that has stream tabs: its streams key the per-stream campaigns. */
export function streamSectionProps(config: unknown): Json | null {
    const section = findSections(config, 'courseCatalog').find((s) =>
        isObject((s.props as Json).streams)
    );
    return section ? (section.props as Json) : null;
}

/** The site's page routes, for "only the pages I pick". */
export function siteRoutes(config: unknown): { route: string; title: string }[] {
    const pages = isObject(config) && Array.isArray(config.pages) ? config.pages : [];
    const seen = new Set<string>();
    return pages.flatMap((p) => {
        if (!isObject(p) || typeof p.route !== 'string' || seen.has(p.route)) return [];
        seen.add(p.route);
        return [
            { route: p.route, title: typeof p.title === 'string' && p.title ? p.title : p.route },
        ];
    });
}

/**
 * Switching the assistant on for the first time fills the two things a new
 * admin would otherwise leave blank: its name and the suggested questions.
 * Anything already set is kept.
 */
export function enableSiteAssistant(
    value: SiteAssistantSettings | undefined,
    seed: { instituteName?: string | null; popular: string[] }
): SiteAssistantSettings {
    const next: SiteAssistantSettings = { ...value, enabled: true };
    const institute = (seed.instituteName || '').trim();
    if (!next.name?.trim() && institute) next.name = `Ask ${institute}`;
    if (next.suggestions === undefined && seed.popular.length > 0) {
        next.suggestions = cleanSuggestions(seed.popular);
    }
    return next;
}

/** Whole numbers 1…MAX_DAILY_ANSWERS; anything else means "use the default". */
export function parseDailyAnswers(raw: string): number | undefined {
    const n = Number(raw.trim());
    if (!raw.trim() || !Number.isFinite(n)) return undefined;
    return Math.min(MAX_DAILY_ANSWERS, Math.max(1, Math.round(n)));
}

/** The site tag of the editor this card is open in (/manage-pages/editor/<tag>). */
export function siteTagFromPath(pathname: string): string | null {
    const match = /\/manage-pages\/editor\/([^/?#]+)/.exec(pathname);
    if (!match?.[1]) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

export const siteAssistantPageHref = (siteTag: string | null | undefined) =>
    siteTag
        ? `/manage-pages/site-assistant?site=${encodeURIComponent(siteTag)}`
        : '/manage-pages/site-assistant';
