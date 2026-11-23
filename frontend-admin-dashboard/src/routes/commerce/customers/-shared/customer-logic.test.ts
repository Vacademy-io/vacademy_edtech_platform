/** F12: the customers screens' query parameters and answer normalisation (backend B2). */
import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import {
    customerListParams,
    isCustomerNotFound,
    isCustomersApiMissing,
    normalizeCustomerPage,
    normalizeCustomerProfile,
} from './customer-logic';

const failure = (status: number, message = 'x') =>
    new AxiosError('failed', 'ERR', undefined, undefined, {
        status,
        data: { message },
        headers: {},
        statusText: '',
        config: {} as never,
    } as never);

describe('customerListParams', () => {
    it('trims and cuts the search, clamps page and size', () => {
        expect(customerListParams({ search: '  +91 98765 43210 ', page: 2, pageSize: 20 })).toEqual({
            search: '+91 98765 43210',
            page: 2,
            pageSize: 20,
        });
        expect(customerListParams({ search: 'a'.repeat(80) }).search).toHaveLength(64);
        expect(customerListParams({ page: -3, pageSize: 500 })).toEqual({ page: 0, pageSize: 50 });
        expect(customerListParams({ pageSize: 0 })).toEqual({ page: 0, pageSize: 1 });
        expect(customerListParams({ search: '   ' })).toEqual({ page: 0, pageSize: 50 });
    });
});

describe('a server without the customers API', () => {
    it('404 or 405 on the list means "not available", other failures do not', () => {
        expect(isCustomersApiMissing(failure(404))).toBe(true);
        expect(isCustomersApiMissing(failure(405))).toBe(true);
        expect(isCustomersApiMissing(failure(403, 'ROLE_NOT_ALLOWED: no'))).toBe(false);
        expect(isCustomersApiMissing(failure(500))).toBe(false);
        expect(isCustomersApiMissing(new Error('x'))).toBe(false);
        expect(isCustomerNotFound(failure(404, 'CUSTOMER_NOT_FOUND: no such customer'))).toBe(true);
    });
});

describe('normalisation', () => {
    it('list rows: string money becomes numbers, missing fields get defaults', () => {
        const page = normalizeCustomerPage({
            customers: [
                {
                    id: 'c-1',
                    name: 'Test Customer',
                    phone: '+919000000001',
                    orders_count: 3,
                    total_spent: '1300.00',
                    dues: '500.00',
                    last_order_at: '2026-11-10T10:00:00Z',
                    cod_refusals: 1,
                    marketing_consent: true,
                },
                { id: 'c-2' },
                { name: 'no id is dropped' },
            ],
            page: 0,
            page_size: 50,
            total: 2,
        });
        expect(page.total).toBe(2);
        expect(page.customers).toHaveLength(2);
        expect(page.customers[0]).toMatchObject({
            total_spent: 1300,
            dues: 500,
            orders_count: 3,
            marketing_consent: true,
            anonymised: false,
        });
        expect(page.customers[1]).toMatchObject({
            name: null,
            email: null,
            orders_count: 0,
            total_spent: 0,
            dues: 0,
            cod_refusals: 0,
            marketing_consent: false,
            last_order_at: null,
        });
    });

    it('an empty or odd answer is an empty page', () => {
        expect(normalizeCustomerPage(null)).toEqual({ customers: [], page: 0, page_size: 50, total: 0 });
    });

    it('profile: notes and consent inside customer, addresses at the top level', () => {
        const profile = normalizeCustomerProfile({
            customer: {
                id: 'c-1',
                name: 'Test Customer',
                dues: 0,
                notes: 'Calls after 6 pm',
                consent_at: '2026-11-01T09:00:00Z',
                consent_source: 'CHECKOUT',
            },
            addresses: [
                {
                    id: 'a-1',
                    label: 'Home',
                    line1: '1 Test Street',
                    city: 'Test City',
                    state_code: '27',
                    pincode: '100001',
                    is_default: true,
                },
            ],
        });
        expect(profile.customer).toMatchObject({
            notes: 'Calls after 6 pm',
            consent_at: '2026-11-01T09:00:00Z',
            consent_source: 'CHECKOUT',
        });
        expect(profile.addresses).toEqual([
            {
                id: 'a-1',
                label: 'Home',
                name: null,
                phone: null,
                line1: '1 Test Street',
                line2: null,
                landmark: null,
                city: 'Test City',
                state_code: '27',
                pincode: '100001',
                is_default: true,
            },
        ]);
        expect(normalizeCustomerProfile({ customer: { id: 'c-2' } }).addresses).toEqual([]);
    });
});
