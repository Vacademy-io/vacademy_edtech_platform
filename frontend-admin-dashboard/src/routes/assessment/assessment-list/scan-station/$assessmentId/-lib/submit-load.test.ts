import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
    version: '3.11.174',
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(),
}));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: vi.fn() }));
vi.mock('@/constants/urls', () => ({
    SCAN_STATION_BASE_URL: '/scan',
    GET_SIGNED_URL: '/signed',
    ACKNOWLEDGE: '/ack',
}));
const uploadScanFiles = vi.fn();
vi.mock('./upload-scan-file', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./upload-scan-file')>()),
    uploadScanFiles: (...a: unknown[]) => uploadScanFiles(...a),
}));
const addScanLoad = vi.fn();
const replaceScanLoad = vi.fn();
vi.mock('../-services/scan-station-services', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-services/scan-station-services')>()),
    addScanLoad: (...a: unknown[]) => addScanLoad(...a),
    replaceScanLoad: (...a: unknown[]) => replaceScanLoad(...a),
}));

import { prepareLoad, sendLoad } from './submit-load';
import type { ScanLoadBody } from '../-services/scan-station-services';

const T0 = 1_731_900_000_000;
const LABELS = { first: 'First', second: 'Second', one: 'Folder' };
const jpeg = (name: string, t: number) =>
    new File([`body of ${name} ${t}`], name, { type: 'image/jpeg', lastModified: t });
/** Image Capture names, listed backwards. */
const imageCapturePass = (n: number, start: number) =>
    Array.from({ length: n }, (_, i) =>
        jpeg(i === 0 ? 'Scan.jpeg' : `Scan ${i}.jpeg`, start + i * 2000)
    ).reverse();

beforeEach(() => {
    uploadScanFiles.mockReset();
    addScanLoad.mockReset();
    replaceScanLoad.mockReset();
    uploadScanFiles.mockImplementation(async (files: File[]) => files.map((_, i) => `id${i}`));
    addScanLoad.mockResolvedValue({ loads: [{ load_no: 1 }] });
    replaceScanLoad.mockResolvedValue({ loads: [{ load_no: 1 }] });
});

describe('the shared load path (folder intake and guided scan)', () => {
    it('orders, checks and sends two passes as one load', async () => {
        const prepared = await prepareLoad(
            'TWO_PASSES',
            imageCapturePass(3, T0),
            imageCapturePass(3, T0 + 60_000),
            [],
            100,
            LABELS
        );
        expect(prepared?.errors).toEqual([]);
        expect(prepared?.orderSource).toBe('IMAGE_CAPTURE_SUFFIX');
        const progress = vi.fn();
        await sendLoad({
            prepared: prepared!,
            mode: 'TWO_PASSES',
            sessionId: 's1',
            instituteId: 'inst1',
            userId: 'u1',
            onProgress: progress,
        });
        expect(progress).toHaveBeenCalledWith(0, 6);
        const body = addScanLoad.mock.calls[0]![2] as ScanLoadBody;
        expect(body.passes[0]!.files.map((f) => [f.file_name, f.file_id])).toEqual([
            ['Scan.jpeg', 'id0'],
            ['Scan 1.jpeg', 'id1'],
            ['Scan 2.jpeg', 'id2'],
        ]);
        expect(body.passes[1]!.files.map((f) => f.file_id)).toEqual(['id3', 'id4', 'id5']);
        expect(body.intake_mode).toBe('TWO_PASSES');
        expect(replaceScanLoad).not.toHaveBeenCalled();
    });

    it('replaces a load when asked to', async () => {
        const prepared = await prepareLoad(
            'TWO_PASSES',
            imageCapturePass(2, T0),
            imageCapturePass(2, T0 + 60_000),
            [],
            100,
            LABELS
        );
        await sendLoad({
            prepared: prepared!,
            mode: 'TWO_PASSES',
            sessionId: 's1',
            instituteId: 'inst1',
            userId: 'u1',
            replaceLoadNo: 2,
        });
        expect(replaceScanLoad).toHaveBeenCalledWith('s1', 2, 'inst1', expect.any(Object));
        expect(addScanLoad).not.toHaveBeenCalled();
    });

    it('blocks unequal passes and refuses to send them', async () => {
        const prepared = await prepareLoad(
            'TWO_PASSES',
            imageCapturePass(3, T0),
            imageCapturePass(2, T0 + 60_000),
            [],
            100,
            LABELS
        );
        expect(prepared?.errors.map((e) => e.key)).toEqual(['intake.errors.COUNT_MISMATCH']);
        await expect(
            sendLoad({
                prepared: prepared!,
                mode: 'TWO_PASSES',
                sessionId: 's1',
                instituteId: 'inst1',
                userId: 'u1',
            })
        ).rejects.toThrow('not ready');
        expect(uploadScanFiles).not.toHaveBeenCalled();
    });

    it('splits one folder at the turn-over pause', async () => {
        const one = [
            ...imageCapturePass(2, T0).reverse(),
            jpeg('Scan 2.jpeg', T0 + 60_000),
            jpeg('Scan 3.jpeg', T0 + 62_000),
        ];
        const prepared = await prepareLoad('ONE_FOLDER', [], [], one, 100, LABELS);
        expect(prepared?.errors).toEqual([]);
        expect(prepared?.split).toEqual({ first: 2, second: 2, name: 'Scan 1.jpeg' });
    });
});
