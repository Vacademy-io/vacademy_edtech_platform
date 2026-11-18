import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ScanSession } from '../-services/scan-station-services';
import { CopyReviewList } from './CopyReviewList';
import { LoadSummaryCard } from './LoadSummaryCard';
import { ScanVerdictBar } from './ScanVerdictBar';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../-lib/thumb-source', () => ({
    thumbUrl: () => Promise.resolve('blob:thumb'),
}));

const page = (ref: string, pass_no: number, page_index: number) => ({
    ref,
    pass_no,
    file_id: `f${pass_no}`,
    page_index,
    kind: 'PDF' as const,
    dpi: 300,
    dpi_source: 'PDF' as const,
    width_px: 2480,
    height_px: 3508,
    ink_per_10k: 10,
    blank_class: 'WRITTEN' as const,
    error: null,
    blank_effective: 'WRITTEN' as const,
});

const sheet = (sheet_no: number, label: boolean) => ({
    sheet_no,
    front: `p2.${sheet_no}`,
    back: `p1.${1 - sheet_no}`,
    pair_score: 0.6,
    pair_runner_up: 0.2,
    pair_is_row_max: true,
    label_kind: label ? ('PRINTED_FIELD' as const) : ('NONE' as const),
    label_present: label,
    name_text: label ? 'Asha' : null,
    name_readable: label,
    roll_text: null,
    label_template_sim: 0.8,
    back_label_like: false,
    front_blank_class: 'WRITTEN' as const,
    back_blank_class: sheet_no === 1 ? ('BLANK' as const) : ('WRITTEN' as const),
});

const SESSION: ScanSession = {
    id: 's1',
    assessment_id: 'a1',
    status: 'OPEN',
    verdict: 'NEEDS_REVIEW',
    verdict_reasons: [],
    fronts_direction: 'FORWARD',
    fronts_direction_source: 'LOAD1',
    session_flags: [],
    loads: [
        {
            load_no: 1,
            status: 'DONE',
            attempts: 1,
            error_message: null,
            passes: [
                {
                    pass_no: 1,
                    page_count: 2,
                    files: [{ file_id: 'f1', file_name: 'a.pdf', kind: 'PDF' }],
                },
                {
                    pass_no: 2,
                    page_count: 2,
                    files: [{ file_id: 'f2', file_name: 'b.pdf', kind: 'PDF' }],
                },
            ],
            layout: {
                fronts_pass: 2,
                fronts_rotation: 0,
                backs_order: 'REVERSED',
                backs_rotation: 180,
                order_margin: 0.3,
                shift: null,
                blank_rule_suspect: false,
            },
            pages: [page('p1.0', 1, 0), page('p1.1', 1, 1), page('p2.0', 2, 0), page('p2.1', 2, 1)],
            sheets: [sheet(0, true), sheet(1, false)],
            flags: [
                {
                    code: 'BLANKS_TO_CONFIRM',
                    severity: 'REVIEW',
                    sheet_no: null,
                    detail: null,
                    accepted: false,
                    fingerprint: 'fp-blanks',
                },
            ],
        },
    ],
    copies: [
        {
            copy_key: 'L1-S0',
            load_no: 1,
            first_sheet_no: 0,
            sheets: [
                { load_no: 1, sheet_no: 0 },
                { load_no: 1, sheet_no: 1 },
            ],
            pages: [
                {
                    load_no: 1,
                    ref: 'p2.0',
                    file_id: 'f2',
                    page_index: 0,
                    kind: 'PDF',
                    rotation: 0,
                    side: 'FRONT',
                },
                {
                    load_no: 1,
                    ref: 'p1.1',
                    file_id: 'f1',
                    page_index: 1,
                    kind: 'PDF',
                    rotation: 180,
                    side: 'BACK',
                },
                {
                    load_no: 1,
                    ref: 'p2.1',
                    file_id: 'f2',
                    page_index: 1,
                    kind: 'PDF',
                    rotation: 0,
                    side: 'FRONT',
                },
            ],
            left_out: [{ load_no: 1, ref: 'p1.0', file_id: 'f1', page_index: 0, kind: 'PDF' }],
            page_count: 3,
            name_text: 'Asha',
            flags: [{ code: 'SAME_NAME', severity: 'REVIEW', sheet_no: 0, detail: null }],
            decision: 'NONE',
            needs_review: true,
            fingerprint: 'fp-copy',
        },
    ],
    built: null,
    intake_batch_id: null,
    error_message: null,
    totals: { loads: 1, sheets: 2, pages: 3, copies: 1, blank_left_out: 1, excluded: 0 },
};

describe('scan review screen', () => {
    it('accepts a copy with its first sheet, splits and keeps pages by sheet and ref', () => {
        const decide = vi.fn();
        render(
            <CopyReviewList
                session={SESSION}
                decide={decide}
                readOnly={false}
                onPairCheck={vi.fn()}
            />
        );
        expect(screen.getByText('Asha')).toBeTruthy();
        expect(screen.getByText('flags.SAME_NAME.title')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'copy.accept' }));
        // The accept names the copy as it was shown.
        expect(decide).toHaveBeenLastCalledWith('ACCEPT_COPY', {
            load_no: 1,
            sheet_no: 0,
            expected_fingerprint: 'fp-copy',
        });

        fireEvent.click(screen.getByRole('button', { name: /copy\.split/ }));
        expect(decide).toHaveBeenLastCalledWith('SPLIT_BEFORE_SHEET', { load_no: 1, sheet_no: 1 });

        fireEvent.click(screen.getByRole('button', { name: 'copy.keepPage' }));
        expect(decide).toHaveBeenLastCalledWith('KEEP_PAGE', { load_no: 1, ref: 'p1.0' });
    });

    it('confirms a load’s blank backs in one click', () => {
        const decide = vi.fn();
        render(
            <LoadSummaryCard
                session={SESSION}
                load={SESSION.loads[0]!}
                decide={decide}
                readOnly={false}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
                onPairCheck={vi.fn()}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'actions.openBlanks' }));
        fireEvent.click(screen.getByRole('button', { name: 'blanks.allBlank' }));
        expect(decide).toHaveBeenLastCalledWith('ACCEPT_LOAD_FLAG', {
            load_no: 1,
            code: 'BLANKS_TO_CONFIRM',
            expected_fingerprint: 'fp-blanks',
        });
    });

    it('only lets blank backs be confirmed from the open grid, below the pages', () => {
        const decide = vi.fn();
        render(
            <LoadSummaryCard
                session={SESSION}
                load={SESSION.loads[0]!}
                decide={decide}
                readOnly={false}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
                onPairCheck={vi.fn()}
            />
        );
        expect(screen.queryByRole('button', { name: 'actions.accept' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'blanks.allBlank' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'actions.openBlanks' }));
        const keep = screen.getByRole('button', { name: 'blanks.keepPage' });
        const confirm = screen.getByRole('button', { name: 'blanks.allBlank' });
        expect(
            keep.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('says why the session is blocked when every copy is left out', () => {
        const blocked: ScanSession = {
            ...SESSION,
            verdict: 'BLOCKED',
            verdict_reasons: [
                { code: 'NO_COPIES', severity: 'BLOCK', load_no: null, copy_key: null },
            ],
            loads: [{ ...SESSION.loads[0]!, flags: [] }],
            copies: [{ ...SESSION.copies[0]!, decision: 'EXCLUDED' }],
        };
        render(
            <ScanVerdictBar
                session={blocked}
                busy={false}
                onNext={vi.fn()}
                onBuild={vi.fn()}
                onReopen={vi.fn()}
                onStart={vi.fn()}
                onOpenChecks={vi.fn()}
            />
        );
        expect(screen.getByText('flags.NO_COPIES.title')).toBeTruthy();
        expect(screen.getByText('flags.NO_COPIES.help')).toBeTruthy();
    });

    it('keeps "Make copies" off until the verdict is READY', () => {
        const onBuild = vi.fn();
        const props = {
            busy: false,
            onNext: vi.fn(),
            onBuild,
            onReopen: vi.fn(),
            onStart: vi.fn(),
            onOpenChecks: vi.fn(),
        };
        const { rerender } = render(<ScanVerdictBar session={SESSION} {...props} />);
        const build = () => screen.getByRole('button', { name: 'bar.build' });
        expect((build() as HTMLButtonElement).disabled).toBe(true);
        rerender(<ScanVerdictBar session={{ ...SESSION, verdict: 'READY' }} {...props} />);
        expect((build() as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(build());
        expect(onBuild).toHaveBeenCalled();
    });

    it('offers the other fronts order before anything else for an unlabelled first sheet', () => {
        const decide = vi.fn();
        const unlabelled: ScanSession = {
            ...SESSION,
            verdict: 'BLOCKED',
            loads: [{ ...SESSION.loads[0]!, sheets: [sheet(0, false), sheet(1, false)] }],
            copies: [
                {
                    ...SESSION.copies[0]!,
                    name_text: null,
                    flags: [
                        {
                            code: 'FIRST_SHEET_NO_LABEL',
                            severity: 'BLOCK',
                            sheet_no: 0,
                            detail: null,
                        },
                    ],
                },
            ],
        };
        render(
            <CopyReviewList
                session={unlabelled}
                decide={decide}
                readOnly={false}
                onPairCheck={vi.fn()}
            />
        );
        expect(screen.getByText('copy.firstSheetHelp')).toBeTruthy();
        const turn = screen.getByRole('button', { name: /copy\.tryDirection\.REVERSED/ });
        const startHere = screen.getByRole('button', { name: /copy\.startHere/ });
        expect(
            turn.compareDocumentPosition(startHere) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        // Leaving the copy out stays on offer, once, in the copy's header.
        expect(screen.getAllByRole('button', { name: 'copy.exclude' })).toHaveLength(1);

        fireEvent.click(turn);
        expect(decide).toHaveBeenLastCalledWith('SET_FRONTS_DIRECTION', { value: 'REVERSED' });
        fireEvent.click(startHere);
        expect(decide).toHaveBeenLastCalledWith('SPLIT_BEFORE_SHEET', { load_no: 1, sheet_no: 0 });
    });

    it('shows a build waiting for a busy AI service as progress, never as a failure', () => {
        const props = {
            busy: false,
            onNext: vi.fn(),
            onBuild: vi.fn(),
            onReopen: vi.fn(),
            onStart: vi.fn(),
            onOpenChecks: vi.fn(),
        };
        const second = { ...SESSION.copies[0]!, copy_key: 'L1-S1', first_sheet_no: 1 };
        const building: ScanSession = {
            ...SESSION,
            status: 'BUILDING',
            verdict: 'READY',
            copies: [SESSION.copies[0]!, second],
            built: null,
            error_message: 'The AI service is busy; the copies will be made as soon as it is free',
        };
        const { rerender } = render(<ScanVerdictBar session={building} {...props} />);
        expect(screen.getByText('bar.building')).toBeTruthy();
        expect(screen.getByText('bar.aiBusy')).toBeTruthy();
        expect(screen.queryByText('bar.failed')).toBeNull();
        expect(screen.queryByText(/AI service is busy/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'bar.retry' })).toBeNull();

        rerender(
            <ScanVerdictBar
                session={{
                    ...building,
                    built: [{ copy_key: 'L1-S0', file_id: 'out1', page_count: 3 }],
                }}
                {...props}
            />
        );
        expect(screen.getByText('bar.buildingProgress')).toBeTruthy();
        expect(screen.getByText('bar.aiBusy')).toBeTruthy();

        rerender(<ScanVerdictBar session={{ ...building, error_message: null }} {...props} />);
        expect(screen.queryByText('bar.aiBusy')).toBeNull();
    });
});
