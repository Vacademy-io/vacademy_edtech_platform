/**
 * Shared building blocks for the Reports Center tabs — formatters, KPI cards,
 * breakdown bars, sortable table headers, and the canonical loading / empty /
 * error states every tab renders.
 *
 * Everything here is purely presentational; data fetching stays in the tabs.
 */
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CaretDown,
    CaretRight,
    CaretUp,
    ChartBar,
    CloudWarning,
    DownloadSimple,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { isReportEndpointMissing } from '../-services/get-crm-reports';
import { type CsvCell, exportCsv } from '../-utils/export-csv';

// ── Tab props contract ─────────────────────────────────────────────────

/** Every Reports Center tab receives the shell's applied filter set. */
export interface ReportTabProps {
    instituteId: string;
    /** yyyy-MM-dd (inclusive). */
    fromDate: string;
    /** yyyy-MM-dd (inclusive). */
    toDate: string;
    teamId?: string;
    counsellorUserId?: string;
    /** Campaign (audience) id to scope the report to a single campaign. Only the
     *  "clean" lead-based tabs (whose queries join audience_response) honour it;
     *  the shared bar hides the picker on tabs where it can't filter cleanly. */
    audienceId?: string;
}

// ── Formatters ─────────────────────────────────────────────────────────

export function fmtMinutes(mins: number | null | undefined): string {
    if (mins == null || Number.isNaN(mins)) return '—';
    const totalMins = Math.max(0, Math.round(mins));
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const m = totalMins % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${m}m`;
    return `${m}m`;
}

export function fmtPct(p: number | null | undefined): string {
    if (p == null || Number.isNaN(p)) return '—';
    return `${p.toFixed(1)}%`;
}

export function fmtNumber(n: number | null | undefined): string {
    if (n == null) return '—';
    return n.toLocaleString();
}

/**
 * Money formatter for the revenue reports. Uses Intl currency formatting when a
 * valid ISO code is supplied; falls back to a plain grouped number otherwise.
 * Em-dash for null/NaN. Fractional digits collapse to 0 for whole amounts.
 */
export function fmtCurrency(n: number | null | undefined, currency?: string | null): string {
    if (n == null || Number.isNaN(n)) return '—';
    const fractionDigits = Number.isInteger(n) ? 0 : 2;
    try {
        if (currency) {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency,
                maximumFractionDigits: fractionDigits,
                minimumFractionDigits: 0,
            }).format(n);
        }
    } catch {
        // Invalid currency code — fall through to plain number.
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

/** Compact money for tight spots ("₹1.2L"-style via Intl compact notation). */
export function fmtCurrencyCompact(n: number | null | undefined, currency?: string | null): string {
    if (n == null || Number.isNaN(n)) return '—';
    try {
        return new Intl.NumberFormat(undefined, {
            style: currency ? 'currency' : 'decimal',
            currency: currency ?? undefined,
            notation: 'compact',
            maximumFractionDigits: 1,
        }).format(n);
    } catch {
        return n.toLocaleString();
    }
}

/** Days with one decimal ("3.5d"); em-dash when unknown. */
export function fmtDays(d: number | null | undefined): string {
    if (d == null || Number.isNaN(d)) return '—';
    return `${d.toFixed(1)}d`;
}

/** Conversion rate buckets — green ≥15%, amber 5–14.99%, red <5%. */
export function convRateClass(rate: number | null | undefined): string {
    if (rate == null) return 'text-neutral-400';
    if (rate >= 15) return 'text-green-700 font-semibold';
    if (rate >= 5) return 'text-amber-700 font-medium';
    return 'text-red-600 font-medium';
}

/** TAT met buckets — green ≥80%, amber 50–79.99%, red <50%. */
export function tatMetClass(rate: number | null | undefined): string {
    if (rate == null) return 'text-neutral-400';
    if (rate >= 80) return 'text-green-700 font-semibold';
    if (rate >= 50) return 'text-amber-700 font-medium';
    return 'text-red-600 font-medium';
}

/**
 * Tier → static Tailwind bg-class, for the legacy trio only. Callers pass the institute's
 * catalog colour as `colorHex`, which takes precedence; this is the fallback for a tier with
 * no colour set. Static enumeration so Tailwind keeps the classes.
 */
export function tierBgClass(tier: string): string {
    switch (tier) {
        case 'HOT':
            return 'bg-red-500';
        case 'WARM':
            return 'bg-amber-500';
        case 'COLD':
            return 'bg-blue-500';
        default:
            return 'bg-neutral-400';
    }
}

/** Deterministic avatar palette from a name — keeps the same colour for the same counsellor. */
const AVATAR_PALETTES = [
    'bg-blue-100 text-blue-700',
    'bg-green-100 text-green-700',
    'bg-amber-100 text-amber-700',
    'bg-red-100 text-red-700',
    'bg-purple-100 text-purple-700',
    'bg-pink-100 text-pink-700',
    'bg-teal-100 text-teal-700',
    'bg-indigo-100 text-indigo-700',
] as const;
export function avatarPalette(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    // Non-null assertion is safe: (h % length) is always a valid index into a non-empty tuple.
    return AVATAR_PALETTES[h % AVATAR_PALETTES.length]!;
}

// ── KPI card ───────────────────────────────────────────────────────────

export interface KpiCardProps {
    label: string;
    value: string;
    sub?: string;
    icon?: ReactNode;
    tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
    loading?: boolean;
    /** Drill-through — when set the card becomes clickable (cursor + hover affordance). */
    onClick?: () => void;
}
export function KpiCard({
    label,
    value,
    sub,
    icon,
    tone = 'default',
    loading,
    onClick,
}: KpiCardProps) {
    const toneToIconClass: Record<NonNullable<KpiCardProps['tone']>, string> = {
        default: 'bg-neutral-100 text-neutral-600',
        primary: 'bg-blue-100 text-blue-600',
        success: 'bg-green-100 text-green-700',
        warning: 'bg-amber-100 text-amber-700',
        danger: 'bg-red-100 text-red-600',
        info: 'bg-indigo-100 text-indigo-600',
    };
    return (
        <div
            className={cn(
                'group flex min-w-0 flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md',
                onClick && 'cursor-pointer hover:border-primary-200'
            )}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onClick();
                          }
                      }
                    : undefined
            }
        >
            <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {label}
                </span>
                {icon && (
                    <div
                        className={cn(
                            'flex size-9 shrink-0 items-center justify-center rounded-lg',
                            toneToIconClass[tone]
                        )}
                    >
                        {icon}
                    </div>
                )}
            </div>
            {loading ? (
                <span className="h-8 w-24 animate-pulse rounded bg-neutral-100" />
            ) : (
                <span className="text-2xl font-bold tabular-nums tracking-tight text-neutral-900">
                    {value}
                </span>
            )}
            {(sub || onClick) && (
                <span className="flex items-center justify-between text-xs text-neutral-500">
                    {sub}
                    {onClick && (
                        <CaretRight
                            size={12}
                            className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-500"
                        />
                    )}
                </span>
            )}
        </div>
    );
}

// ── Section / breakdown shells ─────────────────────────────────────────

export function ReportSection({
    title,
    icon,
    actions,
    children,
    className,
}: {
    title: string;
    icon?: ReactNode;
    /** Right-aligned header slot (e.g. CSV export button, sub-stats). */
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                'flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm',
                className
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    {icon && <span className="text-neutral-500">{icon}</span>}
                    <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
                </div>
                {actions}
            </div>
            {children}
        </section>
    );
}

export function BreakdownCard({
    title,
    icon,
    children,
}: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
                <span className="text-neutral-500">{icon}</span>
                <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
            </div>
            <div className="flex flex-col gap-3">{children}</div>
        </div>
    );
}

export interface BreakdownBarProps {
    label: string;
    count: number;
    total: number;
    converted?: number;
    colorHex?: string;
    colorClass?: string;
    /** Drill-through — when set the row becomes clickable. */
    onClick?: () => void;
}
export function BreakdownBar({
    label,
    count,
    total,
    converted,
    colorHex,
    colorClass,
    onClick,
}: BreakdownBarProps) {
    const { t } = useTranslation('audienceManagerReportShared');
    const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0;
    const cpct = converted != null && total > 0 ? Math.min(100, (converted / total) * 100) : 0;
    return (
        <div
            className={cn(
                'flex flex-col gap-1.5',
                onClick && 'group -mx-1.5 cursor-pointer rounded-md px-1.5 py-1 hover:bg-neutral-50'
            )}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onClick();
                          }
                      }
                    : undefined
            }
        >
            <div className="flex items-center justify-between text-sm">
                <span className="truncate text-neutral-700">{label}</span>
                <span className="flex items-center gap-1 font-medium text-neutral-900">
                    {count}
                    {converted != null && (
                        <span className="ms-1 text-xs text-green-700">
                            {t('breakdownBar.converted', { count: converted })}
                        </span>
                    )}
                    {onClick && (
                        <CaretRight
                            size={12}
                            className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                        />
                    )}
                </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                {colorHex ? (
                    /* Per-institute catalog colour + dynamic width — inline style is the
                       right call here, isolated to this rule. */
                    <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: colorHex }}
                    />
                ) : (
                    /* Width is data-driven; colour comes from a Tailwind utility class. */
                    <div
                        className={cn(
                            'absolute inset-y-0 left-0 rounded-full',
                            colorClass ?? 'bg-primary-500'
                        )}
                        style={{ width: `${pct}%` }}
                    />
                )}
                {converted != null && (
                    /* Overlay width is dynamic; isolated to this rule. */
                    <div
                        className="absolute inset-y-0 left-0 rounded-full bg-green-600"
                        style={{ width: `${cpct}%` }}
                    />
                )}
            </div>
        </div>
    );
}

// ── Loading / empty / error states ─────────────────────────────────────

export function EmptyHint({ message }: { message?: string }) {
    const { t } = useTranslation('audienceManagerReportShared');
    return (
        <div className="flex h-32 items-center justify-center text-sm text-neutral-400">
            {message ?? t('emptyHint.default')}
        </div>
    );
}

/** Skeleton for a whole tab — KPI strip + a table block. */
export function ReportTabSkeleton() {
    const { t } = useTranslation('audienceManagerReportShared');
    const id = useId();
    return (
        <div
            className="flex animate-pulse flex-col gap-4"
            aria-busy="true"
            aria-label={t('skeleton.ariaLabel')}
        >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <div
                        key={`${id}-kpi-${i}`}
                        className="h-28 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
                    >
                        <div className="h-3 w-20 rounded bg-neutral-100" />
                        <div className="mt-4 h-7 w-24 rounded bg-neutral-100" />
                    </div>
                ))}
            </div>
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="h-4 w-40 rounded bg-neutral-100" />
                {[0, 1, 2, 3, 4].map((i) => (
                    <div key={`${id}-row-${i}`} className="h-8 rounded bg-neutral-50" />
                ))}
            </div>
        </div>
    );
}

/**
 * Graceful tab-level error. Distinguishes "endpoint not deployed yet"
 * (404 / gateway 403 — the immediate post-merge reality) from a generic
 * failure, and offers a retry for the latter.
 */
export function ReportErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const { t } = useTranslation('audienceManagerReportShared');
    const deployPending = isReportEndpointMissing(error);
    return (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center shadow-sm">
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                {deployPending ? <CloudWarning size={24} /> : <ChartBar size={24} />}
            </div>
            <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-neutral-800">
                    {deployPending
                        ? t('errorState.deployPendingTitle')
                        : t('errorState.genericTitle')}
                </p>
                <p className="max-w-md text-xs text-neutral-500">
                    {deployPending
                        ? t('errorState.deployPendingBody')
                        : t('errorState.genericBody')}
                </p>
            </div>
            {!deployPending && onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                    {t('errorState.retry')}
                </Button>
            )}
        </div>
    );
}

// ── CSV export button ──────────────────────────────────────────────────

export function ExportCsvButton({
    onClick,
    disabled,
    label,
}: {
    onClick: () => void;
    disabled?: boolean;
    label?: string;
}) {
    const { t } = useTranslation('audienceManagerReportShared');
    return (
        <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onClick}
            disabled={disabled}
        >
            <DownloadSimple size={14} />
            {label ?? t('export.defaultLabel')}
        </Button>
    );
}

/**
 * Drop-in upgrade for ExportCsvButton that shows a column-selection dialog
 * before downloading. `getHeadersAndRows` is called lazily when the user
 * opens the picker so no computation happens until they click Export.
 */
export function ExportWithColumnPickerButton({
    filename,
    getHeadersAndRows,
    disabled,
    label,
}: {
    filename: string;
    getHeadersAndRows: () => { headers: string[]; rows: CsvCell[][] };
    disabled?: boolean;
    label?: string;
}) {
    const { t } = useTranslation('audienceManagerReportShared');
    const [open, setOpen] = useState(false);
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<CsvCell[][]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const handleOpen = () => {
        const { headers: h, rows: r } = getHeadersAndRows();
        setHeaders(h);
        setRows(r);
        setSelected(new Set(h));
        setOpen(true);
    };

    const handleExport = () => {
        const indices = headers.map((_, i) => i).filter((i) => selected.has(headers[i]!));
        exportCsv(
            filename,
            indices.map((i) => headers[i]!),
            rows.map((row) => indices.map((i) => row[i]))
        );
        setOpen(false);
    };

    const toggleCol = (h: string, checked: boolean) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(h);
            else next.delete(h);
            return next;
        });

    return (
        <>
            <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleOpen}
                disabled={disabled}
            >
                <DownloadSimple size={14} />
                {label ?? t('export.defaultLabel')}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('export.dialogTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 py-1">
                        <div className="flex items-center gap-1.5 text-xs">
                            <button
                                type="button"
                                onClick={() => setSelected(new Set(headers))}
                                className="text-primary-600 hover:underline"
                            >
                                {t('export.selectAll')}
                            </button>
                            <span className="text-neutral-300">·</span>
                            <button
                                type="button"
                                onClick={() => setSelected(new Set())}
                                className="text-primary-600 hover:underline"
                            >
                                {t('export.deselectAll')}
                            </button>
                        </div>
                        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-neutral-200 p-2">
                            {headers.map((h) => (
                                <label
                                    key={h}
                                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-100"
                                >
                                    <Checkbox
                                        checked={selected.has(h)}
                                        onCheckedChange={(chk) => toggleCol(h, chk === true)}
                                    />
                                    {h}
                                </label>
                            ))}
                        </div>
                    </div>
                    <DialogFooter className="items-center sm:justify-between">
                        <span className="text-xs text-neutral-500">
                            {t('export.columnsSelected', {
                                selected: selected.size,
                                total: headers.length,
                            })}
                        </span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                                {t('export.cancel')}
                            </Button>
                            <Button size="sm" onClick={handleExport} disabled={selected.size === 0}>
                                <DownloadSimple size={14} className="mr-1" />
                                {t('export.export')}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

// ── Generic sortable header cell ───────────────────────────────────────

export interface SortableHeaderProps<K extends string> {
    label: string;
    sortKey: K;
    current: K;
    dir: 'asc' | 'desc';
    onClick: (k: K) => void;
    align?: 'left' | 'right';
}
export function SortableHeader<K extends string>({
    label,
    sortKey,
    current,
    dir,
    onClick,
    align = 'right',
}: SortableHeaderProps<K>) {
    const active = current === sortKey;
    return (
        <th
            className={cn(
                'cursor-pointer select-none py-2 pr-3 transition-colors hover:text-neutral-700',
                align === 'right' ? 'text-right' : 'text-left',
                active && 'text-neutral-700'
            )}
            onClick={() => onClick(sortKey)}
        >
            <span
                className={cn(
                    'inline-flex items-center gap-0.5',
                    align === 'right' && 'justify-end'
                )}
            >
                {label}
                {active && (dir === 'asc' ? <CaretUp size={10} /> : <CaretDown size={10} />)}
            </span>
        </th>
    );
}
