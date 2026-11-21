import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import {
    fetchCreditNotes,
    fetchOrder,
    fetchOrders,
    fetchRemittances,
    fetchReturn,
    recordRemittance,
} from './order-api';
import { readOrderError } from './order-errors';
import { type OrderFilters, listParams } from './order-queues';
import type { RemittanceBody, StaffOrderDetail } from './order-types';

/**
 * TanStack Query bindings of the order desk. Keys start with the institute;
 * every write answers the order detail, which replaces the cached detail at once
 * (new buttons appear without a reload) and refreshes lists and counts.
 * Every read takes `enabled` so a role that may not read fires no request.
 */

const LIST_STALE_MS = 30 * 1000;
const DETAIL_STALE_MS = 10 * 1000;
export const COUNT_REFRESH_MS = 60 * 1000;

const root = () => ['commerce', getInstituteId() ?? 'none'] as const;

export const orderKeys = {
    all: () => [...root(), 'orders'] as const,
    list: (filters: OrderFilters) => [...root(), 'orders', 'list', filters] as const,
    count: (queue: string) => [...root(), 'orders', 'count', queue] as const,
    detail: (orderId: string) => [...root(), 'orders', 'detail', orderId] as const,
    search: (text: string, queue: string | null) => [...root(), 'orders', 'search', text, queue] as const,
    returnView: (returnId: string) => [...root(), 'returns', returnId] as const,
    creditNotes: (invoiceId: string) => [...root(), 'credit-notes', invoiceId] as const,
    remittances: (filters: object) => [...root(), 'remittances', filters] as const,
};

const isOn = (enabled: boolean | undefined) => enabled !== false && !!getInstituteId();

export const useOrderList = (filters: OrderFilters, enabled?: boolean) =>
    useQuery({
        queryKey: orderKeys.list(filters),
        queryFn: () => fetchOrders(listParams(filters)),
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
        placeholderData: (previous) => previous,
    });

/** No count route (G3): one `pageSize=1` read per tab, its `total`. */
export const useQueueCount = (serverQueue: string, enabled?: boolean) =>
    useQuery({
        queryKey: orderKeys.count(serverQueue),
        queryFn: async () => (await fetchOrders({ queue: serverQueue, page: 0, pageSize: 1 })).total,
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
        refetchInterval: COUNT_REFRESH_MS,
        refetchIntervalInBackground: false,
        retry: false,
    });

export const useOrderDetail = (orderId: string | null | undefined, enabled?: boolean) =>
    useQuery({
        queryKey: orderKeys.detail(orderId ?? ''),
        queryFn: () => fetchOrder(orderId as string),
        enabled: isOn(enabled) && !!orderId,
        staleTime: DETAIL_STALE_MS,
        retry: (count, error) => {
            const status = readOrderError(error).status;
            return status !== 404 && status !== 403 && count < 2;
        },
    });

export const useReturnView = (returnId: string | null | undefined, enabled?: boolean) =>
    useQuery({
        queryKey: orderKeys.returnView(returnId ?? ''),
        queryFn: () => fetchReturn(returnId as string),
        enabled: isOn(enabled) && !!returnId,
        staleTime: DETAIL_STALE_MS,
    });

export const useCreditNotes = (invoiceId: string | null | undefined, enabled?: boolean) =>
    useQuery({
        queryKey: orderKeys.creditNotes(invoiceId ?? ''),
        queryFn: () => fetchCreditNotes(invoiceId as string),
        enabled: isOn(enabled) && !!invoiceId,
        staleTime: LIST_STALE_MS,
    });

export const useRemittances = (
    filters: { from?: string; to?: string; page?: number; pageSize?: number },
    enabled?: boolean
) =>
    useQuery({
        queryKey: orderKeys.remittances(filters),
        queryFn: () => fetchRemittances(filters),
        enabled: isOn(enabled),
        staleTime: LIST_STALE_MS,
        placeholderData: (previous) => previous,
    });

/** Lists, counts and details of every order are stale after a write. */
export const invalidateOrders = (queryClient: QueryClient) =>
    queryClient.invalidateQueries({ queryKey: orderKeys.all() });

/** A write's answer replaces the cached detail; everything else refetches. */
export function applyDetail(queryClient: QueryClient, detail: StaffOrderDetail) {
    if (detail.order.id) queryClient.setQueryData(orderKeys.detail(detail.order.id), detail);
    void queryClient.invalidateQueries({
        queryKey: orderKeys.all(),
        predicate: (query) => !(query.queryKey[3] === 'detail' && query.queryKey[4] === detail.order.id),
    });
}

/**
 * A write that answers the order detail. 409 and 403 refetch too: the screen
 * then shows the server's current `next_actions`.
 */
export function useOrderWrite<TVars>(write: (vars: TVars) => Promise<StaffOrderDetail>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: write,
        onSuccess: (detail) => applyDetail(queryClient, detail),
        onError: (error) => {
            const status = readOrderError(error).status;
            if (status === 409 || status === 403) void invalidateOrders(queryClient);
        },
    });
}

export const useRecordRemittance = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: RemittanceBody) => recordRemittance(body),
        onSuccess: () => {
            void invalidateOrders(queryClient);
            void queryClient.invalidateQueries({ queryKey: [...root(), 'remittances'] });
        },
        onError: (error) => {
            const status = readOrderError(error).status;
            if (status === 409 || status === 403) void invalidateOrders(queryClient);
        },
    });
};
