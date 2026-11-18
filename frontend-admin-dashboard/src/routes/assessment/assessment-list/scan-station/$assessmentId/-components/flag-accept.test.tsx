import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ScanLoadFlag, ScanSession } from '../-services/scan-station-services';
import { collectIssues } from '../-lib/review-model';
import { LoadSummaryCard } from './LoadSummaryCard';
import { PairCheckDialog } from './PairCheckDialog';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../-lib/thumb-source', () => ({
    thumbUrl: () => Promise.resolve('blob:thumb'),
}));

const flag = (
    code: string,
    fingerprint: string,
    sheet_no: number | null,
    accepted = false
): ScanLoadFlag => ({ code, severity: 'REVIEW', sheet_no, detail: null, accepted, fingerprint });

const withFlags = (flags: ScanLoadFlag[]): ScanSession => ({
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
            passes: [],
            layout: null,
            pages: [],
            sheets: [],
            flags,
        },
    ],
    copies: [],
    built: null,
    intake_batch_id: null,
    error_message: null,
    totals: { loads: 1, sheets: 0, pages: 0, copies: 0, blank_left_out: 0, excluded: 0 },
});

const card = (session: ScanSession, decide = vi.fn()) => {
    render(
        <LoadSummaryCard
            session={session}
            load={session.loads[0]!}
            decide={decide}
            readOnly={false}
            onRescan={vi.fn()}
            onRemove={vi.fn()}
            onPairCheck={vi.fn()}
        />
    );
    return decide;
};

describe('accepting one of two flags with the same code', () => {
    it('sends the fingerprint of the flag that was clicked, not the first of its code', () => {
        const decide = card(
            withFlags([flag('DPI_LOW', 'fp-a', null), flag('DPI_LOW', 'fp-b', null)])
        );
        const accepts = screen.getAllByRole('button', { name: 'actions.accept' });
        expect(accepts).toHaveLength(2);
        fireEvent.click(accepts[1]!);
        expect(decide).toHaveBeenLastCalledWith('ACCEPT_LOAD_FLAG', {
            load_no: 1,
            code: 'DPI_LOW',
            expected_fingerprint: 'fp-b',
        });
        fireEvent.click(accepts[0]!);
        expect(decide).toHaveBeenLastCalledWith('ACCEPT_LOAD_FLAG', {
            load_no: 1,
            code: 'DPI_LOW',
            expected_fingerprint: 'fp-a',
        });
    });

    it('shows each flag as accepted on its own', () => {
        const decide = card(
            withFlags([flag('DPI_LOW', 'fp-a', null, true), flag('DPI_LOW', 'fp-b', null)])
        );
        // The accepted one has no button left; the other still does, with its own fingerprint.
        const accepts = screen.getAllByRole('button', { name: 'actions.accept' });
        expect(accepts).toHaveLength(1);
        fireEvent.click(accepts[0]!);
        expect(decide).toHaveBeenLastCalledWith('ACCEPT_LOAD_FLAG', {
            load_no: 1,
            code: 'DPI_LOW',
            expected_fingerprint: 'fp-b',
        });
    });

    it('accepts the very pair the clerk opened in the pair check', () => {
        const session = withFlags([
            flag('ORDER_UNCERTAIN', 'fp-a', 0),
            flag('ORDER_UNCERTAIN', 'fp-b', 3),
        ]);
        const second = collectIssues(session).find((i) => i.sheet_no === 3)!;
        const decide = vi.fn();
        const onClose = vi.fn();
        render(
            <PairCheckDialog
                session={session}
                issue={second}
                onClose={onClose}
                decide={decide}
                readOnly={false}
                onRescan={vi.fn()}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /pair\.right/ }));
        expect(decide).toHaveBeenLastCalledWith('ACCEPT_LOAD_FLAG', {
            load_no: 1,
            code: 'ORDER_UNCERTAIN',
            expected_fingerprint: 'fp-b',
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('names the flag as the session shows it now when it changed after the dialog opened', () => {
        const before = withFlags([flag('ORDER_UNCERTAIN', 'fp-old', 3)]);
        const opened = collectIssues(before)[0]!;
        const now = withFlags([flag('ORDER_UNCERTAIN', 'fp-new', 3)]);
        const decide = vi.fn();
        render(
            <PairCheckDialog
                session={now}
                issue={opened}
                onClose={vi.fn()}
                decide={decide}
                readOnly={false}
                onRescan={vi.fn()}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /pair\.right/ }));
        expect(decide).toHaveBeenLastCalledWith(
            'ACCEPT_LOAD_FLAG',
            expect.objectContaining({ expected_fingerprint: 'fp-new' })
        );
    });
});
