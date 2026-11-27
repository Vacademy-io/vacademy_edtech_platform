import { useCallback, useEffect, useRef } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';

/**
 * Browser-history integration for the learner side-view tabs.
 *
 * Each tab the admin clicks pushes a history entry on the SAME url, carrying
 * the tab id in history state. The browser back button then steps back
 * through the tabs instead of leaving the page. When the drawer closes, the
 * tab entries are popped so back again behaves as if the drawer was never
 * explored.
 *
 * The url is left untouched (state only), so list filters, loaders and
 * shared links are unaffected.
 */
export const SIDE_TAB_STATE_KEY = '__studentSideTab';
const DEPTH_KEY = '__studentSideTabDepth';

type SideTabState = {
    [SIDE_TAB_STATE_KEY]?: string;
    [DEPTH_KEY]?: number;
};

/** True when a history entry was pushed by a side-view tab switch. */
export const isSideTabHistoryState = (state: unknown): boolean =>
    !!state && typeof state === 'object' && SIDE_TAB_STATE_KEY in state;

export function useSideViewTabHistory({
    enabled,
    isOpen,
    category,
    setCategory,
}: {
    enabled: boolean;
    isOpen: boolean;
    category: string;
    setCategory: (id: string) => void;
}) {
    const router = useRouter();
    const historyTab = useRouterState({
        select: (s) => (s.location.state as SideTabState | undefined)?.[SIDE_TAB_STATE_KEY],
    });
    // Tab that was showing before the first pushed entry, restored when back
    // lands on the original (state-less) entry.
    const baseCategoryRef = useRef<string | null>(null);
    const prevHistoryTabRef = useRef(historyTab);

    // Back / forward: follow the tab recorded on the entry we landed on.
    useEffect(() => {
        if (!enabled) return;
        const prev = prevHistoryTabRef.current;
        prevHistoryTabRef.current = historyTab;
        if (historyTab === prev) return;
        if (historyTab) setCategory(historyTab);
        else if (baseCategoryRef.current) setCategory(baseCategoryRef.current);
    }, [enabled, historyTab, setCategory]);

    // Drawer closed: drop the tab entries so back leaves the page as before.
    const wasOpenRef = useRef(isOpen);
    useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (!enabled || !wasOpen || isOpen) return;
        const state = router.state.location.state as SideTabState | undefined;
        const depth = state?.[DEPTH_KEY] ?? 0;
        if (depth > 0) router.history.go(-depth);
    }, [enabled, isOpen, router]);

    return useCallback(
        (id: string) => {
            if (!enabled || !isOpen) {
                setCategory(id);
                return;
            }
            if (id === category) return;
            const current = router.state.location.state as SideTabState | undefined;
            if (!current?.[SIDE_TAB_STATE_KEY]) baseCategoryRef.current = category;
            const depth = (current?.[DEPTH_KEY] ?? 0) + 1;
            setCategory(id);
            // window.location, not the router location: the list writes its
            // filters with a raw history.replaceState the router never sees.
            const { pathname, search, hash } = window.location;
            router.history.push(pathname + search + hash, {
                [SIDE_TAB_STATE_KEY]: id,
                [DEPTH_KEY]: depth,
            } as unknown as Parameters<typeof router.history.push>[1]);
        },
        [enabled, isOpen, category, router, setCategory]
    );
}
