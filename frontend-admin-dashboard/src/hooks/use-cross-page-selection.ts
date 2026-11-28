import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OnChangeFn, RowSelectionState } from '@tanstack/react-table';

/**
 * Row selection that can span every page of a paginated table.
 *
 * The tables here render selection per page, keyed by the row's index within that page. That is fine
 * for ticking a few rows, but it caps a "select everything" action at the ten rows currently on
 * screen: to message 400 learners you had to walk 40 pages. This adds a second mode — *all matching
 * rows* — that fetches every row for the active filters in one request and then tracks
 * **exclusions**, so unticking someone after "Select all" removes just that person instead of
 * collapsing back to one page.
 *
 * @param page           current (0-based) page number
 * @param pageRows       rows rendered on the current page, in display order
 * @param getId          stable id for a row; used to track exclusions across pages
 * @param totalElements  total rows matching the active filters, from the server
 * @param fetchAllMatching  fetches every matching row in one call (same filters as the table)
 * @param onError        called if that fetch fails, so the caller can toast in its own voice
 * @param resetKey       changes whenever the active filters/search change; clears the selection so a
 *                       bulk action can never run against rows the current filters no longer match
 */
export function useCrossPageSelection<T>({
    page,
    pageRows,
    getId,
    totalElements,
    fetchAllMatching,
    onError,
    resetKey,
}: {
    page: number;
    pageRows: T[];
    getId: (row: T) => string;
    totalElements: number;
    fetchAllMatching: () => Promise<T[]>;
    onError?: (error: unknown) => void;
    resetKey?: string;
}) {
    // Per-page mode: ticked rows by id, with the page they were ticked on. Keyed by id, not by the row's
    // index: when a page refetches (an accepted request drops out of a filtered list) index keys moved the
    // tick onto whichever row slid into that slot. The table still gets index keys (currentPageSelection).
    const [selectedById, setSelectedById] = useState<Record<string, { row: T; page: number }>>({});

    // All-matching mode: every row for the current filters, minus anything unticked since.
    const [allMatching, setAllMatching] = useState<T[] | null>(null);
    const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
    const [isSelectingAll, setIsSelectingAll] = useState(false);

    // When the current page's rows change, refresh the stored rows and drop ticks on rows that left this
    // page (accepted, terminated, filtered out), so a bulk action never runs on rows the screen no longer
    // shows. Ticks from other pages are kept.
    useEffect(() => {
        if (!pageRows.length) return;
        setSelectedById((prev) => {
            const onPage = new Map(pageRows.map((row) => [getId(row), row]));
            let changed = false;
            const next = { ...prev };
            for (const [id, entry] of Object.entries(prev)) {
                if (entry.page !== page) continue;
                const fresh = onPage.get(id);
                if (!fresh) {
                    delete next[id];
                    changed = true;
                } else if (fresh !== entry.row) {
                    next[id] = { row: fresh, page };
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [page, pageRows, getId]);

    const isAllMode = allMatching !== null;

    const currentPageSelection: RowSelectionState = useMemo(() => {
        // The checkbox state is derived from ids. All-mode: everything on screen is ticked except rows
        // the user explicitly removed. Per-page mode: the rows ticked by id.
        const derived: RowSelectionState = {};
        pageRows.forEach((row, index) => {
            const id = getId(row);
            if (isAllMode ? !excludedIds.has(id) : selectedById[id]) derived[index] = true;
        });
        return derived;
    }, [isAllMode, selectedById, pageRows, excludedIds, getId]);

    const onRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback(
        (updaterOrValue) => {
            const next =
                typeof updaterOrValue === 'function'
                    ? updaterOrValue(currentPageSelection)
                    : updaterOrValue;

            if (isAllMode) {
                setExcludedIds((prev) => {
                    const updated = new Set(prev);
                    pageRows.forEach((row, index) => {
                        if (next[index]) updated.delete(getId(row));
                        else updated.add(getId(row));
                    });
                    return updated;
                });
                return;
            }

            setSelectedById((prev) => {
                const updated = { ...prev };
                pageRows.forEach((row, index) => {
                    const id = getId(row);
                    if (next[index]) updated[id] = { row, page };
                    else delete updated[id];
                });
                return updated;
            });
        },
        [currentPageSelection, isAllMode, page, pageRows, getId]
    );

    const selectedRows: T[] = useMemo(() => {
        if (isAllMode) {
            return allMatching.filter((row) => !excludedIds.has(getId(row)));
        }
        return Object.values(selectedById).map((entry) => entry.row);
    }, [isAllMode, allMatching, excludedIds, selectedById, getId]);

    const reset = useCallback(() => {
        setSelectedById({});
        setAllMatching(null);
        setExcludedIds(new Set());
    }, []);

    // "Select all 400" captured 400 concrete rows. Narrow the filters afterwards and those rows are
    // no longer what the screen says is selected — sending to them would hit people the admin just
    // filtered out. Drop the selection whenever the filters change; re-selecting is one click.
    const [lastResetKey, setLastResetKey] = useState(resetKey);
    if (resetKey !== lastResetKey) {
        setLastResetKey(resetKey);
        if (allMatching !== null || Object.keys(selectedById).length > 0) reset();
    }

    const selectAllMatching = useCallback(async () => {
        if (!totalElements) return;
        setIsSelectingAll(true);
        try {
            const rows = await fetchAllMatching();
            setAllMatching(rows);
            setExcludedIds(new Set());
            setSelectedById({});
        } catch (error) {
            onError?.(error);
        } finally {
            setIsSelectingAll(false);
        }
    }, [totalElements, fetchAllMatching, onError]);

    return {
        currentPageSelection,
        onRowSelectionChange,
        selectedRows,
        selectedCount: selectedRows.length,
        reset,
        selectAllMatching,
        isSelectingAll,
        /** True once something is selected but not yet everything the filters match. */
        canSelectAll: totalElements > 0 && selectedRows.length < totalElements,
        isAllMode,
    };
}
