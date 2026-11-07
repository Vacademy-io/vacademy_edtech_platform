import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/offline-payment-modes', () => ({
    useOfflinePaymentModes: () => ({ data: undefined }),
}));

import { receiptDateFieldOptions } from '../InvoiceReceiptDateSection';

describe('receiptDateFieldOptions', () => {
    it('lists each active DATE field once, with the modes that carry it', () => {
        const options = receiptDateFieldOptions({
            modes: [
                {
                    label: 'Wallet A',
                    active: true,
                    custom_fields: [
                        {
                            key: 'transaction_date',
                            label: 'Transaction Date',
                            type: 'DATE',
                            active: true,
                        },
                        { key: 'note', label: 'Note', type: 'TEXT', active: true },
                    ],
                },
                {
                    label: 'Wallet B',
                    active: true,
                    custom_fields: [
                        {
                            key: 'transaction_date',
                            label: 'Transaction Date',
                            type: 'DATE',
                            active: true,
                        },
                    ],
                },
                {
                    label: 'Cheque',
                    active: true,
                    custom_fields: [
                        { key: 'cheque_date', label: 'Cheque Date', type: 'DATE', active: true },
                        { key: 'old_date', label: 'Old', type: 'DATE', active: false },
                        { key: null, label: 'Unsaved', type: 'DATE', active: true },
                    ],
                },
                {
                    label: 'Switched off',
                    active: false,
                    custom_fields: [{ key: 'off_date', label: 'Off', type: 'DATE', active: true }],
                },
            ],
        } as never);
        expect(options).toEqual([
            { key: 'transaction_date', label: 'Transaction Date', modes: ['Wallet A', 'Wallet B'] },
            { key: 'cheque_date', label: 'Cheque Date', modes: ['Cheque'] },
        ]);
    });

    it('is empty without modes', () => {
        expect(receiptDateFieldOptions(undefined)).toEqual([]);
    });
});
