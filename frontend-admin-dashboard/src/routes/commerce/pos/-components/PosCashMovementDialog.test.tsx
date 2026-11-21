/**
 * POS review follow-ups (F-MAJOR 1): a cash in/out whose answer never came
 * keeps its request id when the dialog is closed and opened again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../-shared/pos-api', () => ({ addCashMovement: vi.fn() }));

import * as api from '../-shared/pos-api';
import { networkError } from '../-shared/pos-test-fixtures';
import { PosCashMovementDialog } from './PosCashMovementDialog';

const mocked = vi.mocked(api);

afterEach(() => sessionStorage.clear());

const fill = (amount: string) => {
    fireEvent.change(screen.getByLabelText(/pos.cash.amount/), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText(/pos.cash.reason/), { target: { value: 'Float' } });
    fireEvent.click(screen.getByText('common.save'));
};

describe('PosCashMovementDialog', () => {
    it('reopened after a timeout, the movement goes with the first id; the maybe-saved note shows', async () => {
        mocked.addCashMovement.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(undefined as never);
        const client = new QueryClient();
        const view = (open: boolean) => (
            <QueryClientProvider client={client}>
                <PosCashMovementDialog sessionId="sess-1" open={open} onOpenChange={() => undefined} />
            </QueryClientProvider>
        );
        const { rerender } = render(view(true));
        fill('100');
        await waitFor(() => expect(mocked.addCashMovement).toHaveBeenCalledTimes(1));
        rerender(view(false));
        rerender(view(true));
        expect(await screen.findByTestId('pos-cash-maybe-saved')).toBeTruthy();
        fill('150');
        await waitFor(() => expect(mocked.addCashMovement).toHaveBeenCalledTimes(2));
        const ids = mocked.addCashMovement.mock.calls.map((call) => (call[1] as { client_request_id: string }).client_request_id);
        expect(ids[1]).toBe(ids[0]);
    });
});
