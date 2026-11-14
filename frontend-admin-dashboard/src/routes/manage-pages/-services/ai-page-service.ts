import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    AI_PAGE_BUILDER_GENERATE,
    AI_PAGE_BUILDER_ESTIMATE,
    AI_PAGE_BUILDER_EDIT,
    AI_PAGE_BUILDER_SECTION,
    AI_PAGE_BUILDER_SITE_CHROME,
    AI_PAGE_BUILDER_BRAND_KIT,
    AI_PAGE_BUILDER_IMAGE,
    AI_PAGE_BUILDER_SITE,
    AI_PAGE_BUILDER_INTAKE,
    AI_PAGE_BUILDER_TRANSLATE,
} from '@/constants/urls';
import { CatalogueConfig, Component, Page } from '../-types/editor-types';
import { CATALOGUE_FONTS } from '../-utils/catalogue-fonts';

export interface AiPageImage {
    url: string;
    caption?: string;
    kind?: 'logo' | 'photo' | 'banner';
}

export interface AiCourseSnapshotItem {
    name: string;
    price?: string;
    level?: string;
    description?: string;
    tags?: string[];
}

export interface GeneratePagePayload {
    brief: string;
    page_type?: string;
    route_slug?: string;
    institute_name?: string;
    images?: AiPageImage[];
    inspiration_image_urls?: string[];
    source_url?: string;
    /** Someone else's website whose LAYOUT the admin wants. Screenshotted
     *  server-side and read like inspiration screenshots; with global_settings
     *  pinned only its structure is taken — colours, fonts and logo stay ours. */
    reference_url?: string;
    courses?: AiCourseSnapshotItem[];
    terminology?: Record<string, string>;
    direction?: string;
    /** Pin one of the composer's design languages instead of letting it choose —
     *  the mechanism behind "same brief, a different direction". */
    design_language?: DesignLanguageId;
    /** The site's existing theme/fonts/motion. Send it to add a page that
     *  matches the rest of the site — the composer designs into this palette
     *  and returns it unchanged instead of proposing a new one. */
    global_settings?: Record<string, any>;
    auto_images?: boolean;
    run_id?: string;
}

/** The composer's design languages (server-side `_DESIGN_LANGUAGES`). An unknown
 *  value is ignored by the server, never echoed into the prompt. */
export type DesignLanguageId =
    | 'editorial-serif'
    | 'swiss-minimal'
    | 'bold-modern'
    | 'dark-tech'
    | 'warm-community'
    | 'corporate-trust'
    | 'directory-reference';

export interface GeneratedPage {
    id: string;
    title?: string;
    route: string;
    components: Component[];
}

export interface GeneratePageResponse {
    page: GeneratedPage;
    /** A matching site theme the composer chose — apply for a premium render. */
    global_settings?: Record<string, any> | null;
    run_id: string;
    model: string;
    warnings: string[];
}

export interface PageCreditEstimate {
    estimated_credits?: number;
    current_balance?: number;
    sufficient?: boolean;
}

export const generateAiPage = async (payload: GeneratePagePayload): Promise<GeneratePageResponse> => {
    const response = await authenticatedAxiosInstance.post<GeneratePageResponse>(
        AI_PAGE_BUILDER_GENERATE(),
        payload,
        { timeout: 240000 } // page composition is one large LLM call
    );
    return response.data;
};

export const estimateAiPageCredits = async (): Promise<PageCreditEstimate> => {
    const response = await authenticatedAxiosInstance.get<PageCreditEstimate>(
        AI_PAGE_BUILDER_ESTIMATE()
    );
    return response.data;
};

/* ─── Copilot (conversational edit) ────────────────────────────────────── */

export type EditOp =
    | { op: 'insert'; component: Component; afterId: string | null; note?: string }
    | { op: 'update'; id: string; propsPatch?: Record<string, any>; stylePatch?: Record<string, any>; note?: string }
    | { op: 'remove'; id: string; note?: string }
    | { op: 'move'; id: string; afterId: string | null; note?: string }
    | { op: 'updateGlobalSettings'; patch: Record<string, any>; note?: string };

export interface EditChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface EditPagePayload {
    page: { id: string; components: Component[] };
    instruction: string;
    selected_component_id?: string;
    institute_name?: string;
    images?: AiPageImage[];
    terminology?: Record<string, string>;
    history?: EditChatTurn[];
}

export interface EditPageResponse {
    ops: EditOp[];
    reply: string;
    run_id: string;
    model: string;
    warnings: string[];
}

export const editAiPage = async (payload: EditPagePayload): Promise<EditPageResponse> => {
    const response = await authenticatedAxiosInstance.post<EditPageResponse>(
        AI_PAGE_BUILDER_EDIT(),
        payload,
        { timeout: 180000 }
    );
    return response.data;
};

/** Reference screenshots the design pass reads. Mirrors _MAX_INSPIRATION_IMAGES
 *  in page_builder.py — the server slices to the same number, so letting an
 *  admin add more here would silently discard the extras. */
export const MAX_INSPIRATION_IMAGES = 6;

/* ─── Section variants (regenerate one section, several ways) ──────────── */

export interface SectionVariant {
    label: string;
    rationale: string;
    component: Component;
}

export interface SectionVariantsResponse {
    variants: SectionVariant[];
    run_id: string;
    model: string;
    warnings: string[];
}

export interface SectionVariantsPayload {
    page: { id: string; components: Component[] };
    component_id: string;
    instruction?: string;
    variant_count?: number;
    institute_name?: string;
    images?: AiPageImage[];
    terminology?: Record<string, string>;
    global_settings?: Record<string, any>;
    allow_type_change?: boolean;
}

/** Ask for N treatments of ONE section. The server drops any version that
 *  would render broken, so the returned list can be shorter than requested. */
export const generateSectionVariants = async (
    payload: SectionVariantsPayload
): Promise<SectionVariantsResponse> => {
    const response = await authenticatedAxiosInstance.post<SectionVariantsResponse>(
        AI_PAGE_BUILDER_SECTION(),
        payload,
        { timeout: 180000 }
    );
    return response.data;
};

/* ─── Brand kit (theme proposals) ──────────────────────────────────────── */

export interface BrandKit {
    label: string;
    themePreset: string;
    /** Exact brand hex (#rrggbb) when the institute's real colour is known —
     *  overrides the preset's hue. Absent means "use the preset's palette". */
    primaryColor?: string | null;
    atmosphere: { canvas: string; intensity: string };
    headingScale: string;
    borderRadius: string;
    motion: string;
    fontFamily: string;
    headingFontFamily?: string;
    rationale: string;
}

export interface BrandKitResponse {
    kits: BrandKit[];
    run_id: string;
    model: string;
}

/* ─── Image / logo generation ──────────────────────────────────────────── */

export type AiImageKind = 'logo' | 'hero' | 'banner' | 'illustration' | 'photo' | 'image';

export interface GenerateSitePayload {
    brief: string;
    page_types?: string[];
    institute_name?: string;
    images?: AiPageImage[];
    courses?: AiCourseSnapshotItem[];
    terminology?: Record<string, string>;
    source_url?: string;
    auto_images?: boolean;
    /** Reference screenshots for the whole site — analysed once server-side and
     *  shared by every page, so the site comes out in one design language. */
    inspiration_image_urls?: string[];
    /** See GeneratePagePayload.reference_url — captured once for the whole site. */
    reference_url?: string;
    design_language?: DesignLanguageId;
    /** The site's existing theme/fonts/motion; when set every page is composed
     *  into it and a reference contributes layout only. */
    global_settings?: Record<string, any>;
}

export interface GenerateSiteResponse {
    pages: { page_type: string; page: GeneratedPage }[];
    global_settings?: Record<string, any> | null;
    model: string;
    warnings: string[];
}

export const generateAiSite = async (payload: GenerateSitePayload): Promise<GenerateSiteResponse> => {
    const response = await authenticatedAxiosInstance.post<GenerateSiteResponse>(
        AI_PAGE_BUILDER_SITE(),
        payload,
        { timeout: 600000 } // several pages, one large LLM call each
    );
    return response.data;
};

export const generateAiImage = async (payload: {
    prompt: string;
    kind?: AiImageKind;
    aspect_ratio?: string;
    count?: number;
}): Promise<{ urls: string[]; model: string }> => {
    const response = await authenticatedAxiosInstance.post<{ urls: string[]; model: string }>(
        AI_PAGE_BUILDER_IMAGE(),
        payload,
        { timeout: 150000 } // image gen can take a while
    );
    return response.data;
};

/* ─── Assistive intake (chat-style website interview) ─────────────────── */

export interface IntakeTurn {
    role: 'user' | 'assistant';
    content: string;
    /** Images the admin uploaded WITH this turn (already on our S3). */
    image_urls?: string[];
}

export interface IntakeResponse {
    reply: string;
    chips: string[];
    request_upload: 'logo' | 'photo' | 'inspiration' | null;
    /** Assistant's classification of images in the admin's latest message. */
    received_image_kind?: 'logo' | 'photo' | 'inspiration' | null;
    ready: boolean;
    brief: string | null;
    page_type: string;
    whole_site: boolean;
    run_id: string;
    model: string;
}

export const intakeAiTurn = async (payload: {
    history: IntakeTurn[];
    institute_name?: string;
    courses?: AiCourseSnapshotItem[];
    terminology?: Record<string, string>;
}): Promise<IntakeResponse> => {
    const response = await authenticatedAxiosInstance.post<IntakeResponse>(
        AI_PAGE_BUILDER_INTAKE(),
        payload,
        { timeout: 180000 } // vision turns with big screenshots can run long
    );
    return response.data;
};

export const deriveBrandKit = async (payload: {
    institute_name?: string;
    brief?: string;
    brand_notes?: string;
}): Promise<BrandKitResponse> => {
    const response = await authenticatedAxiosInstance.post<BrandKitResponse>(
        AI_PAGE_BUILDER_BRAND_KIT(),
        payload,
        { timeout: 120000 }
    );
    return response.data;
};

/** Maps a BrandKit into the globalSettings patch the renderers consume
 *  (theme.preset + atmosphere + radius + heading scale, motion, font stack). */
export const brandKitToGlobalPatch = (kit: BrandKit): Record<string, any> => {
    const bodyStack =
        CATALOGUE_FONTS.find((f) => f.label === kit.fontFamily)?.stack || 'Inter, sans-serif';
    const headStack = kit.headingFontFamily
        ? CATALOGUE_FONTS.find((f) => f.label === kit.headingFontFamily)?.stack
        : undefined;
    const fonts: Record<string, any> = { enabled: true, family: bodyStack };
    // Only a genuinely different heading font is worth storing.
    if (headStack && headStack !== bodyStack) fonts.headingFamily = headStack;
    const theme: Record<string, any> = {
        preset: kit.themePreset,
        atmosphere: { canvas: kit.atmosphere.canvas, intensity: kit.atmosphere.intensity },
        headingScale: kit.headingScale,
        borderRadius: kit.borderRadius,
    };
    // A kit that names an exact brand colour must apply it; a kit that doesn't
    // must CLEAR any previous one, otherwise switching kits keeps the old hue
    // and the new preset never visibly takes effect.
    theme.primaryColor = /^#[0-9a-fA-F]{6}$/.test(kit.primaryColor || '')
        ? (kit.primaryColor as string)
        : undefined;
    return {
        theme,
        motion: { personality: kit.motion },
        fonts,
    };
};

/** Shallow-merge a patch into an existing object (undefined values delete). */
const mergePatch = <T extends Record<string, any>>(base: T | undefined, patch: Record<string, any>): T => {
    const out: Record<string, any> = { ...(base || {}) };
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) delete out[k];
        else out[k] = v;
    }
    return out as T;
};

/** Recursively patch/remove a component by id (covers columnLayout slot children). */
const patchById = (
    components: Component[],
    id: string,
    fn: (c: Component) => Component | null
): { components: Component[]; hit: boolean } => {
    let hit = false;
    const next: Component[] = [];
    for (const c of components) {
        if (c.id === id) {
            hit = true;
            const res = fn(c);
            if (res) next.push(res);
            continue;
        }
        // Recurse into columnLayout slots
        const slots = c.props?.slots;
        if (Array.isArray(slots)) {
            let slotHit = false;
            const newSlots = slots.map((slot: Component[]) => {
                if (!Array.isArray(slot)) return slot;
                const r = patchById(slot, id, fn);
                if (r.hit) slotHit = true;
                return r.components;
            });
            if (slotHit) {
                hit = true;
                next.push({ ...c, props: { ...c.props, slots: newSlots } });
                continue;
            }
        }
        next.push(c);
    }
    return { components: next, hit };
};

/**
 * Applies copilot ops to a deep-cloned config, returning a new config.
 * Pure — the panel keeps this as a "shadow" for diff preview before commit.
 * insert/move resolve afterId against the TOP-LEVEL component list;
 * update/remove find the target anywhere (including slot children).
 */
export const applyOps = (config: CatalogueConfig, pageId: string, ops: EditOp[]): CatalogueConfig => {
    const clone: CatalogueConfig = JSON.parse(JSON.stringify(config));
    const page = clone.pages.find((p: Page) => p.id === pageId);
    if (!page) return clone;

    for (const op of ops) {
        switch (op.op) {
            case 'insert': {
                const comp = op.component;
                if (op.afterId === null) {
                    page.components.unshift(comp);
                } else {
                    const idx = page.components.findIndex((c) => c.id === op.afterId);
                    if (idx === -1) page.components.push(comp);
                    else page.components.splice(idx + 1, 0, comp);
                }
                break;
            }
            case 'update': {
                page.components = patchById(page.components, op.id, (c) => ({
                    ...c,
                    props: op.propsPatch ? mergePatch(c.props, op.propsPatch) : c.props,
                    style: op.stylePatch ? mergePatch(c.style, op.stylePatch) : c.style,
                })).components;
                break;
            }
            case 'remove': {
                page.components = patchById(page.components, op.id, () => null).components;
                break;
            }
            case 'move': {
                const idx = page.components.findIndex((c) => c.id === op.id);
                if (idx === -1) break; // only top-level components are movable
                const [moved] = page.components.splice(idx, 1);
                if (!moved) break;
                if (op.afterId === null) {
                    page.components.unshift(moved);
                } else {
                    const after = page.components.findIndex((c) => c.id === op.afterId);
                    if (after === -1) page.components.push(moved);
                    else page.components.splice(after + 1, 0, moved);
                }
                break;
            }
            case 'updateGlobalSettings': {
                const gs: Record<string, any> = clone.globalSettings as any;
                for (const [k, v] of Object.entries(op.patch)) {
                    const before = k === 'theme' ? gs.theme?.palette : undefined;
                    gs[k] = v && typeof v === 'object' && !Array.isArray(v)
                        ? { ...(gs[k] || {}), ...v }
                        : v;
                    // theme.palette merges one level deeper: a patch naming one
                    // colour must not drop the site's other palette colours.
                    const palettePatch = (v as any)?.palette;
                    if (k === 'theme' && palettePatch && typeof palettePatch === 'object' && !Array.isArray(palettePatch)) {
                        const merged: Record<string, unknown> = { ...(before && typeof before === 'object' ? before : {}) };
                        for (const [key, value] of Object.entries(palettePatch)) {
                            if (value === null) delete merged[key];
                            else merged[key] = value;
                        }
                        // No colour left: applyToTokens alone means nothing (same as the MCP's apply_ops).
                        if (Object.keys(merged).some((key) => key !== 'applyToTokens')) gs.theme.palette = merged;
                        else delete gs.theme.palette;
                    }
                }
                break;
            }
        }
    }
    return clone;
};


/** Site chrome (header / footer / theme) — global settings the copilot can edit. */
export interface SiteChromePayload {
    instruction: string;
    global_settings: Record<string, any>;
    pages: Array<{ route?: string; title?: string }>;
    institute_name?: string;
    terminology?: Record<string, string>;
    history?: Array<{ role: string; content: string }>;
}

export interface SiteChromeResponse {
    global_settings: Record<string, any>;
    reply: string;
    run_id: string;
    model: string;
    warnings: string[];
}

export const editSiteChrome = async (payload: SiteChromePayload): Promise<SiteChromeResponse> => {
    const response = await authenticatedAxiosInstance.post<SiteChromeResponse>(
        AI_PAGE_BUILDER_SITE_CHROME(),
        payload,
        { timeout: 180000 }
    );
    return response.data;
};

/* ─── Site languages: translate site texts ─────────────────────────────── */

export interface TranslateSiteStringsPayload {
    /** Exact base-language texts (they are the dictionary keys). At most 200 per call. */
    strings: string[];
    target_locale: string;
    source_locale?: string;
    /** Ignore the translation memory ("translate again with AI"). */
    skip_memory?: boolean;
    preferred_model?: string;
}

export interface TranslateSiteStringsResponse {
    /** Keyed by the exact source text sent. */
    translations: Record<string, string>;
    /** Texts that could not be translated safely (markup, links or numbers changed). */
    failed: Array<{ source: string; reason: string }>;
    tm_hits: number;
    run_id: string;
    model: string;
    warnings: string[];
}

export const translateSiteStrings = async (
    payload: TranslateSiteStringsPayload
): Promise<TranslateSiteStringsResponse> => {
    const response = await authenticatedAxiosInstance.post<TranslateSiteStringsResponse>(
        AI_PAGE_BUILDER_TRANSLATE(),
        payload,
        { timeout: 180000 } // a batch is several small LLM calls in parallel
    );
    return response.data;
};
