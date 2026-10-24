import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StudentRow } from '@/routes/mentorship/-types/mentorship-types';

const searchStudents = vi.fn();
const fetchAllMatchingStudents = vi.fn();
const success = vi.fn();

vi.mock('@/routes/mentorship/-services/mentorship-service', () => ({
    searchStudents: (...a: unknown[]) => searchStudents(...(a as [])),
    fetchAllMatchingStudents: (...a: unknown[]) => fetchAllMatchingStudents(...(a as [])),
}));
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => success(...(a as [])) } }));
vi.mock('@/lib/report-api-error', () => ({ reportApiError: vi.fn() }));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: (selector: (s: unknown) => unknown) =>
        selector({
            instituteDetails: {
                batches_for_sessions: [
                    {
                        id: 'ps-1',
                        level: { id: 'lvl-1', level_name: 'Class 10' },
                        package_dto: { package_name: 'Science' },
                        session: { id: 'sess-1', session_name: '2025-26' },
                    },
                ],
            },
        }),
}));

import { MenteePicker } from '@/routes/mentorship/-components/MenteePicker';

const rows = (n: number, offset = 0): StudentRow[] =>
    Array.from({ length: n }, (_, i) => ({
        user_id: `u${i + offset}`,
        full_name: `Student ${i + offset}`,
        email: `s${i + offset}@example.com`,
        package_session_id: 'ps-1',
    }));

const page = (content: StudentRow[], total = content.length, totalPages = 1) => ({
    content,
    total_elements: total,
    total_pages: totalPages,
    number: 0,
    size: content.length,
});

/** Renders the picker with real selection state, the way a dialog holds it. */
function Harness() {
    const [selected, setSelected] = useState<StudentRow[]>([]);
    return (
        <>
            <MenteePicker instituteId="inst-1" selected={selected} onChange={setSelected} />
            <output data-testid="count">{selected.length}</output>
        </>
    );
}

function open() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <Harness />
        </QueryClientProvider>
    );
}

const selectedCount = () => Number(screen.getByTestId('count').textContent);

describe('MenteePicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        searchStudents.mockResolvedValue(page(rows(3)));
    });

    it('lists enrolled students on open, with no search term typed', async () => {
        open();
        expect(await screen.findByText('Student 0')).toBeInTheDocument();
        // The old picker sat empty behind "Type a name to search students", which
        // made bulk assignment look impossible.
        expect(screen.queryByText(/Type a name to search/)).not.toBeInTheDocument();
        expect(searchStudents).toHaveBeenCalledWith(
            expect.objectContaining({ instituteId: 'inst-1', name: '' })
        );
    });

    it('takes every student on the page in one click', async () => {
        open();
        await screen.findByText('Student 0');

        fireEvent.click(screen.getByLabelText('Select every student on this page'));
        expect(selectedCount()).toBe(3);

        // ...and gives them all back the same way.
        fireEvent.click(screen.getByLabelText('Select every student on this page'));
        expect(selectedCount()).toBe(0);
    });

    it('toggles one student without disturbing the rest', async () => {
        open();
        await screen.findByText('Student 0');
        fireEvent.click(screen.getByLabelText('Select every student on this page'));

        fireEvent.click(screen.getByLabelText('Select Student 1'));
        expect(selectedCount()).toBe(2);
        expect(screen.queryByLabelText('Remove Student 1')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Remove Student 0')).toBeInTheDocument();
    });

    it('sweeps every match when the selection spans more pages than are shown', async () => {
        searchStudents.mockResolvedValue(page(rows(3), 45, 3));
        fetchAllMatchingStudents.mockResolvedValue(rows(45));
        open();
        await screen.findByText('Student 0');

        fireEvent.click(screen.getByRole('button', { name: 'Select all 45 matching' }));
        await waitFor(() => expect(selectedCount()).toBe(45));
        expect(success).toHaveBeenCalledWith('Selected 45 more students');
    });

    it('refuses to select a match set larger than one assignment should be', async () => {
        searchStudents.mockResolvedValue(page(rows(3), 4000, 200));
        open();
        await screen.findByText('Student 0');

        expect(
            screen.queryByRole('button', { name: /Select all .* matching/ })
        ).not.toBeInTheDocument();
        expect(screen.getByText(/filter by batch to select them all at once/i)).toBeInTheDocument();
    });

    it('keeps selected students visible after the filter moves on', async () => {
        open();
        await screen.findByText('Student 0');
        fireEvent.click(screen.getByLabelText('Select Student 0'));

        searchStudents.mockResolvedValue(page(rows(2, 90)));
        fireEvent.change(screen.getByPlaceholderText('Search by name'), {
            target: { value: 'zzz' },
        });
        await screen.findByText('Student 90');

        // Student 0 has dropped off the result list, but is still plainly
        // selected — as a chip that can be taken back off.
        expect(screen.queryByLabelText('Select Student 0')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Remove Student 0')).toBeInTheDocument();
        expect(selectedCount()).toBe(1);

        fireEvent.click(screen.getByLabelText('Remove Student 0'));
        expect(selectedCount()).toBe(0);
    });

    it('offers the batch filter when the institute has batches', async () => {
        open();
        await screen.findByText('Student 0');
        expect(screen.getByRole('combobox', { name: /filter by batch/i })).toBeInTheDocument();
    });

    it('captions each student with the batch they are enrolled in', async () => {
        open();
        await screen.findByText('Student 0');
        expect(screen.getByText('s0@example.com · Science · Class 10')).toBeInTheDocument();
    });
});

describe('MenteePicker — single select (booking a 1:1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        searchStudents.mockResolvedValue(page(rows(3), 45, 3));
    });

    function openSingle() {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        function Single() {
            const [selected, setSelected] = useState<StudentRow[]>([]);
            return (
                <>
                    <MenteePicker
                        instituteId="inst-1"
                        singleSelect
                        selected={selected}
                        onChange={setSelected}
                    />
                    <output data-testid="count">{selected.length}</output>
                </>
            );
        }
        return render(
            <QueryClientProvider client={client}>
                <Single />
            </QueryClientProvider>
        );
    }

    it('replaces the pick instead of accumulating, since only one learner is booked', async () => {
        openSingle();
        await screen.findByText('Student 0');

        fireEvent.click(screen.getByLabelText('Select Student 0'));
        fireEvent.click(screen.getByLabelText('Select Student 1'));
        expect(selectedCount()).toBe(1);
        expect(screen.getByLabelText('Remove Student 1')).toBeInTheDocument();
    });

    it('hides the bulk controls it cannot honour', async () => {
        openSingle();
        await screen.findByText('Student 0');

        expect(
            screen.queryByLabelText('Select every student on this page')
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /Select all .* matching/ })
        ).not.toBeInTheDocument();
    });
});
