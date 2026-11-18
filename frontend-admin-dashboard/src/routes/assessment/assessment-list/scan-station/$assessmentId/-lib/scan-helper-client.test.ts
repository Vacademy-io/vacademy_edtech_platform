import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    detectHelper,
    downloadPassFiles,
    helperFileName,
    scanHelper,
    ScanHelperError,
    SCAN_HELPER_ORIGIN,
    type HelperPage,
    type HelperScanner,
    type HelperStatus,
} from './scan-helper-client';
import { orderScanFiles } from './order-files';

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const scanner = (over: Partial<HelperScanner> = {}): HelperScanner => ({
    id: 'brother-1',
    name: 'Brother DCP-T830DW',
    transport: 'network',
    available: true,
    busy_reason: null,
    feeder: { present: true, duplex: false, paper_loaded: true },
    flatbed: { present: true },
    ...over,
});

const status = (scanners: HelperScanner[], printers: HelperStatus['printers'] = []) => ({
    helper: { version: '0.1.0', platform: 'mac' },
    state: 'idle' as const,
    scanners,
    printers,
});

describe('scanHelper calls', () => {
    it('asks 127.0.0.1:47811 for its status without cookies', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, status([scanner()])));
        const s = await scanHelper.status();
        expect(s.scanners[0]!.name).toBe('Brother DCP-T830DW');
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${SCAN_HELPER_ORIGIN}/v1/status`);
        expect(SCAN_HELPER_ORIGIN).toBe('http://127.0.0.1:47811');
        expect(init.credentials).toBe('omit');
    });

    it('gives up on the status after 1.5 s', async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError'))
                    );
                })
        );
        const pending = scanHelper.status().catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(1499);
        let settled = false;
        void pending.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        const error = await pending;
        expect(error).toBeInstanceOf(ScanHelperError);
        expect((error as ScanHelperError).code).toBe('UNREACHABLE');
    });

    it("reads the helper's error code", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(409, { error: { code: 'SCANNER_BUSY', message: 'busy' } })
        );
        const error = await scanHelper
            .startScan({
                scanner_id: 'brother-1',
                source: 'feeder',
                duplex: false,
                dpi: 300,
                color: true,
            })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ScanHelperError);
        expect((error as ScanHelperError).code).toBe('SCANNER_BUSY');
        expect((error as ScanHelperError).status).toBe(409);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${SCAN_HELPER_ORIGIN}/v1/scan`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toMatchObject({ source: 'feeder', duplex: false });
    });

    it('deletes a job with DELETE /v1/scan/{id}', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        await scanHelper.remove('job 1');
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${SCAN_HELPER_ORIGIN}/v1/scan/job%201`);
        expect(init.method).toBe('DELETE');
    });
});

describe('downloadPassFiles', () => {
    const page = (index: number): HelperPage => ({
        index,
        width: 2480,
        height: 3508,
        bytes: 10,
        image_url: `/v1/scan/j1/pages/${index}.jpg`,
        thumb_url: `/v1/scan/j1/pages/${index}/thumb.jpg`,
    });

    it('names pages pass1-001.jpg … in scan order, which the folder ordering reads back', async () => {
        fetchMock.mockImplementation(async (url: string) => {
            const index = /pages\/(\d+)\.jpg$/.exec(url)![1];
            return new Response(new Blob([`page-${index}`], { type: 'image/jpeg' }));
        });
        const pages = [page(2), page(0), page(11), page(1), ...[3, 4, 5, 6, 7, 8, 9, 10].map(page)];
        const files = await downloadPassFiles(pages, 'pass1');
        expect(files.map((f) => f.name)).toEqual(
            Array.from({ length: 12 }, (_, i) => helperFileName('pass1', i))
        );
        expect(files[0]!.name).toBe('pass1-001.jpg');
        expect(files[11]!.name).toBe('pass1-012.jpg');
        expect(await files[0]!.text()).toBe('page-0');
        expect(await files[11]!.text()).toBe('page-11');
        expect(files.every((f) => f.type === 'image/jpeg')).toBe(true);

        const ordered = orderScanFiles([...files].reverse());
        expect(ordered.errors).toEqual([]);
        expect(ordered.warnings).toEqual([]);
        expect(ordered.source).toBe('NUMERIC_SUFFIX');
        expect(ordered.ordered.map((f) => f.name)).toEqual(files.map((f) => f.name));
    });
});

describe('detectHelper', () => {
    it('is checking before the first answer, and no helper when nothing answered', () => {
        expect(detectHelper(undefined).kind).toBe('checking');
        expect(detectHelper(null).kind).toBe('noHelper');
    });

    it('says when no scanner is connected', () => {
        expect(detectHelper(status([])).kind).toBe('noScanner');
    });

    it('says when another app holds the scanner', () => {
        const d = detectHelper(status([scanner({ available: false, busy_reason: 'OTHER_APP' })]));
        expect(d.kind).toBe('otherApp');
    });

    it('is busy while someone else scans, ready while this page scans', () => {
        const s = status([scanner({ available: false, busy_reason: 'SCANNING' })]);
        expect(detectHelper(s).kind).toBe('busy');
        expect(detectHelper(s, true).kind).toBe('ready');
    });

    it('sends a glass-only scanner to the folders', () => {
        const d = detectHelper(
            status([scanner({ feeder: { present: false, duplex: false, paper_loaded: null } })])
        );
        expect(d.kind).toBe('glassOnly');
    });

    it('is ready with the feeder sides and the default printer', () => {
        const d = detectHelper(
            status(
                [scanner({ feeder: { present: true, duplex: true, paper_loaded: null } })],
                [
                    { id: 'p2', name: 'Other', duplex: false, color: false, default: false },
                    { id: 'p1', name: 'Brother', duplex: true, color: true, default: true },
                ]
            )
        );
        expect(d.kind).toBe('ready');
        if (d.kind !== 'ready') return;
        expect(d.duplex).toBe(true);
        expect(d.printer?.id).toBe('p1');
    });

    it('prefers a scanner with a feeder that is free', () => {
        const glass = scanner({
            id: 'glass',
            feeder: { present: false, duplex: false, paper_loaded: null },
        });
        const held = scanner({ id: 'held', available: false, busy_reason: 'OTHER_APP' });
        const free = scanner({ id: 'free' });
        const d = detectHelper(status([glass, held, free]));
        expect(d.kind).toBe('ready');
        if (d.kind === 'ready') expect(d.scanner.id).toBe('free');
    });
});
