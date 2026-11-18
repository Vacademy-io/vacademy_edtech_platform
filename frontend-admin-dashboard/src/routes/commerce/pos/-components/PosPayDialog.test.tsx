/**
 * Contract §8.3: Confirm payment posts ONCE for a double tap; a retry after a
 * network failure reuses the request id; APPROVAL_REQUIRED opens the PIN
 * dialog and resends the same body with `approval` and the same id; offline
 * blocks Confirm.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';
import type { SaleAnswer, SaleRequest } from '../-shared/pos-types';

const state = vi.hoisted(() => ({ access: null as unknown }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../-shared/pos-api', () => ({
    fetchApprovers: vi.fn(async () => [{ user_id: 'm-1', full_name: 'Test Manager' }]),
}));
vi.mock('../-shared/pos-receipt', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-shared/pos-receipt')>()),
    printReceipt: vi.fn(),
}));
// The real dialog's manager picker is a Radix select; a stub approves at once.
vi.mock('@/routes/commerce/-components/ManagerPinDialog', () => ({
    ManagerPinDialog: ({
        open,
        onApprove,
        onOpenChange,
    }: {
        open: boolean;
        onApprove: (a: { approver_user_id: string; pin: string }) => Promise<void>;
        onOpenChange: (open: boolean) => void;
    }) =>
        open ? (
            <button
                type="button"
                data-testid="pin-approve"
                onClick={() =>
                    void onApprove({ approver_user_id: 'm-1', pin: '123456' }).then(
                        () => onOpenChange(false),
                        // A refused approval keeps the real dialog open; the stub stays too.
                        () => undefined
                    )
                }
            >
                approve
            </button>
        ) : null,
}));

import { networkError, saleAnswer, serverError } from '../-shared/pos-test-fixtures';
import { useAttemptStore } from '../-shared/pos-session-store';
import { PosPayDialog, type PosPayDialogProps } from './PosPayDialog';

const body = (): SaleRequest => ({
    session_id: 'sess-1',
    lines: [{ line_ref: 'l1', variant_id: 'ps-bottle', quantity: 2, unit_price: '450.00' }],
    tenders: [{ mode: 'CASH', amount: '900.00' }],
    notify: true,
});

type HarnessProps = Omit<PosPayDialogProps, 'attempts' | 'attemptScope'>;

/** The dialog with the till's attempt store (session `sess-1`), as the sell screen gives it. */
function Harness(props: HarnessProps) {
    const attempts = useAttemptStore('inst-1', 'sess-1', 'pos');
    return <PosPayDialog {...props} attempts={attempts} attemptScope="sale" />;
}

const props = (
    submit: (b: SaleRequest) => Promise<SaleAnswer>,
    over: Partial<HarnessProps> = {}
): HarnessProps => ({
    open: true,
    onOpenChange: () => undefined,
    total: 900,
    credit: 0,
    ready: true,
    online: true,
    instituteId: 'inst-1',
    registerId: 'reg-1',
    buildBody: () => body(),
    submit,
    onRefused: () => false,
    onNewBill: () => undefined,
    ...over,
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderPay = (submit: (b: SaleRequest) => Promise<SaleAnswer>, online = true) =>
    render(
        <QueryClientProvider client={client()}>
            <Harness {...props(submit, { online })} />
        </QueryClientProvider>
    );

const confirm = () => screen.getByTestId('pos-confirm-pay') as HTMLButtonElement;

describe('PosPayDialog', () => {
    afterEach(() => {
        sessionStorage.clear();
    });

    beforeEach(() => {
        sessionStorage.clear();
        state.access = {
            ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.POS_CASHIER], isFeatureOn: () => true }),
            isResolved: true,
        } satisfies CommerceAccessState;
    });

    it('a double tap on Confirm posts once', async () => {
        let resolve: (value: SaleAnswer) => void = () => undefined;
        const submit = vi.fn(
            (_body: SaleRequest) =>
                new Promise<SaleAnswer>((r) => {
                    resolve = r;
                })
        );
        renderPay(submit);
        fireEvent.click(confirm());
        fireEvent.click(confirm());
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        resolve(saleAnswer());
        expect(await screen.findByTestId('pos-new-bill')).toBeTruthy();
        expect(submit).toHaveBeenCalledTimes(1);
        const sent = submit.mock.calls[0]?.[0] as SaleRequest | undefined;
        expect(sent?.client_request_id).toMatch(/^pos-[A-Za-z0-9_-]{6,58}$/);
        expect(sent?.tenders).toEqual([{ mode: 'CASH', amount: '900.00' }]);
    });

    it('a retry after a network failure sends the same request id', async () => {
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(networkError())
            .mockResolvedValueOnce(saleAnswer());
        renderPay(submit);
        fireEvent.click(confirm());
        expect(await screen.findByText('pos.pay.notSavedHint')).toBeTruthy();
        expect(confirm().textContent).toContain('pos.notSaved');
        fireEvent.click(confirm());
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        const first = submit.mock.calls[0]?.[0]?.client_request_id;
        expect(first).toBeTruthy();
        expect(submit.mock.calls[1]?.[0]?.client_request_id).toBe(first);
        expect(await screen.findByTestId('pos-new-bill')).toBeTruthy();
    });

    it('APPROVAL_REQUIRED opens the PIN dialog and resends with approval and the same id', async () => {
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(serverError(409, 'APPROVAL_REQUIRED: POS_DISCOUNT discount above the limit'))
            .mockResolvedValueOnce(saleAnswer());
        renderPay(submit);
        fireEvent.click(confirm());
        fireEvent.click(await screen.findByTestId('pin-approve'));
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        const [first, second] = submit.mock.calls.map((call) => call[0]);
        expect(first?.approval).toBeUndefined();
        expect(second?.approval).toEqual({ approver_user_id: 'm-1', pin: '123456' });
        expect(second?.client_request_id).toBe(first?.client_request_id);
        const { client_request_id: _a, approval: _b, ...restSecond } = second ?? ({} as SaleRequest);
        const { client_request_id: _c, ...restFirst } = first ?? ({} as SaleRequest);
        expect(restSecond).toEqual(restFirst);
        expect(await screen.findByTestId('pos-new-bill')).toBeTruthy();
    });

    it('a second APPROVAL_REQUIRED on the resend keeps the PIN step open; the same id goes a third time', async () => {
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(serverError(409, 'APPROVAL_REQUIRED: POS_DISCOUNT discount above the limit'))
            .mockRejectedValueOnce(serverError(409, 'APPROVAL_REQUIRED: POS_DISCOUNT discount above the limit'))
            .mockResolvedValueOnce(saleAnswer());
        renderPay(submit);
        fireEvent.click(confirm());
        fireEvent.click(await screen.findByTestId('pin-approve'));
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        fireEvent.click(await screen.findByTestId('pin-approve'));
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
        const ids = submit.mock.calls.map((call) => call[0]?.client_request_id);
        expect(new Set(ids).size).toBe(1);
        expect(await screen.findByTestId('pos-new-bill')).toBeTruthy();
    });

    it('a gateway 502 (the sale may be saved) keeps the same id for the retry', async () => {
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(serverError(502, 'Bad Gateway'))
            .mockResolvedValueOnce(saleAnswer());
        renderPay(submit);
        fireEvent.click(confirm());
        expect(await screen.findByText('pos.pay.notSavedHint')).toBeTruthy();
        fireEvent.click(confirm());
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        expect(submit.mock.calls[1]?.[0]?.client_request_id).toBe(submit.mock.calls[0]?.[0]?.client_request_id);
    });

    it('closing and reopening the Pay dialog after a timeout keeps the same id', async () => {
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(networkError())
            .mockResolvedValueOnce(saleAnswer());
        const qc = client();
        const view = render(
            <QueryClientProvider client={qc}>
                <Harness {...props(submit)} />
            </QueryClientProvider>
        );
        fireEvent.click(confirm());
        expect(await screen.findByText('pos.pay.notSavedHint')).toBeTruthy();
        view.rerender(
            <QueryClientProvider client={qc}>
                <Harness {...props(submit, { open: false })} />
            </QueryClientProvider>
        );
        view.rerender(
            <QueryClientProvider client={qc}>
                <Harness {...props(submit)} />
            </QueryClientProvider>
        );
        fireEvent.click(confirm());
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        expect(submit.mock.calls[1]?.[0]?.client_request_id).toBe(submit.mock.calls[0]?.[0]?.client_request_id);
    });

    it('a reload after a timeout keeps the same id (kept in this tab per session)', async () => {
        const first = vi.fn<[SaleRequest], Promise<SaleAnswer>>().mockRejectedValueOnce(networkError());
        const view = renderPay(first);
        fireEvent.click(confirm());
        expect(await screen.findByText('pos.pay.notSavedHint')).toBeTruthy();
        view.unmount();
        const again = vi.fn<[SaleRequest], Promise<SaleAnswer>>().mockResolvedValueOnce(saleAnswer());
        renderPay(again);
        fireEvent.click(confirm());
        await waitFor(() => expect(again).toHaveBeenCalledTimes(1));
        expect(again.mock.calls[0]?.[0]?.client_request_id).toBe(first.mock.calls[0]?.[0]?.client_request_id);
        // A definite answer ends it: the next bill gets a new id.
        expect(await screen.findByTestId('pos-new-bill')).toBeTruthy();
        expect(sessionStorage.getItem('commerce.pos.attempt.inst-1.sess-1.sale')).toBeNull();
    });

    it('changed tenders after an unanswered attempt go with the same id; a mismatch says the bill was saved', async () => {
        let tenders: SaleRequest['tenders'] = [{ mode: 'CASH', amount: '900.00' }];
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(serverError(504, 'Gateway Timeout'))
            .mockRejectedValueOnce(serverError(409, 'IDEMPOTENCY_MISMATCH: client_request_id was already used'));
        render(
            <QueryClientProvider client={client()}>
                <Harness {...props(submit, { buildBody: () => ({ ...body(), tenders }) })} />
            </QueryClientProvider>
        );
        fireEvent.click(confirm());
        expect(await screen.findByText('pos.pay.notSavedHint')).toBeTruthy();
        tenders = [{ mode: 'UPI', amount: '900.00', reference: 'UPI-1' }];
        fireEvent.click(confirm());
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        const [one, two] = submit.mock.calls.map((call) => call[0]);
        expect(two?.client_request_id).toBe(one?.client_request_id);
        expect(two?.tenders).toEqual(tenders);
        expect(await screen.findByTestId('pos-pay-probably-saved')).toBeTruthy();
        expect(confirm().disabled).toBe(true);
    });

    it('a definite refusal ends the attempt: a changed bill gets a new id', async () => {
        let tenders: SaleRequest['tenders'] = [{ mode: 'CASH', amount: '900.00' }];
        const submit = vi
            .fn<[SaleRequest], Promise<SaleAnswer>>()
            .mockRejectedValueOnce(serverError(400, 'TENDERS_SHORT: tenders do not cover the bill'))
            .mockResolvedValueOnce(saleAnswer());
        render(
            <QueryClientProvider client={client()}>
                <Harness {...props(submit, { buildBody: () => ({ ...body(), tenders }) })} />
            </QueryClientProvider>
        );
        fireEvent.click(confirm());
        expect(await screen.findByTestId('pos-pay-error')).toBeTruthy();
        tenders = [{ mode: 'UPI', amount: '900.00', reference: 'UPI-1' }];
        fireEvent.click(confirm());
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
        expect(submit.mock.calls[1]?.[0]?.client_request_id).not.toBe(submit.mock.calls[0]?.[0]?.client_request_id);
    });

    it('a re-quote that moves the total while the dialog is open closes it and says why', async () => {
        const onOpenChange = vi.fn();
        const onTotalMoved = vi.fn();
        const qc = client();
        const view = render(
            <QueryClientProvider client={qc}>
                <Harness {...props(vi.fn(), { onOpenChange, onTotalMoved })} />
            </QueryClientProvider>
        );
        view.rerender(
            <QueryClientProvider client={qc}>
                <Harness {...props(vi.fn(), { onOpenChange, onTotalMoved, total: 950 })} />
            </QueryClientProvider>
        );
        await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
        expect(onTotalMoved).toHaveBeenCalledTimes(1);
    });

    it('shows the round-off of a whole-rupee bill under the total', () => {
        render(
            <QueryClientProvider client={client()}>
                <Harness {...props(vi.fn(), { total: 949, roundOff: -0.05 })} />
            </QueryClientProvider>
        );
        expect(screen.getByTestId('pos-pay-round-off').textContent).toContain('pos.pay.roundOff');
    });

    it('offline: Confirm is disabled and nothing is sent', () => {
        const submit = vi.fn();
        renderPay(submit, false);
        expect(confirm().disabled).toBe(true);
        fireEvent.click(confirm());
        expect(submit).not.toHaveBeenCalled();
        expect(screen.getByText('pos.offline')).toBeTruthy();
    });
});
