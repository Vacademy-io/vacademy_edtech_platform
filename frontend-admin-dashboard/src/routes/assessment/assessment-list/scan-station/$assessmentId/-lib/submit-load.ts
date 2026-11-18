import {
    addScanLoad,
    replaceScanLoad,
    type ScanClientWarning,
    type ScanFileKind,
    type ScanIntakeMode,
    type ScanOrderSource,
    type ScanSession,
} from '../-services/scan-station-services';
import { orderScanFiles, type OrderedFiles } from './order-files';
import { deinterleaveDuplex, splitOneFolder, type SplitRefusal } from './split-passes';
import { precheckLoad, type PrecheckResult } from './pass-precheck';
import { uploadScanFiles } from './upload-scan-file';
import { buildLoadBody, type UploadedPassFile } from './load-body';
import { rememberLocalFile } from './local-files';

/**
 * The one load path, shared by the folder intake and the guided scanner flow:
 * order each pass, check it before a byte is uploaded, then upload strictly and
 * hand the load to the server.
 */

export type IntakeMessage = { key: string; params?: Record<string, string | number> };

export interface PreparedLoad {
    passes: [File[], File[]] | null;
    precheck: PrecheckResult | null;
    orderSource: ScanOrderSource;
    warnings: ScanClientWarning[];
    errors: IntakeMessage[];
    notes: IntakeMessage[];
    /** One-folder mode: the split the clerk must confirm. */
    split: { first: number; second: number; name: string } | null;
}

export interface PassLabels {
    first: string;
    second: string;
    one: string;
}

const listNames = (names: string[]) =>
    names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');

const orderMessages = (o: OrderedFiles<File>, pass: string): IntakeMessage[] => {
    const out: IntakeMessage[] = [];
    if (o.errors.includes('INDEX_GAP')) {
        out.push({
            key: 'intake.errors.INDEX_GAP',
            params: { pass, name: o.gapAfter ?? '', index: o.missingIndex ?? '' },
        });
    }
    if (o.errors.includes('DUPLICATE_INDEX')) {
        out.push({
            key: 'intake.errors.DUPLICATE_INDEX',
            params: { pass, names: listNames(o.duplicateNames ?? []) },
        });
    }
    if (o.errors.includes('MIXED_STEMS'))
        out.push({ key: 'intake.errors.MIXED_STEMS', params: { pass } });
    return out;
};

const precheckMessages = (r: PrecheckResult, maxPages: number): IntakeMessage[] =>
    r.errors.map((code): IntakeMessage => {
        switch (code) {
            case 'COUNT_MISMATCH':
                return {
                    key: 'intake.errors.COUNT_MISMATCH',
                    params: { a: r.pageCounts[0], b: r.pageCounts[1] },
                };
            case 'UNSUPPORTED_FILE':
                return {
                    key: 'intake.errors.UNSUPPORTED_FILE',
                    params: { names: listNames(r.unsupported) },
                };
            case 'PDF_UNREADABLE':
                return {
                    key: 'intake.errors.PDF_UNREADABLE',
                    params: { names: listNames(r.unreadable) },
                };
            case 'DUPLICATE_FILE':
                return {
                    key: 'intake.errors.DUPLICATE_FILE',
                    params: { names: listNames(r.duplicates) },
                };
            case 'TOO_MANY_PAGES':
                return { key: 'intake.errors.TOO_MANY_PAGES', params: { max: maxPages } };
            default:
                return { key: `intake.errors.${code}` };
        }
    });

const splitMessage = (reason: SplitRefusal, count: number): IntakeMessage => ({
    key: `intake.errors.${reason}`,
    params: { count },
});

/**
 * Order and check one load. TWO_PASSES reads `first` and `second`; ONE_FOLDER
 * and DUPLEX read `one`. Null when nothing has been added yet.
 */
export const prepareLoad = async (
    mode: ScanIntakeMode,
    first: File[],
    second: File[],
    one: File[],
    maxPages: number,
    passLabels: PassLabels
): Promise<PreparedLoad | null> => {
    const errors: IntakeMessage[] = [];
    const notes: IntakeMessage[] = [];
    let passes: [File[], File[]] | null = null;
    let orderSource: ScanOrderSource = 'NAME';
    const warnings: ScanClientWarning[] = [];
    let split: PreparedLoad['split'] = null;

    const ordered = (files: File[], label: string) => {
        const o = orderScanFiles(files);
        errors.push(...orderMessages(o, label));
        if (o.warnings.includes('MTIME_DISAGREES')) {
            warnings.push('MTIME_DISAGREES');
            notes.push({ key: 'intake.warnings.MTIME_DISAGREES', params: { pass: label } });
        }
        return o;
    };

    if (mode === 'TWO_PASSES') {
        if (first.length === 0 && second.length === 0) return null;
        const a = ordered(first, passLabels.first);
        const b = ordered(second, passLabels.second);
        orderSource = a.ordered.length > 0 ? a.source : b.source;
        passes = [a.ordered, b.ordered];
    } else {
        if (one.length === 0) return null;
        const o = ordered(one, passLabels.one);
        orderSource = o.source;
        if (mode === 'ONE_FOLDER') {
            const s = splitOneFolder(o.ordered);
            if (s.ok) {
                passes = [s.first, s.second];
                split = { first: s.first.length, second: s.second.length, name: s.splitAfterName };
            } else {
                errors.push(splitMessage(s.reason, one.length));
            }
        } else {
            const d = deinterleaveDuplex(o.ordered);
            passes = [d.first, d.second];
            notes.push({ key: 'intake.duplexUntested' });
        }
    }

    const precheck = passes ? await precheckLoad(passes[0], passes[1], maxPages) : null;
    if (precheck) errors.push(...precheckMessages(precheck, maxPages));
    return { passes, precheck, orderSource, warnings, errors, notes, split };
};

/**
 * Upload a prepared load strictly (a page that did not land throws
 * ScanUploadError and nothing is sent), then add it to the session, or replace
 * load `replaceLoadNo`.
 */
export const sendLoad = async ({
    prepared,
    mode,
    sessionId,
    instituteId,
    userId,
    replaceLoadNo = null,
    onProgress,
}: {
    prepared: PreparedLoad;
    mode: ScanIntakeMode;
    sessionId: string;
    instituteId: string;
    userId: string;
    replaceLoadNo?: number | null;
    onProgress?: (done: number, total: number) => void;
}): Promise<ScanSession> => {
    if (!prepared.passes || !prepared.precheck || prepared.errors.length > 0) {
        throw new Error('not ready');
    }
    const [p1, p2] = prepared.passes;
    const { precheck } = prepared;
    const all = [...p1, ...p2];
    onProgress?.(0, all.length);
    const ids = await uploadScanFiles(all, { userId, instituteId }, onProgress);
    const describe = (files: File[], pass: 0 | 1, offset: number): UploadedPassFile[] =>
        files.map((file, i) => ({
            file,
            fileId: ids[offset + i]!,
            kind: (precheck.fileKinds[pass][i] === 'PDF' ? 'PDF' : 'IMAGE') as ScanFileKind,
            pageCount: precheck.filePages[pass][i] ?? 1,
        }));
    const body = buildLoadBody(
        [describe(p1, 0, 0), describe(p2, 1, p1.length)],
        mode,
        prepared.orderSource,
        prepared.warnings
    );
    const session =
        replaceLoadNo !== null
            ? await replaceScanLoad(sessionId, replaceLoadNo, instituteId, body)
            : await addScanLoad(sessionId, instituteId, body);
    all.forEach((file, i) => rememberLocalFile(ids[i]!, file));
    return session;
};

/** The load number the server gave the newest load. */
export const newestLoadNo = (session: ScanSession) =>
    Math.max(0, ...session.loads.map((l) => l.load_no));
