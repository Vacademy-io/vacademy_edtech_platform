import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import {
    addCashMovement,
    changeTender,
    closeSession,
    createBillBook,
    createBillBookEntry,
    createPosReturn,
    createRegister,
    createSale,
    fetchApprovers,
    fetchCatalogue,
    fetchDocumentSeries,
    fetchPosSettings,
    fetchRegisters,
    fetchRegisterSession,
    fetchSale,
    fetchSession,
    fetchSessions,
    fetchSessionSales,
    openSession,
    previewPosReturn,
    quoteBill,
    savePosSettings,
    type SessionFilters,
    updateRegister,
    voidSale,
} from './pos-api';
import type { QuoteRequest } from './pos-types';

/**
 * TanStack Query bindings for the billing counter. Keys start
 * `['commerce', inst, 'pos', …]`; every write invalidates that whole branch.
 * Every read is held back until the person's access is known and opens the
 * counter (`canOpen('commerce-pos')`), so someone without the module or the
 * role fires no request at all (contract §7.1, §9).
 */

const root = () => ['commerce', getInstituteId() ?? 'none', 'pos'] as const;

export const posKeys = {
    all: () => root(),
    registers: () => [...root(), 'registers'] as const,
    registerSession: (registerId: string) => [...root(), 'register-session', registerId] as const,
    catalogue: (registerId: string) => [...root(), 'catalogue', registerId] as const,
    catalogueSearch: (registerId: string, q: string) => [...root(), 'catalogue-search', registerId, q] as const,
    session: (sessionId: string) => [...root(), 'session', sessionId] as const,
    sessions: (filters: SessionFilters) => [...root(), 'sessions', filters] as const,
    sessionSales: (sessionId: string, page: number) => [...root(), 'session-sales', sessionId, page] as const,
    sale: (orderId: string) => [...root(), 'sale', orderId] as const,
    approvers: (registerId: string) => [...root(), 'approvers', registerId] as const,
    settings: () => [...root(), 'settings'] as const,
    quote: (body: QuoteRequest | null) => [...root(), 'quote', body] as const,
    series: () => [...root(), 'document-series'] as const,
};

/** Catalogue reads: a write leaves them (a bill does not change the price list). */
const CATALOGUE_PARTS: ReadonlySet<unknown> = new Set(['catalogue', 'catalogue-search']);

/**
 * After a write: everything of the counter except the catalogue, which is up to 5,000 items and
 * would otherwise be fetched again (and written to this device's copy) after every bill. The
 * catalogue refreshes on its own timer, on window focus, and when a scan finds a code the copy
 * does not have.
 */
export const isCatalogueKey = (queryKey: readonly unknown[]): boolean => CATALOGUE_PARTS.has(queryKey[3]);

export const invalidatePos = (client: QueryClient) =>
    client.invalidateQueries({ queryKey: posKeys.all(), predicate: (query) => !isCatalogueKey(query.queryKey) });

/** The counter's own gate: resolved, module on, role allowed. */
export function usePosAllowed(): boolean {
    const access = useCommerceAccess();
    return access.isResolved && access.canOpen('commerce-pos');
}

/** Manager screens (P7–P9): the counter gate plus store manager or admin. */
export function usePosManagerAllowed(): boolean {
    const access = useCommerceAccess();
    return access.isResolved && access.canOpen('commerce-pos') && access.isManager;
}

const on = (allowed: boolean, extra = true) => allowed && extra && !!getInstituteId();

const CATALOGUE_STALE_MS = 10 * 60 * 1000;

// ───────────────────────── Reads ─────────────────────────

export function useRegisters(enabled = true) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.registers(),
        queryFn: () => fetchRegisters(),
        enabled: on(allowed, enabled),
        staleTime: 15_000,
    });
}

export function useRegisterSession(registerId: string | null) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.registerSession(registerId ?? ''),
        queryFn: () => fetchRegisterSession(registerId as string),
        enabled: on(allowed, !!registerId),
    });
}

export function useCatalogue(registerId: string | null) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.catalogue(registerId ?? ''),
        queryFn: () => fetchCatalogue(registerId as string),
        enabled: on(allowed, !!registerId),
        staleTime: CATALOGUE_STALE_MS,
        refetchInterval: CATALOGUE_STALE_MS,
        refetchOnWindowFocus: true,
    });
}

/** Server search, only when the catalogue was too big to send whole (`truncated`). */
export function useCatalogueSearch(registerId: string | null, q: string, enabled: boolean) {
    const allowed = usePosAllowed();
    const text = q.trim();
    return useQuery({
        queryKey: posKeys.catalogueSearch(registerId ?? '', text),
        queryFn: () => fetchCatalogue(registerId as string, text),
        enabled: on(allowed, enabled && !!registerId && text.length >= 2 && text.length <= 64),
        staleTime: 60_000,
    });
}

export function useSession(sessionId: string | null) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.session(sessionId ?? ''),
        queryFn: () => fetchSession(sessionId as string),
        enabled: on(allowed, !!sessionId),
        staleTime: 10_000,
    });
}

export function useSessions(filters: SessionFilters) {
    const allowed = usePosManagerAllowed();
    return useQuery({
        queryKey: posKeys.sessions(filters),
        queryFn: () => fetchSessions(filters),
        enabled: on(allowed),
        placeholderData: keepPreviousData,
    });
}

export function useSessionSales(sessionId: string | null, page = 0, pageSize = 50) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.sessionSales(sessionId ?? '', page),
        queryFn: () => fetchSessionSales(sessionId as string, page, pageSize),
        enabled: on(allowed, !!sessionId),
        placeholderData: keepPreviousData,
    });
}

export function useSale(orderId: string | null, sessionId: string | null) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.sale(orderId ?? ''),
        queryFn: () => fetchSale(orderId as string, sessionId as string),
        enabled: on(allowed, !!orderId && !!sessionId),
    });
}

export function useApprovers(registerId: string | null, enabled: boolean) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.approvers(registerId ?? ''),
        queryFn: () => fetchApprovers(registerId as string),
        enabled: on(allowed, enabled && !!registerId),
        staleTime: 5 * 60 * 1000,
    });
}

export function usePosSettings(enabled = true) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.settings(),
        queryFn: fetchPosSettings,
        enabled: on(allowed, enabled),
        staleTime: 5 * 60 * 1000,
    });
}

export function useBillBookSeries(enabled = true) {
    const allowed = usePosManagerAllowed();
    return useQuery({
        queryKey: posKeys.series(),
        queryFn: fetchDocumentSeries,
        enabled: on(allowed, enabled),
        staleTime: 60_000,
    });
}

/** A value that settles `delay` ms after its last change (the quote's 300 ms). */
export function useDebounced<T>(value: T, delay = 300): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return settled;
}

/**
 * The server's price of the bill. The body is debounced by the caller; the
 * previous quote stays on screen while the next one loads ("Updating…").
 */
export function useQuote(body: QuoteRequest | null) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: posKeys.quote(body),
        queryFn: () => quoteBill(body as QuoteRequest),
        enabled: on(allowed, !!body && body.lines.length > 0),
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        retry: false,
    });
}

export function useReturnPreview(body: Parameters<typeof previewPosReturn>[0] | null) {
    const allowed = usePosAllowed();
    return useQuery({
        queryKey: [...root(), 'return-preview', body] as const,
        queryFn: () => previewPosReturn(body as Parameters<typeof previewPosReturn>[0]),
        enabled: on(allowed, !!body && body.lines.length > 0),
        placeholderData: keepPreviousData,
        retry: false,
    });
}

// ───────────────────────── Writes ─────────────────────────

/**
 * A counter write. The variables of a resend carry the manager's PIN, so the mutation leaves the
 * cache as soon as it settles (`reset` + `gcTime: 0`): the PIN is never kept (contract §3.4).
 */
export function usePosWrite<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
    const client = useQueryClient();
    const { mutateAsync, reset } = useMutation({
        mutationFn: (args: A) => fn(...args),
        gcTime: 0,
        onSuccess: () => {
            void invalidatePos(client);
        },
    });
    const send = useCallback(
        async (args: A): Promise<R> => {
            try {
                return await mutateAsync(args);
            } finally {
                reset();
            }
        },
        [mutateAsync, reset]
    );
    return useMemo(() => ({ mutateAsync: send }), [send]);
}

export const useOpenSession = () => usePosWrite(openSession);
export const useCreateSale = () => usePosWrite(createSale);
export const useCreateBillBookEntry = () => usePosWrite(createBillBookEntry);
export const useVoidSale = () => usePosWrite(voidSale);
export const useChangeTender = () => usePosWrite(changeTender);
export const useCreatePosReturn = () => usePosWrite(createPosReturn);
export const useCloseSession = () => usePosWrite(closeSession);
export const useCashMovement = () => usePosWrite(addCashMovement);
export const useCreateRegister = () => usePosWrite(createRegister);
export const useUpdateRegister = () => usePosWrite(updateRegister);
export const useSavePosSettings = () => usePosWrite(savePosSettings);
export const useCreateBillBook = () => usePosWrite(createBillBook);
