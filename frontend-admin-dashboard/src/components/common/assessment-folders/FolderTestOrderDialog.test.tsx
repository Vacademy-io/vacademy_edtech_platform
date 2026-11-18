import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import strings from '../../../../public/locales/en/assessmentFolders.json';
import type { AssessmentFolder, FolderTestOrder } from '@/services/assessment-folders';

/**
 * The folder "Test order" dialog decides the order students see a folder's tests in:
 * by name (A to Z, numbers by value) or an order arranged by the admin.
 */

// Strict `t`: a missing key throws instead of leaking a raw key into the UI.
const resolve = (key: string, options?: Record<string, unknown>): string => {
    const value = key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            strings
        );
    if (typeof value !== 'string') throw new Error(`Missing translation: ${key}`);
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: resolve }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/report-api-error', () => ({ reportApiError: vi.fn() }));

const saveMock = vi.fn();
const invalidateMock = vi.fn(() => Promise.resolve());
let orderState: {
    data?: FolderTestOrder;
    isError: boolean;
    isFetching: boolean;
    refetch: () => void;
};
vi.mock('@/services/assessment-folders', () => ({
    useFolderTestOrder: () => orderState,
    saveFolderTestOrder: (...args: unknown[]) => saveMock(...args),
    useInvalidateAssessmentFolders: () => invalidateMock,
    compareTestNames: (a: string, b: string) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
}));

const { FolderTestOrderDialog } = await import('./FolderTestOrderDialog');

const folder: AssessmentFolder = {
    id: 'f-1',
    name: 'Chapter Tests',
    description: null,
    image_url: null,
    display_order: 0,
    status: 'ACTIVE',
    parent_id: null,
    assessment_count: 3,
};

const item = (id: string, name: string, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') => ({
    assessment_id: id,
    name,
    status,
});

const shownNames = () =>
    within(screen.getByRole('list', { name: strings.order.listLabel }))
        .getAllByRole('listitem')
        .map((li) => li.querySelector('span[title]')?.getAttribute('title'));

const radio = (label: string) =>
    screen.getByRole('radio', { name: new RegExp(label.replace(/[()→]/g, '.')) });

beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockResolvedValue({});
    invalidateMock.mockClear();
});

describe('FolderTestOrderDialog', () => {
    it('shows a folder in name order A to Z, numbers by value, with drafts marked', () => {
        orderState = {
            data: {
                folder_id: 'f-1',
                mode: 'NAME',
                assessments: [
                    item('a10', 'Chapter Test 10A'),
                    item('a2', 'Chapter Test 2A', 'DRAFT'),
                    item('a7', 'chapter test 07A'),
                ],
            },
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
        };
        render(<FolderTestOrderDialog folder={folder} onOpenChange={vi.fn()} />);

        expect(shownNames()).toEqual(['Chapter Test 2A', 'chapter test 07A', 'Chapter Test 10A']);
        expect(radio(strings.order.byName)).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(strings.order.draft)).toBeInTheDocument();
        expect(screen.getByText(strings.order.draftNote)).toBeInTheDocument();
    });

    it('moving a test switches to the custom order and saves it', async () => {
        orderState = {
            data: {
                folder_id: 'f-1',
                mode: 'NAME',
                assessments: [item('a1', 'Test 1'), item('a2', 'Test 2'), item('a3', 'Test 3')],
            },
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
        };
        const onOpenChange = vi.fn();
        render(<FolderTestOrderDialog folder={folder} onOpenChange={onOpenChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Move Test 3 up' }));

        expect(shownNames()).toEqual(['Test 1', 'Test 3', 'Test 2']);
        expect(radio(strings.order.custom)).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('button', { name: 'Move Test 1 up' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: strings.form.save }));
        await waitFor(() =>
            expect(saveMock).toHaveBeenCalledWith('f-1', 'CUSTOM', ['a1', 'a3', 'a2'])
        );
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
        expect(invalidateMock).toHaveBeenCalled();
    });

    it('an arranged folder opens in its own order and can go back to name order', async () => {
        orderState = {
            data: {
                folder_id: 'f-1',
                mode: 'CUSTOM',
                assessments: [item('a3', 'Test 3'), item('a1', 'Test 1'), item('a2', 'Test 2')],
            },
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
        };
        render(<FolderTestOrderDialog folder={folder} onOpenChange={vi.fn()} />);

        expect(shownNames()).toEqual(['Test 3', 'Test 1', 'Test 2']);
        expect(radio(strings.order.custom)).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(radio(strings.order.byName));
        expect(shownNames()).toEqual(['Test 1', 'Test 2', 'Test 3']);

        // Switching back keeps the arranged order.
        fireEvent.click(radio(strings.order.custom));
        expect(shownNames()).toEqual(['Test 3', 'Test 1', 'Test 2']);

        fireEvent.click(radio(strings.order.byName));
        fireEvent.click(screen.getByRole('button', { name: strings.form.save }));
        await waitFor(() => expect(saveMock).toHaveBeenCalled());
        expect(saveMock.mock.calls[0]?.slice(0, 2)).toEqual(['f-1', 'NAME']);
    });

    it('waits for the fresh fetch, and offers a retry when loading fails', () => {
        const refetch = vi.fn();
        orderState = { data: undefined, isError: false, isFetching: true, refetch };
        const { rerender } = render(
            <FolderTestOrderDialog folder={folder} onOpenChange={vi.fn()} />
        );
        expect(
            screen.queryByRole('list', { name: strings.order.listLabel })
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: strings.form.save })).toBeDisabled();

        orderState = { data: undefined, isError: true, isFetching: false, refetch };
        rerender(<FolderTestOrderDialog folder={folder} onOpenChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: strings.order.retry }));
        expect(refetch).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: strings.form.save })).toBeDisabled();
    });

    it('shows an empty folder', () => {
        orderState = {
            data: { folder_id: 'f-1', mode: 'NAME', assessments: [] },
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
        };
        render(<FolderTestOrderDialog folder={folder} onOpenChange={vi.fn()} />);
        expect(screen.getByText(strings.order.empty)).toBeInTheDocument();
    });
});
