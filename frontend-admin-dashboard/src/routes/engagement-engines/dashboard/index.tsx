import { createFileRoute } from '@tanstack/react-router';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Route definition only; the component is lazy-loaded from index.lazy.tsx.
 * ?engine=<engineId> picks one engine (absent = all engines) and ?date=yyyy-MM-dd
 * picks the day (absent = today in the institute time zone), so a report link can be shared.
 */
export const Route = createFileRoute('/engagement-engines/dashboard/')({
    validateSearch: (search: Record<string, unknown>): { engine?: string; date?: string } => ({
        engine: typeof search.engine === 'string' && search.engine ? search.engine : undefined,
        date:
            typeof search.date === 'string' && ISO_DAY.test(search.date) ? search.date : undefined,
    }),
});
