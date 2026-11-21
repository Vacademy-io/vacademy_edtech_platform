import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/**
 * Paced, background CSV export for the lead queues.
 *
 * Two things were wrong with running the export inline in the page:
 *
 *  - **It was a burst.** Exporting I2CAN's 20,364 follow-ups is ~100 lead
 *    queries, and the old loop fired them back to back with no gap. That query
 *    is not cheap, so one admin pressing Export put a sustained spike on
 *    admin-core that everybody else felt as a slow page.
 *  - **It died with the component.** Navigating away mid-export threw away both
 *    the run and every row it had already fetched, with no download and no
 *    explanation.
 *
 * So a run lives here, in module scope, not in a component. It waits between
 * pages — at least BASE_GAP_MS, and at least as long as the previous page took,
 * so the export never asks for more than roughly half the server's attention and
 * backs off by itself when the server is already busy. Progress goes to a single
 * sonner toast that updates in place, so leaving the page is fine: the toaster
 * is mounted at the app root and the download still arrives.
 */

/** Rows per request. 200 is what the lead queries have always been paged at. */
const PAGE_SIZE = 200;
/** Never less than this between pages, even when the server answers instantly. */
const BASE_GAP_MS = 500;
/** …and never more than this, however slow it gets. */
const MAX_GAP_MS = 4_000;
/** One retry per page: a transient 502 shouldn't cost the whole run. */
const RETRY_GAP_MS = 3_000;
/** ~50k rows. Past this the CSV string itself is a memory problem in the tab. */
const MAX_PAGES = 250;

export interface ExportPage<TRow> {
    content?: TRow[];
    totalPages?: number;
    totalElements?: number;
    last?: boolean;
}

export interface BackgroundExportSpec<TRow> {
    /** Identifies the run; a second start under a live key is refused. */
    key: string;
    fileName: string;
    header: string[];
    fetchPage: (page: number, size: number) => Promise<ExportPage<TRow> | undefined>;
    toRow: (row: TRow) => (string | number | null | undefined)[];
    /**
     * Identity of a row. When given, a row seen on an earlier page is skipped: offset
     * paging over rows that change mid-run (or tie on the sort key) can hand the same
     * row back on the next page, and a CSV with duplicates reads as wrong numbers.
     */
    rowKey?: (row: TRow) => string | undefined;
    labels: {
        /** e.g. "Exporting 20,364 follow-ups…" — called with what the server reported. */
        progress: (done: number, total: number) => string;
        done: (count: number) => string;
        failed: string;
        /** Shown when the same export is already running. */
        alreadyRunning: string;
        /** Shown when MAX_PAGES cut the run short. */
        truncated: (count: number) => string;
        /** Shown when the run died part-way but had rows worth keeping. */
        partial: (count: number) => string;
    };
}

const running = new Set<string>();
const listeners = new Set<() => void>();

function setRunning(key: string, value: boolean) {
    if (value) running.add(key);
    else running.delete(key);
    listeners.forEach((l) => l());
}

/** Subscribe/read pair for useSyncExternalStore — see useIsExporting. */
export function subscribeToExports(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
/**
 * Live "is this export running?" for a button label. Reads module state rather
 * than component state so navigating away and back still shows the run.
 */
export function useIsExporting(key: string): boolean {
    return useSyncExternalStore(
        subscribeToExports,
        () => running.has(key),
        () => false
    );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const csvCell = (v: unknown) => {
    const str = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

function download(fileName: string, csv: string) {
    // Prepend a BOM: without it Excel on Windows reads the UTF-8 names as mojibake.
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Starts the run and returns immediately. Returns false if one with this key is
 * already in flight.
 */
export function startBackgroundExport<TRow>(spec: BackgroundExportSpec<TRow>): boolean {
    if (running.has(spec.key)) {
        toast.info(spec.labels.alreadyRunning);
        return false;
    }
    setRunning(spec.key, true);
    const toastId = `export:${spec.key}`;
    toast.loading(spec.labels.progress(0, 0), { id: toastId, duration: Infinity });

    void (async () => {
        const rows: string[] = [];
        const seen = new Set<string>();
        let total = 0;
        let truncated = false;
        try {
            for (let page = 0; page < MAX_PAGES; page += 1) {
                const startedAt = Date.now();
                let res: ExportPage<TRow> | undefined;
                try {
                    res = await spec.fetchPage(page, PAGE_SIZE);
                } catch {
                    // One retry, after a longer pause — if the server is failing,
                    // hammering it is the last thing it needs.
                    await sleep(RETRY_GAP_MS);
                    res = await spec.fetchPage(page, PAGE_SIZE);
                }
                const elapsed = Date.now() - startedAt;

                for (const row of res?.content ?? []) {
                    const id = spec.rowKey?.(row);
                    if (id) {
                        if (seen.has(id)) continue;
                        seen.add(id);
                    }
                    rows.push(spec.toRow(row).map(csvCell).join(','));
                }
                if (page === 0) total = res?.totalElements ?? rows.length;

                const lastPage = res?.last ?? page + 1 >= (res?.totalPages ?? 0);
                if (lastPage) break;
                if (page + 1 === MAX_PAGES) truncated = true;

                toast.loading(spec.labels.progress(rows.length, total), {
                    id: toastId,
                    duration: Infinity,
                });
                // Spend at most about half the time the server spent on us.
                await sleep(Math.min(MAX_GAP_MS, Math.max(BASE_GAP_MS, elapsed)));
            }

            download(spec.fileName, [spec.header.join(','), ...rows].join('\n'));
            toast.success(
                truncated ? spec.labels.truncated(rows.length) : spec.labels.done(rows.length),
                { id: toastId, duration: 6_000 }
            );
        } catch (err) {
            console.error(`Background export "${spec.key}" failed:`, err);
            // Twenty pages in, throwing away what we already have helps nobody —
            // hand over the partial file and say that is what it is.
            if (rows.length > 0) {
                download(spec.fileName, [spec.header.join(','), ...rows].join('\n'));
                toast.warning(spec.labels.partial(rows.length), { id: toastId, duration: 8_000 });
            } else {
                toast.error(spec.labels.failed, { id: toastId, duration: 6_000 });
            }
        } finally {
            setRunning(spec.key, false);
        }
    })();

    return true;
}
