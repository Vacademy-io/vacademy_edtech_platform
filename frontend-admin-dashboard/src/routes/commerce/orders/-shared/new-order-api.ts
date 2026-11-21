import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import { COMMERCE_CUSTOMERS } from '@/routes/commerce/-shared/commerce-urls';

/**
 * The one customer read the new order page makes: "is this phone a known
 * customer?". Backend B2 may not be deployed yet; a 404/405 then means "no
 * lookup", never an error on the form.
 */
export interface KnownCustomer {
    name: string | null;
    ordersCount: number;
}

export type CustomerLookup = { available: false } | { available: true; customer: KnownCustomer | null };

export async function lookupCustomer(phone: string): Promise<CustomerLookup> {
    try {
        const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_CUSTOMERS, {
            params: { ...instituteParams(), search: phone, page: 0, pageSize: 1 },
        });
        const list = asRecord(res.data)?.customers;
        const first = Array.isArray(list) ? asRecord(list[0]) : null;
        return {
            available: true,
            customer: first ? { name: str(first.name), ordersCount: num(first.orders_count) ?? 0 } : null,
        };
    } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404 || status === 405) return { available: false };
        throw error;
    }
}
