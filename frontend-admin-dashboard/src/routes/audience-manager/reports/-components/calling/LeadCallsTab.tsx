/**
 * Reports Center — Lead Calls tab (lead-wise call report).
 *
 * Answers "how many times did we try each lead, and with what outcome?" plus
 * "which new leads never got a single call?":
 *
 *   1. KPI strip — leads called / total dials / connected / callback /
 *      tried-but-never-connected / new leads never called.
 *   2. Two switchable views over the same window:
 *      - Called leads: one row per lead with attempt + outcome counts
 *        (connected / callback / didn't pick up), last call and next promised
 *        callback. Most-tried leads first.
 *      - Never called: in-window new leads with zero dials ever, newest first.
 *
 * The outcome buckets are NOT mutually exclusive (a connected call can also log
 * a callback disposition) so they are shown side by side, never summed.
 * Server-side pagination + name/phone search. Read-only.
 */
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    CaretLeft,
    CaretRight,
    MagnifyingGlass,
    Phone,
    PhoneDisconnect,
    PhoneOutgoing,
    PhoneX,
    UserSound,
    WarningCircle,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { humanizeCallStatus } from '@/hooks/use-lead-report-settings';
import {
    callsByLeadQueryKey,
    fetchCallsByLead,
    type CalledLeadRow,
    type CallsByLeadView,
    type UncalledLeadRow,
} from './calling-reports-service';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    fmtNumber,
    type ReportTabProps,
} from '../report-shared';

const PAGE_SIZE = 25;

export default function LeadCallsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerLeadCallsTab');
    const [view, setView] = useState<CallsByLeadView>('CALLED');
    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    // Debounced search — also resets to the first page.
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(0);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // New filter window/scope invalidates the page cursor.
    useEffect(() => {
        setPage(0);
    }, [instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId, view]);

    const params = {
        instituteId,
        fromDate,
        toDate,
        teamId,
        counsellorUserId,
        audienceId,
        search,
        view,
        page,
        size: PAGE_SIZE,
    };

    const query = useQuery({
        queryKey: callsByLeadQueryKey(params),
        queryFn: () => fetchCallsByLead(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
        placeholderData: keepPreviousData,
    });

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    const summary = query.data?.summary;
    const calledRows = query.data?.rows ?? [];
    const uncalledRows = query.data?.uncalled_rows ?? [];
    const totalRows = query.data?.total_rows ?? 0;
    const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

    const getCalledExportData = () => ({
        headers: [
            t('field.lead'),
            t('field.phone'),
            t('field.status'),
            t('field.counsellor'),
            t('field.attempts'),
            t('field.connected'),
            t('field.callback'),
            t('field.notPickedUp'),
            t('field.failed'),
            t('field.lastCall'),
            t('field.lastOutcome'),
            t('field.nextCallback'),
        ],
        rows: calledRows.map((r) => [
            r.lead_name ?? '',
            r.lead_phone ?? '',
            r.lead_status_label ?? '',
            r.counsellor_name ?? r.counsellor_user_id ?? '',
            r.attempts,
            r.connected,
            r.callbacks,
            r.not_picked,
            r.failed,
            fmtDateTime(r.last_call_at),
            // Bug fix: this used to emit the raw last_disposition_key (e.g.
            // "NOT_INTERESTED") straight from the backend when present, instead
            // of humanizing it like the on-screen table does (see
            // CalledLeadsTable below) — the export column silently disagreed
            // with what the user saw on screen.
            r.last_disposition_key
                ? humanizeKey(r.last_disposition_key)
                : humanizeCallStatus(r.last_call_status ?? ''),
            fmtDateTime(r.next_callback_at),
        ]),
    });

    const getUncalledExportData = () => ({
        headers: [
            t('field.lead'),
            t('field.phone'),
            t('field.source'),
            t('field.status'),
            t('field.assignedCounsellor'),
            t('field.submitted'),
        ],
        rows: uncalledRows.map((r) => [
            r.lead_name ?? '',
            r.lead_phone ?? '',
            r.source_type ? humanizeKey(r.source_type) : '',
            r.lead_status_label ?? '',
            r.counsellor_name ?? r.counsellor_user_id ?? '',
            fmtDateTime(r.submitted_at),
        ]),
    });

    return (
        <div className="flex flex-col gap-6">
            {/* ── KPI strip ────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
                <KpiCard
                    label={t('kpi.leadsCalled.label')}
                    value={fmtNumber(summary?.leads_called)}
                    sub={t('kpi.leadsCalled.sub')}
                    icon={<UserSound size={20} />}
                    tone="primary"
                />
                <KpiCard
                    label={t('kpi.totalDials.label')}
                    value={fmtNumber(summary?.total_dials)}
                    sub={t('kpi.totalDials.sub')}
                    icon={<PhoneOutgoing size={20} />}
                />
                <KpiCard
                    label={t('kpi.connected.label')}
                    value={fmtNumber(summary?.leads_connected)}
                    sub={t('kpi.connected.sub')}
                    icon={<Phone size={20} />}
                    tone="success"
                />
                <KpiCard
                    label={t('kpi.callbackAsked.label')}
                    value={fmtNumber(summary?.leads_callback)}
                    sub={t('kpi.callbackAsked.sub')}
                    icon={<PhoneX size={20} />}
                    tone="info"
                />
                <KpiCard
                    label={t('kpi.neverConnected.label')}
                    value={fmtNumber(summary?.leads_never_connected)}
                    sub={t('kpi.neverConnected.sub')}
                    icon={<PhoneDisconnect size={20} />}
                    tone="warning"
                />
                <KpiCard
                    label={t('kpi.newLeadsNotCalled.label')}
                    value={fmtNumber(summary?.uncalled_new_leads)}
                    sub={t('kpi.newLeadsNotCalled.sub')}
                    icon={<WarningCircle size={20} />}
                    tone="danger"
                    onClick={() => setView('UNCALLED')}
                />
            </div>

            {/* ── Lead table ───────────────────────────────────────────────── */}
            <ReportSection
                title={view === 'CALLED' ? t('section.titleCalled') : t('section.titleUncalled')}
                icon={<Phone size={18} />}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative">
                            <MagnifyingGlass
                                size={14}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
                            />
                            <Input
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder={t('search.placeholder')}
                                className="h-8 w-48 pl-8 text-sm"
                                aria-label={t('search.ariaLabel')}
                            />
                        </div>
                        <div className="flex h-8 items-center gap-1 rounded-md border border-neutral-200 bg-white p-1">
                            <ViewPill
                                active={view === 'CALLED'}
                                onClick={() => setView('CALLED')}
                                label={t('view.called', { count: summary?.leads_called ?? 0 })}
                            />
                            <ViewPill
                                active={view === 'UNCALLED'}
                                onClick={() => setView('UNCALLED')}
                                label={t('view.uncalled', {
                                    count: summary?.uncalled_new_leads ?? 0,
                                })}
                            />
                        </div>
                        <ExportWithColumnPickerButton
                            filename={`lead-calls-${view.toLowerCase()}_${fromDate}_${toDate}.csv`}
                            disabled={
                                view === 'CALLED'
                                    ? calledRows.length === 0
                                    : uncalledRows.length === 0
                            }
                            getHeadersAndRows={
                                view === 'CALLED' ? getCalledExportData : getUncalledExportData
                            }
                        />
                    </div>
                }
            >
                {view === 'CALLED' ? (
                    calledRows.length === 0 ? (
                        <EmptyHint message={t('empty.noCalls')} />
                    ) : (
                        <CalledLeadsTable rows={calledRows} />
                    )
                ) : uncalledRows.length === 0 ? (
                    <EmptyHint message={t('empty.allCalled')} />
                ) : (
                    <UncalledLeadsTable rows={uncalledRows} />
                )}

                {/* Pager */}
                {totalRows > PAGE_SIZE && (
                    <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
                        <span className="text-xs text-neutral-500">
                            {t('pager.summary', {
                                count: totalRows,
                                formattedCount: fmtNumber(totalRows),
                                page: page + 1,
                                pageCount: fmtNumber(pageCount),
                            })}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                disabled={page === 0 || query.isFetching}
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                            >
                                <CaretLeft size={12} />
                                {t('pager.prev')}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                disabled={page + 1 >= pageCount || query.isFetching}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                {t('pager.next')}
                                <CaretRight size={12} />
                            </Button>
                        </div>
                    </div>
                )}
                <p className="text-xs text-neutral-400">
                    {view === 'CALLED' ? t('footnote.called') : t('footnote.uncalled')}
                </p>
            </ReportSection>
        </div>
    );
}

// ── Called-leads table ─────────────────────────────────────────────────

function CalledLeadsTable({ rows }: { rows: CalledLeadRow[] }) {
    const { t } = useTranslation('audienceManagerLeadCallsTab');
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                        <th className="sticky start-0 z-10 bg-white py-2 pe-3 text-start">
                            {t('field.lead')}
                        </th>
                        <th className="py-2 ps-3 text-start">{t('field.status')}</th>
                        <th className="py-2 ps-3 text-start">{t('field.counsellor')}</th>
                        <th className="py-2 ps-3 text-end">{t('field.attempts')}</th>
                        <th className="py-2 ps-3 text-end text-success-600">
                            {t('field.connected')}
                        </th>
                        <th className="py-2 ps-3 text-end text-info-600">
                            {t('field.callback')}
                        </th>
                        <th className="py-2 pl-3 text-right text-warning-600">
                            {t('field.notPickedUp')}
                        </th>
                        <th className="py-2 ps-3 text-end">{t('field.failed')}</th>
                        <th className="py-2 ps-3 text-start">{t('field.lastCall')}</th>
                        <th className="py-2 ps-3 text-start">{t('field.nextCallback')}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr
                            key={r.response_id}
                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                        >
                            <td className="sticky left-0 z-10 bg-white py-2.5 pr-3">
                                <div className="flex flex-col">
                                    <span className="font-medium text-neutral-900">
                                        {r.lead_name || t('row.unknownLead')}
                                    </span>
                                    {r.lead_phone && (
                                        <span className="text-xs text-neutral-500">
                                            {r.lead_phone}
                                        </span>
                                    )}
                                </div>
                            </td>
                            <td className="py-2.5 pl-3">
                                <LeadStatusChip
                                    label={r.lead_status_label}
                                    color={r.lead_status_color}
                                />
                            </td>
                            <td className="py-2.5 pl-3 text-neutral-700">
                                {r.counsellor_name ?? r.counsellor_user_id ?? '—'}
                            </td>
                            <td className="py-2.5 pl-3 text-right font-semibold tabular-nums text-neutral-900">
                                {fmtNumber(r.attempts)}
                            </td>
                            <OutcomeCell value={r.connected} toneClass="text-success-600" />
                            <OutcomeCell value={r.callbacks} toneClass="text-info-600" />
                            <OutcomeCell value={r.not_picked} toneClass="text-warning-600" />
                            <OutcomeCell value={r.failed} toneClass="text-danger-600" />
                            <td className="whitespace-nowrap py-2.5 pl-3 text-neutral-700">
                                <div className="flex flex-col">
                                    <span>{fmtDateTime(r.last_call_at)}</span>
                                    <span className="text-xs text-neutral-400">
                                        {r.last_disposition_key
                                            ? humanizeKey(r.last_disposition_key)
                                            : humanizeCallStatus(r.last_call_status ?? '')}
                                    </span>
                                </div>
                            </td>
                            <td
                                className={cn(
                                    'whitespace-nowrap py-2.5 pl-3',
                                    r.next_callback_at
                                        ? 'font-medium text-info-600'
                                        : 'text-neutral-300'
                                )}
                            >
                                {r.next_callback_at ? fmtDateTime(r.next_callback_at) : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Uncalled-leads table ───────────────────────────────────────────────

function UncalledLeadsTable({ rows }: { rows: UncalledLeadRow[] }) {
    const { t } = useTranslation('audienceManagerLeadCallsTab');
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                        <th className="sticky start-0 z-10 bg-white py-2 pe-3 text-start">
                            {t('field.lead')}
                        </th>
                        <th className="py-2 ps-3 text-start">{t('field.source')}</th>
                        <th className="py-2 ps-3 text-start">{t('field.status')}</th>
                        <th className="py-2 ps-3 text-start">{t('field.assignedCounsellor')}</th>
                        <th className="py-2 ps-3 text-start">{t('field.submitted')}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr
                            key={r.response_id}
                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                        >
                            <td className="sticky left-0 z-10 bg-white py-2.5 pr-3">
                                <div className="flex flex-col">
                                    <span className="font-medium text-neutral-900">
                                        {r.lead_name || t('row.unknownLead')}
                                    </span>
                                    {r.lead_phone && (
                                        <span className="text-xs text-neutral-500">
                                            {r.lead_phone}
                                        </span>
                                    )}
                                </div>
                            </td>
                            <td className="py-2.5 pl-3 text-neutral-700">
                                {humanizeKey(r.source_type ?? 'UNKNOWN')}
                            </td>
                            <td className="py-2.5 pl-3">
                                <LeadStatusChip
                                    label={r.lead_status_label}
                                    color={r.lead_status_color}
                                />
                            </td>
                            <td className="py-2.5 pl-3 text-neutral-700">
                                {r.counsellor_name ?? r.counsellor_user_id ?? (
                                    <span className="text-warning-600">{t('row.unassigned')}</span>
                                )}
                            </td>
                            <td className="whitespace-nowrap py-2.5 pl-3 text-neutral-700">
                                {fmtDateTime(r.submitted_at)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Bits ───────────────────────────────────────────────────────────────

function ViewPill({
    active,
    onClick,
    label,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded px-2.5 py-0.5 text-xs transition-colors',
                active ? 'bg-primary-500 text-white' : 'text-neutral-600 hover:bg-neutral-50'
            )}
        >
            {label}
        </button>
    );
}

/** Pipeline-status chip with the per-institute catalog colour. */
function LeadStatusChip({ label, color }: { label: string | null; color: string | null }) {
    if (!label) return <span className="text-neutral-300">—</span>;
    return (
        <span className="inline-flex items-center gap-1.5 text-neutral-700">
            {/* Catalog colour from API — isolated dynamic style. */}
            <span
                className={cn('size-2.5 shrink-0 rounded-sm', !color && 'bg-primary-500')}
                style={color ? { backgroundColor: color } : undefined}
            />
            {label}
        </span>
    );
}

/** Numeric outcome cell — zero is dimmed so real counts pop. */
function OutcomeCell({ value, toneClass }: { value: number; toneClass: string }) {
    return (
        <td
            className={cn(
                'py-2.5 pl-3 text-right tabular-nums',
                value > 0 ? cn('font-medium', toneClass) : 'text-neutral-300'
            )}
        >
            {fmtNumber(value)}
        </td>
    );
}

/** ISO-8601 UTC → local "22 Jul, 3:41 pm"; em-dash when absent. */
function fmtDateTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    });
}

/** SNAKE_CASE key → "Title Case" display. */
function humanizeKey(key: string): string {
    return key
        .toLowerCase()
        .split('_')
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
}
