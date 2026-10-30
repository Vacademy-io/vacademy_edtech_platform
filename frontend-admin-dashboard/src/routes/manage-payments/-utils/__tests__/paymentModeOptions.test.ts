import { describe, expect, it } from 'vitest';
import type { OfflinePaymentModes } from '@/services/offline-payment-modes';
import { buildPaymentModeOptions } from '../paymentModeOptions';

const settings: OfflinePaymentModes = {
    require_mode: false,
    default_mode: 'CASH',
    modes: [
        { code: 'CASH', label: 'Cash', active: true },
        {
            code: 'UPI',
            label: 'UPI',
            active: true,
            sub_modes: [
                { code: 'PHONEPE', label: 'PhonePe', active: true },
                { code: 'PAYTM', label: 'Paytm', active: false },
            ],
        },
        // A custom mode an institute added itself.
        { code: 'BRANCH_COUNTER', label: 'Branch counter', active: true },
        { code: 'DD', label: 'Demand draft', active: false },
    ],
};

describe('buildPaymentModeOptions', () => {
    it('lists every active mode from Settings, custom ones included, with their active options', () => {
        expect(buildPaymentModeOptions(settings, [])).toEqual([
            { value: 'CASH', label: 'Cash' },
            { value: 'UPI', label: 'UPI' },
            { value: 'UPI|PHONEPE', label: 'UPI · PhonePe' },
            { value: 'BRANCH_COUNTER', label: 'Branch counter' },
        ]);
    });

    it('keeps modes and options found on payments even when Settings no longer offers them', () => {
        const options = buildPaymentModeOptions(settings, [
            { mode: 'UPI', sub_mode: 'PAYTM', mode_label: 'UPI', sub_mode_label: 'Paytm' },
            { mode: 'DD', sub_mode: null, mode_label: 'DD (old name)', sub_mode_label: null },
            { mode: 'OLD_WALLET', sub_mode: null, mode_label: null, sub_mode_label: null },
            { mode: 'CASH', sub_mode: null, mode_label: 'Cash', sub_mode_label: null },
        ]);
        expect(options).toEqual([
            { value: 'CASH', label: 'Cash' },
            { value: 'UPI', label: 'UPI' },
            { value: 'UPI|PHONEPE', label: 'UPI · PhonePe' },
            // A switched-off option sits under its own mode, not at the end.
            { value: 'UPI|PAYTM', label: 'UPI · Paytm' },
            { value: 'BRANCH_COUNTER', label: 'Branch counter' },
            // Switched off in Settings: the Settings label wins over the recorded one.
            { value: 'DD', label: 'Demand draft' },
            // Deleted from Settings and recorded with no label: named from its code.
            { value: 'OLD_WALLET', label: 'Old Wallet' },
        ]);
    });

    it('still offers recorded modes while Settings is loading', () => {
        expect(
            buildPaymentModeOptions(undefined, [
                { mode: 'CHEQUE', sub_mode: null, mode_label: 'Cheque', sub_mode_label: null },
            ])
        ).toEqual([{ value: 'CHEQUE', label: 'Cheque' }]);
    });
});
