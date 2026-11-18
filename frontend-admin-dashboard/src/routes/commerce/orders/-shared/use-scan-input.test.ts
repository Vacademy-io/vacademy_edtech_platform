/**
 * Contract §7.4 / §8.3: a label's QR link is read as its code by the shared
 * keyboard-wedge hook and by `scanCode`, and nothing else changes, so the till
 * (POS), the pack station and new order lines keep reading every code as before.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: http.get } }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import { indexCatalogue, lookupCode } from '../../pos/-shared/pos-catalogue';
import type { CatalogueItem } from '../../pos/-shared/pos-types';
import { scanCode } from './order-api';
import { normaliseScannedCode, useScanInput } from './use-scan-input';

describe('normaliseScannedCode', () => {
    it.each([
        ['https://shop.example/q/PABCDEFGH2', 'PABCDEFGH2'],
        ['https://shop.example/store/en/q/VABCDEFGH2', 'VABCDEFGH2'],
        ['https://shop.example/q/PABCDEFGH2/', 'PABCDEFGH2'],
        ['https://shop.example/q/PABCDEFGH2?src=label', 'PABCDEFGH2'],
        ['https://shop.example/q/PABCDEFGH2#top', 'PABCDEFGH2'],
        ['HTTPS://SHOP.EXAMPLE/q/PABCDEFGH2', 'PABCDEFGH2'],
        ['http://shop.example/q/SKU_1-a', 'SKU_1-a'],
        ['  https://shop.example/q/PABCDEFGH2  ', 'PABCDEFGH2'],
    ])('reads %s as %s', (raw, code) => {
        expect(normaliseScannedCode(raw)).toBe(code);
    });

    it.each([
        ['PABCDEFGH2', 'PABCDEFGH2'],
        ['  8901234567890 ', '8901234567890'],
        ['ORD-000123', 'ORD-000123'],
        ['Cotton scarf blue', 'Cotton scarf blue'],
        ['https://shop.example/products/cotton-scarf', 'https://shop.example/products/cotton-scarf'],
        ['https://shop.example/q/', 'https://shop.example/q/'],
        ['https://shop.example/q/two words', 'https://shop.example/q/two words'],
        ['ftp://shop.example/q/PABCDEFGH2', 'ftp://shop.example/q/PABCDEFGH2'],
    ])('leaves %s as %s', (raw, code) => {
        expect(normaliseScannedCode(raw)).toBe(code);
    });
});

describe('useScanInput', () => {
    it('submit passes the code of a QR link, trimmed codes as they are, and drops a bounce', () => {
        const onScan = vi.fn();
        const { result } = renderHook(() => useScanInput(onScan, { autoFocus: false }));
        act(() => result.current.submit('https://shop.example/q/PABCDEFGH2'));
        // The scanner bounce: the same code again within 400 ms, typed as the bare code.
        act(() => result.current.submit('PABCDEFGH2'));
        act(() => result.current.submit('  SKU-1  '));
        expect(onScan.mock.calls).toEqual([['PABCDEFGH2'], ['SKU-1']]);
    });

    it('an empty or too long scan is not passed on', () => {
        const onScan = vi.fn();
        const { result } = renderHook(() => useScanInput(onScan, { autoFocus: false }));
        act(() => result.current.submit('   '));
        act(() => result.current.submit('X'.repeat(101)));
        expect(onScan).not.toHaveBeenCalled();
    });
});

describe('callers keep working', () => {
    beforeEach(() => http.get.mockReset());

    it('pack station and new order lines: scanCode asks the server for the code of a QR link', async () => {
        http.get.mockResolvedValue({
            data: { kind: 'PIECE', variant: { package_session_id: 'ps-1', sku: 'SCARF-1' }, piece: { id: 'pc-1', code: 'PABCDEFGH2' } },
        });
        const found = await scanCode('https://shop.example/q/PABCDEFGH2');
        expect(http.get.mock.calls[0]?.[0]).toMatch(/\/scan\/PABCDEFGH2$/);
        expect(found?.piece?.code).toBe('PABCDEFGH2');
    });

    it('pack station: a plain code, a barcode and an unknown code read as before', async () => {
        http.get.mockResolvedValueOnce({ data: { kind: 'VARIANT', variant: { package_session_id: 'ps-2' } } });
        await scanCode('VABCDEFGH2');
        http.get.mockResolvedValueOnce({ data: { kind: 'VARIANT', variant: { package_session_id: 'ps-2' } } });
        await scanCode('8901234567890');
        http.get.mockRejectedValueOnce({ response: { status: 404 } });
        expect(await scanCode('NOPE')).toBeNull();
        expect(http.get.mock.calls.map((call) => String(call[0]).split('/scan/')[1])).toEqual([
            'VABCDEFGH2',
            '8901234567890',
            'NOPE',
        ]);
    });

    it('till: the cached catalogue finds an item by the code of its QR link, and by SKU or barcode as before', () => {
        const item = {
            variant_id: 'ps-1',
            product_id: 'p-1',
            sku: 'BOTTLE-1',
            label_code: 'VABCDEFGH2',
            barcode: '8901234567890',
            names: { hi: null, en: 'Steel bottle' },
            variant_label: { hi: null, en: null },
        } as unknown as CatalogueItem;
        const index = indexCatalogue([item]);
        expect(lookupCode(index, normaliseScannedCode('https://shop.example/q/VABCDEFGH2'))).toBe(item);
        expect(lookupCode(index, normaliseScannedCode('BOTTLE-1'))).toBe(item);
        expect(lookupCode(index, normaliseScannedCode(' 8901234567890 '))).toBe(item);
        expect(lookupCode(index, normaliseScannedCode('https://shop.example/q/VZZZZZZZZ2'))).toBeNull();
    });
});
