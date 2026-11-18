import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: vi.fn() }));
vi.mock('@/constants/urls', () => ({
    SCAN_STATION_BASE_URL: '/scan',
    GET_SIGNED_URL: '/signed',
    ACKNOWLEDGE: '/ack',
}));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => 'token',
    getTokenDecodedData: () => ({ user: 'u1' }),
}));
vi.mock('pdfjs-dist', () => ({
    version: '3.11.174',
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key} ${JSON.stringify(params)}` : key,
    }),
}));
vi.mock('../-hooks/useScanActions', () => ({ useOnScanNotFound: () => () => false }));

// The helper: every call the page makes to it.
const helper = vi.hoisted(() => ({
    status: vi.fn(),
    startScan: vi.fn(),
    job: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    pageBlob: vi.fn(),
    thumbBlob: vi.fn(),
}));
vi.mock('../-lib/scan-helper-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-lib/scan-helper-client')>()),
    scanHelper: helper,
}));

// The existing load path, below the shared prepare/send code: upload and POST load.
const uploadScanFiles = vi.fn();
vi.mock('../-lib/upload-scan-file', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-lib/upload-scan-file')>()),
    uploadScanFiles: (...a: unknown[]) => uploadScanFiles(...a),
}));
const addScanLoad = vi.fn();
vi.mock('../-services/scan-station-services', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-services/scan-station-services')>()),
    addScanLoad: (...a: unknown[]) => addScanLoad(...a),
}));

import { GuidedScan } from './GuidedScan';
import { SCAN_HELPER_DOWNLOAD_URL, type HelperScanner } from '../-lib/scan-helper-client';
import type { ScanLoadBody } from '../-services/scan-station-services';

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
const status = (scanners: HelperScanner[]) => ({
    helper: { version: '0.1.0', platform: 'mac' },
    state: 'idle',
    scanners,
    printers: [{ id: 'p1', name: 'Brother', duplex: true, color: true, default: true }],
});

const page = (job: string, index: number) => ({
    index,
    width: 2480,
    height: 3508,
    bytes: 100,
    image_url: `/v1/scan/${job}/pages/${index}.jpg`,
    thumb_url: `/v1/scan/${job}/pages/${index}/thumb.jpg`,
});
/** Pages listed out of index order on purpose: the page must sort by index. */
const pages = (job: string, n: number) =>
    Array.from({ length: n }, (_, i) => page(job, i)).reverse();
const doneJob = (job: string, n: number, duplex = false) => ({
    job_id: job,
    state: 'done',
    source: 'feeder',
    duplex,
    pages: pages(job, n),
    error: null,
});

/** Jobs started, in order; each job answers from `script` (last answer repeats). */
let jobIds: string[];
let scripts: Record<string, object[]>;
const scriptJob = (job: string, ...answers: object[]) => {
    scripts[job] = answers;
};

const session = { id: 's1', loads: [{ load_no: 1 }] };
const onLoadSent = vi.fn();
const onUseFolders = vi.fn();

beforeEach(() => {
    Object.values(helper).forEach((m) => m.mockReset());
    uploadScanFiles.mockReset();
    addScanLoad.mockReset();
    onLoadSent.mockReset();
    onUseFolders.mockReset();
    jobIds = ['jobA', 'jobB', 'jobC'];
    scripts = {};
    helper.status.mockResolvedValue(status([scanner()]));
    helper.startScan.mockImplementation(async () => jobIds.shift());
    helper.job.mockImplementation(async (id: string) => {
        const list = scripts[id] ?? [];
        return list.length > 1 ? list.shift() : list[0];
    });
    helper.cancel.mockResolvedValue(undefined);
    helper.remove.mockResolvedValue(undefined);
    helper.pageBlob.mockImplementation(
        async (p: { image_url: string }) =>
            new Blob([`bytes of ${p.image_url}`], { type: 'image/jpeg' })
    );
    helper.thumbBlob.mockImplementation(
        async (p: { thumb_url: string }) => new Blob([p.thumb_url], { type: 'image/jpeg' })
    );
    uploadScanFiles.mockImplementation(async (files: File[]) => files.map((_, i) => `f${i}`));
    addScanLoad.mockResolvedValue(session);
});

const renderGuided = () =>
    render(
        <GuidedScan
            sessionId="s1"
            instituteId="inst1"
            nextLoadNo={1}
            onLoadSent={onLoadSent}
            onUseFolders={onUseFolders}
            statusPollMs={20}
            jobPollMs={5}
        />
    );

const startButton = () => screen.findByRole('button', { name: 'guided.start' });

describe('guided scan — finding the helper', () => {
    it('shows the install card and the folders way out when no helper answers', async () => {
        helper.status.mockRejectedValue(new Error('refused'));
        renderGuided();
        await screen.findByText('guided.detect.install.title');
        const link = screen.getByRole('link', { name: /guided.detect.install.download/ });
        expect(link.getAttribute('href')).toBe(SCAN_HELPER_DOWNLOAD_URL);
        expect(screen.queryByRole('button', { name: 'guided.start' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /guided.useFolders/ }));
        expect(onUseFolders).toHaveBeenCalledTimes(1);
    });

    it('asks to turn the scanner on when the helper sees none', async () => {
        helper.status.mockResolvedValue(status([]));
        renderGuided();
        await screen.findByText('guided.detect.noScanner');
        expect(screen.queryByRole('button', { name: 'guided.start' })).toBeNull();
    });

    it('asks to close Image Capture when another app holds the scanner', async () => {
        helper.status.mockResolvedValue(
            status([scanner({ available: false, busy_reason: 'OTHER_APP' })])
        );
        renderGuided();
        await screen.findByText('guided.detect.otherApp');
    });

    it('sends a glass-only scanner to the folders', async () => {
        helper.status.mockResolvedValue(
            status([scanner({ feeder: { present: false, duplex: false, paper_loaded: null } })])
        );
        renderGuided();
        await screen.findByText('guided.detect.glassOnly');
    });

    it('shows the device when ready, and turns ready once the helper starts', async () => {
        helper.status.mockRejectedValueOnce(new Error('refused'));
        renderGuided();
        await screen.findByText('guided.detect.install.title');
        await screen.findByText(
            'Brother DCP-T830DW · guided.device.feeder · guided.device.oneSide · guided.device.printsTwoSided'
        );
        expect(screen.queryByText('guided.detect.install.title')).toBeNull();
        await startButton();
    });
});

describe('guided scan — one-sided feeder', () => {
    it('never scans before Start is clicked', async () => {
        renderGuided();
        await startButton();
        await act(async () => {
            await new Promise((r) => setTimeout(r, 120));
        });
        expect(helper.status.mock.calls.length).toBeGreaterThan(1);
        expect(helper.startScan).not.toHaveBeenCalled();
        fireEvent.click(await startButton());
        await waitFor(() => expect(helper.startScan).toHaveBeenCalledTimes(1));
        expect(helper.startScan).toHaveBeenCalledWith({
            scanner_id: 'brother-1',
            source: 'feeder',
            duplex: false,
            dpi: 300,
            color: true,
        });
    });

    it('scans side A with live pages, asks to turn the pile, and catches a count mismatch', async () => {
        scriptJob(
            'jobA',
            { ...doneJob('jobA', 1), state: 'scanning' },
            { ...doneJob('jobA', 2), state: 'scanning' },
            doneJob('jobA', 3)
        );
        scriptJob('jobB', doneJob('jobB', 2));
        scriptJob('jobC', doneJob('jobC', 3));
        const { container } = renderGuided();
        await screen.findByText(/guided.stepA/);
        fireEvent.click(await startButton());

        // Side A done: three thumbnails, and the turn-over step.
        await screen.findByText(/guided.stepB1/);
        expect(screen.getByText('guided.sideDone {"count":3}')).toBeTruthy();
        // Previews are fetched through the client (the helper needs an Origin), in scan order.
        await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
        const asked = helper.thumbBlob.mock.calls.map((c) => (c[0] as { index: number }).index);
        expect(asked.slice(-3)).toEqual([0, 1, 2]);
        expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('alt'))).toEqual(
            [1, 2, 3].map((n) => `guided.pageAlt {"n":${n}}`)
        );
        expect(helper.startScan).toHaveBeenCalledTimes(1);

        // Side B: only after the second click.
        fireEvent.click(await startButton());
        await screen.findByText('guided.mismatch {"a":3,"b":2}');
        expect(uploadScanFiles).not.toHaveBeenCalled();

        // "Scan this side again" drops side B only.
        fireEvent.click(screen.getByRole('button', { name: 'guided.rescanSide' }));
        await waitFor(() => expect(helper.remove).toHaveBeenCalledWith('jobB'));
        expect(helper.remove).not.toHaveBeenCalledWith('jobA');
        await screen.findByText(/guided.stepB1/);
        expect(helper.startScan).toHaveBeenCalledTimes(2);

        fireEvent.click(await startButton());
        await waitFor(() => expect(addScanLoad).toHaveBeenCalledTimes(1));
        const body = addScanLoad.mock.calls[0]![2] as ScanLoadBody;
        expect(body.passes[1]!.files.map((f) => f.file_name)).toEqual([
            'pass2-001.jpg',
            'pass2-002.jpg',
            'pass2-003.jpg',
        ]);
    });

    it('"Start this load again" drops both sides', async () => {
        scriptJob('jobA', doneJob('jobA', 3));
        scriptJob('jobB', doneJob('jobB', 4));
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText(/guided.stepB1/);
        fireEvent.click(await startButton());
        await screen.findByText('guided.mismatch {"a":3,"b":4}');
        fireEvent.click(screen.getByRole('button', { name: 'guided.restartLoad' }));
        await screen.findByText(/guided.stepA/);
        await waitFor(() => {
            expect(helper.remove).toHaveBeenCalledWith('jobA');
            expect(helper.remove).toHaveBeenCalledWith('jobB');
        });
    });

    it('hands equal sides to the existing load path in scan order, then frees the helper jobs', async () => {
        scriptJob('jobA', doneJob('jobA', 3));
        scriptJob('jobB', doneJob('jobB', 3));
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText(/guided.stepB1/);
        fireEvent.click(await startButton());

        await screen.findByText('guided.sent {"load":1}');
        // Strict upload got the files in pass order, named so the ordering rules read them back.
        expect(uploadScanFiles).toHaveBeenCalledTimes(1);
        const [files, opts] = uploadScanFiles.mock.calls[0] as [File[], { userId: string }];
        expect(files.map((f) => f.name)).toEqual([
            'pass1-001.jpg',
            'pass1-002.jpg',
            'pass1-003.jpg',
            'pass2-001.jpg',
            'pass2-002.jpg',
            'pass2-003.jpg',
        ]);
        expect(await Promise.all(files.map((f) => f.text()))).toEqual([
            'bytes of /v1/scan/jobA/pages/0.jpg',
            'bytes of /v1/scan/jobA/pages/1.jpg',
            'bytes of /v1/scan/jobA/pages/2.jpg',
            'bytes of /v1/scan/jobB/pages/0.jpg',
            'bytes of /v1/scan/jobB/pages/1.jpg',
            'bytes of /v1/scan/jobB/pages/2.jpg',
        ]);
        expect(opts.userId).toBe('u1');

        // The same POST load the folder flow makes.
        expect(addScanLoad).toHaveBeenCalledTimes(1);
        const [sessionId, instituteId, body] = addScanLoad.mock.calls[0] as [
            string,
            string,
            ScanLoadBody,
        ];
        expect(sessionId).toBe('s1');
        expect(instituteId).toBe('inst1');
        expect(body.intake_mode).toBe('TWO_PASSES');
        expect(body.order_source).toBe('NUMERIC_SUFFIX');
        expect(body.client_warnings).toEqual([]);
        expect(
            body.passes.map((p) => p.files.map((f) => [f.file_name, f.file_id, f.order_index]))
        ).toEqual([
            [
                ['pass1-001.jpg', 'f0', 0],
                ['pass1-002.jpg', 'f1', 1],
                ['pass1-003.jpg', 'f2', 2],
            ],
            [
                ['pass2-001.jpg', 'f3', 0],
                ['pass2-002.jpg', 'f4', 1],
                ['pass2-003.jpg', 'f5', 2],
            ],
        ]);
        expect(onLoadSent).toHaveBeenCalledWith(session);

        // DELETE both helper jobs once the load is sent.
        await waitFor(() => {
            expect(helper.remove).toHaveBeenCalledWith('jobA');
            expect(helper.remove).toHaveBeenCalledWith('jobB');
        });
        // Next pile or Finish; nothing scans by itself.
        expect(helper.startScan).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'guided.finish' }));
        await screen.findByText('guided.finished');
    });

    it('keeps the helper jobs and offers a retry when the upload fails', async () => {
        scriptJob('jobA', doneJob('jobA', 2));
        scriptJob('jobB', doneJob('jobB', 2));
        uploadScanFiles.mockRejectedValueOnce(new Error('network'));
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText(/guided.stepB1/);
        fireEvent.click(await startButton());
        await screen.findByRole('button', { name: 'guided.retry' });
        expect(addScanLoad).not.toHaveBeenCalled();
        expect(helper.remove).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'guided.retry' }));
        await screen.findByText('guided.sent {"load":1}');
        expect(addScanLoad).toHaveBeenCalledTimes(1);
    });

    it('cancels a pass and throws its pages away', async () => {
        scriptJob('jobA', { ...doneJob('jobA', 1), state: 'scanning' });
        renderGuided();
        fireEvent.click(await startButton());
        const cancel = await screen.findByRole('button', { name: 'guided.cancel' });
        await screen.findByText('guided.scanning {"count":1}');
        fireEvent.click(cancel);
        await screen.findByText('guided.cancelled');
        expect(helper.cancel).toHaveBeenCalledWith('jobA');
        expect(helper.remove).toHaveBeenCalledWith('jobA');
        expect(screen.getByText(/guided.stepA/)).toBeTruthy();
        expect(uploadScanFiles).not.toHaveBeenCalled();
    });

    it('says what went wrong when the helper refuses to start', async () => {
        const { ScanHelperError } = await import('../-lib/scan-helper-client');
        helper.startScan.mockRejectedValueOnce(new ScanHelperError('NO_PAPER', 'no paper', 422));
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText('guided.errors.NO_PAPER');
        expect(screen.getByText(/guided.stepA/)).toBeTruthy();
    });
});

describe('guided scan — two-sided feeder', () => {
    beforeEach(() => {
        helper.status.mockResolvedValue(
            status([scanner({ feeder: { present: true, duplex: true, paper_loaded: true } })])
        );
    });

    it('scans once and splits front/back into the DUPLEX intake', async () => {
        scriptJob('jobA', doneJob('jobA', 4, true));
        renderGuided();
        await screen.findByText(/guided.device.bothSides/);
        fireEvent.click(await startButton());
        await screen.findByText('guided.sent {"load":1}');
        expect(helper.startScan).toHaveBeenCalledTimes(1);
        expect(helper.startScan.mock.calls[0]![0]).toMatchObject({ duplex: true });

        const [files] = uploadScanFiles.mock.calls[0] as [File[]];
        expect(files.map((f) => f.name)).toEqual([
            'scan-001.jpg',
            'scan-003.jpg',
            'scan-002.jpg',
            'scan-004.jpg',
        ]);
        const body = addScanLoad.mock.calls[0]![2] as ScanLoadBody;
        expect(body.intake_mode).toBe('DUPLEX');
        expect(body.passes[0]!.files.map((f) => f.file_name)).toEqual([
            'scan-001.jpg',
            'scan-003.jpg',
        ]);
        expect(body.passes[1]!.files.map((f) => f.file_name)).toEqual([
            'scan-002.jpg',
            'scan-004.jpg',
        ]);
        await waitFor(() => expect(helper.remove).toHaveBeenCalledWith('jobA'));
    });

    it('refuses an odd page count', async () => {
        scriptJob('jobA', doneJob('jobA', 5, true));
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText('guided.mismatchDuplex {"count":5}');
        expect(screen.queryByRole('button', { name: 'guided.rescanSide' })).toBeNull();
        expect(uploadScanFiles).not.toHaveBeenCalled();
    });
});
