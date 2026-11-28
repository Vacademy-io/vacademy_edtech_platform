import { normalizePeriodSearch, type PeriodSearch } from './report-period';

/*
 * The Engagement Dashboard's URL. Everything the page shows lives in it, so a link can be shared:
 *   ?view=weekly | overview   absent = the daily report
 *   ?engine=<engineId>        absent = all engines
 *   ?date= | ?from=&to=       the period (see report-period.ts); on the weekly view `date` is the
 *                             last day of the week; absent = today in the institute time zone
 *   ?numbers=1                the daily report's "All numbers" section is open (absent = closed)
 * Light on purpose (no React): the route file imports it eagerly.
 */

export type DashboardView = 'daily' | 'weekly' | 'overview';

export interface DashboardSearch extends PeriodSearch {
    engine?: string;
    view?: 'weekly' | 'overview';
    numbers?: 1;
}

/** `?numbers=1` arrives as the number 1 (the router parses it), `true` or `"1"` if typed by hand. */
const isOn = (value: unknown): boolean =>
    value === 1 || value === true || value === '1' || value === 'true';

/** The route's `validateSearch`: unknown values are dropped, so a stale link still opens. */
export const normalizeDashboardSearch = (search: Record<string, unknown>): DashboardSearch => ({
    engine: typeof search.engine === 'string' && search.engine ? search.engine : undefined,
    ...normalizePeriodSearch(search),
    view: search.view === 'weekly' || search.view === 'overview' ? search.view : undefined,
    numbers: isOn(search.numbers) ? 1 : undefined,
});

export const viewOfSearch = (search: { view?: unknown }): DashboardView =>
    search.view === 'overview' ? 'overview' : search.view === 'weekly' ? 'weekly' : 'daily';

/** The `view` param for a view; the daily report is the default, so it is left out. */
export const viewPatch = (view: DashboardView): Pick<DashboardSearch, 'view'> => ({
    view: view === 'daily' ? undefined : view,
});

export const isNumbersOpen = (search: { numbers?: unknown }): boolean => isOn(search.numbers);

/** The `numbers` param for the section being open or closed; closed is left out. */
export const numbersPatch = (open: boolean): Pick<DashboardSearch, 'numbers'> => ({
    numbers: open ? 1 : undefined,
});
