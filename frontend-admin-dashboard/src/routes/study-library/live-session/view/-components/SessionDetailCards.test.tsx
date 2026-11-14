/**
 * The attendance tiles sit in a half-width card, which is where they kept going
 * wrong: "Attendance Rate" was clipped to "Atte…". These pin the two things
 * that must hold at that width — the label stays readable, and the headline
 * rate agrees with the roster below rather than printing NaN.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/services/upload_file', () => ({ getPublicUrl: vi.fn(async () => '') }));

import { AttendanceStatTiles, LinkedBatchesCard } from './SessionDetailCards';

const labels = {
    registered: 'Registered',
    attended: 'Attended',
    rate: 'Attendance Rate',
    students: 'students',
};

const renderTiles = (registered: number, attended: number) =>
    render(<AttendanceStatTiles registered={registered} attended={attended} labels={labels} />);

describe('AttendanceStatTiles', () => {
    it('spells the rate label out in full instead of clipping it', () => {
        renderTiles(9, 0);

        const label = screen.getByText('Attendance Rate');
        expect(label).toBeInTheDocument();
        // `truncate` is what turned this into "Atte…" in the narrow column.
        expect(label.className).not.toMatch(/\btruncate\b/);
    });

    it('reports a rate that matches the counts', () => {
        renderTiles(10, 7);
        expect(screen.getByText('70%')).toBeInTheDocument();
    });

    it('rounds rather than printing a long decimal', () => {
        renderTiles(3, 1);
        expect(screen.getByText('33%')).toBeInTheDocument();
    });

    it('shows 0%, not NaN, when nobody is registered', () => {
        renderTiles(0, 0);

        expect(screen.getByText('0%')).toBeInTheDocument();
        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });
});

const batch = (n: number) => ({
    package_session_id: `ps-${n}`,
    package_name: `MGP B-${n}`,
    level_name: 'Class 9',
    session_name: '2026-2027',
});

const renderBatches = (count: number) =>
    render(
        <LinkedBatchesCard
            batches={Array.from({ length: count }, (_, i) => batch(i + 1))}
            label="Associated Batches"
            linkedLabel={`${count} batches linked`}
        />
    );

describe('LinkedBatchesCard', () => {
    it('reveals the hidden batches when "+N more" is clicked', () => {
        renderBatches(7);

        // Only the first three, and the overflow is a real button.
        expect(screen.queryByText('Class 9 MGP B-7')).not.toBeInTheDocument();
        const more = screen.getByRole('button', { name: '+4 more' });

        fireEvent.click(more);

        // All seven now present — the badge used to be a <span> that did nothing.
        for (let i = 1; i <= 7; i += 1) {
            expect(screen.getByText(`Class 9 MGP B-${i}`)).toBeInTheDocument();
        }
        expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument();
    });

    it('never hides a batch behind a scrollbar', () => {
        renderBatches(7);
        fireEvent.click(screen.getByRole('button', { name: '+4 more' }));

        // macOS hides overlay scrollbars, so a capped scroll area silently
        // swallowed the last batches with nothing on screen to hint at them.
        const chip = screen.getByText('Class 9 MGP B-7');
        for (let el = chip.parentElement; el; el = el.parentElement) {
            expect(el.className).not.toMatch(/overflow-y-auto|max-h-/);
        }
    });

    it('collapses again', () => {
        renderBatches(7);
        fireEvent.click(screen.getByRole('button', { name: '+4 more' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show less' }));

        expect(screen.queryByText('Class 9 MGP B-7')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+4 more' })).toBeInTheDocument();
    });

    it('offers no toggle when everything already fits', () => {
        renderBatches(2);

        // The card heading is itself a button, so scope this to the overflow one.
        expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
    });
});
