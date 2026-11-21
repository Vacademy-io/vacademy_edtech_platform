/** WP-44 FA4: return create, return receive, RTO receive and cancel line take lengths without rounding. */
import { describe, expect, it } from 'vitest';
import { localeT } from '@/routes/commerce/-shared/en-t';
import { cancelStartText, conditionLabel, conditionSplit, returnRequestLines, typedQuantity, wholeText } from './length-entry';

const en = localeT('en');
const cloth = { id: 'line-c', qty_scale: 10 };
const bottle = { id: 'line-b', qty_scale: 1 };

describe('typed lengths in the order dialogs', () => {
    it('return create: "1.25" is refused, "1.2" sends 12', () => {
        expect(typedQuantity('1.25', 10)).toEqual({ problem: 'decimals' });
        expect(returnRequestLines([cloth, bottle], { 'line-c': '1.25', 'line-b': '1' })).toEqual([
            { order_line_id: 'line-b', quantity: 1 },
        ]);
        expect(returnRequestLines([cloth, bottle], { 'line-c': '1.2', 'line-b': '' })).toEqual([
            { order_line_id: 'line-c', quantity: 12 },
        ]);
        expect(typedQuantity('', 10)).toEqual({ stored: 0 });
    });

    it('return and RTO receive: resaleable + damaged add up exactly, refused boxes say why', () => {
        expect(conditionSplit({ resaleable: '1.2', damaged: '0' }, 10, 12)).toEqual({ good: 12, bad: 0 });
        expect(conditionSplit({ resaleable: '1', damaged: '0.2' }, 10, 12)).toEqual({ good: 10, bad: 2 });
        expect(conditionSplit({ resaleable: '1.25', damaged: '0' }, 10, 12)).toEqual({ problem: 'decimals' });
        expect(conditionSplit({ resaleable: '1', damaged: '0' }, 10, 12)).toEqual({ problem: 'sum' });
        expect(wholeText(34, 10)).toBe('3.4');
    });

    it('cancel line opens at the whole open length for a measured line (D8), at 1 for counted goods', () => {
        expect(cancelStartText(cloth, 34)).toBe('3.4');
        expect(cancelStartText(bottle, 3)).toBe('1');
        expect(cancelStartText(null, 0)).toBe('1');
    });

    it('labels carry the unit for measured lines', () => {
        expect(conditionLabel('resaleable', 10, 'MTR', en)).toBe('Can be sold again (in m)');
        expect(conditionLabel('damaged', 1, null, en)).toBe('Damaged');
    });
});
