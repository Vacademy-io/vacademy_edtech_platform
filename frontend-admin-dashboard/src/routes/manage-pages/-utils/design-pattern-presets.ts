/**
 * Editor presets built from the design-pattern registry (generated/design-patterns.json,
 * exported from the learner's -ai/design-patterns.ts by
 * scripts/export-catalogue-schema-catalog.mjs):
 *
 *  - TemplateLibrary recipes ("Editorial catalogue", "Learning paths", "Brand chrome"):
 *    the registry's page recipes, each section's patterns merged onto the editor's
 *    own component template; the chrome recipe changes the header / footer look and
 *    keeps the admin's own text, links and lists;
 *  - VariantSwitcher looks: a pattern that describes a whole block ("Editorial hero",
 *    "Brand footer") becomes a one-click look whose label is the registry's label.
 *
 * Everything here is opt-in: nothing changes a page until the admin clicks it.
 *
 * Patterns carry placeholders ("<headline line 1>", "<libraryId: leave empty …>")
 * written for an AI. The editor never inserts one: a placeholder key is dropped (the
 * template's own default stays), and a list item holding one is dropped whole, so ids
 * stay empty for the admin to pick and no "<…>" text ever reaches a page.
 */
import { v4 as uuidv4 } from 'uuid';
import type { TFunction } from 'i18next';
import type { Component } from '../-types/editor-types';
import { buildComponentTemplates } from './component-templates';
import type { PageTemplate } from './page-templates';
import generated from './generated/design-patterns.json';

type Json = unknown;
type JsonObject = Record<string, Json>;

interface GeneratedPattern {
    id: string;
    label: string;
    component: string;
    propPath: string;
    looksLike: string;
    minimal: JsonObject;
}

interface GeneratedRecipe {
    id: string;
    name: string;
    description: string;
    pages: Array<{
        route: string;
        title: string;
        sections: Array<{ component: string; patterns: string[]; props?: JsonObject }>;
    }>;
    site: string[];
}

export interface PatternVariant {
    id: string;
    label: string;
    description: string;
    thumbnail: string;
    props: Record<string, any>;
}

const PATTERNS = generated.patterns as unknown as GeneratedPattern[];
const RECIPES = generated.recipes as unknown as GeneratedRecipe[];
const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

const PLACEHOLDER = /^<[^<>]*>$/;

const isObject = (v: Json): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

const holdsPlaceholder = (v: Json): boolean => {
    if (typeof v === 'string') return PLACEHOLDER.test(v.trim());
    if (Array.isArray(v)) return v.some(holdsPlaceholder);
    if (isObject(v)) return Object.values(v).some(holdsPlaceholder);
    return false;
};

/**
 * A pattern's JSON without its placeholders: a placeholder value is dropped, a list
 * item holding one anywhere is dropped whole, and an object or list emptied that way
 * is dropped too (one that was empty to begin with, like `filtersConfig: []`, stays).
 */
export const stripPlaceholders = (value: Json): Json => {
    if (typeof value === 'string') return PLACEHOLDER.test(value.trim()) ? undefined : value;
    if (Array.isArray(value)) {
        if (value.length === 0) return [];
        const kept = value.filter((item) => !holdsPlaceholder(item)).map(stripPlaceholders);
        return kept.length ? kept : undefined;
    }
    if (isObject(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) return {};
        const out: JsonObject = {};
        for (const [k, v] of entries) {
            const s = stripPlaceholders(v);
            if (s !== undefined) out[k] = s;
        }
        return Object.keys(out).length ? out : undefined;
    }
    return value;
};

/** Several patterns of one section: objects merged key by key, lists concatenated. */
const combine = (a: Json, b: Json): Json => {
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
    if (isObject(a) && isObject(b)) {
        const out: JsonObject = { ...a };
        for (const [k, v] of Object.entries(b)) out[k] = k in out ? combine(out[k], v) : v;
        return out;
    }
    return b === undefined ? a : b;
};

/** Deep-merge `patch` onto `base` (objects key by key; anything else is replaced). */
export const mergeOnto = (base: Json, patch: Json): Json => {
    if (isObject(base) && isObject(patch)) {
        const out: JsonObject = { ...base };
        for (const [k, v] of Object.entries(patch)) out[k] = mergeOnto(base[k], v);
        return out;
    }
    return patch === undefined ? base : patch;
};

/**
 * Keys that set how a block looks rather than what it says: variant, layout, mode…
 * and any *Style / *Size / *Layout / *Width / *Display / *Variant key (navStyle,
 * barSize, contentWidth, cartDisplay). Other text keys are the admin's content.
 */
const LOOK_KEY = /^(variant|layout|listLayout|mode|style|size|display)$|(Style|Size|Layout|Width|Display|Variant)$/;
export const isLookKey = (key: string): boolean => LOOK_KEY.test(key);

/**
 * mergeOnto for site chrome the admin already wrote: a non-empty list already there
 * (their nav links, footer columns) is kept,
 * and so is any text they wrote under a content key (a footer column's title, a
 * newsletter heading) — the pattern's text only fills what is empty. Look keys,
 * flags and numbers take the pattern's value.
 */
export const mergeChromeOnto = (base: Json, patch: Json, key = ''): Json => {
    if (isObject(base) && isObject(patch)) {
        const out: JsonObject = { ...base };
        for (const [k, v] of Object.entries(patch)) out[k] = mergeChromeOnto(base[k], v, k);
        return out;
    }
    if (patch === undefined) return base;
    if (Array.isArray(patch) && Array.isArray(base) && base.length > 0) return base;
    if (typeof patch === 'string' && !isLookKey(key) && typeof base === 'string' && base.trim()) return base;
    return patch;
};

/** The props several patterns write into one block, placeholders removed. */
export const patternProps = (ids: string[]): JsonObject => {
    let out: Json = {};
    for (const id of ids) {
        const p = BY_ID.get(id);
        if (!p) continue;
        out = combine(out, stripPlaceholders(p.minimal) ?? {});
    }
    return isObject(out) ? out : {};
};

export const patternLabel = (id: string): string => BY_ID.get(id)?.label ?? id;

/* ── VariantSwitcher looks ────────────────────────────────────────────── */

/** The root a block's own props live at: a pattern written there describes the whole block. */
const BLOCK_ROOTS = new Set(['props', 'globalSettings.layout.header.props', 'globalSettings.layout.footer.props']);
/** Nested keys that are look, not content (e.g. hero eyebrow.style 'rule'). */
const LOOK_KEYS = new Set(['style', 'variant', 'layout']);

/**
 * A look without content: top-level flags, numbers and look keys (isLookKey), plus
 * nested style / variant / layout keys. Text, links, lists and ids stay as the admin
 * wrote them.
 */
const lookOf = (minimal: JsonObject): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(stripPlaceholders(minimal) as JsonObject)) {
        if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && isLookKey(k))) {
            out[k] = v;
        } else if (isObject(v)) {
            const nested = Object.fromEntries(
                Object.entries(v).filter(([nk, nv]) => LOOK_KEYS.has(nk) && typeof nv !== 'object')
            );
            if (Object.keys(nested).length) out[k] = nested;
        }
    }
    return out;
};

/** Registry looks for one block type, labelled with the registry's own names. */
export const patternVariantsFor = (componentType: string): PatternVariant[] =>
    PATTERNS.filter((p) => p.component === componentType && BLOCK_ROOTS.has(p.propPath))
        .map((p) => ({
            id: `pattern:${p.id}`,
            label: p.label,
            description: p.looksLike,
            thumbnail: '',
            props: lookOf(p.minimal),
        }))
        .filter((v) => Object.keys(v.props).length > 0);

/**
 * A look as it applies to THIS block: a header with no logo of its own never takes
 * `logoOnly: true` (it would hide the site name and leave an empty bar), the same
 * guard the TemplateLibrary chrome recipe applies.
 */
export const lookForBlock = (
    componentType: string,
    currentProps: Record<string, any> | undefined,
    look: Record<string, any>
): Record<string, any> => {
    if (componentType === 'header' && look.logoOnly === true && !currentProps?.logo) {
        return { ...look, logoOnly: currentProps?.logoOnly ?? false };
    }
    return look;
};

/* ── TemplateLibrary recipes ──────────────────────────────────────────── */

const makeSection = (t: TFunction, type: string, ids: string[], extra?: JsonObject): Component => {
    const base = buildComponentTemplates(t)[type];
    const patch = combine(patternProps(ids), extra ?? {});
    return {
        id: uuidv4(),
        type,
        enabled: true,
        ...base,
        props: mergeOnto(base?.props ?? {}, patch) as Record<string, any>,
    } as Component;
};

const CHROME = ['header', 'footer'] as const;

/** Site settings a recipe also relies on, named for the template card. */
const settingsNote = (recipe: GeneratedRecipe): string => {
    const names = recipe.site
        .filter((id) => BY_ID.get(id)?.component === 'globalSettings')
        .map(patternLabel);
    return names.length ? ` Also set in Settings: ${names.join(', ')}.` : '';
};

/** The header / footer a chrome recipe writes, merged onto what the site already has. */
const applyChrome = (recipe: GeneratedRecipe) => (layout: Record<string, any> | undefined, t: TFunction) => {
    const next: Record<string, any> = { ...(layout ?? {}) };
    for (const kind of CHROME) {
        const ids = recipe.site.filter((id) => BY_ID.get(id)?.component === kind);
        if (!ids.length) continue;
        const current = next[kind] ?? { ...buildComponentTemplates(t)[kind], id: uuidv4() };
        const props = mergeChromeOnto(current.props ?? {}, patternProps(ids)) as Record<string, any>;
        // A logo-only bar with no logo would show nothing: keep the site name until a logo is set.
        if (kind === 'header' && !props.logo) props.logoOnly = current.props?.logoOnly ?? false;
        next[kind] = { ...current, enabled: current.enabled !== false, props };
    }
    return next;
};

/** The registry's page recipes as editor templates (page recipes replace the page; chrome ones set header + footer). */
export const buildDesignRecipeTemplates = (): PageTemplate[] =>
    RECIPES.map((recipe): PageTemplate => {
        const page = recipe.pages[0];
        if (!page) {
            return {
                id: `recipe:${recipe.id}`,
                name: recipe.name,
                description: recipe.description + settingsNote(recipe),
                category: 'section',
                getComponents: () => [],
                applyLayout: applyChrome(recipe),
            };
        }
        return {
            id: `recipe:${recipe.id}`,
            name: recipe.name,
            description: recipe.description + settingsNote(recipe),
            category: 'page',
            getComponents: (t) => page.sections.map((s) => makeSection(t, s.component, s.patterns, s.props)),
        };
    });
