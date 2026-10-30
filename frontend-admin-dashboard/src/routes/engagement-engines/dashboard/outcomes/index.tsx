import { createFileRoute } from '@tanstack/react-router';
import { isOutcomeTab, type OutcomeTab } from '../-utils/outcomes-params';
import { normalizePeriodSearch, type PeriodSearch } from '../-utils/report-period';

export interface OutcomesSearch extends PeriodSearch {
    engine?: string;
    tab?: OutcomeTab;
    filter?: string;
    search?: string;
    /** 1-based; absent = the first page. */
    page?: number;
}

/**
 * A param that is a string but may arrive as a number: the router JSON-parses every value, so
 * `?search=9876543210` is the number 9876543210 (and a purely numeric id would be too).
 */
const text = (value: unknown): string | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return typeof value === 'string' && value.trim() ? value : undefined;
};

/**
 * Route definition only; the component is lazy-loaded from index.lazy.tsx.
 *
 * Leads & outcomes: the people (and new WhatsApp templates) behind the daily report's numbers.
 *   ?engine=<engineId>   one engine (absent = all engines)
 *   ?date=yyyy-MM-dd     the day, in the institute time zone (absent = today), or
 *   ?from=&to=           a range of days, both included (they win over `date`)
 *   ?tab=                leads (default) | demos | status | conversions | templates
 *   ?filter=             per tab, see outcomes-params.ts (a stale value for the tab is ignored)
 *   ?search=             lead name, email or phone (not used by the templates tab)
 *   ?page=               1-based
 */
export const Route = createFileRoute('/engagement-engines/dashboard/outcomes/')({
    validateSearch: (search: Record<string, unknown>): OutcomesSearch => {
        const page = Number(search.page);
        return {
            engine: text(search.engine),
            ...normalizePeriodSearch(search),
            tab: isOutcomeTab(search.tab) ? search.tab : undefined,
            filter: text(search.filter),
            search: text(search.search),
            page: Number.isInteger(page) && page > 1 ? page : undefined,
        };
    },
});
