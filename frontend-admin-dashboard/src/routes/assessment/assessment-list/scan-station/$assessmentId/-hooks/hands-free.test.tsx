import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: vi.fn() }));
vi.mock('@/constants/urls', () => ({ SCAN_STATION_BASE_URL: '/scan' }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const api = vi.hoisted(() => ({
    build: vi.fn(),
    start: vi.fn(),
    copyCheckConfig: vi.fn(),
    settings: vi.fn(),
    publicUrl: vi.fn(),
    print: vi.fn(),
    printStatus: vi.fn(),
}));
vi.mock('../-services/scan-station-services', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-services/scan-station-services')>()),
    buildScanSession: (...a: unknown[]) => api.build(...a),
    startScanSession: (...a: unknown[]) => api.start(...a),
}));
vi.mock(
    '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services',
    () => ({ getCopyCheckConfig: (...a: unknown[]) => api.copyCheckConfig(...a) })
);
vi.mock('@/services/assessment-settings', () => ({
    getAssessmentSettings: (...a: unknown[]) => api.settings(...a),
}));
vi.mock('@/services/upload_file', () => ({
    getPublicUrl: (...a: unknown[]) => api.publicUrl(...a),
}));
vi.mock('../-lib/scan-helper-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-lib/scan-helper-client')>()),
    scanHelper: { print: api.print, printStatus: api.printStatus },
}));

import { useHandsFreeRun } from './useHandsFreeRun';
import { usePrintChecked } from './usePrintChecked';
import { DEFAULT_HANDS_FREE, defaultStartBody } from '../-lib/hands-free';
import type { ScanSession } from '../-services/scan-station-services';

const session = (over: Partial<ScanSession> = {}): ScanSession =>
    ({
        id: 's1',
        assessment_id: 'a1',
        status: 'OPEN',
        verdict: 'READY',
        verdict_reasons: [],
        fronts_direction: 'FORWARD',
        fronts_direction_source: 'LOAD1',
        session_flags: [],
        loads: [{ load_no: 1, status: 'DONE' }],
        copies: [{}, {}],
        built: null,
        intake_batch_id: null,
        error_message: null,
        totals: {},
        ...over,
    }) as unknown as ScanSession;

const auto = { ...DEFAULT_HANDS_FREE, autoCheck: true };

let store: Map<string, string>;
beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    store = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
    });
    api.copyCheckConfig.mockResolvedValue({ subject: 'Science', level: '', instructions: null });
    api.settings.mockResolvedValue({
        aiCopyCheck: {
            commentPlacement: 'OUTSIDE',
            instructions: 'Be kind',
            languageFeedback: 'ON',
        },
    });
});

describe('hands-free run', () => {
    it('does nothing while checking by itself is off', async () => {
        const apply = vi.fn();
        renderHook(() =>
            useHandsFreeRun({
                session: session(),
                settings: DEFAULT_HANDS_FREE,
                assessmentId: 'a1',
                instituteId: 'i1',
                apply,
            })
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(api.build).not.toHaveBeenCalled();
    });

    it('makes the copies once the session is READY and every load is read', async () => {
        const built = session({ status: 'BUILDING' });
        api.build.mockResolvedValue(built);
        const apply = vi.fn();
        const { rerender } = renderHook(
            ({ s }) =>
                useHandsFreeRun({
                    session: s,
                    settings: auto,
                    assessmentId: 'a1',
                    instituteId: 'i1',
                    apply,
                }),
            { initialProps: { s: session() } }
        );
        await waitFor(() => expect(apply).toHaveBeenCalledWith(built));
        expect(api.build).toHaveBeenCalledWith('s1', 'i1');
        rerender({ s: session() });
        await new Promise((r) => setTimeout(r, 20));
        expect(api.build).toHaveBeenCalledTimes(1);
    });

    it('waits while a load is being read or something needs a look', async () => {
        const apply = vi.fn();
        const { rerender } = renderHook(
            ({ s }) =>
                useHandsFreeRun({
                    session: s,
                    settings: auto,
                    assessmentId: 'a1',
                    instituteId: 'i1',
                    apply,
                }),
            {
                initialProps: {
                    s: session({ loads: [{ load_no: 1, status: 'ANALYSING' }] as never }),
                },
            }
        );
        rerender({ s: session({ verdict: 'NEEDS_REVIEW' }) });
        await new Promise((r) => setTimeout(r, 20));
        expect(api.build).not.toHaveBeenCalled();
    });

    it('starts the check with the test settings once the copies are made', async () => {
        const started = session({ status: 'STARTED', intake_batch_id: 'b1' });
        api.start.mockResolvedValue({ session: started, batch: { id: 'b1', total_items: 2 } });
        const apply = vi.fn();
        renderHook(() =>
            useHandsFreeRun({
                session: session({ status: 'BUILT' }),
                settings: { ...auto, matchStudents: false },
                assessmentId: 'a1',
                instituteId: 'i1',
                apply,
            })
        );
        await waitFor(() => expect(apply).toHaveBeenCalledWith(started));
        expect(api.start).toHaveBeenCalledWith('s1', 'i1', {
            preferred_model: null,
            notify_email: false,
            comment_placement: 'OUTSIDE',
            copy_check_config: {
                subject: 'Science',
                level: null,
                instructions: 'Be kind',
                language_feedback: 'ON',
            },
            map_students: false,
        });
    });

    it('still starts with the defaults when the settings cannot be read', async () => {
        api.copyCheckConfig.mockRejectedValue(new Error('down'));
        api.settings.mockRejectedValue(new Error('down'));
        const body = await defaultStartBody('a1', 'i1', true);
        expect(body.copy_check_config).toEqual({
            subject: null,
            level: null,
            instructions: null,
            language_feedback: 'OFF',
        });
        expect(body.comment_placement).toBe('INSIDE');
        expect(body.map_students).toBe(true);
    });
});

describe('printing checked copies', () => {
    const printer = { id: 'p1', name: 'Brother', duplex: true, color: true, default: true };
    const copy = (id: string) => ({
        item_id: id,
        file_name: `${id}.pdf`,
        student_name: id,
        roll: null,
        evaluated_file_id: `file-${id}`,
    });

    beforeEach(() => {
        api.publicUrl.mockImplementation(async (id: string) => `https://cdn.test/${id}`);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' })))
        );
        let n = 0;
        api.print.mockImplementation(async () => `print-${++n}`);
        api.printStatus.mockResolvedValue({ print_id: 'x', state: 'done', error: null });
    });

    it('prints each checked copy once, two-sided, and remembers it', async () => {
        const { result, rerender } = renderHook(
            ({ copies }) => usePrintChecked({ batchId: 'b1', copies, printer, enabled: true }),
            { initialProps: { copies: [copy('c1')] } }
        );
        await waitFor(() => expect(api.print).toHaveBeenCalledTimes(1));
        expect(api.print.mock.calls[0]![1]).toBe('p1');
        expect(api.print.mock.calls[0]![2]).toBe('two-sided-long-edge');
        rerender({ copies: [copy('c1'), copy('c2')] });
        await waitFor(() => expect(api.print).toHaveBeenCalledTimes(2));
        rerender({ copies: [copy('c1'), copy('c2')] });
        await new Promise((r) => setTimeout(r, 20));
        expect(api.print).toHaveBeenCalledTimes(2);
        expect(JSON.parse(store.get('scanStation.printed.b1')!)).toEqual(['c1', 'c2']);
        await waitFor(() => expect(result.current.stateOf('c1')).toBe('queued'));
    });

    it('never prints again after a reload', async () => {
        store.set('scanStation.printed.b1', JSON.stringify(['c1']));
        const { result } = renderHook(() =>
            usePrintChecked({ batchId: 'b1', copies: [copy('c1')], printer, enabled: true })
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(api.print).not.toHaveBeenCalled();
        expect(result.current.stateOf('c1')).toBe('done');
    });

    it('marks a copy that did not reach the printer, and prints it again on request', async () => {
        api.print.mockRejectedValueOnce(new Error('jam'));
        const { result } = renderHook(() =>
            usePrintChecked({ batchId: 'b1', copies: [copy('c1')], printer, enabled: true })
        );
        await waitFor(() => expect(result.current.stateOf('c1')).toBe('failed'));
        result.current.reprint(copy('c1'));
        await waitFor(() => expect(api.print).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.stateOf('c1')).toBe('queued'));
    });

    it('prints nothing without a printer or when switched off', async () => {
        renderHook(() =>
            usePrintChecked({ batchId: 'b1', copies: [copy('c1')], printer: null, enabled: true })
        );
        renderHook(() =>
            usePrintChecked({ batchId: 'b2', copies: [copy('c1')], printer, enabled: false })
        );
        await new Promise((r) => setTimeout(r, 20));
        expect(api.print).not.toHaveBeenCalled();
    });
});
