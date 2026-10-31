import { SidebarItemsType } from '@/types/layout-container/layout-container-types';
import type { DisplaySettingsData } from '@/types/display-settings';
import { SubModuleType } from '@/schemas/student/student-list/institute-schema';
import { SUB_MODULE_SIDEBAR_MAPPING, controlledTabs, modules } from './constant';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import {
    SUB_ORG_MODULE_SUB_ITEM_ID,
    SUB_ORG_MODULE_TAB_ID,
    canAccessSubOrgModule,
} from '@/lib/display-settings/sub-org-module';

export function getModuleFlags(
    sub_modules:
        | { module: string; sub_module: string; sub_module_description: string }[]
        | undefined
) {
    const modules = Array.isArray(sub_modules) ? sub_modules : [];
    return {
        assess: modules.some((item) => item?.module === 'ASSESS'),
        lms: modules.some((item) => item?.module === 'ENGAGE'),
        volt: modules.some((item) => item?.module === 'VOLT'),
        vsmart_ai_tools: modules.some((item) => item?.module === 'VSMART_AI_TOOLS'),
    };
}

// Get allowed sidebar items based on sub-modules
export function getAllowedSidebarItems(subModules: SubModuleType[] | undefined): Set<string> {
    const allowedItems = new Set<string>();

    if (!Array.isArray(subModules)) return allowedItems;

    subModules.forEach((subModule) => {
        if (!subModule) return;
        const mapping = SUB_MODULE_SIDEBAR_MAPPING[subModule.sub_module];
        if (mapping) {
            // Handle both single object and array of mappings
            const mappings = Array.isArray(mapping) ? mapping : [mapping];

            mappings.forEach((map) => {
                if (map.itemId) {
                    allowedItems.add(map.itemId);
                } else if (map.itemIds) {
                    map.itemIds.forEach((id) => allowedItems.add(id));
                }
            });
        }
    });

    return allowedItems;
}

/** Never shown to a non-admin, whatever their Display Settings say. */
const ALWAYS_ADMIN_ONLY_TAB_IDS = [
    'learner-insights', // Learner Live Activities
    'settings', // Settings — institute configuration
    'admin-activity-logs', // Admin audit trail — institute ADMIN only
];

/**
 * Tabs whose `adminOnly` sub-items can never be switched on for a non-admin.
 * Every engagement API requires institute ADMIN (EngagementAccessGuard), so
 * opting a role in would only hand it a page of 403s.
 */
const NO_OPT_IN_SUB_ITEM_TAB_IDS = ['engagement-engines'];

/**
 * Tabs a non-admin only gets when their role's Display Settings switch them on.
 * The teacher/custom defaults ship these hidden, so a saved `visible: true` is a
 * deliberate choice by the institute admin.
 */
const NON_ADMIN_OPT_IN_TAB_IDS = [SUB_ORG_MODULE_TAB_ID];

/**
 * Filters sidebar items based on user role.
 *
 * Admins see everything. For every other role (teacher, custom roles like
 * "Operations") the role's Display Settings decide: an admin-only tab or
 * `adminOnly` sub-item shows only when those settings explicitly mark it
 * visible. With no settings loaded (cold cache, failed fetch) they stay hidden.
 */
export function filterSidebarByRole(
    menuList: SidebarItemsType[],
    roleDisplay?: DisplaySettingsData | null
): SidebarItemsType[] {
    // Roles are per institute: an ADMIN of another institute is not an admin here.
    const userRoles = getRolesForCurrentInstitute();
    const isAdmin = userRoles.includes('ADMIN');

    // If user is admin, return all items
    if (isAdmin) {
        return menuList;
    }

    const tabCfg = new Map((roleDisplay?.sidebar || []).map((t) => [t.id, t]));
    const isTabOptedIn = (tabId: string) => tabCfg.get(tabId)?.visible === true;
    const isSubOptedIn = (tabId: string, subId: string) =>
        isTabOptedIn(tabId) &&
        (tabCfg.get(tabId)?.subTabs || []).some((s) => s.id === subId && s.visible === true);

    // The Sub-Organizations (Channel Partners) module has its own grant. A role
    // with only that grant keeps Manage Institute carrying ONLY the sub-orgs entry;
    // the sub-org rows themselves are scoped to the user's assignments server-side.
    const subOrgModuleGranted = canAccessSubOrgModule();

    return menuList
        .filter((item) => !ALWAYS_ADMIN_ONLY_TAB_IDS.includes(item.id))
        .filter((item) => {
            if (!NON_ADMIN_OPT_IN_TAB_IDS.includes(item.id)) return true;
            if (item.id === SUB_ORG_MODULE_TAB_ID && subOrgModuleGranted) return true;
            return isTabOptedIn(item.id);
        })
        .map((item) => {
            if (!item.subItems || item.subItems.length === 0) return item;
            if (item.id === SUB_ORG_MODULE_TAB_ID && !isTabOptedIn(item.id)) {
                return {
                    ...item,
                    subItems: item.subItems.filter(
                        (sub) => sub.subItemId === SUB_ORG_MODULE_SUB_ITEM_ID
                    ),
                };
            }
            const filteredSubItems = item.subItems.filter((sub) => {
                if (sub.subItemId === SUB_ORG_MODULE_SUB_ITEM_ID && !subOrgModuleGranted) {
                    return false;
                }
                if (!sub.adminOnly) return true;
                return (
                    !NO_OPT_IN_SUB_ITEM_TAB_IDS.includes(item.id) &&
                    isSubOptedIn(item.id, sub.subItemId)
                );
            });
            return { ...item, subItems: filteredSubItems };
        });
}

export function filterMenuList(
    subModules: { assess: boolean | undefined; lms: boolean | undefined },
    menuList: SidebarItemsType[]
) {
    return menuList.filter((item) => {
        if (item.to === '/assessment' && !subModules.assess) return false;
        return true;
    });
}

// Get allowed sub-items for a specific sidebar item
export function getAllowedSubItems(
    subModules: SubModuleType[] | undefined,
    itemId: string
): Set<string> {
    const allowedSubItems = new Set<string>();

    if (!Array.isArray(subModules)) return allowedSubItems;

    subModules.forEach((subModule) => {
        if (!subModule) return;
        const mapping = SUB_MODULE_SIDEBAR_MAPPING[subModule.sub_module];
        if (mapping) {
            // Handle both single object and array of mappings
            const mappings = Array.isArray(mapping) ? mapping : [mapping];

            mappings.forEach((map) => {
                if (map.itemId && map.itemId === itemId) {
                    if (Array.isArray(map.subItemIds)) {
                        map.subItemIds.forEach((subItem: string) => allowedSubItems.add(subItem));
                    }
                } else if (map.itemIds && map.itemIds.includes(itemId)) {
                    if (Array.isArray(map.subItemIds)) {
                        map.subItemIds.forEach((subItem: string) => allowedSubItems.add(subItem));
                    }
                }
            });
        }
    });

    return allowedSubItems;
}

export function filterMenuListByModules(
    subModules: SubModuleType[] | undefined,
    menuList: SidebarItemsType[]
): SidebarItemsType[] {
    const allowedItems = getAllowedSidebarItems(subModules);

    return menuList
        .filter((item) => {
            // Always allow key tabs irrespective of module mapping
            if (
                item.id === 'dashboard' ||
                item.id === 'settings' ||
                item.id === 'announcement' ||
                item.id === 'user-tags' ||
                item.id === 'manage-campaigns' ||
                item.id === 'planning' ||
                item.id === 'membership-expiry' ||
                item.id === 'membership-stats' ||
                item.id === 'manage-contacts' ||
                item.id === 'ai-center' ||
                item.id === 'instructor-copilot' ||
                item.id === 'admissions'
            ) {
                return true;
            }

            // Check if the item is allowed based on sub-modules
            return allowedItems.has(item.id);
        })
        .map((item) => {
            // If item has sub-items, filter them based on allowed sub-items
            if (item.subItems) {
                const allowedSubItems = getAllowedSubItems(subModules, item.id);
                // If no explicit sub-item permissions found for this item, keep all sub-items
                if (allowedSubItems.size === 0) {
                    return item;
                }
                const filteredSubItems = item.subItems.filter((subItem) =>
                    allowedSubItems.has(subItem.subItemId || '')
                );
                return { ...item, subItems: filteredSubItems };
            }
            return item;
        });
}

export function filterMenuItems(
    menuList: SidebarItemsType[],
    instituteId: string | undefined,
    isTabVisible?: (tabId: string) => boolean,
    isSubItemVisible?: (parentTabId: string, subItemTabId: string) => boolean,
    roleDisplay?: DisplaySettingsData | null
) {
    // Define the tabs that should be controlled by tab settings
    let filteredList = filterSidebarByRole(menuList, roleDisplay);

    // Apply tab settings filtering if functions are provided
    if (isTabVisible && isSubItemVisible) {
        filteredList = filteredList
            .filter((item) => {
                // show all tabs that are not controlled tabs
                if (!controlledTabs.includes(item.id)) {
                    return true; // show all tabs that are not controlled tabs
                }

                // in case of controlled tabs, return true if the tab is visible
                return isTabVisible(item.id);
            })
            .map((item) => {
                // Do the same for sub-items
                if (item.subItems) {
                    const filteredSubItems = item.subItems.filter((subItem) => {
                        // show all sub-items that are not controlled sub-items
                        if (!controlledTabs.includes(subItem.subItemId || '')) {
                            return true;
                        }

                        // in case of controlled sub-items, return true if the sub-item is visible
                        // Note: For controlled sub-items, we check their individual visibility
                        // regardless of whether the parent tab is controlled or not
                        return isSubItemVisible(item.id, subItem.subItemId || '');
                    });

                    // return the item with filtered sub-items
                    return { ...item, subItems: filteredSubItems };
                }
                return item;
            });
    }

    return filteredList;
}

export function getModules(subModules: SubModuleType[] | undefined) {
    const optionalModules: Set<string> = new Set();

    if (Array.isArray(subModules)) {
        subModules.forEach((subModule) => {
            if (subModule && modules.includes(subModule.module)) {
                optionalModules.add(subModule.module);
            }
        });
    }

    const result = Array.from(optionalModules);
    return result;
}

/**
 * Split a sidebar link into the pieces TanStack Router actually understands.
 *
 * Sidebar entries are plain strings and some carry a query
 * ("/settings?selectedTab=telephony"). The router does NOT parse a query out of
 * `to` — it would end up inside the pathname and match nothing — so anything
 * after the "?" has to travel in `search`.
 *
 * Values are JSON-coerced exactly the way the router's own `parseSearch` does,
 * because `stringifySearch` re-serialises anything JSON-parseable: handing it
 * the raw string "0" produces `?currentStep="0"` in the address bar, which then
 * parses back out as the string "0" and blows up a `z.number()` schema. Coercing
 * here makes a sidebar click land on exactly the URL a hard page load would.
 */
export function parseSidebarLink(link?: string): {
    to: string;
    search?: Record<string, unknown>;
} {
    if (!link) return { to: '' };
    const q = link.indexOf('?');
    if (q === -1) return { to: link };
    const search: Record<string, unknown> = {};
    new URLSearchParams(link.slice(q + 1)).forEach((value, key) => {
        try {
            // Non-JSON values ("liveTests", "telephony", …) stay strings.
            search[key] = JSON.parse(value);
        } catch {
            search[key] = value;
        }
    });
    return { to: link.slice(0, q), search };
}

/**
 * Is this sidebar link the one the user is currently on?
 *
 * Several sub-items can share a path and differ only by query — the Follow-ups
 * buckets are all /audience-manager/follow-ups with ?bucket=today|all|overdue|…
 * Comparing the pathname against the whole link meant none of those ever
 * matched, so the highlight stayed on whichever sibling had a bare path and
 * clicking "All Follow Ups" left it on "Today's Pending Follow-ups".
 *
 * A link's identifying params must all be satisfied (see sidebarLinkIdentity);
 * extra params in the URL (date=, a filter the user added) don't stop it matching.
 */
export function isSidebarLinkActive(
    link: string | undefined,
    currentPath: string,
    currentSearch: Record<string, unknown> | undefined
): boolean {
    if (!sidebarLinkPathMatches(link, currentPath)) return false;
    const identity = sidebarLinkIdentity(parseSidebarLink(link).search);
    if (!identity) return true;
    return Object.entries(identity).every(([key, value]) =>
        sameSearchValue(currentSearch?.[key], value)
    );
}

/** Does the link's path (query ignored) cover the current pathname? */
function sidebarLinkPathMatches(link: string | undefined, currentPath: string): boolean {
    if (!link) return false;
    const { to } = parseSidebarLink(link);
    if (!to) return false;
    return currentPath === to || currentPath.startsWith(to + '/');
}

/**
 * The params that say WHICH sub-tab a link is.
 *
 * A link that pins filters with `lock=` is identified by those, plus `lock`
 * itself (it tells "All Leads", which pins status, apart from "Shortlisted",
 * which pins tier AND the same status). Its other params are only the values the
 * page opens with, and the user is free to change them: every I2CAN Enquiry link
 * opens on `range=ALL`, so picking a date used to drop the highlight and leave
 * nothing in the sidebar saying which list was open.
 *
 * A link without `lock=` is identified by all of its params, as before.
 */
function sidebarLinkIdentity(
    search: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (!search || search.lock == null || search.lock === '') return search;
    const pinned = new Set(['lock', ...splitSearchList(search.lock)]);
    return Object.fromEntries(Object.entries(search).filter(([key]) => pinned.has(key)));
}

const splitSearchList = (value: unknown): string[] =>
    String(value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

/**
 * Comma lists compare as sets: the page writes back the statuses it holds, which
 * need not be in the order the route listed them.
 */
const sameSearchValue = (a: unknown, b: unknown): boolean =>
    splitSearchList(a).sort().join(',') === splitSearchList(b).sort().join(',');

/** How many of the link's own params the current URL still carries unchanged. */
function matchedParamCount(link: string, currentSearch: Record<string, unknown> | undefined) {
    const { search } = parseSidebarLink(link);
    return Object.entries(search ?? {}).filter(([key, value]) =>
        sameSearchValue(currentSearch?.[key], value)
    ).length;
}

/**
 * How specific a link is, for picking a winner when several match. With the
 * current URL given, only params it still carries count, so between two links
 * that pin the same filters the one whose opening values are untouched wins.
 */
export function sidebarLinkSpecificity(
    link: string | undefined,
    currentSearch?: Record<string, unknown>
): number {
    if (!link) return 0;
    const { to, search } = parseSidebarLink(link);
    const params = currentSearch
        ? matchedParamCount(link, currentSearch)
        : Object.keys(search ?? {}).length;
    return to.length + params * 1000;
}

/**
 * Which of `links` is the page the user is on, or null. The most specific match
 * wins; on a tie the earlier link does, as the panel always picked.
 */
export function pickActiveSidebarLink(
    links: Array<string | undefined>,
    currentPath: string,
    currentSearch: Record<string, unknown> | undefined
): string | null {
    let best: string | null = null;
    let bestScore = -1;
    for (const link of links) {
        if (!link || !isSidebarLinkActive(link, currentPath, currentSearch)) continue;
        const score = sidebarLinkSpecificity(link, currentSearch);
        if (score > bestScore) {
            best = link;
            bestScore = score;
        }
    }
    return best;
}
