import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicUrl } from '@/services/upload_file';
import type { CopyIntakeCheckedCopy } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';
import { scanHelper, type HelperPrinter, type HelperPrintSides } from '../-lib/scan-helper-client';
import { readPrinted, savePrinted } from '../-lib/hands-free';

export type PrintState = 'waiting' | 'sending' | 'queued' | 'printing' | 'done' | 'failed';

export interface PrintRow {
    state: PrintState;
    printId?: string;
}

const STATUS_POLL_MS = 3000;

/**
 * Print each checked copy once, as soon as it is ready, through the scan
 * helper: fetch the checked PDF from storage, hand it to the printer, then
 * follow the job until the printer is done. One copy goes to the printer at a
 * time, in the order the copies became ready. A copy sent once is remembered
 * for the batch in this browser, so a reload never prints it twice.
 */
export const usePrintChecked = ({
    batchId,
    copies,
    printer,
    enabled,
}: {
    batchId: string;
    copies: CopyIntakeCheckedCopy[];
    printer: HelperPrinter | null;
    enabled: boolean;
}) => {
    const [rows, setRows] = useState<Record<string, PrintRow>>({});
    const sent = useRef<Set<string>>(readPrinted(batchId));
    const queue = useRef<CopyIntakeCheckedCopy[]>([]);
    const running = useRef(false);
    const printerRef = useRef(printer);
    printerRef.current = printer;

    const setRow = (itemId: string, row: PrintRow) =>
        setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...row } }));

    const pump = useCallback(async () => {
        if (running.current) return;
        running.current = true;
        try {
            while (queue.current.length > 0) {
                const p = printerRef.current;
                if (!p) break;
                const copy = queue.current.shift()!;
                setRow(copy.item_id, { state: 'sending' });
                try {
                    const url = await getPublicUrl(copy.evaluated_file_id);
                    if (!url) throw new Error('no url');
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const pdf = await res.blob();
                    const sides: HelperPrintSides = p.duplex ? 'two-sided-long-edge' : 'one-sided';
                    const printId = await scanHelper.print(pdf, p.id, sides);
                    sent.current.add(copy.item_id);
                    savePrinted(batchId, sent.current);
                    setRow(copy.item_id, { state: 'queued', printId });
                } catch (e) {
                    console.warn('[scan-station] print failed', copy.item_id, e);
                    setRow(copy.item_id, { state: 'failed' });
                }
            }
        } finally {
            running.current = false;
        }
    }, [batchId]);

    // New checked copies join the queue (never one already sent or in hand).
    useEffect(() => {
        if (!enabled) return;
        let added = false;
        for (const copy of copies) {
            if (sent.current.has(copy.item_id)) continue;
            if (queue.current.some((c) => c.item_id === copy.item_id)) continue;
            const state = rows[copy.item_id]?.state;
            if (state && state !== 'waiting') continue;
            queue.current.push(copy);
            setRow(copy.item_id, { state: 'waiting' });
            added = true;
        }
        if (added || queue.current.length > 0) void pump();
        // rows is read only to skip copies already in hand.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [copies, enabled, printer, pump]);

    // Follow the jobs the printer has until each is done or failed.
    const following = Object.entries(rows)
        .filter(([, r]) => (r.state === 'queued' || r.state === 'printing') && r.printId)
        .map(([itemId, r]) => `${itemId}:${r.printId}`)
        .join(',');
    useEffect(() => {
        if (!following) return undefined;
        const timer = setInterval(() => {
            following.split(',').forEach((pair) => {
                const [itemId, printId] = pair.split(':') as [string, string];
                scanHelper
                    .printStatus(printId)
                    .then((job) => setRow(itemId, { state: job.state }))
                    .catch(() => undefined);
            });
        }, STATUS_POLL_MS);
        return () => clearInterval(timer);
    }, [following]);

    /** Print one copy again (after a failure, or a jammed page). */
    const reprint = (copy: CopyIntakeCheckedCopy) => {
        sent.current.delete(copy.item_id);
        savePrinted(batchId, sent.current);
        queue.current = queue.current.filter((c) => c.item_id !== copy.item_id);
        queue.current.push(copy);
        setRow(copy.item_id, { state: 'waiting', printId: undefined });
        void pump();
    };

    /** A copy sent in an earlier visit of this page shows as sent. */
    const stateOf = (itemId: string): PrintState | null =>
        rows[itemId]?.state ?? (sent.current.has(itemId) ? 'done' : null);

    return { stateOf, reprint };
};
