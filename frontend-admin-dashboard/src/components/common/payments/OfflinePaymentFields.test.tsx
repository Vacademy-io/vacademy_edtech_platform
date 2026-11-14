import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OfflinePaymentDetails, OfflinePaymentModes } from '@/services/offline-payment-modes';
import { OfflinePaymentFields } from './OfflinePaymentFields';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/upload_file', () => ({ UploadFileInS3: vi.fn() }));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'u' }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'i' }));

const modes: OfflinePaymentModes = {
    require_mode: true,
    default_mode: 'CHEQUE',
    modes: [
        { code: 'CASH', label: 'Cash', active: true },
        {
            code: 'CHEQUE',
            label: 'Cheque',
            active: true,
            reference_label: 'Cheque/DD No.',
            extra_fields: ['bank_name'],
            required_extra_fields: ['bank_name'],
            sub_mode_label: 'Account',
            sub_mode_required: true,
            sub_modes: [
                { code: 'ACC_A', label: 'Account A', active: true },
                { code: 'ACC_B', label: 'Account B', active: true },
            ],
            custom_fields: [
                { key: 'cheque_status', label: 'Cheque Status', type: 'SELECT', required: true, active: true, options: ['Pending', 'Cleared'] },
                { key: 'branch', label: 'Bank Branch Name', type: 'TEXT', active: true },
                { key: 'txn_date', label: 'Transaction Date', type: 'DATE', active: true },
                { key: 'old', label: 'Retired field', type: 'TEXT', active: false },
            ],
        },
    ],
};

// Branch-style numbering field: asked for plan-new (no value yet), not for plan-pinned.
vi.mock('@/services/numbering-field', () => ({
    useNumberingField: (target: { userPlanId?: string | null } | null | undefined) => ({
        data: !target
            ? undefined
            : target.userPlanId === 'plan-pinned'
              ? { ask: false, required: true, options: ['Branch A', 'Branch B'], value: 'Branch A', label: 'Branch' }
              : { ask: true, required: true, options: ['Branch A', 'Branch B'], suggested: 'branch b', label: 'Branch' },
    }),
}));

vi.mock('@/services/offline-payment-modes', async (importActual) => ({
    ...(await importActual<typeof import('@/services/offline-payment-modes')>()),
    useOfflinePaymentModes: () => ({ data: modes, isLoading: false }),
}));

const Harness = ({
    initial,
    numbering,
}: {
    initial: OfflinePaymentDetails;
    numbering?: { userPlanId?: string | null; userId?: string | null };
}) => {
    const [value, setValue] = useState<OfflinePaymentDetails>(initial);
    return <OfflinePaymentFields value={value} onChange={setValue} numbering={numbering} />;
};

describe('OfflinePaymentFields', () => {
    it('shows mode and account as dropdowns, not chips, with the mode’s own fields', () => {
        render(<Harness initial={{}} />);
        // mode, account, cheque status
        expect(screen.getAllByRole('combobox')).toHaveLength(3);
        expect(screen.queryAllByRole('radio')).toHaveLength(0);
        expect(screen.getByRole('combobox', { name: 'Account' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Cheque Status' })).toBeTruthy();
        expect(screen.getByText('Cheque/DD No.')).toBeTruthy();
        expect(screen.getByText('Bank Branch Name')).toBeTruthy();
        expect(screen.getByText('Transaction Date')).toBeTruthy();
        expect(screen.queryByText('Retired field')).toBeNull();
        // default mode preselected; the account is still missing
        expect(screen.getByRole('combobox', { name: 'modeLabel' }).textContent).toContain('Cheque');
        expect(screen.getByRole('alert').textContent).toBe('errors.subModeRequired');
    });

    it('clears the error once everything required is filled', () => {
        render(
            <Harness
                initial={{ mode: 'CHEQUE', sub_mode: 'ACC_B', extra: { bank_name: 'B' }, custom: { cheque_status: 'Cleared' } }}
            />
        );
        expect(screen.getByRole('combobox', { name: 'Account' }).textContent).toContain('Account B');
        expect(screen.getByRole('combobox', { name: 'Cheque Status' }).textContent).toContain('Cleared');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a mode without options shows no account dropdown or extra fields', () => {
        render(<Harness initial={{ mode: 'CASH' }} />);
        expect(screen.getAllByRole('combobox')).toHaveLength(1);
        expect(screen.queryByText('Bank Branch Name')).toBeNull();
    });

    it('asks the numbering field on an enrolment\'s first payment, preselecting the learner\'s value', () => {
        render(
            <Harness
                initial={{ mode: 'CASH' }}
                numbering={{ userPlanId: 'plan-new', userId: 'u-1' }}
            />
        );
        const branch = screen.getByRole('combobox', { name: 'Branch' });
        expect(branch.textContent).toContain('Branch B');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('preselects the default mode and the learner\'s branch together', () => {
        render(<Harness initial={{}} numbering={{ userPlanId: 'plan-new', userId: 'u-1' }} />);
        expect(screen.getByRole('combobox', { name: 'modeLabel' }).textContent).toContain('Cheque');
        expect(screen.getByRole('combobox', { name: 'Branch' }).textContent).toContain('Branch B');
    });

    it('does not ask again once the enrolment has a value', () => {
        render(<Harness initial={{ mode: 'CASH' }} numbering={{ userPlanId: 'plan-pinned', userId: 'u-1' }} />);
        expect(screen.queryByRole('combobox', { name: 'Branch' })).toBeNull();
    });

    it('without a numbering target nothing is asked (dialogs that do not pass one are unchanged)', () => {
        render(<Harness initial={{ mode: 'CASH' }} />);
        expect(screen.getAllByRole('combobox')).toHaveLength(1);
    });
});
