/** Answer reading aligned with the backend build record (R/inv/build-b1.md "For the frontend"). */
import { describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

import { fetchLabelPrintData, normalizeReview, quickAddItem, utcTime } from './inventory-api';

describe('inventory answers', () => {
    it('times without an offset are read as UTC; dates stay dates', () => {
        expect(utcTime('2026-11-18T10:15:30.123')).toBe('2026-11-18T10:15:30.123Z');
        expect(utcTime('2026-11-18T10:15:30Z')).toBe('2026-11-18T10:15:30Z');
        expect(utcTime('2026-11-18T10:15:30+05:30')).toBe('2026-11-18T10:15:30+05:30');
        expect(utcTime('2026-11-18')).toBe('2026-11-18');
        expect(utcTime(null)).toBeNull();
    });

    it('print data: MRP per display unit, Hindi and English names, shop name from its map', async () => {
        http.post.mockResolvedValueOnce({
            data: {
                size: 'STICKER_50X25',
                shop_name: { en: 'The shop', hi: null },
                labels: [
                    {
                        request_id: 'lr-1',
                        code: 'PABCDEFGH2',
                        qr_value: 'https://shop.example/q/PABCDEFGH2',
                        sku: 'SCARF-1',
                        product_name: { en: 'Cotton scarf', hi: 'सूती दुपट्टा' },
                        variant_name: { en: 'Red', hi: null },
                        price: 1200.0,
                        mrp: 1400.0,
                        currency: 'INR',
                        unit: 'PCS',
                        qty_scale: 1,
                        copies: 1,
                        piece_id: 'pc-1',
                    },
                ],
                total_copies: 1,
            },
        });
        const data = await fetchLabelPrintData({ request_ids: ['lr-1'], size: 'STICKER_50X25' });
        expect(http.post.mock.calls[0]?.[1]).toEqual({ request_ids: ['lr-1'], size: 'STICKER_50X25' });
        expect(data.shop_name).toBe('The shop');
        expect(data.labels[0]).toMatchObject({
            code: 'PABCDEFGH2',
            price: 1400,
            product_name: { en: 'Cotton scarf', hi: 'सूती दुपट्टा' },
            variant_name: { en: 'Red', hi: null },
            copies: 1,
        });
    });

    it('quick add: the answer name is the map that was sent', async () => {
        http.post.mockResolvedValueOnce({
            data: { package_session_id: 'ps-1', sku: 'QA-000001', name: { en: 'Canvas bag' }, stock_mode: 'QUANTITY', unit: 'PCS', qty_scale: 1, status: 'DRAFT' },
        });
        const answer = await quickAddItem({
            client_request_id: 'qa-12345678',
            name: { en: 'Canvas bag' },
            unit: 'PCS',
            stock_mode: 'QUANTITY',
            qty_scale: 1,
        });
        expect(answer.name).toBe('Canvas bag');
    });

    it('review: piece lines with null quantities read as numbers; recount agreement read from the summary', () => {
        const review = normalizeReview({
            count_id: 'c-1',
            lines: [{ line_id: 'l-p', package_session_id: 'ps-s', piece_code: 'P1', counted_qty: 1, on_hand_now: null, adjustment: 1 }],
            found_pieces: [{ piece_id: 'pc-1', code: 'P1' }],
        });
        expect(review.lines[0]).toMatchObject({ piece_code: 'P1', on_hand_now: 0, adjustment: 1 });
        expect(review.pieces.found_pieces).toHaveLength(1);
    });
});
