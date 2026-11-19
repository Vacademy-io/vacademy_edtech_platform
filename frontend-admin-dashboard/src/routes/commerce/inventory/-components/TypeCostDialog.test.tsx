/** WP-44 FA6 / D13: unit cost is typed per metre and sent per 10 cm with 4 decimals; nothing is rounded. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

import type { ReceiptLine } from '../-shared/inventory-types';
import { costLines } from './TypeCostDialog';

const line = (id: string, qty_scale: number): ReceiptLine =>
    ({ id, qty_scale, unit: qty_scale > 1 ? 'MTR' : 'PCS', qty_received: 100, unit_cost: null, pieces: [] }) as unknown as ReceiptLine;

const receipt = { lines: [line('cloth', 10), line('bottle', 1)] };

describe('costLines', () => {
    it('"80.00" a metre sends 8.0000; a bottle sends its cost as typed', () => {
        expect(costLines(receipt, { cloth: '80.00', bottle: '45.5' })).toEqual({
            lines: [
                { line_id: 'cloth', unit_cost: '8.0000' },
                { line_id: 'bottle', unit_cost: '45.5000' },
            ],
        });
    });

    it('a per-metre cost that does not fit 4 decimals per 10 cm is refused (at most 3 per metre)', () => {
        expect(costLines(receipt, { cloth: '80.0005' })).toEqual({ problemLineId: 'cloth', decimals: 3 });
        expect(costLines(receipt, { cloth: '80.005' })).toEqual({ lines: [{ line_id: 'cloth', unit_cost: '8.0005' }] });
        expect(costLines(receipt, { cloth: 'abc' })).toEqual({ problemLineId: 'cloth', decimals: null });
        expect(costLines(receipt, { cloth: ' ' })).toEqual({ problemLineId: null, decimals: null });
    });
});
