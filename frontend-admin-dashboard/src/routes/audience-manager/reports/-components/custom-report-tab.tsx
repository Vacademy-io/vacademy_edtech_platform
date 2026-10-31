/**
 * Reports Center — Custom Report Builder tab.
 *
 * Self-serve report builder over a curated semantic model. The user picks dimensions (group-by),
 * measures (aggregates) and filters from the server's catalog (GET /custom/catalog), then runs the
 * spec (POST /custom/run). No SQL ever leaves the browser — only whitelisted field keys. The page
 * date range + team/counsellor scope from the shared filter bar are applied to every run.
 *
 * Matrix view: when the result has exactly two dimensions and one measure (e.g. Counsellor ×
 * Current status → Leads), a client-side pivot renders the second dimension as columns — the
 * same grid shape as the Dispositions-tab matrices. Pure presentation; the flat rows from the
 * server are the source of truth and the CSV export follows whichever view is active.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, FunnelSimple, Play, Table as TableIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    customCatalogQueryKey,
    fetchCustomCatalog,
    runCustomReport,
    type CustomReportFilter,
} from '../-services/get-custom-report';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    type ReportTabProps,
} from './report-shared';

export function CustomReportTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerCustomReportTab');

    const catalog = useQuery({
        queryKey: customCatalogQueryKey(instituteId),
        queryFn: () => fetchCustomCatalog(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    });

    const [dims, setDims] = useState<string[]>([]);
    const [measures, setMeasures] = useState<string[]>([]);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [matrixView, setMatrixView] = useState(false);

    const run = useMutation({ mutationFn: runCustomReport });

    const canRun = dims.length > 0 && measures.length > 0 && !!instituteId;

    const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
        set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

    const toggleFilterValue = (field: string, value: string) =>
        setFilters((prev) => {
            const cur = prev[field] ?? [];
            const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
            return { ...prev, [field]: next };
        });

    const doRun = () => {
        if (!canRun) return;
        const activeFilters: CustomReportFilter[] = Object.entries(filters)
            .filter(([, values]) => values.length > 0)
            .map(([field, values]) => ({ field, values }));
        run.mutate({
            instituteId,
            fromDate,
            toDate,
            teamId,
            counsellorUserId,
            dimensions: dims,
            measures,
            filters: activeFilters,
        });
    };

    const result = run.data ?? null;

    // Pivot the flat rows into a first-dim × second-dim grid — only defined for
    // exactly 2 dimensions + 1 measure (any other spec keeps the flat table).
    const pivot = useMemo(() => {
        if (!result) return null;
        const dimCols = result.columns.filter((c) => c.kind === 'dimension');
        const measCols = result.columns.filter((c) => c.kind === 'measure');
        if (dimCols.length !== 2 || measCols.length !== 1) return null;
        const colKeys: string[] = [];
        const rowOrder: string[] = [];
        const cells = new Map<string, Record<string, number | null>>();
        for (const row of result.rows) {
            const r = row[0] == null ? '—' : String(row[0]);
            const c = row[1] == null ? '—' : String(row[1]);
            const v = typeof row[2] === 'number' ? row[2] : null;
            if (!colKeys.includes(c)) colKeys.push(c);
            if (!cells.has(r)) {
                rowOrder.push(r);
                cells.set(r, {});
            }
            cells.get(r)![c] = v;
        }
        colKeys.sort((a, b) => a.localeCompare(b));
        return {
            rowDim: dimCols[0]!,
            colDim: dimCols[1]!,
            measure: measCols[0]!,
            colKeys,
            rows: rowOrder.map((r) => ({ key: r, values: cells.get(r)! })),
        };
    }, [result]);

    const showMatrix = matrixView && !!pivot;

    if (catalog.isLoading) return <ReportTabSkeleton />;
    if (catalog.isError)
        return <ReportErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;

    const data = catalog.data;

    return (
        <div className="flex flex-col gap-6">
            <ReportSection title={t('buildSection.title')} icon={<TableIcon size={18} />}>
                <FieldPicker
                    label={t('buildSection.groupByLabel')}
                    fields={data?.dimensions ?? []}
                    selected={dims}
                    onToggle={(k) => toggle(dims, setDims, k)}
                />
                <FieldPicker
                    label={t('buildSection.measuresLabel')}
                    fields={data?.measures ?? []}
                    selected={measures}
                    onToggle={(k) => toggle(measures, setMeasures, k)}
                    tone="primary"
                />

                {(data?.filters ?? []).some((f) => f.options.length > 0) && (
                    <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4">
                        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
                            <FunnelSimple size={13} /> {t('buildSection.filtersHeading')}
                        </span>
                        {(data?.filters ?? [])
                            .filter((f) => f.options.length > 0)
                            .map((f) => (
                                <div key={f.key} className="flex flex-col gap-1.5">
                                    <span className="text-xs text-neutral-600">{f.label}</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {f.options.map((o) => {
                                            const active = (filters[f.key] ?? []).includes(o.value);
                                            return (
                                                <Chip
                                                    key={o.value}
                                                    label={o.label}
                                                    active={active}
                                                    onClick={() =>
                                                        toggleFilterValue(f.key, o.value)
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                    </div>
                )}

                <div className="flex items-center gap-3 border-t border-neutral-100 pt-4">
                    <Button
                        onClick={doRun}
                        disabled={!canRun || run.isPending}
                        size="sm"
                        className="gap-1.5"
                    >
                        {run.isPending ? (
                            <ArrowClockwise size={14} className="animate-spin" />
                        ) : (
                            <Play size={14} />
                        )}
                        {t('buildSection.runButton')}
                    </Button>
                    {!canRun && (
                        <span className="text-xs text-neutral-400">
                            {t('buildSection.pickHint')}
                        </span>
                    )}
                </div>
            </ReportSection>

            {run.isError && <ReportErrorState error={run.error} onRetry={doRun} />}

            {result && (
                <ReportSection
                    title={t('resultSection.title')}
                    icon={<TableIcon size={18} />}
                    actions={
                        <div className="flex items-center gap-2">
                            {pivot && (
                                <Chip
                                    label={t('resultSection.matrixViewLabel')}
                                    active={matrixView}
                                    tone="primary"
                                    onClick={() => setMatrixView((v) => !v)}
                                />
                            )}
                            <ExportWithColumnPickerButton
                                filename={`custom-report_${fromDate}_${toDate}.csv`}
                                disabled={result.rows.length === 0}
                                getHeadersAndRows={() =>
                                    showMatrix && pivot
                                        ? {
                                              headers: [
                                                  pivot.rowDim.label,
                                                  ...pivot.colKeys,
                                                  t('resultSection.totalColumn'),
                                              ],
                                              rows: pivot.rows.map((r) => [
                                                  r.key,
                                                  ...pivot.colKeys.map((k) =>
                                                      formatCell(r.values[k] ?? null, 'number')
                                                  ),
                                                  formatCell(pivotRowTotal(r.values), 'number'),
                                              ]),
                                          }
                                        : {
                                              headers: result.columns.map((c) => c.label),
                                              rows: result.rows.map((row) =>
                                                  row.map((cell, i) =>
                                                      formatCell(cell, result.columns[i]?.type)
                                                  )
                                              ),
                                          }
                                }
                            />
                        </div>
                    }
                >
                    {result.rows.length === 0 ? (
                        <EmptyHint message={t('resultSection.emptyHint')} />
                    ) : showMatrix && pivot ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                            <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left">
                                                {pivot.rowDim.label}
                                            </th>
                                            {pivot.colKeys.map((k) => (
                                                <th key={k} className="py-2 pl-3 text-right">
                                                    {k}
                                                </th>
                                            ))}
                                            <th className="py-2 ps-3 text-end">
                                                {t('resultSection.totalColumn')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pivot.rows.map((r) => (
                                            <tr
                                                key={r.key}
                                                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                            >
                                                <td className="sticky left-0 z-10 bg-white py-2.5 pr-3 font-medium text-neutral-900">
                                                    {r.key}
                                                </td>
                                                {pivot.colKeys.map((k) => {
                                                    const v = r.values[k];
                                                    return (
                                                        <td
                                                            key={k}
                                                            className={cn(
                                                                'py-2.5 pl-3 text-right tabular-nums',
                                                                v != null && v !== 0
                                                                    ? 'text-neutral-800'
                                                                    : 'text-neutral-300'
                                                            )}
                                                        >
                                                            {formatCell(v ?? 0, 'number')}
                                                        </td>
                                                    );
                                                })}
                                                <td className="py-2.5 pl-3 text-right font-semibold text-neutral-900">
                                                    {formatCell(pivotRowTotal(r.values), 'number')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-neutral-400">
                                {t('resultSection.matrixCaption', {
                                    measure: pivot.measure.label,
                                    rowDim: pivot.rowDim.label.toLowerCase(),
                                    colDim: pivot.colDim.label.toLowerCase(),
                                })}
                            </p>
                            {result.truncated && (
                                <p className="text-xs text-amber-600">
                                    {t('resultSection.truncatedMatrix', {
                                        count: result.row_count,
                                    })}
                                </p>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                            {result.columns.map((c) => (
                                                <th
                                                    key={c.key}
                                                    className={cn(
                                                        'py-2 pr-3',
                                                        c.kind === 'measure'
                                                            ? 'text-right'
                                                            : 'text-left'
                                                    )}
                                                >
                                                    {c.label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.rows.map((row, ri) => (
                                            <tr
                                                key={ri}
                                                className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                            >
                                                {row.map((cell, ci) => {
                                                    const col = result.columns[ci];
                                                    return (
                                                        <td
                                                            key={ci}
                                                            className={cn(
                                                                'py-2.5 pr-3',
                                                                col?.kind === 'measure'
                                                                    ? 'text-right text-neutral-800'
                                                                    : 'font-medium text-neutral-900'
                                                            )}
                                                        >
                                                            {formatCell(cell, col?.type)}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {result.truncated && (
                                <p className="text-xs text-amber-600">
                                    {t('resultSection.truncatedTable', {
                                        count: result.row_count,
                                    })}
                                </p>
                            )}
                        </>
                    )}
                </ReportSection>
            )}
        </div>
    );
}

function FieldPicker({
    label,
    fields,
    selected,
    onToggle,
    tone = 'default',
}: {
    label: string;
    fields: { key: string; label: string }[];
    selected: string[];
    onToggle: (key: string) => void;
    tone?: 'default' | 'primary';
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {label}
            </span>
            <div className="flex flex-wrap gap-1.5">
                {fields.map((f) => (
                    <Chip
                        key={f.key}
                        label={f.label}
                        active={selected.includes(f.key)}
                        tone={tone}
                        onClick={() => onToggle(f.key)}
                    />
                ))}
            </div>
        </div>
    );
}

function Chip({
    label,
    active,
    onClick,
    tone = 'default',
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    tone?: 'default' | 'primary';
}) {
    const activeClass =
        tone === 'primary'
            ? 'border-primary-500 bg-primary-50 text-primary-700'
            : 'border-green-500 bg-green-50 text-green-700';
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                active
                    ? activeClass
                    : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
            )}
        >
            {label}
        </button>
    );
}

/** Sum of a pivot row's cell values (nulls skipped) for the trailing Total column. */
function pivotRowTotal(values: Record<string, number | null>): number {
    return Object.values(values).reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/** Measures render as grouped numbers; dimensions as their string value. Null → em-dash. */
function formatCell(cell: string | number | null, type?: string): string {
    if (cell == null) return '—';
    if (type === 'number' && typeof cell === 'number') {
        return cell.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(cell);
}
