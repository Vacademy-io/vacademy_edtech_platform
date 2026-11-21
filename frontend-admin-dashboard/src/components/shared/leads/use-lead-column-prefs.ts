import { useCallback, useState } from 'react';

/** A table column the user can show/hide (and, where enabled, drag into order). */
export interface LeadColumnToggle {
    id: string;
    label: string;
    /**
     * Structural columns that carry the row's identity and can't be switched off (their
     * checkbox renders ticked and disabled). They can still be dragged into a new position.
     */
    locked?: boolean;
}

/**
 * Institute wording for the renamable columns. Pass the values from
 * useLeadTerminology() so the "Manage Column" list says what the table headers
 * say — an institute that calls Tier "Interest Level" must not see "Tier" here.
 */
export interface LeadColumnLabels {
    tier?: string;
    leadStatus?: string;
    campaignType?: string;
    /** What this institute calls the audience a lead came in through. */
    leadSource?: string;
}

/**
 * The LeadTable columns a user may show/hide, in display order. Mirrors the
 * gating in LeadTable's own column list: the ops columns appear only when the
 * lead-ops feature is on, and the score column only when score display is on.
 * The Lead-name column is intentionally omitted — it is always shown.
 */
export function buildLeadColumnToggles(
    showOps: boolean,
    showScore: boolean,
    labels?: LeadColumnLabels
): LeadColumnToggle[] {
    const cols: LeadColumnToggle[] = [
        { id: 'contact', label: 'Contact' },
        { id: 'source', label: labels?.leadSource || 'Lead source' },
        { id: 'campaignType', label: labels?.campaignType || 'Campaign type' },
        { id: 'utmCampaign', label: 'UTM campaign' },
    ];
    if (showOps) cols.push({ id: 'status', label: labels?.leadStatus || 'Lead status' });
    if (showScore) cols.push({ id: 'score', label: 'Lead score' });
    if (showOps) {
        cols.push(
            { id: 'tier', label: labels?.tier || 'Tier' },
            { id: 'reachout', label: 'Reach out in' },
            { id: 'followup', label: 'Follow up at' },
            { id: 'owner', label: 'Lead owner' },
            { id: 'activity', label: 'Activity' }
        );
    }
    cols.push({ id: 'submitted', label: 'Submitted' });
    return cols;
}

/**
 * Per-user "Manage Column" preferences for the shared LeadTable, persisted to
 * localStorage so a show/hide choice survives reloads and navigation (the state
 * used to be ephemeral and reset on every mount).
 *
 * Keyed per surface via `storageKey` (e.g. Recent Leads vs. the audience lead
 * list) so each table keeps its own layout while sharing this mechanism.
 * `defaultHidden` seeds the set the first time a surface is opened (before the
 * user has expressed any preference); pass a stable reference.
 */
export function useLeadColumnPrefs(storageKey: string, defaultHidden: string[] = []) {
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
                }
            }
        } catch {
            /* corrupt or unavailable storage — fall back to the defaults below */
        }
        return new Set(defaultHidden);
    });

    const persist = useCallback(
        (next: Set<string>) => {
            try {
                localStorage.setItem(storageKey, JSON.stringify([...next]));
            } catch {
                /* storage blocked/full — keep the in-memory choice, just don't persist */
            }
        },
        [storageKey]
    );

    const toggleColumn = useCallback(
        (id: string) => {
            setHiddenColumns((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                persist(next);
                return next;
            });
        },
        [persist]
    );

    const resetColumns = useCallback(() => {
        const next = new Set(defaultHidden);
        setHiddenColumns(next);
        persist(next);
    }, [defaultHidden, persist]);

    return { hiddenColumns, toggleColumn, resetColumns };
}

/** Never let a drag shrink a column past this — a 0px column can't be grabbed back. */
export const MIN_COLUMN_WIDTH = 72;
/** Upper bound, so one runaway drag can't push every other column off screen. */
export const MAX_COLUMN_WIDTH = 640;

/**
 * Per-user column WIDTHS for a table, persisted to localStorage beside the show/hide and
 * order preferences above. Stored as an id → pixels map; a column absent from the map
 * falls back to its natural (content-driven) width, so this only ever records the columns
 * someone has actually dragged.
 *
 * Kept as its own hook and key so a surface can adopt resizing without touching how it
 * stores visibility or order — and so clearing widths is a separate, safe operation.
 */
export function useColumnWidthPrefs(storageKey: string) {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    // Re-validate every entry: a stale or hand-edited value must not be able
                    // to render a column at 0px (ungrabbable) or 5000px (table unusable).
                    return Object.fromEntries(
                        Object.entries(parsed as Record<string, unknown>)
                            .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
                            .map(([k, v]) => [
                                k,
                                Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, v as number)),
                            ])
                    );
                }
            }
        } catch {
            /* corrupt or unavailable storage — fall back to natural widths */
        }
        return {};
    });

    const persist = useCallback(
        (next: Record<string, number>) => {
            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                /* storage blocked/full — keep the in-memory width, just don't persist */
            }
        },
        [storageKey]
    );

    /**
     * Called on every pointermove of a drag, so it deliberately does NOT write to storage —
     * only the in-memory state moves. `commitColumnWidth` persists once, on pointerup.
     */
    const setColumnWidth = useCallback((id: string, width: number) => {
        setColumnWidths((prev) => ({
            ...prev,
            [id]: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width))),
        }));
    }, []);

    const commitColumnWidths = useCallback(() => {
        setColumnWidths((prev) => {
            persist(prev);
            return prev;
        });
    }, [persist]);

    /** Drop one column back to its natural width (double-click on the handle). */
    const clearColumnWidth = useCallback(
        (id: string) => {
            setColumnWidths((prev) => {
                if (!(id in prev)) return prev;
                const next = { ...prev };
                delete next[id];
                persist(next);
                return next;
            });
        },
        [persist]
    );

    const resetColumnWidths = useCallback(() => {
        setColumnWidths({});
        persist({});
    }, [persist]);

    return {
        columnWidths,
        setColumnWidth,
        commitColumnWidths,
        clearColumnWidth,
        resetColumnWidths,
    };
}

/**
 * Per-user column ORDER for a table, persisted to localStorage beside the show/hide
 * preference above. Kept as a separate hook (and a separate storage key) so a surface can
 * adopt reordering without touching how it stores visibility.
 *
 * The stored value is a plain id list. It is never trusted to be complete or current —
 * see `orderColumnIds` for how it is reconciled against the columns that actually exist.
 */
export function useColumnOrderPrefs(storageKey: string) {
    const [columnOrder, setColumnOrderState] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.filter((x): x is string => typeof x === 'string');
                }
            }
        } catch {
            /* corrupt or unavailable storage — fall back to the natural order */
        }
        return [];
    });

    const setColumnOrder = useCallback(
        (next: string[]) => {
            setColumnOrderState(next);
            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                /* storage blocked/full — keep the in-memory order, just don't persist */
            }
        },
        [storageKey]
    );

    const resetColumnOrder = useCallback(() => setColumnOrder([]), [setColumnOrder]);

    return { columnOrder, setColumnOrder, resetColumnOrder };
}

/**
 * Reconcile a saved order against the columns a table currently has.
 *
 * Saved ids that no longer exist are dropped, and columns the saved order has never seen
 * (a newly shipped column, or one that only appears for some institutes) keep their natural
 * position relative to the saved neighbour they follow — so adding a column doesn't shove it
 * to the end of every admin's layout, and an empty saved order is simply the natural order.
 */
export function orderColumnIds(naturalIds: string[], savedOrder: string[]): string[] {
    if (savedOrder.length === 0) return naturalIds;

    const saved = new Set(savedOrder);
    const known = savedOrder.filter((id) => naturalIds.includes(id));
    if (known.length === 0) return naturalIds;

    // Walk the natural list, emitting each unsaved column right after whichever saved
    // column precedes it naturally (or at the very front when nothing does).
    const trailing: string[][] = known.map(() => []);
    const leading: string[] = [];
    let anchor = -1;
    naturalIds.forEach((id) => {
        if (saved.has(id)) {
            const idx = known.indexOf(id);
            if (idx >= 0) anchor = idx;
            return;
        }
        if (anchor < 0) leading.push(id);
        else trailing[anchor]!.push(id);
    });

    return [...leading, ...known.flatMap((id, i) => [id, ...trailing[i]!])];
}
