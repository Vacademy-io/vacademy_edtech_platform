import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { MyTable } from '@/components/design-system/table';
import { cn } from '@/lib/utils';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceEmptyState, CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { inputClass } from '@/routes/commerce/orders/-components/order-ui';
import { ExportButtons } from '../../-components/ExportButtons';
import { ReportErrorNotice } from '../../-components/ReportStates';
import { KeysetPager } from '../../-components/ReportTable';
import { ReportTabs } from '../../-components/ReportTabs';
import { REPORT_CATALOGUE } from '../../-shared/report-catalogue';
import { formatIndiaDateTime, indiaToday } from '../../-shared/report-format';
import { APPROVAL_ACTION_LABELS, AUDIT_KIND_LABELS, AUDIT_TABS } from '../../-shared/report-keys';
import { placeLabel } from '../../-components/ReportFilters';
import {
    useApprovals,
    useAuditActors,
    useAuditKinds,
    useAuditLog,
    useReportLocations,
} from '../../-shared/report-hooks';
import { type AuditSearch, rangeProblem } from '../../-shared/report-search';
import type { ApprovalRow, AuditFilterValues, AuditRow } from '../../-shared/report-types';
import { downloadAudit } from '../../-shared/reports-api';
import { AuditChanges, humanCode } from './AuditChanges';

const KNOWN_KINDS = new Set<string>(AUDIT_KIND_LABELS);

const KNOWN_ACTIONS = new Set<string>(APPROVAL_ACTION_LABELS);

type AuditTab = (typeof AUDIT_TABS)[number];

const AUDIT_ENTRY = REPORT_CATALOGUE.find((entry) => entry.id === 'audit');

/** The filters sent: the address, with this month as the default range. */
export function auditFilters(search: AuditSearch, today: string = indiaToday()): AuditFilterValues {
    return {
        from: search.from ?? `${today.slice(0, 7)}-01`,
        to: search.to ?? today,
        actorUserId: search.actor,
        locationId: search.location,
        kind: search.kind,
        reference: search.reference,
    };
}

/** Audit log route: reads and writes the address. */
export function AuditLogPage() {
    const navigate = useNavigate();
    const search = useSearch({ from: '/commerce/reports/audit/' });
    const setSearch = (next: Partial<AuditSearch>) =>
        void navigate({
            to: '/commerce/reports/audit',
            search: (previous: Record<string, unknown>) => ({ ...previous, ...next }),
            replace: true,
        });
    return <AuditLog search={search} onSearch={setSearch} />;
}

/**
 * Audit log (contract §6.4, §7.2): who changed what, when, where and why,
 * and the approvals given with a manager's PIN. Read-only; the CSV download
 * is audited by the server.
 */
export function AuditLog({ search, onSearch }: { search: AuditSearch; onSearch: (next: Partial<AuditSearch>) => void }) {
    const { t } = useTranslation('commerce');
    const tab: AuditTab = search.tab ?? 'changes';
    const today = indiaToday();
    const filters = useMemo(() => auditFilters(search, today), [search, today]);
    const problem = AUDIT_ENTRY ? rangeProblem(AUDIT_ENTRY, filters, today) : null;

    const filterKey = `${tab}:${JSON.stringify(filters)}`;
    const [pages, setPages] = useState<{ key: string; cursors: (string | null)[] }>({ key: filterKey, cursors: [null] });
    const cursors = pages.key === filterKey ? pages.cursors : [null];
    useEffect(() => {
        if (pages.key !== filterKey) setPages({ key: filterKey, cursors: [null] });
    }, [filterKey, pages.key]);
    const cursor = cursors[cursors.length - 1] ?? null;

    const changes = useAuditLog(filters, cursor, tab === 'changes' && !problem);
    const approvals = useApprovals(filters, cursor, tab === 'approvals' && !problem);
    const query = tab === 'changes' ? changes : approvals;
    const nextCursor = query.data?.nextCursor ?? null;

    return (
        <CommercePage
            navId="commerce-reports"
            anyFeature={AUDIT_ENTRY?.anyFeature}
            title={t('reports.catalogue.audit.title')}
            description={t('reports.catalogue.audit.help')}
            backTo={{ to: '/commerce/reports', label: t('reports.home.back') }}
            actions={
                tab === 'changes' ? (
                    <ExportButtons formats={['csv']} onDownload={() => downloadAudit(filters)} disabled={!!problem} />
                ) : undefined
            }
        >
            <div className="flex flex-col gap-4" data-testid="audit-log">
                <ReportTabs
                    idPrefix="audit"
                    label={t('reports.catalogue.audit.title')}
                    active={tab}
                    onChange={(next) => onSearch({ tab: next })}
                    tabs={AUDIT_TABS.map((id) => ({ id, label: t(`reports.audit.tabs.${id}`) }))}
                />
                <AuditFilters tab={tab} search={search} filters={filters} rows={changes.data?.rows ?? []} onSearch={onSearch} />
                {problem && (
                    <p role="alert" className="text-caption text-danger-600">
                        {t(`reports.filters.problems.${problem}`, { days: AUDIT_ENTRY?.maxDays ?? 366 })}
                    </p>
                )}
                <div role="tabpanel" id="audit-panel" aria-labelledby={`audit-tab-${tab}`} className="flex flex-col gap-4">
                    {!problem && query.isLoading && <CommerceLoadingRows rows={5} />}
                    {!problem && query.isError && <ReportErrorNotice error={query.error} onRetry={() => void query.refetch()} />}
                    {!problem && query.data && !query.isError && (
                        <div className={cn('flex flex-col gap-4', query.isPlaceholderData && 'opacity-60')}>
                            {tab === 'changes' ? (
                                <ChangesTable rows={changes.data?.rows ?? []} />
                            ) : (
                                <ApprovalsTable rows={approvals.data?.rows ?? []} />
                            )}
                            <KeysetPager
                                page={cursors.length - 1}
                                hasNext={!!nextCursor}
                                busy={query.isFetching}
                                onPrevious={() => setPages({ key: filterKey, cursors: cursors.slice(0, -1) })}
                                onNext={() => nextCursor && setPages({ key: filterKey, cursors: [...cursors, nextCursor] })}
                            />
                        </div>
                    )}
                </div>
            </div>
        </CommercePage>
    );
}

function AuditFilters({
    tab,
    search,
    filters,
    rows,
    onSearch,
}: {
    tab: AuditTab;
    search: AuditSearch;
    filters: AuditFilterValues;
    rows: AuditRow[];
    onSearch: (next: Partial<AuditSearch>) => void;
}) {
    const { t } = useTranslation('commerce');
    const locations = useReportLocations();
    const kinds = useAuditKinds();
    const actors = useAuditActors();
    const [reference, setReference] = useState(search.reference ?? '');
    useEffect(() => setReference(search.reference ?? ''), [search.reference]);

    // People: everyone the server has seen in the reader's audit scope (R9), plus anyone in the rows.
    const people = useMemo(() => {
        const map = new Map<string, string>();
        (actors.data ?? []).forEach((a) => map.set(a.userId, a.name));
        rows.forEach((r) => r.actorUserId && !map.has(r.actorUserId) && map.set(r.actorUserId, r.actorName ?? r.actorUserId));
        if (search.actor && !map.has(search.actor)) map.set(search.actor, search.actor);
        return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [actors.data, rows, search.actor]);

    const applyReference = () => {
        const next = reference.trim() || undefined;
        if (next !== search.reference) onSearch({ reference: next });
    };
    const today = indiaToday();

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="audit-filters">
            <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                {t('reports.filters.from')}
                <input
                    type="date"
                    className={inputClass}
                    value={filters.from ?? ''}
                    max={today}
                    onChange={(e) => onSearch({ from: e.target.value || undefined })}
                    data-testid="audit-from"
                />
            </label>
            <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                {t('reports.filters.to')}
                <input
                    type="date"
                    className={inputClass}
                    value={filters.to ?? ''}
                    max={today}
                    onChange={(e) => onSearch({ to: e.target.value || undefined })}
                    data-testid="audit-to"
                />
            </label>
            <label className="flex flex-col gap-1.5 text-caption text-muted-foreground">
                {t('reports.audit.reference')}
                <input
                    type="search"
                    className={inputClass}
                    value={reference}
                    placeholder={t('reports.audit.referencePlaceholder')}
                    onChange={(e) => setReference(e.target.value)}
                    onBlur={applyReference}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') applyReference();
                    }}
                    data-testid="audit-reference"
                />
            </label>
            {tab === 'changes' && (
                <>
                    <PlainSelect
                        label={t('reports.audit.who')}
                        value={search.actor ?? ''}
                        noneLabel={t('reports.audit.everyone')}
                        onChange={(actor) => onSearch({ actor: actor || undefined })}
                        options={people}
                    />
                    <PlainSelect
                        label={t('reports.filters.location')}
                        value={search.location ?? ''}
                        noneLabel={t('reports.filters.allPlaces')}
                        onChange={(location) => onSearch({ location: location || undefined })}
                        options={locations.places.map((p) => ({ value: p.id, label: placeLabel(p) }))}
                    />
                    <PlainSelect
                        label={t('reports.audit.kind')}
                        value={search.kind ?? ''}
                        noneLabel={t('reports.audit.allKinds')}
                        onChange={(kind) => onSearch({ kind: kind || undefined })}
                        options={(kinds.data ?? []).map((kind) => ({ value: kind, label: kindLabel(kind, t) }))}
                    />
                </>
            )}
        </div>
    );
}

/** A kind in the admin's words; a kind not yet named reads "Tracking edited", not `TRACKING_EDITED` (M9). */
const kindLabel = (kind: string, t: TFunction) =>
    KNOWN_KINDS.has(kind) ? t(`reports.audit.kinds.${kind}`) : humanCode(kind);

function ChangesTable({ rows }: { rows: AuditRow[] }) {
    const { t } = useTranslation('commerce');
    const columns = useMemo<ColumnDef<AuditRow>[]>(
        () => [
            { id: 'when', header: t('reports.audit.when'), cell: ({ row }) => formatIndiaDateTime(row.original.at) },
            { id: 'who', header: t('reports.audit.who'), cell: ({ row }) => row.original.actorName ?? '—' },
            { id: 'where', header: t('reports.filters.location'), cell: ({ row }) => row.original.locationName ?? '—' },
            { id: 'kind', header: t('reports.audit.kind'), cell: ({ row }) => kindLabel(row.original.kind, t) },
            {
                id: 'reference',
                header: t('reports.audit.document'),
                cell: ({ row }) => row.original.referenceLabel ?? row.original.referenceType ?? '—',
            },
            {
                id: 'changes',
                header: t('reports.audit.changes'),
                size: 320,
                cell: ({ row }) => <AuditChanges changes={row.original.changes} />,
            },
            { id: 'reason', header: t('reports.audit.reason'), cell: ({ row }) => row.original.reason ?? '—' },
        ],
        [t]
    );
    if (rows.length === 0) return <CommerceEmptyState title={t('reports.audit.empty')} />;
    return (
        <div data-testid="audit-changes-table">
            <MyTable<AuditRow>
                data={{ content: rows, page_no: 0, page_size: rows.length, total_elements: rows.length, total_pages: 1, last: true }}
                columns={columns}
                isLoading={false}
                error={null}
                currentPage={0}
                scrollable
                enableColumnPinning={false}
            />
        </div>
    );
}

function ApprovalsTable({ rows }: { rows: ApprovalRow[] }) {
    const { t } = useTranslation('commerce');
    const columns = useMemo<ColumnDef<ApprovalRow>[]>(
        () => [
            { id: 'when', header: t('reports.audit.when'), cell: ({ row }) => formatIndiaDateTime(row.original.at) },
            {
                id: 'action',
                header: t('reports.audit.action'),
                cell: ({ row }) =>
                    KNOWN_ACTIONS.has(row.original.action)
                        ? t(`reports.audit.actions.${row.original.action}`)
                        : humanCode(row.original.action) || '—',
            },
            { id: 'reference', header: t('reports.audit.document'), cell: ({ row }) => row.original.referenceLabel ?? '—' },
            { id: 'requested', header: t('reports.audit.requestedBy'), cell: ({ row }) => row.original.requestedBy ?? '—' },
            { id: 'approved', header: t('reports.audit.approvedBy'), cell: ({ row }) => row.original.approvedBy ?? '—' },
            {
                id: 'amount',
                header: t('reports.audit.amount'),
                cell: ({ row }) =>
                    row.original.amount === null || row.original.amount === undefined ? (
                        <span className="block text-end">—</span>
                    ) : (
                        <MoneyCell value={row.original.amount as number | string} />
                    ),
            },
            { id: 'reason', header: t('reports.audit.reason'), cell: ({ row }) => row.original.reason ?? '—' },
        ],
        [t]
    );
    if (rows.length === 0) return <CommerceEmptyState title={t('reports.audit.emptyApprovals')} />;
    return (
        <div data-testid="audit-approvals-table">
            <MyTable<ApprovalRow>
                data={{ content: rows, page_no: 0, page_size: rows.length, total_elements: rows.length, total_pages: 1, last: true }}
                columns={columns}
                isLoading={false}
                error={null}
                currentPage={0}
                scrollable
                enableColumnPinning={false}
            />
        </div>
    );
}
