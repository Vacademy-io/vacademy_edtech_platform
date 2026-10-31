/**
 * Navigation access — pure helpers shared by the sidebar, ⌘K search, Recent and
 * the route guard (INSTITUTE_MODULES_AND_CONFIG_SPEC.md §9).
 *
 * Two different questions, kept apart on purpose:
 *  - ENTITLEMENT (the institute's plan): applied only when `entitlement.managed`.
 *    With FULL_ENTITLEMENT every function here returns its input unchanged.
 *  - LOCKED (the role's Display Settings): applies in every mode. A locked entry
 *    is never OFFERED as a shortcut (search, Recent) and its page is guarded.
 *    Entries merely HIDDEN for a role are not guarded — deep links rely on them.
 */
import type {
    SidebarCategory,
    SidebarItemsType,
} from '@/types/layout-container/layout-container-types';
import type { RecentTabEntry } from '@/components/common/layout-container/sidebar/recent-tabs-store';
import { type Entitlement, isAlwaysAllowedPath, pathCovers, toAppPath } from './entitlement';

// ─── Sidebar list ────────────────────────────────────────────────────────────

/**
 * Drops non-entitled tabs and sub-tabs (MANAGED only; otherwise returns `items`
 * itself). A tab that had sub-tabs and lost all of them to entitlement goes too.
 * Ungoverned entries (custom tabs, custom sub-tabs) stay unless their route lands
 * on a page outside the plan — a custom tab must not reopen what the plan closed.
 */
export function filterSidebarByEntitlement(
    items: SidebarItemsType[],
    entitlement: Entitlement
): SidebarItemsType[] {
    if (!entitlement.managed) return items;
    const routeOk = (link: string | undefined) => {
        const path = toAppPath(link);
        return !path || entitlement.isPathEntitled(path);
    };
    const out: SidebarItemsType[] = [];
    for (const item of items) {
        if (!entitlement.isNavItemEntitled(item.id)) continue;
        if (!entitlement.isNavGoverned(item.id) && !routeOk(item.to)) continue;
        if (!item.subItems || item.subItems.length === 0) {
            out.push(item);
            continue;
        }
        const subItems = item.subItems.filter(
            (s) =>
                entitlement.isNavItemEntitled(item.id, s.subItemId) &&
                (entitlement.isNavGoverned(item.id, s.subItemId) || routeOk(s.subItemLink))
        );
        if (subItems.length === item.subItems.length) {
            out.push(item);
        } else if (subItems.length > 0) {
            out.push({ ...item, subItems });
        } else if (item.to) {
            // Every sub-tab was outside the plan; a tab with its own route stays as a link.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { subItems: _dropped, ...link } = item;
            out.push(link);
        }
        // else: nothing left to show under it.
    }
    return out;
}

/** Rail categories that have at least one tab to show (Settings lives on its own). */
export function categoriesWithItems(
    items: SidebarItemsType[],
    instituteId: string | undefined
): Set<SidebarCategory> {
    const set = new Set<SidebarCategory>();
    items.forEach((item) => {
        if (item.id === 'settings') return;
        if (item.showForInstitute && item.showForInstitute !== instituteId) return;
        set.add(item.category || 'CRM');
    });
    return set;
}

/** The rail's built-in category order (category-rail.tsx), used as the last fallback. */
export const RAIL_CATEGORY_ORDER: readonly SidebarCategory[] = ['CRM', 'LMS', 'AI', 'ERP'];

export interface PickActiveCategoryArgs {
    /** Categories whose sidebar entries cover the current route, in priority order. */
    matches: SidebarCategory[];
    /** The rail's current category. */
    activeCategory: string;
    /** True when the route changed since the last sync (not a re-run on the same page). */
    isNavigation: boolean;
    /** roleDisplay.sidebarCategories (null while the role's settings load). */
    sidebarCategories?: Array<CategoryState & { default?: boolean; order?: number }> | null;
    /**
     * MANAGED: the categories that have something to show (categoriesWithItems of
     * the final sidebar — the rail draws only these). null = no restriction (LEGACY).
     */
    available: Set<SidebarCategory> | null;
}

/**
 * Which rail category the sidebar opens for the current route; null = keep the
 * current one.
 *  1. The current category, when the user navigated within it.
 *  2. The first matching category the role can see.
 *  3. The role's default category, then its first visible one by order.
 *  4. MANAGED only: the first category, in rail order, with anything to show.
 * In MANAGED mode every step skips categories with nothing to show, so a page
 * outside the plan (its route still matches the static LMS/AI/ERP entries, or
 * nothing at all) lands on a category the rail draws instead of an empty panel.
 * LEGACY (`available` null) behaves exactly as before: the rail draws every
 * visible category, and with the role's settings still loading it keeps the
 * current one.
 */
export function pickActiveCategory({
    matches,
    activeCategory,
    isNavigation,
    sidebarCategories,
    available,
}: PickActiveCategoryArgs): SidebarCategory | null {
    const isVisible = (cat: string) => {
        const cfg = sidebarCategories?.find((c) => c.id === cat);
        return cfg ? cfg.visible !== false : true;
    };
    const usable = (cat: string): cat is SidebarCategory =>
        isVisible(cat) && (!available || available.has(cat as SidebarCategory));

    if (
        isNavigation &&
        matches.includes(activeCategory as SidebarCategory) &&
        usable(activeCategory)
    ) {
        return activeCategory as SidebarCategory;
    }
    const match = matches.find(usable);
    if (match) return match;

    if (sidebarCategories) {
        const cats = sidebarCategories.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const fallback =
            cats.find((c) => c.default && usable(c.id)) ?? cats.find((c) => usable(c.id));
        if (fallback) return fallback.id as SidebarCategory;
    }
    if (available) return RAIL_CATEGORY_ORDER.find(usable) ?? null;
    return null;
}

// ─── Visible / locked entries ────────────────────────────────────────────────

export interface CategoryState {
    id: string;
    visible?: boolean;
    locked?: boolean;
}

export interface NavAccessContext {
    instituteId?: string;
    /** roleDisplay.sidebarCategories */
    sidebarCategories?: CategoryState[] | null;
}

export interface NavEntry {
    /** The link exactly as the sidebar renders it (may carry a query). */
    route: string;
    path: string;
    label: string;
    locked: boolean;
    tabId: string;
    subId?: string;
}

const categoryFlags = (ctx: NavAccessContext, category: SidebarCategory) => {
    const cfg = ctx.sidebarCategories?.find((c) => c.id === category);
    return { hidden: cfg?.visible === false, locked: cfg?.visible !== false && !!cfg?.locked };
};

const isItemShown = (item: SidebarItemsType, ctx: NavAccessContext) => {
    if (item.showForInstitute && item.showForInstitute !== ctx.instituteId) return false;
    return !categoryFlags(ctx, item.category || 'CRM').hidden;
};

/**
 * Every entry the user can SEE in the sidebar (tabs with a route + sub-tabs),
 * each marked locked when it, its parent tab or its rail category is locked.
 * Input is the final sidebar list (role- and entitlement-filtered).
 */
export function collectNavEntries(items: SidebarItemsType[], ctx: NavAccessContext): NavEntry[] {
    const entries: NavEntry[] = [];
    for (const item of items) {
        if (item.id === 'settings' || !isItemShown(item, ctx)) continue;
        const parentLocked = !!item.locked || categoryFlags(ctx, item.category || 'CRM').locked;
        const tabPath = toAppPath(item.to);
        if (item.to && tabPath) {
            entries.push({
                route: item.to,
                path: tabPath,
                label: item.title,
                locked: parentLocked,
                tabId: item.id,
            });
        }
        item.subItems?.forEach((sub) => {
            const subPath = toAppPath(sub.subItemLink);
            if (!sub.subItemLink || !subPath) return;
            entries.push({
                route: sub.subItemLink,
                path: subPath,
                label: sub.subItem || item.title,
                locked: parentLocked || !!sub.locked,
                tabId: item.id,
                subId: sub.subItemId,
            });
        });
    }
    return entries;
}

/**
 * The ⌘K search list: the same items minus anything locked (a locked tab takes
 * its sub-tabs with it), hidden categories and other institutes' items.
 */
export function filterSearchableItems(
    items: SidebarItemsType[],
    ctx: NavAccessContext
): SidebarItemsType[] {
    const out: SidebarItemsType[] = [];
    for (const item of items) {
        if (item.id === 'settings') continue;
        if (!isItemShown(item, ctx)) continue;
        if (item.locked || categoryFlags(ctx, item.category || 'CRM').locked) continue;
        if (!item.subItems) {
            out.push(item);
            continue;
        }
        const subItems = item.subItems.filter((s) => !s.locked);
        out.push(subItems.length === item.subItems.length ? item : { ...item, subItems });
    }
    return out;
}

/**
 * Recent entries still on offer: the route must belong to a visible, unlocked
 * sidebar entry right now. Settings screens (recorded as "/settings") stay when
 * the user can open Settings at all.
 */
export function filterRecentEntries(
    entries: RecentTabEntry[],
    items: SidebarItemsType[],
    ctx: NavAccessContext & { canOpenSettings: boolean }
): RecentTabEntry[] {
    const offered = new Set(
        collectNavEntries(items, ctx)
            .filter((e) => !e.locked)
            .map((e) => e.route)
    );
    return entries.filter((e) => {
        if (offered.has(e.route)) return true;
        const path = toAppPath(e.route);
        return ctx.canOpenSettings && !!path && pathCovers('/settings', path);
    });
}

// ─── Route guard decision ────────────────────────────────────────────────────

export type RouteAccessDecision =
    | { kind: 'allow' }
    | { kind: 'not-in-plan'; features: string[] }
    | { kind: 'locked'; label: string };

export interface DecideRouteAccessArgs {
    pathname: string;
    entitlement: Entitlement;
    /**
     * collectNavEntries() of the role's final sidebar, or null while it is not
     * known (sidebar not mounted / settings still loading) — then no lock check.
     */
    navEntries: NavEntry[] | null;
}

/**
 * (a) MANAGED: the most specific catalogue/sidebar claims on the path are all
 *     outside the plan → not-in-plan.
 * (b) Any mode: the most specific VISIBLE sidebar entries covering the path are
 *     all locked → locked. Hidden entries are not in `navEntries`, so a path only
 *     reachable through a hidden entry is allowed (deep links).
 * Always-allowed paths (dashboard, settings, auth, the locked page) never block.
 */
export function decideRouteAccess({
    pathname,
    entitlement,
    navEntries,
}: DecideRouteAccessArgs): RouteAccessDecision {
    const path = toAppPath(pathname);
    if (!path || isAlwaysAllowedPath(path)) return { kind: 'allow' };

    if (entitlement.managed && !entitlement.isPathEntitled(path)) {
        return { kind: 'not-in-plan', features: entitlement.featuresForPath(path) };
    }

    if (navEntries && navEntries.length > 0) {
        let best = -1;
        let tier: NavEntry[] = [];
        for (const e of navEntries) {
            if (e.path === '/' || !pathCovers(e.path, path)) continue;
            if (e.path.length > best) {
                best = e.path.length;
                tier = [e];
            } else if (e.path.length === best) {
                tier.push(e);
            }
        }
        if (tier.length > 0 && tier.every((e) => e.locked)) {
            return { kind: 'locked', label: tier[0]!.label };
        }
    }
    return { kind: 'allow' };
}
