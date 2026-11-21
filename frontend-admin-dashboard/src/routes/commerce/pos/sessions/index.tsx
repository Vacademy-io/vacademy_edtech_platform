import { createFileRoute } from '@tanstack/react-router';

/** Filters and page live in the address (deep links, Back). */
export interface PosSessionsSearch {
    page?: number;
    registerId?: string;
    status?: string;
    from?: string;
    to?: string;
}

const text = (value: unknown, max = 64): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;
const isoDate = (value: unknown): string | undefined =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

export const Route = createFileRoute('/commerce/pos/sessions/')({
    validateSearch: (search: Record<string, unknown>): PosSessionsSearch => {
        const page = Number(search.page);
        const status = text(search.status, 16);
        return {
            page: Number.isInteger(page) && page > 0 ? page : undefined,
            registerId: text(search.registerId),
            status: status === 'OPEN' || status === 'CLOSED' ? status : undefined,
            from: isoDate(search.from),
            to: isoDate(search.to),
        };
    },
});
