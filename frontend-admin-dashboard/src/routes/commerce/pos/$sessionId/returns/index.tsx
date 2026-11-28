import { createFileRoute } from '@tanstack/react-router';

/** `order`: a bill to open straight away (from the bills list). */
export const Route = createFileRoute('/commerce/pos/$sessionId/returns/')({
    validateSearch: (search: Record<string, unknown>): { order?: string } => ({
        order: typeof search.order === 'string' && search.order ? search.order.slice(0, 64) : undefined,
    }),
});
