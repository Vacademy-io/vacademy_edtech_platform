/**
 * CATALOGUE FONT REGISTRY + LOADER — canonical, shared by BOTH apps.
 * ===================================================================
 * Byte-identical copies live at:
 *   learner: frontend-learner-dashboard-app/src/routes/$tagName/-utils/catalogue-fonts.ts
 *   admin:   frontend-admin-dashboard/src/routes/manage-pages/-utils/catalogue-fonts.ts
 * Synced via scripts/check-style-engine-sync.mjs (see that script's header).
 *
 * WHY: the admin editor offers per-component font families (StyleEditor) and a
 * global family (GlobalSettings.fonts), but the learner previously loaded ONLY
 * the single global family — every other choice silently fell back to system
 * fonts. This registry is the single source of truth for which faces exist,
 * and ensureFontsLoaded() walks a catalogue config and loads EVERY referenced
 * face in one merged Google-Fonts request. The editor imports the same
 * registry, so the two sides can never disagree about the font list.
 */

export interface CatalogueFontEntry {
    /** Display label (also the css family name). */
    label: string;
    /** Full CSS stack, as stored in config JSON (e.g. `"Poppins, sans-serif"`). */
    stack: string;
    /** Google Fonts css2 family spec (name + weight axis). */
    css2: string;
    /** Serif/display face (used by pairing UIs to group options). */
    serif?: boolean;
    /** Suited for large display headlines. */
    display?: boolean;
}

const W_TEXT = ':wght@300;400;500;600;700';
const W_DISPLAY = ':wght@400;500;600;700;800';

export const CATALOGUE_FONTS: CatalogueFontEntry[] = [
    // ── Sans (body + UI) ──────────────────────────────────────────────
    { label: 'Inter', stack: 'Inter, sans-serif', css2: `Inter${W_TEXT}` },
    { label: 'Roboto', stack: 'Roboto, sans-serif', css2: `Roboto${W_TEXT}` },
    { label: 'Open Sans', stack: '"Open Sans", sans-serif', css2: `Open Sans${W_TEXT}` },
    { label: 'Poppins', stack: 'Poppins, sans-serif', css2: `Poppins${W_TEXT}` },
    { label: 'Lato', stack: 'Lato, sans-serif', css2: 'Lato:wght@300;400;700' },
    { label: 'Montserrat', stack: 'Montserrat, sans-serif', css2: `Montserrat${W_TEXT}` },
    { label: 'Mulish', stack: 'Mulish, sans-serif', css2: `Mulish${W_TEXT}` },
    { label: 'Figtree', stack: 'Figtree, sans-serif', css2: `Figtree${W_TEXT}` },
    { label: 'Outfit', stack: 'Outfit, sans-serif', css2: `Outfit${W_TEXT}` },
    { label: 'Nunito', stack: 'Nunito, sans-serif', css2: `Nunito${W_TEXT}` },
    { label: 'Space Grotesk', stack: '"Space Grotesk", sans-serif', css2: `Space Grotesk${W_DISPLAY}`, display: true },
    // ── Rounded / friendly (family, pre-school, kids brands) ──────────
    // The registry had no rounded geometric face, so every warm childcare
    // reference was rebuilt in Nunito or Inter — close in weight, wrong in
    // character. Rubik in particular is what these brands actually use.
    { label: 'Rubik', stack: 'Rubik, sans-serif', css2: `Rubik${W_DISPLAY}`, display: true },
    { label: 'Quicksand', stack: 'Quicksand, sans-serif', css2: 'Quicksand:wght@400;500;600;700' },
    { label: 'Baloo 2', stack: '"Baloo 2", sans-serif', css2: 'Baloo 2:wght@400;500;600;700;800', display: true },
    // ── Serif / display (editorial headlines) ─────────────────────────
    { label: 'Playfair Display', stack: '"Playfair Display", serif', css2: `Playfair Display${W_DISPLAY}`, serif: true, display: true },
    { label: 'Fraunces', stack: 'Fraunces, serif', css2: `Fraunces${W_DISPLAY}`, serif: true, display: true },
    { label: 'Newsreader', stack: 'Newsreader, serif', css2: `Newsreader${W_TEXT}`, serif: true },
    { label: 'Lora', stack: 'Lora, serif', css2: `Lora${W_TEXT}`, serif: true },
    { label: 'DM Serif Display', stack: '"DM Serif Display", serif', css2: 'DM Serif Display:wght@400', serif: true, display: true },
    // ── Devanagari (Hindi / Marathi sites) ────────────────────────────
    // Latin-only faces fall back to whatever Devanagari font the OS has, so a
    // हिन्दी site picks one of these. Each also covers Latin, so an English
    // page in the same site keeps one consistent face. Weights match what
    // Google Fonts serves for each family (a weight it lacks fails the whole
    // merged request): Tiro Devanagari Hindi has 400 only.
    { label: 'Noto Sans Devanagari', stack: '"Noto Sans Devanagari", sans-serif', css2: `Noto Sans Devanagari${W_TEXT}` },
    { label: 'Mukta', stack: 'Mukta, sans-serif', css2: `Mukta${W_TEXT}` },
    { label: 'Hind', stack: 'Hind, sans-serif', css2: `Hind${W_TEXT}` },
    { label: 'Noto Serif Devanagari', stack: '"Noto Serif Devanagari", serif', css2: `Noto Serif Devanagari${W_TEXT}`, serif: true },
    { label: 'Tiro Devanagari Hindi', stack: '"Tiro Devanagari Hindi", serif', css2: 'Tiro Devanagari Hindi:wght@400', serif: true, display: true },
];

/** First family name of a CSS stack, unquoted ("Open Sans", sans-serif → Open Sans). */
export function primaryFamilyName(stack?: string | null): string {
    if (!stack) return '';
    return stack.split(',')[0]?.replace(/['"]/g, '').trim() ?? '';
}

/** Registry entry for a stored stack/family string, if the face is known. */
export function resolveFontEntry(stackOrFamily?: string | null): CatalogueFontEntry | undefined {
    const name = primaryFamilyName(stackOrFamily);
    if (!name) return undefined;
    return CATALOGUE_FONTS.find((f) => f.label.toLowerCase() === name.toLowerCase());
}

/**
 * Walks a catalogue config (either app's shape — treated structurally) and
 * collects every referenced font family: the global family plus every
 * per-component style.typography.fontFamily, including responsive overrides
 * and components nested in layout slots.
 */
export function collectConfigFontFamilies(config: {
    globalSettings?: { fonts?: { enabled?: boolean; family?: string; headingFamily?: string } };
    pages?: Array<{ components?: unknown[] }>;
} | null | undefined): string[] {
    const found = new Set<string>();
    const add = (stack?: string | null) => {
        const name = primaryFamilyName(stack);
        if (name) found.add(name);
    };

    // Global family only counts when the feature is enabled (the `enabled`
    // flag has always governed the global font; per-component typography
    // below is independent of it). headingFamily rides the same flag.
    const globalFonts = config?.globalSettings?.fonts;
    if (globalFonts?.enabled && globalFonts.family) add(globalFonts.family);
    if (globalFonts?.enabled && globalFonts.headingFamily) add(globalFonts.headingFamily);

    const visitStyle = (style: any) => {
        if (!style) return;
        add(style.typography?.fontFamily);
        visitStyle(style.responsive?.tablet);
        visitStyle(style.responsive?.mobile);
    };
    const visitComponent = (component: any) => {
        if (!component) return;
        visitStyle(component.style);
        // Layout slots nest components (columnLayout: props.slots = Component[][])
        const slots = component.props?.slots;
        if (Array.isArray(slots)) {
            for (const slot of slots) {
                if (Array.isArray(slot)) slot.forEach(visitComponent);
            }
        }
    };
    config?.pages?.forEach((p) => (p.components ?? []).forEach(visitComponent));

    return [...found];
}

/**
 * Merged Google Fonts css2 URL for the given family names.
 * Registry faces use their curated weight axis; UNKNOWN names fall back to a
 * default weight axis instead of being dropped — tenants configured with a
 * face outside the registry (e.g. "Rubik") keep loading it, matching the
 * pre-registry loader's behavior.
 */
export function buildGoogleFontsUrl(familyNames: string[]): string | null {
    const specs = [...new Set(familyNames)]
        .filter((name) => name.trim().length > 0)
        .map((name) => {
            const entry = CATALOGUE_FONTS.find(
                (f) => f.label.toLowerCase() === name.toLowerCase(),
            );
            return entry ? entry.css2 : `${name}${W_TEXT}`;
        })
        .map((css2) => `family=${encodeURIComponent(css2).replace(/%3A/gi, ':').replace(/%40/gi, '@').replace(/%3B/gi, ';')}`);
    if (specs.length === 0) return null;
    return `https://fonts.googleapis.com/css2?${specs.join('&')}&display=swap`;
}

const FONT_LINK_ID = 'catalogue-fonts';

/**
 * Injects (or replaces) ONE merged <link> tag loading every referenced face.
 * Idempotent: skips DOM work when the href is already current.
 */
export function ensureFontsLoaded(familyNames: string[], doc: Document = document): void {
    const href = buildGoogleFontsUrl(familyNames);
    const existing = doc.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
    if (!href) {
        return; // nothing known referenced; leave any previous link in place
    }
    if (existing?.href === href) return;
    if (existing) {
        existing.href = href;
        return;
    }
    const link = doc.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = href;
    doc.head.appendChild(link);
}
