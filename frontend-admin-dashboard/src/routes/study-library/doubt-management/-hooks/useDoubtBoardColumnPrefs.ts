import { useCallback, useState } from 'react';

/**
 * Which staff columns the doubt board shows, persisted per institute in localStorage.
 *
 * Stored as an override map: user id → true (always show) / false (always hide). A staff
 * member with no entry is "auto": shown while they have at least one card on the board and
 * hidden otherwise, so a 30-teacher institute doesn't open to 30 empty columns, yet a teacher
 * you want to drag work onto can be pinned even before they have anything.
 */
export function useDoubtBoardColumnPrefs(storageKey: string) {
    const [overrides, setOverrides] = useState<Record<string, boolean>>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const clean: Record<string, boolean> = {};
                    Object.entries(parsed).forEach(([id, v]) => {
                        if (typeof v === 'boolean') clean[id] = v;
                    });
                    return clean;
                }
            }
        } catch {
            /* corrupt or unavailable storage — start from "auto" for everyone */
        }
        return {};
    });

    const persist = useCallback(
        (next: Record<string, boolean>) => {
            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                /* storage blocked/full — keep the in-memory choice, just don't persist */
            }
        },
        [storageKey]
    );

    const setColumnVisible = useCallback(
        (id: string, visible: boolean) => {
            setOverrides((prev) => {
                const next = { ...prev, [id]: visible };
                persist(next);
                return next;
            });
        },
        [persist]
    );

    const resetColumns = useCallback(() => {
        setOverrides({});
        persist({});
    }, [persist]);

    /** Resolve a staff member's visibility: explicit override, else "has cards". */
    const isColumnVisible = useCallback(
        (id: string, hasCards: boolean) => overrides[id] ?? hasCards,
        [overrides]
    );

    return {
        hasOverrides: Object.keys(overrides).length > 0,
        isColumnVisible,
        setColumnVisible,
        resetColumns,
    };
}
