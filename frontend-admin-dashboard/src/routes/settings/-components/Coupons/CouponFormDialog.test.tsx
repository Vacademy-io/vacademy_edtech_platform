import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CouponFormDialog } from './CouponFormDialog';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const createSpy = vi.fn();
vi.mock('@/services/coupons', () => ({
    useCreateCoupon: () => ({ mutateAsync: createSpy, isPending: false }),
    useUpdateCoupon: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./CouponScopePicker', () => ({ CouponScopePicker: () => null }));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: (_k: string, fallback: string) => fallback,
    getTerminologyPlural: (_k: string, fallback: string) => `${fallback}s`,
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Batch: 'Batch' },
    OtherTerms: { Invite: 'Invite' },
    RoleTerms: { Learner: 'Learner' },
    SystemTerms: { Batch: 'Batch', Invite: 'Invite', Learner: 'Learner' },
}));

const renderDialog = () =>
    render(<CouponFormDialog instituteId="inst" open onOpenChange={() => {}} />);

const valueInput = () =>
    screen.getByPlaceholderText('basics.value.placeholderPercentage') as HTMLInputElement;

describe('CouponFormDialog discount value', () => {
    beforeEach(() => {
        createSpy.mockReset();
        createSpy.mockResolvedValue({ code: 'SAVE10' });
    });

    it('starts empty instead of a stuck 0', () => {
        renderDialog();
        expect(valueInput().value).toBe('');
    });

    it('can be cleared and retyped without a leftover 0', () => {
        renderDialog();
        fireEvent.change(valueInput(), { target: { value: '25' } });
        expect(valueInput().value).toBe('25');
        fireEvent.change(valueInput(), { target: { value: '' } });
        expect(valueInput().value).toBe('');
        fireEvent.change(valueInput(), { target: { value: '10' } });
        expect(valueInput().value).toBe('10');
    });

    it('blocks submit with a required error when left blank', async () => {
        renderDialog();
        fireEvent.change(screen.getByPlaceholderText('basics.code.placeholder'), {
            target: { value: 'SAVE10' },
        });
        fireEvent.click(screen.getByText('footer.createCoupon'));
        expect(await screen.findByText('schema.discountValueRequired')).toBeTruthy();
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('creates a percentage coupon with no max cap and no end date', async () => {
        renderDialog();
        fireEvent.change(screen.getByPlaceholderText('basics.code.placeholder'), {
            target: { value: 'SAVE10' },
        });
        fireEvent.change(valueInput(), { target: { value: '10' } });
        fireEvent.click(screen.getByText('footer.createCoupon'));
        await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
        const payload = createSpy.mock.calls[0]![0];
        expect(payload.applied_discount).toMatchObject({
            discount_type: 'PERCENTAGE',
            discount_point: 10,
            max_discount_point: null,
        });
        expect(payload.redeem_end_date).toBeNull();
    });
});
