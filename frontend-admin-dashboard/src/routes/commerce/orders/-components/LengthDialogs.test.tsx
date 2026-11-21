/**
 * WP-44 F m6 / W5: the order dialogs that take a length, rendered (not only
 * their helpers): cancel opens at the whole open length (D8), "1.25" at scale
 * 10 is said and disables the action, "1.2" sends 12 base units; a blank box
 * is never sent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ cancelOrderLine: vi.fn(), createReturn: vi.fn(), previewReturn: vi.fn() }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@/routes/commerce/orders/-shared/order-api', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    cancelOrderLine: api.cancelOrderLine,
    createReturn: api.createReturn,
    previewReturn: api.previewReturn,
}));
// The design-system select is a popover; a native one stands in for choosing.
vi.mock('@/routes/commerce/-components/CatalogueBits', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    PlainSelect: ({
        label,
        value,
        onChange,
        options,
    }: {
        label: string;
        value: string;
        onChange: (value: string) => void;
        options: { value: string; label: string }[];
    }) => (
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="" />
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    ),
}));

import { detailFixture } from '@/routes/commerce/orders/-shared/order-fixtures';
import { CancelLineDialog } from './dialogs/CancelLineDialog';
import { ReturnCreateDialog } from './dialogs/ReturnCreateDialog';

const clothLine = (over: Record<string, unknown> = {}) => ({
    id: 'line-c',
    line_no: 1,
    line_type: 'ITEM',
    package_session_id: 'ps-cloth',
    name: 'Cotton cloth',
    sku: 'CLOTH-1',
    unit: 'MTR',
    qty_scale: 10,
    quantity: 34,
    qty_cancelled: 0,
    qty_shipped: 0,
    qty_returned: 0,
    unit_price: '12.34',
    ...over,
});

const wrap = (node: React.ReactNode) =>
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
    vi.clearAllMocks();
    state.access = {
        ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.STORE_MANAGER], isFeatureOn: () => false }),
        isResolved: true,
    } satisfies CommerceAccessState;
});

describe('CancelLineDialog, a 3.4 m cloth line', () => {
    const detail = () => detailFixture({ lines: [clothLine()] }, { status: 'CONFIRMED', payment_method: 'PREPAID' });

    it('opens at the whole open length, in metres', () => {
        wrap(<CancelLineDialog open onOpenChange={() => undefined} detail={detail()} />);
        expect((screen.getByLabelText(/Length \(m\)/) as HTMLInputElement).value).toBe('3.4');
    });

    it('"1.25" and a blank box disable Cancel line; "1.2" sends 12', async () => {
        api.cancelOrderLine.mockResolvedValue(detail());
        wrap(<CancelLineDialog open onOpenChange={() => undefined} detail={detail()} />);
        const box = screen.getByLabelText(/Length \(m\)/);
        const submit = screen.getByTestId('cancel-line-submit');
        fireEvent.change(box, { target: { value: '1.25' } });
        expect(screen.getByText('Use at most 1 decimal place, like 2.5. Nothing is rounded.')).toBeTruthy();
        expect(submit).toBeDisabled();
        fireEvent.change(box, { target: { value: '' } });
        expect(submit).toBeDisabled();
        fireEvent.change(box, { target: { value: '1.2' } });
        expect(submit).not.toBeDisabled();
        fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Customer asked' } });
        fireEvent.click(submit);
        await waitFor(() => expect(api.cancelOrderLine).toHaveBeenCalledTimes(1));
        expect(api.cancelOrderLine.mock.calls[0]?.[1]).toBe('line-c');
        expect(api.cancelOrderLine.mock.calls[0]?.[2]).toMatchObject({ quantity: 12, reason: 'Customer asked' });
    });
});

describe('ReturnCreateDialog, a delivered 3.4 m cloth line', () => {
    const detail = () =>
        detailFixture({ lines: [clothLine({ qty_shipped: 34 })] }, { status: 'DELIVERED', payment_method: 'PREPAID' });

    it('"1.25" is said and disables Create return; "1.2" sends 12', async () => {
        api.previewReturn.mockResolvedValue({ policy: null, warnings: [], lines: [], credit_estimate: null });
        api.createReturn.mockResolvedValue({ id: 'r-1', return_number: 'RET-1' });
        wrap(<ReturnCreateDialog open onOpenChange={() => undefined} detail={detail()} />);
        expect(screen.getByText('Length (m)')).toBeTruthy();
        const box = screen.getByLabelText(/Cotton cloth/);
        const submit = screen.getByTestId('return-create-submit');
        fireEvent.change(box, { target: { value: '1.25' } });
        expect(screen.getByText('Use at most 1 decimal place, like 2.5. Nothing is rounded.')).toBeTruthy();
        expect(submit).toBeDisabled();
        fireEvent.change(box, { target: { value: '1,2' } });
        expect(screen.getByText('Use a dot for decimals, like 2.5.')).toBeTruthy();
        expect(submit).toBeDisabled();
        fireEvent.change(box, { target: { value: '1.2' } });
        expect(submit).not.toBeDisabled();
        fireEvent.change(screen.getByLabelText('Reason for the return'), { target: { value: 'DEFECTIVE' } });
        fireEvent.click(submit);
        await waitFor(() => expect(api.createReturn).toHaveBeenCalledTimes(1));
        expect(api.createReturn.mock.calls[0]?.[0].lines).toEqual([{ order_line_id: 'line-c', quantity: 12 }]);
    });
});
