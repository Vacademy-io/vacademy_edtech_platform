/**
 * Entitlement — what the CURRENT institute's plan includes, resolved against the
 * capability catalogue (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §3, §4, §9).
 *
 * Pure: no React, no network. `useEntitlement()` builds one of these from
 * `/capabilities/v1/me` + the catalogue; everything else reads it.
 *
 * Rules (§4):
 *  - An element governed by several features is entitled only if ALL are on.
 *  - An element not listed anywhere in the catalogue is ungoverned = entitled.
 *  - LEGACY institutes, an unloaded/failed `/me`, or a missing catalogue all get
 *    FULL_ENTITLEMENT — nothing is ever hidden on doubt (the server enforces).
 */
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';

// ─── Catalogue wire shape (snake_case, §12.1) ─────────────────────────────────

export interface CatalogGoverns {
    nav: string[];
    widgets: string[];
    quick_actions: string[];
    assistant_groups: string[];
    setup_steps: string[];
    routes: string[];
}

export interface CatalogFeature {
    key: string;
    label: string;
    governs: CatalogGoverns;
}

export interface CatalogModule {
    key: string;
    label: string;
    rail: string | null;
    core: boolean;
    features: CatalogFeature[];
}

export interface CapabilityCatalog {
    version: number;
    modules: CatalogModule[];
}

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : [];

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

/**
 * Validates the catalogue (the `catalog` field of GET /capabilities/v1/catalog).
 * Anything malformed is null, which callers treat as "no catalogue" = fail open.
 */
export function normalizeCatalog(raw: unknown): CapabilityCatalog | null {
    const r = asRecord(raw);
    if (!r || !Array.isArray(r.modules)) return null;
    const modules: CatalogModule[] = [];
    for (const m of r.modules) {
        const mr = asRecord(m);
        if (!mr || typeof mr.key !== 'string' || !Array.isArray(mr.features)) return null;
        const features: CatalogFeature[] = [];
        for (const f of mr.features) {
            const fr = asRecord(f);
            if (!fr || typeof fr.key !== 'string') return null;
            const g = asRecord(fr.governs) ?? {};
            features.push({
                key: fr.key,
                label: typeof fr.label === 'string' ? fr.label : fr.key,
                governs: {
                    nav: asStringArray(g.nav),
                    widgets: asStringArray(g.widgets),
                    quick_actions: asStringArray(g.quick_actions),
                    assistant_groups: asStringArray(g.assistant_groups),
                    setup_steps: asStringArray(g.setup_steps),
                    routes: asStringArray(g.routes),
                },
            });
        }
        modules.push({
            key: mr.key,
            label: typeof mr.label === 'string' ? mr.label : mr.key,
            rail: typeof mr.rail === 'string' ? mr.rail : null,
            core: mr.core === true,
            features,
        });
    }
    return { version: typeof r.version === 'number' ? r.version : 0, modules };
}

// ─── Paths ───────────────────────────────────────────────────────────────────

/** "/a/b?x=1#h" → "/a/b" (no trailing slash). Non-app links ("https://…", "") → null. */
export function toAppPath(link: string | undefined | null): string | null {
    if (!link || !link.startsWith('/')) return null;
    const path = link.split(/[?#]/)[0] ?? '';
    const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
    return trimmed || null;
}

/** Segment-aware prefix: "/chat" covers "/chat" and "/chat/x", never "/chatbot". */
export function pathCovers(prefix: string, pathname: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Pages no guard ever blocks: the landing page, settings (its sub-screens are
 * reached as /settings?selectedTab=…, which a prefix rule cannot tell apart),
 * the locked page itself and every auth / public route.
 */
export const ALWAYS_ALLOWED_PATH_PREFIXES = [
    '/dashboard',
    '/settings',
    '/locked-feature',
    '/login',
    '/signup',
    '/auth-transfer',
    '/landing',
    '/pricing',
    '/mcp',
    '/vim',
] as const;

export function isAlwaysAllowedPath(pathname: string): boolean {
    const path = toAppPath(pathname);
    if (!path || path === '/') return true;
    return ALWAYS_ALLOWED_PATH_PREFIXES.some((p) => pathCovers(p, path));
}

// ─── Entitlement ─────────────────────────────────────────────────────────────

export interface RouteClaim {
    /** App path the claim covers (prefix, segment-aware). */
    path: string;
    /** All must be on for the claim to be entitled; [] = ungoverned. */
    features: string[];
    source: 'catalog' | 'nav';
    /** "tab" or "tab/sub" for nav claims. */
    navKey?: string;
}

export interface Entitlement {
    /** True only when gating applies (MANAGED + catalogue loaded). */
    readonly managed: boolean;
    isFeatureOn(featureKey: string): boolean;
    /**
     * False only when a feature governing the tab (exact "tab") or, with `subId`,
     * the sub-tab ("tab/sub") is off. A tab whose every built-in sub-tab is off
     * is not entitled either (nothing would be left under it).
     */
    isNavItemEntitled(tabId: string, subId?: string): boolean;
    /** True when the catalogue lists exactly this nav id ("tab", or "tab/sub" with `subId`). */
    isNavGoverned(tabId: string, subId?: string): boolean;
    isWidgetEntitled(widgetId: string): boolean;
    isQuickActionEntitled(actionId: string): boolean;
    isAssistantGroupEntitled(group: string): boolean;
    isSetupStepEntitled(stepId: string): boolean;
    /**
     * Features governing a path: those of the MOST SPECIFIC matching claims
     * (catalogue `governs.routes` prefixes and governed sidebar routes).
     */
    featuresForPath(pathname: string): string[];
    /**
     * False only when the most specific claims matching the path exist and every
     * one of them is non-entitled. Unclaimed and always-allowed paths are true.
     */
    isPathEntitled(pathname: string): boolean;
}

/** Everything entitled — LEGACY, loading, failure, no catalogue. */
export const FULL_ENTITLEMENT: Entitlement = Object.freeze({
    managed: false,
    isFeatureOn: () => true,
    isNavItemEntitled: () => true,
    isNavGoverned: () => false,
    isWidgetEntitled: () => true,
    isQuickActionEntitled: () => true,
    isAssistantGroupEntitled: () => true,
    isSetupStepEntitled: () => true,
    featuresForPath: () => [],
    isPathEntitled: () => true,
});

type GovernanceIndex = Map<string, string[]>;

const addTo = (index: GovernanceIndex, id: string, featureKey: string) => {
    const list = index.get(id);
    if (!list) index.set(id, [featureKey]);
    else if (!list.includes(featureKey)) list.push(featureKey);
};

const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));

/** Claims whose path is the longest one covering `pathname` (the deciding tier). */
export function mostSpecificClaims(claims: RouteClaim[], pathname: string): RouteClaim[] {
    const path = toAppPath(pathname);
    if (!path) return [];
    let best = -1;
    let tier: RouteClaim[] = [];
    for (const c of claims) {
        if (!pathCovers(c.path, path)) continue;
        if (c.path.length > best) {
            best = c.path.length;
            tier = [c];
        } else if (c.path.length === best) {
            tier.push(c);
        }
    }
    return tier;
}

export interface CreateEntitlementArgs {
    catalog: CapabilityCatalog;
    /** Resolved feature state; `useCapabilities().can` (fails open). */
    can: (featureKey: string) => boolean;
    /** Built-in sidebar (getSidebarItemsData()) — sub-tab lists and routes. */
    staticItems: SidebarItemsType[];
}

export function createEntitlement({
    catalog,
    can,
    staticItems,
}: CreateEntitlementArgs): Entitlement {
    const nav: GovernanceIndex = new Map();
    const widgets: GovernanceIndex = new Map();
    const quickActions: GovernanceIndex = new Map();
    const assistantGroups: GovernanceIndex = new Map();
    const setupSteps: GovernanceIndex = new Map();
    const catalogRoutes: GovernanceIndex = new Map();

    for (const m of catalog.modules) {
        for (const f of m.features) {
            f.governs.nav.forEach((id) => addTo(nav, id, f.key));
            f.governs.widgets.forEach((id) => addTo(widgets, id, f.key));
            f.governs.quick_actions.forEach((id) => addTo(quickActions, id, f.key));
            f.governs.assistant_groups.forEach((id) => addTo(assistantGroups, id, f.key));
            f.governs.setup_steps.forEach((id) => addTo(setupSteps, id, f.key));
            f.governs.routes.forEach((route) => {
                const path = toAppPath(route);
                if (path) addTo(catalogRoutes, path, f.key);
            });
        }
    }

    const allOn = (keys: string[] | undefined) => !keys || keys.every((k) => can(k));
    const govOf = (index: GovernanceIndex, id: string) => index.get(id) ?? [];

    const staticSubIds = new Map<string, string[]>();
    staticItems.forEach((item) => {
        if (item.subItems?.length) {
            staticSubIds.set(
                item.id,
                item.subItems.map((s) => s.subItemId)
            );
        }
    });

    const isNavItemEntitled = (tabId: string, subId?: string): boolean => {
        if (!allOn(nav.get(tabId))) return false;
        if (subId !== undefined) return allOn(nav.get(`${tabId}/${subId}`));
        const subs = staticSubIds.get(tabId);
        if (subs && subs.length > 0 && subs.every((s) => !allOn(nav.get(`${tabId}/${s}`)))) {
            return false;
        }
        return true;
    };

    // Route claims: catalogue route prefixes, plus every built-in sidebar route
    // with the features governing its tab (and sub-tab).
    const claims: RouteClaim[] = [];
    catalogRoutes.forEach((features, path) => {
        if (!isAlwaysAllowedPath(path)) claims.push({ path, features, source: 'catalog' });
    });
    staticItems.forEach((item) => {
        const tabFeatures = govOf(nav, item.id);
        const tabPath = toAppPath(item.to);
        if (tabPath && !isAlwaysAllowedPath(tabPath)) {
            claims.push({ path: tabPath, features: tabFeatures, source: 'nav', navKey: item.id });
        }
        item.subItems?.forEach((sub) => {
            const subPath = toAppPath(sub.subItemLink);
            if (!subPath || isAlwaysAllowedPath(subPath)) return;
            const navKey = `${item.id}/${sub.subItemId}`;
            claims.push({
                path: subPath,
                features: union(tabFeatures, govOf(nav, navKey)),
                source: 'nav',
                navKey,
            });
        });
    });

    return {
        managed: true,
        isFeatureOn: (key) => can(key),
        isNavItemEntitled,
        isNavGoverned: (tabId, subId) => nav.has(subId === undefined ? tabId : `${tabId}/${subId}`),
        isWidgetEntitled: (id) => allOn(widgets.get(id)),
        isQuickActionEntitled: (id) => allOn(quickActions.get(id)),
        isAssistantGroupEntitled: (group) => allOn(assistantGroups.get(group)),
        isSetupStepEntitled: (id) => allOn(setupSteps.get(id)),
        featuresForPath: (pathname) =>
            Array.from(new Set(mostSpecificClaims(claims, pathname).flatMap((c) => c.features))),
        isPathEntitled: (pathname) => {
            if (isAlwaysAllowedPath(pathname)) return true;
            const tier = mostSpecificClaims(claims, pathname);
            if (tier.length === 0) return true;
            return tier.some((c) => allOn(c.features));
        },
    };
}
