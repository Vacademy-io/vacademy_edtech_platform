import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ColumnDef } from '@tanstack/react-table';
import { MyTable, TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Eye, CaretDown, CaretRight, UsersThree } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    FinancalManagementPaginatedResponse,
    StudentFeePaymentRowDTO,
    InstallmentDetailDTO,
} from '@/types/manage-finances';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { InstallmentDetailsModal } from './InstallmentDetailsModal';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    fetchInstallmentDetails,
    getInstallmentDetailsQueryKey,
} from '@/services/manage-finances';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ManageFinancesTableProps {
    data: FinancalManagementPaginatedResponse | undefined;
    isLoading: boolean;
    error: unknown;
    currentPage: number;
    onPageChange: (page: number) => void;
    isFeeTypeFiltered?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
    PAID: { bg: 'bg-success-50', text: 'text-success-700', dot: 'bg-success-500' },
    OVERDUE: { bg: 'bg-danger-50', text: 'text-danger-700', dot: 'bg-danger-500' },
    PARTIAL: { bg: 'bg-warning-50', text: 'text-warning-700', dot: 'bg-warning-500' },
    PENDING: { bg: 'bg-neutral-100', text: 'text-neutral-600', dot: 'bg-neutral-400' },
};

function buildInstallmentStatusColors(
    t: TFunction
): Record<string, { bg: string; label: string }> {
    return {
        PAID: { bg: 'bg-success-500', label: t('installmentStatus.paid') },
        PARTIAL_PAID: { bg: 'bg-warning-500', label: t('installmentStatus.partial') },
        OVERDUE: { bg: 'bg-danger-500', label: t('installmentStatus.overdue') },
        PENDING: { bg: 'bg-neutral-200', label: t('installmentStatus.pending') },
        WAIVED: { bg: 'bg-info-500', label: t('installmentStatus.waived') },
    };
}

function StatusPill({ status }: { status: string }) {
    const style = STATUS_STYLES[status] || STATUS_STYLES['PENDING']!;
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}
        >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
            {status}
        </span>
    );
}

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

// ─── Percentage Progress Bar (parent row) ──────────────────────────────────

function PercentageProgressBar({
    paid,
    due,
    overdue,
    total,
}: {
    paid: number;
    due: number;
    overdue: number;
    total: number;
}) {
    const { t } = useTranslation('financialManagementManageFinancesTable');
    if (total <= 0) return <span className="text-neutral-400">—</span>;

    const paidPct = Math.round((paid / total) * 100);
    const overduePct = Math.round((overdue / total) * 100);
    const duePct = Math.max(0, 100 - paidPct - overduePct);

    return (
        <div className="flex min-w-32 max-w-44 flex-col gap-1">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100">
                {paidPct > 0 && (
                    <div
                        className="h-full bg-success-500 transition-all"
                        style={{ width: `${paidPct}%` }}
                        title={t('progressBar.paidTooltip', { percent: paidPct })}
                    />
                )}
                {overduePct > 0 && (
                    <div
                        className="h-full bg-danger-500 transition-all"
                        style={{ width: `${overduePct}%` }}
                        title={t('progressBar.overdueTooltip', { percent: overduePct })}
                    />
                )}
                {duePct > 0 && (
                    <div
                        className="h-full bg-warning-400 transition-all"
                        style={{ width: `${duePct}%` }}
                        title={t('progressBar.dueTooltip', { percent: duePct })}
                    />
                )}
            </div>
            <div className="text-caption font-medium text-neutral-500">
                {t('progressBar.paidLabel', { percent: paidPct })}
            </div>
        </div>
    );
}

// ─── Installment Progress Bar (per fee type in expanded row) ───────────────

function InstallmentProgressBar({ statuses }: { statuses: string[] }) {
    const { t } = useTranslation('financialManagementManageFinancesTable');
    if (!statuses || statuses.length === 0) return <span className="text-neutral-400">—</span>;

    const statusColors = buildInstallmentStatusColors(t);

    return (
        <div className="flex min-w-20 max-w-40 items-center gap-0.5">
            {statuses.map((status, idx) => {
                const config = statusColors[status] || statusColors['PENDING']!;
                return (
                    <div
                        key={idx}
                        className={cn(
                            'group relative h-5 flex-1 cursor-default rounded-sm',
                            config.bg
                        )}
                    >
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 group-hover:block">
                            <div className="whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-caption font-medium text-white shadow-lg">
                                {t('installmentTooltip', { number: idx + 1, label: config.label })}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Expanded Row Content ──────────────────────────────────────────────────

interface FeeTypeGroup {
    feeTypeName: string;
    totalExpected: number;
    totalPaid: number;
    totalDue: number;
    totalOverdue: number;
    installmentStatuses: string[];
}

function groupByFeeType(installments: InstallmentDetailDTO[]): FeeTypeGroup[] {
    const map = new Map<string, FeeTypeGroup>();
    for (const inst of installments) {
        const key = inst.fee_type_name;
        let group = map.get(key);
        if (!group) {
            group = {
                feeTypeName: key,
                totalExpected: 0,
                totalPaid: 0,
                totalDue: 0,
                totalOverdue: 0,
                installmentStatuses: [],
            };
            map.set(key, group);
        }
        group.totalExpected += inst.amount_expected;
        group.totalPaid += inst.amount_paid;
        const instDue = inst.due_amount ?? 0;
        if (inst.status === 'OVERDUE') {
            group.totalOverdue += instDue;
        } else {
            group.totalDue += instDue;
        }
        group.installmentStatuses.push(inst.status);
    }
    return Array.from(map.values());
}

function ExpandedRowContent({ studentId, cpoId }: { studentId: string; cpoId: string }) {
    const { t } = useTranslation('financialManagementManageFinancesTable');
    const { data, isLoading, error } = useQuery({
        queryKey: getInstallmentDetailsQueryKey(studentId, cpoId),
        queryFn: () => fetchInstallmentDetails(studentId, cpoId),
        enabled: !!studentId && !!cpoId,
        staleTime: 30000,
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-4">
                <DashboardLoader />
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-6 py-3 text-sm text-danger-600">{t('expandedRow.loadFailed')}</div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="px-6 py-3 text-sm text-neutral-500">
                {t('expandedRow.noInstallments')}
            </div>
        );
    }

    const feeTypeGroups = groupByFeeType(data);
    const statusColors = buildInstallmentStatusColors(t);

    return (
        <div className="px-6 py-3 space-y-2">
            {/* Legend */}
            <div className="mb-1 flex items-center gap-4">
                <span className="text-caption font-semibold uppercase tracking-wider text-neutral-400">
                    {t('legend.installmentStatus')}
                </span>
                {Object.entries(statusColors).map(([key, config]) => (
                    <div key={key} className="flex items-center gap-1">
                        <span className={cn('inline-block size-2.5 rounded-sm', config.bg)} />
                        <span className="text-caption text-neutral-500">{config.label}</span>
                    </div>
                ))}
            </div>

            {/* Fee type rows */}
            <div className="overflow-hidden rounded-lg border border-neutral-200">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-100/80">
                            <th className="px-4 py-2 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                {t('expandedRow.columns.feeType')}
                            </th>
                            <th className="px-4 py-2 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                {t('expandedRow.columns.expected')}
                            </th>
                            <th className="px-4 py-2 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                {t('expandedRow.columns.paid')}
                            </th>
                            <th className="px-4 py-2 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                {t('expandedRow.columns.due')}
                            </th>
                            <th className="px-4 py-2 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                {t('expandedRow.columns.overdue')}
                            </th>
                            <th className="min-w-36 px-4 py-2 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                {t('expandedRow.columns.installments')}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {feeTypeGroups.map((group) => (
                            <tr key={group.feeTypeName} className="hover:bg-neutral-50/60">
                                <td className="px-4 py-2 font-semibold text-neutral-800">
                                    {group.feeTypeName}
                                </td>
                                <td className="px-4 py-2 text-neutral-700">
                                    {formatCurrency(group.totalExpected)}
                                </td>
                                <td className="px-4 py-2 font-semibold text-success-700">
                                    {formatCurrency(group.totalPaid)}
                                </td>
                                <td className="px-4 py-2 font-semibold text-warning-600">
                                    {group.totalDue > 0 ? formatCurrency(group.totalDue) : '—'}
                                </td>
                                <td className="px-4 py-2 font-semibold text-danger-600">
                                    {group.totalOverdue > 0
                                        ? formatCurrency(group.totalOverdue)
                                        : '—'}
                                </td>
                                <td className="py-2 px-4">
                                    <InstallmentProgressBar
                                        statuses={group.installmentStatuses}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ManageFinancesTable({
    data,
    isLoading,
    error,
    currentPage,
    onPageChange,
    isFeeTypeFiltered = false,
}: ManageFinancesTableProps) {
    const { t } = useTranslation('financialManagementManageFinancesTable');
    const { getDetailsFromPackageSessionId, instituteDetails } = useInstituteDetailsStore();

    // Modal state (eye button only)
    const [selectedRow, setSelectedRow] = useState<{
        studentId: string;
        cpoId: string;
        studentName: string;
        cpoName: string;
    } | null>(null);

    // Expanded rows state
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const toggleExpand = useCallback((studentId: string, cpoId: string) => {
        const key = `${studentId}_${cpoId}`;
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const isExpanded = useCallback(
        (studentId: string, cpoId: string) => expandedRows.has(`${studentId}_${cpoId}`),
        [expandedRows]
    );

    // Map package_session_id → "Package Name - Level"
    const getPackageName = useCallback(
        (id: string) => {
            let details = getDetailsFromPackageSessionId({ packageSessionId: id });
            if (!details && instituteDetails?.batches_for_sessions) {
                details =
                    instituteDetails.batches_for_sessions.find(
                        (batch) => batch.package_dto?.id === id || batch.id === id
                    ) || null;
            }
            if (details) {
                const pkg = details.package_dto?.package_name || '';
                const lvl = details.level?.level_name || '';
                if (pkg && lvl) return `${pkg} - ${lvl}`;
                if (pkg) return pkg;
            }
            return id;
        },
        [getDetailsFromPackageSessionId, instituteDetails]
    );

    // Normalize paginated response (handle camel / snake)
    const tableData: TableData<StudentFeePaymentRowDTO> | undefined = useMemo(() => {
        if (!data) return undefined;
        const d = data as any;
        return {
            content: d.content || [],
            total_pages: d.totalPages ?? d.total_pages ?? 0,
            page_no: d.number ?? d.page_no ?? d.page ?? 0,
            page_size: d.size ?? d.page_size ?? 10,
            total_elements: d.totalElements ?? d.total_elements ?? 0,
            last: d.last ?? false,
        };
    }, [data]);

    // ── Column definitions ──────────────────────────────────────────────

    const columns = useMemo<ColumnDef<StudentFeePaymentRowDTO>[]>(
        () => [
            {
                id: 'expand',
                header: '',
                cell: ({ row }) => {
                    const r = row.original;
                    const expanded = isExpanded(r.student_id, r.cpo_id);
                    return (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(r.student_id, r.cpo_id);
                            }}
                            className="p-1 text-neutral-400 transition-colors hover:text-neutral-700"
                        >
                            {expanded ? (
                                <CaretDown size={14} weight="bold" />
                            ) : (
                                <CaretRight size={14} weight="bold" />
                            )}
                        </button>
                    );
                },
                size: 40,
            },
            {
                id: 'student',
                header: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                accessorFn: (row) => row.student_name || '',
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="min-w-36 space-y-0.5">
                            <div className="font-semibold text-neutral-800">
                                {r.student_name || '—'}
                            </div>
                            {r.phone && (
                                <div className="text-caption text-neutral-400">{r.phone}</div>
                            )}
                        </div>
                    );
                },
                size: 180,
            },
            {
                id: 'package',
                header: t('columns.package'),
                accessorFn: (row) => {
                    const ids = row.package_session_ids || [];
                    return ids.length ? ids.map((id) => getPackageName(id)).join(', ') : '—';
                },
                cell: ({ row }) => {
                    const ids = row.original.package_session_ids || [];
                    const names = ids.map((id) => getPackageName(id));
                    const display = names.length > 0 ? names.join(', ') : '—';
                    return (
                        <div className="max-w-48 truncate text-sm text-neutral-700" title={display}>
                            {display}
                        </div>
                    );
                },
                size: 200,
            },
            {
                id: 'cpoName',
                header: t('columns.cpoName'),
                accessorFn: (row) => row.cpo_name || '',
                cell: ({ row }) => (
                    <div className="text-sm font-medium text-neutral-700">
                        {row.original.cpo_name || '—'}
                    </div>
                ),
                size: 160,
            },
            {
                id: 'totalExpected',
                header: t('columns.expected'),
                accessorFn: (row) => row.total_expected_amount ?? 0,
                cell: ({ row }) => (
                    <div className="font-semibold text-neutral-800">
                        {formatCurrency(row.original.total_expected_amount ?? 0)}
                    </div>
                ),
                size: 120,
            },
            {
                id: 'totalPaid',
                header: t('columns.paid'),
                accessorFn: (row) => row.total_paid_amount ?? 0,
                cell: ({ row }) => (
                    <div className="font-semibold text-success-700">
                        {formatCurrency(row.original.total_paid_amount ?? 0)}
                    </div>
                ),
                size: 120,
            },
            {
                id: 'dueAmount',
                header: t('columns.due'),
                accessorFn: (row) => row.due_amount ?? 0,
                cell: ({ row }) => {
                    const due = row.original.due_amount ?? 0;
                    return (
                        <div
                            className={`font-semibold ${due > 0 ? 'text-warning-600' : 'text-neutral-400'}`}
                        >
                            {formatCurrency(due)}
                        </div>
                    );
                },
                size: 120,
            },
            {
                id: 'overdueAmount',
                header: t('columns.overdue'),
                accessorFn: (row) => row.overdue_amount ?? 0,
                cell: ({ row }) => {
                    const od = row.original.overdue_amount ?? 0;
                    return (
                        <div
                            className={`font-semibold ${od > 0 ? 'text-danger-600' : 'text-neutral-400'}`}
                        >
                            {formatCurrency(od)}
                        </div>
                    );
                },
                size: 120,
            },
            {
                id: 'status',
                header: t('columns.status'),
                accessorFn: (row) => row.status || '',
                cell: ({ row }) => <StatusPill status={row.original.status} />,
                size: 120,
            },
            {
                id: 'progress',
                header: t('columns.progress'),
                cell: ({ row }) => {
                    const r = row.original;
                    if (isFeeTypeFiltered) {
                        return (
                            <InstallmentProgressBar
                                statuses={r.installment_statuses || []}
                            />
                        );
                    }
                    return (
                        <PercentageProgressBar
                            paid={r.total_paid_amount ?? 0}
                            due={r.due_amount ?? 0}
                            overdue={r.overdue_amount ?? 0}
                            total={r.total_expected_amount ?? 0}
                        />
                    );
                },
                size: 180,
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const r = row.original;
                            setSelectedRow({
                                studentId: r.student_id,
                                cpoId: r.cpo_id,
                                studentName: r.student_name,
                                cpoName: r.cpo_name,
                            });
                        }}
                        className="rounded-full p-1.5 text-neutral-400 transition-all hover:bg-primary-50 hover:text-primary-600"
                        title={t('actions.viewInstallments')}
                    >
                        <Eye size={18} weight="duotone" />
                    </button>
                ),
                size: 50,
            },
        ],
        [getPackageName, isExpanded, toggleExpand, isFeeTypeFiltered, t]
    );

    // ── Render expanded row ────────────────────────────────────────────

    const renderExpandedRow = useCallback(
        (row: StudentFeePaymentRowDTO) => {
            if (!isExpanded(row.student_id, row.cpo_id)) return null;
            return <ExpandedRowContent studentId={row.student_id} cpoId={row.cpo_id} />;
        },
        [isExpanded]
    );

    // ── Render states ───────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="flex h-48 items-center justify-center font-semibold tracking-wide text-neutral-500">
                <DashboardLoader />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-danger-200 bg-danger-50 p-8 text-center shadow-sm">
                <p className="font-semibold text-danger-700">{t('error.title')}</p>
                <p className="mt-2 text-sm text-danger-600">
                    {error instanceof Error ? error.message : t('error.genericMessage')}
                </p>
            </div>
        );
    }

    if (!tableData) return null;

    if (tableData.content.length === 0) {
        return (
            <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center shadow-sm">
                <p className="text-lg font-semibold text-neutral-600">{t('empty.title')}</p>
                <p className="mt-2 text-sm text-neutral-400">{t('empty.subtitle')}</p>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4">
                {/* Table Card */}
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-5 py-3">
                        <UsersThree size={16} className="text-neutral-500" />
                        <h3 className="text-subtitle font-semibold text-neutral-800">
                            {t('redesign.rosterTitle')}
                        </h3>
                        <span className="text-caption text-neutral-500">
                            {t('redesign.rosterHint')}
                        </span>
                    </div>
                    <MyTable
                        data={tableData}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={currentPage}
                        scrollable={true}
                        enableColumnResizing={true}
                        enableColumnPinning={false}
                        onCellClick={(row: StudentFeePaymentRowDTO, column: ColumnDef<StudentFeePaymentRowDTO>) => {
                            const colId = column.id || (column as any).accessorKey;
                            if (colId === 'actions' || colId === 'expand') return;
                            toggleExpand(row.student_id, row.cpo_id);
                        }}
                        renderExpandedRow={renderExpandedRow}
                    />
                </div>

                {/* Pagination */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-3 shadow-sm">
                    <div className="text-sm font-medium text-neutral-500">
                        <Trans
                            i18nKey="pagination.showingRange"
                            ns="financialManagementManageFinancesTable"
                            count={tableData.total_elements}
                            values={{
                                start: tableData.page_no * tableData.page_size + 1,
                                end: Math.min(
                                    (tableData.page_no + 1) * tableData.page_size,
                                    tableData.total_elements
                                ),
                                count: tableData.total_elements,
                            }}
                            components={{ b: <span className="font-semibold text-neutral-800" /> }}
                        />
                    </div>
                    <MyPagination
                        currentPage={currentPage}
                        totalPages={tableData.total_pages}
                        onPageChange={onPageChange}
                    />
                </div>
            </div>

            {/* Installment Details Popup (eye button only) */}
            {selectedRow && (
                <InstallmentDetailsModal
                    open={!!selectedRow}
                    onOpenChange={(open) => {
                        if (!open) setSelectedRow(null);
                    }}
                    studentId={selectedRow.studentId}
                    cpoId={selectedRow.cpoId}
                    studentName={selectedRow.studentName}
                    cpoName={selectedRow.cpoName}
                />
            )}
        </>
    );
}
