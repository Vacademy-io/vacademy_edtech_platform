import { createFileRoute } from '@tanstack/react-router';
import { normalizeDashboardSearch } from './-utils/dashboard-search';

/**
 * Route definition only; the component is lazy-loaded from index.lazy.tsx.
 * ?view=weekly shows the weekly report and ?view=overview the 7/30/90-day overview (absent = the
 * daily report). ?numbers=1 opens the daily report's "All numbers" section.
 * ?engine=<engineId> picks one engine (absent = all engines).
 * The period: ?date=yyyy-MM-dd for one day, or ?from=yyyy-MM-dd&to=yyyy-MM-dd for a range (both
 * days included; they win over `date`). Absent = today in the institute time zone. On the weekly
 * view `date` is the last day of the week. So a report link can be shared.
 */
export const Route = createFileRoute('/engagement-engines/dashboard/')({
    validateSearch: normalizeDashboardSearch,
});
