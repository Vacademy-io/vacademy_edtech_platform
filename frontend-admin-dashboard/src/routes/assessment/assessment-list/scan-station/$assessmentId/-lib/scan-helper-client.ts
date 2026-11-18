/**
 * Client for "Vacademy Scan Helper", the small app on the clerk's Mac that
 * drives the scanner (contract v1). It listens on 127.0.0.1 only and never sees
 * Vacademy credentials: the page downloads the scanned JPEGs from it and uploads
 * them itself through the normal scan-station upload.
 */

export const SCAN_HELPER_ORIGIN = 'http://127.0.0.1:47811';

/** Where the clerk gets the helper. Placeholder until the signed build is hosted. */
export const SCAN_HELPER_DOWNLOAD_URL =
    'https://vacademy.io/downloads/vacademy-scan-helper-mac.zip';

/** The status call must answer fast; a slower answer counts as "no helper". */
export const HELPER_STATUS_TIMEOUT_MS = 1500;
const HELPER_CALL_TIMEOUT_MS = 10_000;
const HELPER_PAGE_TIMEOUT_MS = 60_000;

export interface HelperFeeder {
    present: boolean;
    duplex: boolean;
    /** Null when the scanner does not say. */
    paper_loaded: boolean | null;
}

export type HelperBusyReason = 'OTHER_APP' | 'SCANNING';

export interface HelperScanner {
    id: string;
    name: string;
    transport: 'usb' | 'network';
    available: boolean;
    busy_reason: HelperBusyReason | null;
    feeder: HelperFeeder;
    flatbed: { present: boolean };
}

export interface HelperPrinter {
    id: string;
    name: string;
    duplex: boolean;
    color: boolean;
    default: boolean;
}

export interface HelperStatus {
    helper: { version: string; platform: string };
    state: 'idle' | 'scanning' | 'printing';
    scanners: HelperScanner[];
    printers: HelperPrinter[];
}

export interface HelperScanRequest {
    scanner_id: string;
    source: 'feeder' | 'flatbed';
    duplex: boolean;
    dpi: number;
    color: boolean;
}

export type HelperJobState = 'starting' | 'scanning' | 'done' | 'failed' | 'cancelled';

export interface HelperPage {
    index: number;
    width: number;
    height: number;
    bytes: number;
    image_url: string;
    thumb_url: string;
}

export interface HelperJob {
    job_id: string;
    state: HelperJobState;
    source: 'feeder' | 'flatbed';
    duplex: boolean;
    pages: HelperPage[];
    error: { code: string; message: string } | null;
}

/**
 * A refused or failed helper call. `code` is the helper's own code
 * (SCANNER_BUSY, NO_PAPER, …), or UNREACHABLE when nothing answered in time.
 */
export class ScanHelperError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 0) {
        super(message);
        this.name = 'ScanHelperError';
        this.code = code;
        this.status = status;
    }
}

/** A helper path ("/v1/scan/…/thumb.jpg") as a full URL. */
export const helperUrl = (path: string) =>
    /^https?:\/\//.test(path) ? path : `${SCAN_HELPER_ORIGIN}${path}`;

const call = async (
    path: string,
    init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> => {
    const { timeoutMs = HELPER_CALL_TIMEOUT_MS, signal, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);
    let res: Response;
    try {
        res = await fetch(helperUrl(path), {
            ...rest,
            signal: controller.signal,
            // The helper keeps nothing per user; never send cookies to it.
            credentials: 'omit',
            cache: 'no-store',
        });
    } catch (e) {
        throw new ScanHelperError(
            'UNREACHABLE',
            e instanceof Error ? e.message : 'The scan helper did not answer'
        );
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
    }
    if (!res.ok) {
        let code = 'UNKNOWN';
        let message = `Scan helper answered ${res.status}`;
        try {
            const body = (await res.json()) as { error?: { code?: string; message?: string } };
            code = body.error?.code ?? code;
            message = body.error?.message ?? message;
        } catch {
            // Not JSON: keep the status line.
        }
        throw new ScanHelperError(code, message, res.status);
    }
    return res;
};

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

const postJson = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

export const scanHelper = {
    /** GET /v1/status, giving up after 1.5 s. */
    status: async (signal?: AbortSignal): Promise<HelperStatus> =>
        json<HelperStatus>(
            await call('/v1/status', { timeoutMs: HELPER_STATUS_TIMEOUT_MS, signal })
        ),

    /** POST /v1/scan → the new job's id. */
    startScan: async (body: HelperScanRequest): Promise<string> =>
        (await json<{ job_id: string }>(await call('/v1/scan', postJson(body)))).job_id,

    job: async (jobId: string): Promise<HelperJob> =>
        json<HelperJob>(await call(`/v1/scan/${encodeURIComponent(jobId)}`)),

    cancel: async (jobId: string): Promise<void> => {
        await call(`/v1/scan/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
    },

    /** DELETE /v1/scan/{id}: frees the job's files on the Mac. */
    remove: async (jobId: string): Promise<void> => {
        await call(`/v1/scan/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    },

    /** The full-size JPEG of one page. */
    pageBlob: async (page: HelperPage): Promise<Blob> =>
        (await call(page.image_url, { timeoutMs: HELPER_PAGE_TIMEOUT_MS })).blob(),

    /**
     * The small preview. Fetched (not an <img src>) so the request carries the
     * page's Origin, which the helper requires.
     */
    thumbBlob: async (page: HelperPage): Promise<Blob> => (await call(page.thumb_url)).blob(),
};

/** "pass1-001.jpg": the order-files rules read the trailing number as scan order. */
export const helperFileName = (prefix: string, position: number) =>
    `${prefix}-${String(position + 1).padStart(3, '0')}.jpg`;

/**
 * Download a finished pass's pages, in scan order, as Files named
 * `<prefix>-001.jpg`, `<prefix>-002.jpg`… with modified times one second apart
 * in the same order, so the folder ordering rules (and their cross-check) read
 * them exactly as scanned.
 */
export const downloadPassFiles = async (
    pages: HelperPage[],
    prefix: string,
    onPage?: () => void,
    fetchPage: (page: HelperPage) => Promise<Blob> = scanHelper.pageBlob
): Promise<File[]> => {
    const ordered = [...pages].sort((a, b) => a.index - b.index);
    const start = Date.now();
    const files = new Array<File>(ordered.length);
    let next = 0;
    const worker = async () => {
        while (next < ordered.length) {
            const i = next;
            next += 1;
            const blob = await fetchPage(ordered[i]!);
            files[i] = new File([blob], helperFileName(prefix, i), {
                type: 'image/jpeg',
                lastModified: start + i * 1000,
            });
            onPage?.();
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, ordered.length) }, worker));
    return files;
};

// ---- what the status means for the clerk ---------------------------------

export type HelperDetection =
    | { kind: 'checking' }
    | { kind: 'noHelper' }
    | { kind: 'noScanner' }
    | { kind: 'otherApp'; scanner: HelperScanner }
    | { kind: 'busy'; scanner: HelperScanner }
    | { kind: 'glassOnly'; scanner: HelperScanner }
    | {
          kind: 'ready';
          scanner: HelperScanner;
          /** Feeder scans both sides in one go. */
          duplex: boolean;
          printer: HelperPrinter | null;
      };

/** The scanner to use: one with a feeder first, and a free one before a busy one. */
export const pickScanner = (scanners: HelperScanner[]): HelperScanner | null => {
    const rank = (s: HelperScanner) => (s.feeder.present ? 0 : 2) + (s.available ? 0 : 1);
    return [...scanners].sort((a, b) => rank(a) - rank(b))[0] ?? null;
};

/**
 * `undefined` = the first answer has not come yet; `null` = nothing answered.
 * `ownJob` = this page is running a scan, so "busy scanning" is us.
 */
export const detectHelper = (
    status: HelperStatus | null | undefined,
    ownJob = false
): HelperDetection => {
    if (status === undefined) return { kind: 'checking' };
    if (status === null) return { kind: 'noHelper' };
    const scanner = pickScanner(status.scanners ?? []);
    if (!scanner) return { kind: 'noScanner' };
    if (scanner.busy_reason === 'SCANNING') {
        if (!ownJob) return { kind: 'busy', scanner };
    } else if (scanner.busy_reason === 'OTHER_APP' || !scanner.available) {
        return { kind: 'otherApp', scanner };
    }
    if (!scanner.feeder.present) return { kind: 'glassOnly', scanner };
    const printers = status.printers ?? [];
    const printer = printers.find((p) => p.default) ?? printers[0] ?? null;
    return { kind: 'ready', scanner, duplex: scanner.feeder.duplex, printer };
};
