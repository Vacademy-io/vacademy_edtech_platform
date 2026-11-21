import type { SidebarCategory } from '@/types/layout-container/layout-container-types';
/**
 * Recent Tabs Store
 *
 * Persists recently visited sidebar tabs/sub-tabs in localStorage.
 * Each entry records the tab id, label, route, parent category, and timestamp.
 */

const STORAGE_KEY = 'vacademy_recent_sidebar_tabs';
const MAX_RECENT = 8;

export interface RecentTabEntry {
    id: string;
    label: string;
    route: string;
    category: SidebarCategory;
    /** ISO timestamp */
    visitedAt: string;
    /** Optional parent tab id (for sub-items) */
    parentId?: string;
    /** Optional parent label */
    parentLabel?: string;
}

function readStore(): RecentTabEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeStore(entries: RecentTabEntry[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
    } catch {
        // silently fail
    }
}

/**
 * Record a visit to a sidebar tab or sub-tab.
 * Moves the entry to the top if it already exists, otherwise prepends it.
 */
export function recordRecentTab(entry: Omit<RecentTabEntry, 'visitedAt'>): void {
    const current = readStore();
    // Remove existing entry with the same route
    const filtered = current.filter((e) => e.route !== entry.route);
    const newEntry: RecentTabEntry = {
        ...entry,
        visitedAt: new Date().toISOString(),
    };
    writeStore([newEntry, ...filtered]);
}

/**
 * Get the list of recent tabs, most recent first.
 */
export function getRecentTabs(): RecentTabEntry[] {
    return readStore();
}

/**
 * Clear all recent tabs.
 */
export function clearRecentTabs(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // silently fail
    }
}
