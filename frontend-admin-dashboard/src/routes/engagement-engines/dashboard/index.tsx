import { createFileRoute } from '@tanstack/react-router';
import { normalizePeriodSearch } from './-utils/report-period';

/**
 * Route definition only; the component is lazy-loaded from index.lazy.tsx.
 * ?view=overview shows the 7/30/90-day overview (absent = the daily report).
 * ?engine=<engineId> picks one engine (absent = all engines).
 * The period: ?date=yyyy-MM-dd for one day, or ?from=yyyy-MM-dd&to=yyyy-MM-dd for a range (both
 * days included; they win over `date`). Absent = today in the institute time zone. So a report
 * link can be shared.
 */
export const Route = createFileRoute('/engagement-engines/dashboard/')({
    validateSearch: (
        search: Record<string, unknown>
    ): { engine?: string; date?: string; from?: string; to?: string; view?: 'overview' } => ({
        engine: typeof search.engine === 'string' && search.engine ? search.engine : undefined,
        ...normalizePeriodSearch(search),
        view: search.view === 'overview' ? 'overview' : undefined,
    }),
});
