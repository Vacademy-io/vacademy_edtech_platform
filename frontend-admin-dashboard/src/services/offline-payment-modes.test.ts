import { describe, expect, it } from 'vitest';
import {
    activeCustomFields,
    initialOfflinePaymentDetails,
    offlinePaymentDetailsError,
    readRecordedPaymentDetails,
    toOfflinePaymentDetailsPayload,
    type OfflinePaymentModes,
} from './offline-payment-modes';

// Mirrors OfflinePaymentDetailsService on the backend: the dialogs block what it would reject.
const modes: OfflinePaymentModes = {
    require_mode: false,
    default_mode: 'CASH',
    modes: [
        { code: 'CASH', label: 'Cash', active: true },
        { code: 'CHEQUE', label: 'Cheque', active: true, reference_required: true },
        { code: 'BANK_TRANSFER', label: 'Bank transfer', active: true, proof_required: true },
        { code: 'DD', label: 'Demand draft', active: false },
    ],
};

describe('offline payment details', () => {
    it('preselects the default mode', () => {
        expect(initialOfflinePaymentDetails(modes)).toEqual({ mode: 'CASH' });
    });

    it('needs a mode only when the institute requires one', () => {
        expect(offlinePaymentDetailsError({}, modes)).toBeNull();
        expect(offlinePaymentDetailsError({}, { ...modes, require_mode: true })).toBe('errors.modeRequired');
        expect(offlinePaymentDetailsError({ mode: 'DD' }, { ...modes, require_mode: true })).toBe('errors.modeRequired');
    });

    it('enforces a mode’s required reference and proof', () => {
        expect(offlinePaymentDetailsError({ mode: 'CHEQUE' }, modes)).toBe('errors.referenceRequired');
        expect(offlinePaymentDetailsError({ mode: 'CHEQUE', reference: ' 000123 ' }, modes)).toBeNull();
        expect(offlinePaymentDetailsError({ mode: 'BANK_TRANSFER' }, modes)).toBe('errors.proofRequired');
        expect(offlinePaymentDetailsError({ mode: 'BANK_TRANSFER', proof_file_id: 'f1' }, modes)).toBeNull();
    });

    it('drops empty fields and returns null when nothing was given', () => {
        expect(toOfflinePaymentDetailsPayload({})).toBeNull();
        expect(toOfflinePaymentDetailsPayload({ mode: null, reference: '  ', extra: { bank_name: '' } })).toBeNull();
        expect(
            toOfflinePaymentDetailsPayload({ mode: 'UPI', sub_mode: 'PHONEPE', reference: ' R1 ', extra: { bank_name: '', payer_name: 'A' } })
        ).toEqual({
            mode: 'UPI',
            sub_mode: 'PHONEPE',
            reference: 'R1',
            payment_date: null,
            notes: null,
            proof_file_id: null,
            extra: { payer_name: 'A' },
        });
        // An option without its mode is never sent.
        expect(toOfflinePaymentDetailsPayload({ sub_mode: 'PHONEPE', reference: 'R' })?.sub_mode).toBeNull();
    });
});

describe('custom fields and account dropdown', () => {
    const cheque: OfflinePaymentModes = {
        require_mode: true,
        modes: [
            {
                code: 'CHEQUE',
                label: 'Cheque',
                active: true,
                extra_fields: ['bank_name'],
                required_extra_fields: ['bank_name'],
                sub_mode_label: 'Account',
                sub_mode_required: true,
                sub_modes: [{ code: 'ACC_A', label: 'Account A', active: true }],
                custom_fields: [
                    { key: 'cheque_status', label: 'Cheque Status', type: 'SELECT', required: true, active: true, options: ['Pending', 'Cleared'] },
                    { key: 'branch', label: 'Branch', type: 'TEXT', required: false, active: true },
                    { key: 'old', label: 'Old', type: 'TEXT', required: true, active: false },
                ],
            },
            { code: 'CASH', label: 'Cash', active: true, sub_mode_required: true, sub_modes: [{ code: 'X', label: 'X', active: false }] },
        ],
    };
    const filled = { mode: 'CHEQUE', sub_mode: 'ACC_A', extra: { bank_name: 'B' }, custom: { cheque_status: 'Pending' } };

    it('requires the account, required extras and required custom fields', () => {
        expect(offlinePaymentDetailsError(filled, cheque)).toBeNull();
        expect(offlinePaymentDetailsError({ ...filled, sub_mode: null }, cheque)).toBe('errors.subModeRequired');
        expect(offlinePaymentDetailsError({ ...filled, extra: { bank_name: ' ' } }, cheque)).toBe('errors.fieldRequired');
        expect(offlinePaymentDetailsError({ ...filled, custom: {} }, cheque)).toBe('errors.fieldRequired');
    });

    it('ignores a required account when the mode has no active options, and switched-off fields', () => {
        expect(offlinePaymentDetailsError({ mode: 'CASH' }, cheque)).toBeNull();
        expect(activeCustomFields(cheque.modes[0]).map((f) => f.key)).toEqual(['cheque_status', 'branch']);
    });

    it('sends custom values only with a mode, blanks dropped', () => {
        expect(toOfflinePaymentDetailsPayload({ ...filled, custom: { cheque_status: 'Pending', branch: ' ' } })?.custom).toEqual({
            cheque_status: 'Pending',
        });
        expect(toOfflinePaymentDetailsPayload({ mode: null, custom: { branch: 'X' } })).toBeNull();
    });

    it('reads recorded custom values with their labels; older payments have none', () => {
        const recorded = readRecordedPaymentDetails({
            payment_mode: 'CHEQUE',
            payment_details_json: JSON.stringify({
                mode_label: 'Cheque',
                sub_mode_label: 'Account A',
                bank_name: 'B',
                custom_fields: [{ key: 'cheque_status', label: 'Cheque Status', value: 'Cleared' }],
            }),
        });
        expect(recorded?.label).toBe('Cheque · Account A');
        expect(recorded?.extra).toEqual({ bank_name: 'B' });
        expect(recorded?.custom).toEqual([{ key: 'cheque_status', label: 'Cheque Status', value: 'Cleared' }]);
        expect(readRecordedPaymentDetails({ payment_mode: 'CASH', payment_details_json: '{"mode_label":"Cash"}' })?.custom).toEqual([]);
    });
});
