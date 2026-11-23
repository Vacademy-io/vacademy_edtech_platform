import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/lib/formatters';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { channelLabel } from '@/routes/commerce/orders/-shared/order-format';
import { inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { REPORT_CHANNELS, REPORT_STATUSES, type ReportEntry } from '../-shared/report-catalogue';
import { indiaToday, reportLocale } from '../-shared/report-format';
import { B2CL_LIMIT_MAX, B2CL_LIMIT_MIN, type RangeProblem, type ReportsSearch, resolvedMonth } from '../-shared/report-search';
import type { ReportFilterValues, ReportPlace } from '../-shared/report-types';

/** Months offered in the GST month picker: this one and the 23 before it. */
const MONTHS_BACK = 24;

/** `YYYY-MM` months, newest first. */
export function recentMonths(today: string = indiaToday(), count = MONTHS_BACK): string[] {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    return Array.from({ length: count }, (_, back) => {
        const index = year * 12 + (month - 1) - back;
        return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    });
}

/** "November 2026" / "नवंबर 2026" in the admin's language. */
export function monthLabel(month: string): string {
    const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1));
    return new Intl.DateTimeFormat(reportLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * The filters of a report page (contract §7.2 `ReportFilters`): dates, the
 * GST month, the place (only places the person may see; "All my places"),
 * channel, seller GSTIN when the shop has more than one, the grouping and the
 * "as of" date. Every change goes to the address.
 */
export function ReportFilters({
    entry,
    search,
    filters,
    places,
    gstins,
    problem,
    onChange,
}: {
    entry: ReportEntry;
    search: ReportsSearch;
    /** What is being sent (defaults filled in). */
    filters: ReportFilterValues;
    places: ReportPlace[];
    gstins: string[];
    problem: RangeProblem | null;
    onChange: (next: Partial<ReportsSearch>) => void;
}) {
    const { t } = useTranslation('commerce');
    const has = (key: string) => (entry.filters as readonly string[]).includes(key);
    const today = indiaToday();
    const months = useMemo(() => recentMonths(today), [today]);
    const showGstin = has('gstin') && (gstins.length > 1 || !!search.gstin);

    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-filters">
                {has('asOf') && (
                    <DateBox
                        label={t('reports.filters.asOf')}
                        value={filters.asOf ?? ''}
                        max={today}
                        onChange={(asOf) => onChange({ asOf: asOf || undefined })}
                        testId="report-asof"
                    />
                )}
                {has('range') && (
                    <>
                        <DateBox
                            label={t('reports.filters.from')}
                            value={filters.from ?? ''}
                            max={today}
                            onChange={(from) => onChange({ from: from || undefined })}
                            testId="report-from"
                        />
                        <DateBox
                            label={t('reports.filters.to')}
                            value={filters.to ?? ''}
                            max={today}
                            onChange={(to) => onChange({ to: to || undefined })}
                            testId="report-to"
                        />
                    </>
                )}
                {has('month') && (
                    <PlainSelect
                        label={t('reports.filters.month')}
                        value={resolvedMonth(search, today)}
                        onChange={(month) => onChange({ month: month || undefined })}
                        options={months.map((value) => ({ value, label: monthLabel(value) }))}
                    />
                )}
                {has('location') && (
                    <PlainSelect
                        label={t('reports.filters.location')}
                        value={search.location ?? ''}
                        noneLabel={t('reports.filters.allPlaces')}
                        onChange={(location) => onChange({ location: location || undefined })}
                        options={places.map((p) => ({ value: p.id, label: placeLabel(p) }))}
                    />
                )}
                {has('status') && (
                    <PlainSelect
                        label={t('reports.filters.status')}
                        value={search.status ?? ''}
                        noneLabel={t('reports.filters.allStatuses')}
                        onChange={(status) => onChange({ status: status || undefined })}
                        options={REPORT_STATUSES.map((value) => ({ value, label: t(`reports.values.${value}`) }))}
                    />
                )}
                {has('b2clLimit') && (
                    <AmountBox
                        label={t('reports.filters.b2clLimit')}
                        hint={t('reports.filters.b2clLimitHint')}
                        value={search.b2clLimit ?? ''}
                        onChange={(b2clLimit) => onChange({ b2clLimit: b2clLimit || undefined })}
                        testId="report-b2cl-limit"
                    />
                )}
                {has('channel') && (
                    <PlainSelect
                        label={t('reports.filters.channel')}
                        value={search.channel ?? ''}
                        noneLabel={t('reports.filters.allChannels')}
                        onChange={(channel) => onChange({ channel: channel || undefined })}
                        options={REPORT_CHANNELS.map((value) => ({ value, label: channelLabel(value, t) }))}
                    />
                )}
                {showGstin && (
                    <PlainSelect
                        label={t('reports.filters.gstin')}
                        value={search.gstin ?? ''}
                        placeholder={t('reports.filters.pickGstin')}
                        onChange={(gstin) => onChange({ gstin: gstin || undefined })}
                        options={Array.from(new Set([...gstins, ...(search.gstin ? [search.gstin] : [])])).map((g) => ({
                            value: g,
                            label: g,
                        }))}
                    />
                )}
                {has('groupBy') && entry.groupBy && (
                    <PlainSelect
                        label={t('reports.filters.groupBy')}
                        value={filters.groupBy ?? entry.groupBy[0] ?? ''}
                        onChange={(groupBy) => onChange({ groupBy: groupBy || undefined })}
                        options={entry.groupBy.map((value) => ({ value, label: t(`reports.groupBy.${value}`) }))}
                    />
                )}
            </div>
            {problem && (
                <p role="alert" className="text-caption text-danger-600" data-testid="report-range-problem">
                    {t(`reports.filters.problems.${problem}`, {
                        days: entry.maxDays,
                        min: B2CL_LIMIT_MIN,
                        max: formatNumber(B2CL_LIMIT_MAX),
                    })}
                </p>
            )}
        </div>
    );
}

/** A place as the picker shows it: "CODE · Name" when the server sends a code, else the name. */
export const placeLabel = (place: Pick<ReportPlace, 'code' | 'name'>): string =>
    place.code ? `${place.code} · ${place.name}` : place.name;

/** A rupee amount typed in full, sent on Enter or when the box is left (not on every key). */
function AmountBox({
    label,
    hint,
    value,
    onChange,
    testId,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (value: string) => void;
    testId: string;
}) {
    const [typed, setTyped] = useState(value);
    useEffect(() => setTyped(value), [value]);
    const apply = () => {
        const next = typed.trim().replace(/,/g, '');
        if (next !== value) onChange(next);
    };
    return (
        <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
            {label}
            <input
                type="text"
                inputMode="decimal"
                className={inputClass}
                value={typed}
                placeholder={hint}
                onChange={(event) => setTyped(event.target.value)}
                onBlur={apply}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') apply();
                }}
                data-testid={testId}
            />
        </label>
    );
}

function DateBox({
    label,
    value,
    max,
    onChange,
    testId,
}: {
    label: string;
    value: string;
    max: string;
    onChange: (value: string) => void;
    testId: string;
}) {
    return (
        <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
            {label}
            <input
                type="date"
                className={inputClass}
                value={value}
                max={max}
                onChange={(event) => onChange(event.target.value)}
                data-testid={testId}
            />
        </label>
    );
}
