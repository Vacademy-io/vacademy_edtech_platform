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
vi.mock('@/components/ui/switch', () => ({
    Switch: (p: {
        id: string;
        checked: boolean;
        disabled?: boolean;
        onCheckedChange: (v: boolean) => void;
    }) => (
        <input
            type="checkbox"
            id={p.id}
            checked={p.checked}
            disabled={p.disabled}
            onChange={(e) => p.onCheckedChange(e.target.checked)}
        />
    ),
}));
// Ink on each preview: one value per thumbnail asked for (null = cannot measure).
const shares = vi.hoisted(() => ({ next: [] as (number | null)[] }));
vi.mock('../-lib/blank-sides', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-lib/blank-sides')>()),
    darkShare: async () => (shares.next.length ? shares.next.shift()! : null),
}));

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
import { DEFAULT_HANDS_FREE, type HandsFreeSettings } from '../-lib/hands-free';

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
    onHandsFreeChange.mockReset();
    shares.next = [];
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
    });
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

const onHandsFreeChange = vi.fn();
const oneSided: HandsFreeSettings = { ...DEFAULT_HANDS_FREE, sides: 'ONE' };
const renderGuided = (handsFree: HandsFreeSettings = oneSided) =>
    render(
        <GuidedScan
            sessionId="s1"
            instituteId="inst1"
            nextLoadNo={1}
            onLoadSent={onLoadSent}
            onUseFolders={onUseFolders}
            handsFree={handsFree}
            onHandsFreeChange={onHandsFreeChange}
            statusPollMs={20}
            jobPollMs={5}
        />
    );

const startButton = () => screen.findByRole('button', { name: 'guided.start' });

describe('guided scan — copies written on one side', () => {
    it('scans the pile once and sends one ONE_SIDED pass', async () => {
        scriptJob('jobA', doneJob('jobA', 3));
        renderGuided();
        await screen.findByText(/guided.stepOneUp/);
        fireEvent.click(await startButton());
        await waitFor(() => expect(addScanLoad).toHaveBeenCalledTimes(1));
        expect(helper.startScan).toHaveBeenCalledTimes(1);
        expect(helper.startScan.mock.calls[0]![0]).toMatchObject({
            duplex: false,
            source: 'feeder',
        });
        const body = addScanLoad.mock.calls[0]![2] as ScanLoadBody;
        expect(body.intake_mode).toBe('ONE_SIDED');
        expect(body.passes).toHaveLength(1);
        expect(body.passes[0]!.pass_no).toBe(1);
        expect(body.passes[0]!.files.map((f) => f.file_name)).toEqual([
            'scan-001.jpg',
            'scan-002.jpg',
            'scan-003.jpg',
        ]);
        await waitFor(() => expect(onLoadSent).toHaveBeenCalledWith(session));
        await waitFor(() => expect(helper.remove).toHaveBeenCalledWith('jobA'));
    });

    it('scans one side even when the feeder can do both', async () => {
        helper.status.mockResolvedValue(
            status([scanner({ feeder: { present: true, duplex: true, paper_loaded: true } })])
        );
        scriptJob('jobA', doneJob('jobA', 2));
        renderGuided();
        fireEvent.click(await startButton());
        await waitFor(() => expect(addScanLoad).toHaveBeenCalledTimes(1));
        expect(helper.startScan.mock.calls[0]![0]).toMatchObject({ duplex: false });
        expect((addScanLoad.mock.calls[0]![2] as ScanLoadBody).intake_mode).toBe('ONE_SIDED');
    });

    it('spots a pile put in the wrong way up, sends nothing, and learns the side', async () => {
        scriptJob('jobA', doneJob('jobA', 3));
        scriptJob('jobB', doneJob('jobB', 3));
        shares.next = [0, 0.0001, 0.03];
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText('guided.wrongSide.body {"count":3}');
        expect(uploadScanFiles).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'guided.wrongSide.again' }));
        await waitFor(() => expect(helper.remove).toHaveBeenCalledWith('jobA'));
        // This scanner reads the side underneath: the step now says so.
        await screen.findByText(/guided.stepOneDown/);

        shares.next = [0.02, 0.03, 0.04];
        fireEvent.click(await startButton());
        await waitFor(() => expect(addScanLoad).toHaveBeenCalledTimes(1));
    });

    it('sends the pages anyway when the clerk says they are right, and unlearns', async () => {
        scriptJob('jobA', doneJob('jobA', 2));
        shares.next = [0, 0];
        renderGuided();
        fireEvent.click(await startButton());
        await screen.findByText('guided.wrongSide.body {"count":2}');
        fireEvent.click(screen.getByRole('button', { name: 'guided.wrongSide.useAnyway' }));
        await waitFor(() => expect(addScanLoad).toHaveBeenCalledTimes(1));
        expect(window.localStorage.getItem('scanStation.readsFaceDown.brother-1')).toBeNull();
    });
});

describe('guided scan — desk questions', () => {
    it('asks one side or both and reports the change', async () => {
        renderGuided({ ...DEFAULT_HANDS_FREE });
        await screen.findByText(/guided.stepA/);
        fireEvent.click(screen.getByRole('radio', { name: 'handsFree.sides.ONE' }));
        expect(onHandsFreeChange).toHaveBeenCalledWith({ ...DEFAULT_HANDS_FREE, sides: 'ONE' });
    });

    it('offers printing only once checking starts by itself and a printer is there', async () => {
        renderGuided({ ...DEFAULT_HANDS_FREE });
        await startButton();
        const print = screen.getByLabelText(/handsFree.print.label/) as HTMLInputElement;
        expect(print.disabled).toBe(true);
        fireEvent.click(screen.getByLabelText(/handsFree.auto.label/));
        expect(onHandsFreeChange).toHaveBeenCalledWith({
            ...DEFAULT_HANDS_FREE,
            autoCheck: true,
            print: false,
        });
    });
});
