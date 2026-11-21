import { ArrowDown, ArrowUp, Warning } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { LiveActivityAnalytics } from '../-services/live-activity-service';

/**
 * The headline numbers.
 *
 * <p>Stat tiles rather than charts: a single current value has no shape to plot, and a
 * one-bar chart is strictly worse than the number itself.
 *
 * <p>Each tile carries a delta against the preceding window of equal length. A bare count
 * tells an admin almost nothing -- "18 leads" only means something next to what yesterday
 * did.
 */
export function KpiTiles({ data }: { data: LiveActivityAnalytics }) {
    // Explicit locale: these format in the language the admin chose, not whatever the
    // browser happens to be set to.
    const { i18n } = useTranslation();
    const locale = i18n.language;
    const k = data.kpis;
    const connectRate =
        k.callsPlaced > 0 ? Math.round((k.callsConnected / k.callsPlaced) * 100) : null;

    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Leads" value={k.leads} previous={k.previousLeads} locale={locale} />
            <Tile
                label="Enrolments"
                value={k.enrolments}
                previous={k.previousEnrolments}
                locale={locale}
            />
            <Tile
                label="Revenue"
                value={k.revenue}
                previous={k.previousRevenue}
                locale={locale}
                format={(n) => formatMoney(n, k.currency, locale)}
            />
            <Tile
                label="Calls connected"
                value={k.callsConnected}
                locale={locale}
                // Connect rate is the useful figure, but it is a ratio of two numbers in the
                // same tile rather than a second series -- so it sits as a subtitle, not a
                // second axis.
                subtitle={
                    connectRate === null ? undefined : `${connectRate}% of ${k.callsPlaced} placed`
                }
            />
            <AttentionTile count={k.needsAttention} locale={locale} />
        </div>
    );
}

function Tile({
    label,
    value,
    previous,
    subtitle,
    format,
    locale,
}: {
    label: string;
    value: number;
    previous?: number;
    subtitle?: string;
    format?: (n: number) => string;
    locale: string;
}) {
    const display = format ? format(value) : value.toLocaleString(locale);
    const delta = previous === undefined ? null : percentChange(value, previous);

    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
            <div className="text-caption text-neutral-500">{label}</div>
            <div className="mt-1 text-h3 font-semibold tabular-nums text-neutral-700">
                {display}
            </div>
            {delta !== null && <DeltaBadge percent={delta} />}
            {subtitle && <div className="mt-1 text-caption text-neutral-500">{subtitle}</div>}
        </div>
    );
}

/**
 * Needs attention is the only tile that earns a status colour, because it is the only one
 * that is a call to action rather than a measurement. It ships with an icon and a label so
 * the meaning never rests on colour alone.
 */
function AttentionTile({ count, locale }: { count: number; locale: string }) {
    const active = count > 0;
    return (
        <div
            className={`rounded-lg border px-4 py-3 ${
                active ? 'border-warning-200 bg-warning-50' : 'border-neutral-200 bg-white'
            }`}
        >
            <div className="flex items-center gap-1.5 text-caption text-neutral-500">
                {active && <Warning className="size-3.5 text-warning-600" weight="fill" />}
                Needs attention
            </div>
            <div
                className={`mt-1 text-h3 font-semibold tabular-nums ${
                    active ? 'text-warning-700' : 'text-neutral-700'
                }`}
            >
                {count.toLocaleString(locale)}
            </div>
            <div className="mt-1 text-caption text-neutral-500">filled the form, not enrolled</div>
        </div>
    );
}

function DeltaBadge({ percent }: { percent: number | null }) {
    if (percent === null) {
        // No prior activity to compare against. Showing "+100%" against a zero baseline
        // would be arithmetically true and completely misleading.
        return <div className="mt-1 text-caption text-neutral-400">no prior data</div>;
    }
    if (percent === 0) {
        return <div className="mt-1 text-caption text-neutral-500">no change</div>;
    }
    const up = percent > 0;
    return (
        <div
            className={`mt-1 flex items-center gap-0.5 text-caption ${
                up ? 'text-success-600' : 'text-danger-600'
            }`}
        >
            {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {Math.abs(percent)}% vs previous
        </div>
    );
}

function percentChange(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return Math.round(((current - previous) / previous) * 100);
}

function formatMoney(amount: number, currency: string | undefined, locale: string): string {
    const rounded = Math.round(amount);
    const n = rounded.toLocaleString(locale);
    return currency ? `${currency} ${n}` : n;
}
