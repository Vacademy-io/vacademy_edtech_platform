import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { fetchOrders } from '@/routes/commerce/orders/-shared/order-api';
import { fetchCustomer, fetchCustomers } from './customer-api';
import { isCustomersApiMissing } from './customer-logic';
import type { CustomerListFilters } from './customer-types';

const LIST_STALE_MS = 30 * 1000;
const root = () => ['commerce', getInstituteId() ?? 'none'] as const;

export const customerKeys = {
    all: () => [...root(), 'customers'] as const,
    list: (filters: CustomerListFilters) => [...root(), 'customers', 'list', filters] as const,
    detail: (id: string) => [...root(), 'customers', 'detail', id] as const,
    orders: (phone: string) => [...root(), 'customers', 'orders', phone] as const,
};

const isOn = (enabled: boolean | undefined) => enabled !== false && !!getInstituteId();

/** A missing route (404/405) is not retried: the screen shows "coming soon". */
const retryUnlessMissing = (count: number, error: unknown) => !isCustomersApiMissing(error) && count < 2;

export const useCustomers = (filters: CustomerListFilters, enabled?: boolean) =>
    useQuery({
        queryKey: customerKeys.list(filters),
        queryFn: () => fetchCustomers(filters),
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
        placeholderData: (previous) => previous,
        retry: retryUnlessMissing,
    });

export const useCustomer = (customerId: string | null | undefined, enabled?: boolean) =>
    useQuery({
        queryKey: customerKeys.detail(customerId ?? ''),
        queryFn: () => fetchCustomer(customerId as string),
        enabled: isOn(enabled) && !!customerId,
        staleTime: LIST_STALE_MS,
        retry: retryUnlessMissing,
    });

/** The customer's orders: the order list searched by phone (no customer filter on the server). */
export const useCustomerOrders = (phone: string | null | undefined, enabled?: boolean) =>
    useQuery({
        queryKey: customerKeys.orders(phone ?? ''),
        queryFn: () => fetchOrders({ search: phone as string, page: 0, pageSize: 20 }),
        enabled: isOn(enabled) && !!phone,
        staleTime: LIST_STALE_MS,
    });
