import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { CourseSessionSelector } from './CourseSessionSelector';
import type { MappingRow } from '../-types/product-page-types';
import { moveRowInList } from '../-utils/mapping-rows';

/**
 * Up/down arrows on the selected courses. The row order is the saved order —
 * and a learning path's step order — so the arrows must move exactly one row,
 * be disabled at the ends, and not appear for callers that cannot reorder.
 */

const post = vi.fn();

vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { post: (...args: unknown[]) => post(...args), get: vi.fn() },
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const savedRow = (id: string, i: number): MappingRow => ({
    rowId: `row-${id}`,
    inviteId: `inv-${id}`,
    inviteName: `Invite ${id}`,
    psInvitePaymentOptionId: `bridge-${id}`,
    packageSessionId: `ps-${id}`,
    paymentPlanId: 'plan',
    paymentPlanName: 'Full',
    paymentPlanPrice: 100,
    currency: 'INR',
    preselected: false,
    displayOrder: i,
});

function Harness({ initialRows, reorderable }: { initialRows: MappingRow[]; reorderable: boolean }) {
    const [rows, setRows] = useState(initialRows);
    return (
        <CourseSessionSelector
            mappingRows={rows}
            onAdd={vi.fn()}
            onUpdate={vi.fn()}
            onRemove={vi.fn()}
            suggestions={{}}
            onUpdateSuggestions={vi.fn()}
            onMove={reorderable ? (rowId, dir) => setRows((prev) => moveRowInList(prev, rowId, dir)) : undefined}
        />
    );
}

const renderRows = (reorderable: boolean) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <Harness initialRows={['a', 'b', 'c'].map(savedRow)} reorderable={reorderable} />
        </QueryClientProvider>
    );

/** Invite names in the order the rows are on screen. */
const order = () => screen.getAllByText(/^Invite [abc]$/).map((el) => el.textContent);

beforeEach(() => {
    post.mockReset();
    post.mockImplementation((url: string) =>
        Promise.resolve({
            data: url.includes('get-enroll-invite')
                ? { content: [], last: true }
                : { content: [], totalElements: 0, last: true, number: 0 },
        })
    );
});

describe('CourseSessionSelector reordering', () => {
    it('moves a row one step and disables the arrows at the ends', () => {
        renderRows(true);
        expect(order()).toEqual(['Invite a', 'Invite b', 'Invite c']);

        const ups = screen.getAllByRole('button', { name: 'selectedRow.moveUp' });
        const downs = screen.getAllByRole('button', { name: 'selectedRow.moveDown' });
        expect(ups[0]).toBeDisabled();
        expect(downs[2]).toBeDisabled();
        expect(ups[1]).toBeEnabled();

        fireEvent.click(downs[0]!);
        expect(order()).toEqual(['Invite b', 'Invite a', 'Invite c']);

        fireEvent.click(screen.getAllByRole('button', { name: 'selectedRow.moveUp' })[2]!);
        expect(order()).toEqual(['Invite b', 'Invite c', 'Invite a']);
        // The step badge follows the position.
        const firstRow = screen.getByText('Invite b').closest('div.rounded-xl') as HTMLElement;
        expect(within(firstRow).getByText('1')).toBeInTheDocument();
    });

    it('shows no arrows when the caller cannot reorder', () => {
        renderRows(false);
        expect(screen.queryByRole('button', { name: 'selectedRow.moveUp' })).not.toBeInTheDocument();
    });
});
