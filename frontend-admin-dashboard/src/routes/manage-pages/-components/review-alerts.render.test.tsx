import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../-hooks/use-catalogue-permissions', () => ({
    useCataloguePermissions: () => ({ canWrite: true, canPublish: true, canDelete: true }),
}));
const queryArgs: any[] = [];
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: (opts: any) => {
        queryArgs.push(opts);
        return { data: { content: [], counts: { PENDING: 3, APPROVED: 9 } } };
    },
}));

import { EditReviewDialog } from './reviews/ReviewsList';
import { formatBadgeCount, usePendingReviewCount } from '../-hooks/use-pending-review-count';

/**
 * Reviews alerts and moderation polish: the pending badge reads the PENDING
 * count under the Reviews list's cache key, and the edit dialog only shows
 * course / city / designation the review has.
 */

const Badge = () => <span data-testid="n">{usePendingReviewCount()}</span>;

describe('pending reviews badge', () => {
    it('counts PENDING reviews, keyed under the Reviews list so moderation refreshes it', () => {
        render(<Badge />);
        expect(screen.getByTestId('n').textContent).toBe('3');
        const opts = queryArgs.find((o) => o.queryKey?.[2] === 'pending-count');
        expect(opts.queryKey.slice(0, 2)).toEqual(['catalogue-site-reviews', 'inst-1']);
        expect(opts.refetchInterval).toBe(60_000);
        expect(formatBadgeCount(7)).toBe('7');
        expect(formatBadgeCount(140)).toBe('99+');
    });
});

describe('EditReviewDialog', () => {
    const base = { id: 'r1', rating: 5, reviewer_name: 'Neeraj', status: 'PENDING' as const };

    it('hides course, city and designation the review does not have, and does not send them', () => {
        const onSave = vi.fn();
        render(<EditReviewDialog review={base} saving={false} onCancel={() => {}} onSave={onSave} />);
        expect(screen.queryByText('list.fields.course', { selector: 'label' })).toBeNull();
        expect(screen.queryByText('list.fields.city', { selector: 'label' })).toBeNull();
        expect(screen.queryByText('list.fields.designation', { selector: 'label' })).toBeNull();
        fireEvent.click(screen.getByText('list.save'));
        expect(onSave.mock.calls[0][0]).toMatchObject({ reviewer_name: 'Neeraj', city: undefined, course_name: undefined, designation: undefined });
    });

    it('shows the ones the review has, and "+" brings back an empty one to fill in', () => {
        const onSave = vi.fn();
        render(<EditReviewDialog review={{ ...base, city: 'Ajmer' }} saving={false} onCancel={() => {}} onSave={onSave} />);
        expect(screen.getByDisplayValue('Ajmer')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /list\.fields\.course/ }));
        const inputs = screen.getAllByRole('textbox');
        fireEvent.change(inputs[inputs.length - 2]!, { target: { value: 'SSC' } });
        fireEvent.click(screen.getByText('list.save'));
        expect(onSave.mock.calls[0][0]).toMatchObject({ city: 'Ajmer', course_name: 'SSC', designation: undefined });
    });
});
