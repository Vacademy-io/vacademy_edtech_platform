import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { mergeDisplayWithDefaults } from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import { isDeletablePayment } from '@/services/payment-logs';
import { PermanentDeleteDialog } from '../../-components/PermanentDeleteDialog';

/**
 * Permanent delete must be OFF unless an admin switched it on in Display Settings — for every
 * role, for every institute whose settings were saved before the flag existed — and even then it
 * must take a deliberate confirmation.
 */
describe('Display Settings flag', () => {
    it('is off for admin and teacher when never set', () => {
        expect(mergeDisplayWithDefaults({}, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement?.allowDeletePayments).toBe(false);
        expect(mergeDisplayWithDefaults(null, TEACHER_DISPLAY_SETTINGS_KEY).learnerManagement?.allowDeletePayments).toBe(false);
    });

    it('stays off for a settings blob saved before the flag existed', () => {
        const saved = {
            learnerManagement: {
                allowPortalAccess: false,
                allowViewPassword: false,
                allowSendResetPasswordMail: false,
                showApprovalToggle: false,
            },
        };
        expect(mergeDisplayWithDefaults(saved, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement?.allowDeletePayments).toBe(false);
    });

    it('survives the merge once switched on — and only an explicit true counts', () => {
        const on = { learnerManagement: { allowDeletePayments: true } } as never;
        expect(mergeDisplayWithDefaults(on, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement?.allowDeletePayments).toBe(true);
        const junk = { learnerManagement: { allowDeletePayments: 'yes' } } as never;
        expect(mergeDisplayWithDefaults(junk, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement?.allowDeletePayments).toBe(false);
    });

    it('keeps the other learner-management settings exactly as saved', () => {
        const saved = {
            learnerManagement: {
                allowPortalAccess: false,
                allowViewPassword: true,
                allowSendResetPasswordMail: false,
                showApprovalToggle: true,
            },
        };
        const merged = mergeDisplayWithDefaults(saved, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement;
        expect(merged?.allowPortalAccess).toBe(false);
        expect(merged?.allowViewPassword).toBe(true);
        expect(merged?.allowSendResetPasswordMail).toBe(false);
        expect(merged?.showApprovalToggle).toBe(true);
    });
});

describe('Edit credentials flag (was dropped on every read)', () => {
    it('keeps a saved grant for a teacher / custom role, and a saved revoke for admin', () => {
        const granted = { learnerManagement: { allowEditCredentials: true } } as never;
        expect(mergeDisplayWithDefaults(granted, TEACHER_DISPLAY_SETTINGS_KEY).learnerManagement?.allowEditCredentials).toBe(true);
        const revoked = { learnerManagement: { allowEditCredentials: false } } as never;
        expect(mergeDisplayWithDefaults(revoked, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement?.allowEditCredentials).toBe(false);
    });

    it('falls back to the role default when never saved (admin on, teacher off) — as before', () => {
        expect(mergeDisplayWithDefaults({}, ADMIN_DISPLAY_SETTINGS_KEY).learnerManagement?.allowEditCredentials).toBe(true);
        expect(mergeDisplayWithDefaults({}, TEACHER_DISPLAY_SETTINGS_KEY).learnerManagement?.allowEditCredentials).toBe(false);
    });
});

describe('what can be deleted', () => {
    it('only offline / manual payments that are paid or voided', () => {
        expect(isDeletablePayment('MANUAL', 'PAID')).toBe(true);
        expect(isDeletablePayment('OFFLINE', 'VOIDED')).toBe(true);
        expect(isDeletablePayment('RAZORPAY', 'PAID')).toBe(false);
        expect(isDeletablePayment('MANUAL', 'PAYMENT_PENDING')).toBe(false);
    });
});

describe('confirmation', () => {
    it('cannot be confirmed until DELETE is typed', () => {
        render(
            <QueryClientProvider client={new QueryClient()}>
                <PermanentDeleteDialog
                    target={{ kind: 'payment', id: 'pl-1', label: '₹10,000' }}
                    onOpenChange={() => {}}
                />
            </QueryClientProvider>
        );
        const confirm = screen.getByRole('button', { name: 'permanentDelete.confirm' });
        expect(confirm.hasAttribute('disabled')).toBe(true);

        fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'delete' } });
        expect(confirm.hasAttribute('disabled')).toBe(false);
    });
});
