import { createFileRoute } from '@tanstack/react-router';

/** The desk keeps its tab, search, filters and page in the address (deep links, Back). */
export interface OrdersSearch {
    queue?: string;
    q?: string;
    page?: number;
    from?: string;
    to?: string;
    channel?: string;
    method?: string;
}

const text = (value: unknown, max = 64): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;
const isoDate = (value: unknown): string | undefined =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

export const Route = createFileRoute('/commerce/orders/')({
    validateSearch: (search: Record<string, unknown>): OrdersSearch => {
        const page = Number(search.page);
        return {
            queue: text(search.queue, 32),
            q: text(search.q),
            page: Number.isInteger(page) && page > 0 ? page : undefined,
            from: isoDate(search.from),
            to: isoDate(search.to),
            channel: text(search.channel, 16),
            method: text(search.method, 16),
        };
    },
});
