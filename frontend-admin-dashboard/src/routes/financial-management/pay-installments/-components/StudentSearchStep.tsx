import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { CursorClick, MagnifyingGlass, UserCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyTable, TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Input } from '@/components/ui/input';
import {
    FeeSearchFilterDTO,
    FinancalManagementPaginatedResponse,
    StudentFeePaymentRowDTO,
} from '@/types/manage-finances';
import { fetchManageFinancesLogs, getManageFinancesQueryKey } from '@/services/manage-finances';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
    PAID: { bg: 'bg-success-50', text: 'text-success-700', dot: 'bg-success-500' },
    OVERDUE: { bg: 'bg-danger-50', text: 'text-danger-700', dot: 'bg-danger-500' },
    PARTIAL: { bg: 'bg-warning-50', text: 'text-warning-700', dot: 'bg-warning-500' },
    PENDING: { bg: 'bg-neutral-100', text: 'text-neutral-600', dot: 'bg-neutral-400' },
};

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

// ─── Component ──────────────────────────────────────────────────────────────

interface StudentSearchStepProps {
    onSelectStudent: (student: StudentFeePaymentRowDTO) => void;
}

export function StudentSearchStep({ onSelectStudent }: StudentSearchStepProps) {
    const { t } = useTranslation('financialManagementStudentSearchStep');
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const { getDetailsFromPackageSessionId, instituteDetails } = useInstituteDetailsStore();

    const [filter, setFilter] = useState<FeeSearchFilterDTO>({
        page: 0,
        size: 10,
        sortBy: 'studentName',
        sortDirection: 'ASC',
        filters: {},
    });

    const [searchInput, setSearchInput] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        debounceRef.current = setTimeout(() => {
            setFilter((prev) => ({
                ...prev,
                page: 0,
                filters: { ...prev.filters, studentSearchQuery: searchInput || undefined },
            }));
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchInput]);

    const { data, isLoading, error } = useQuery({
        queryKey: getManageFinancesQueryKey(filter),
        queryFn: () => fetchManageFinancesLogs(filter),
        staleTime: 30000,
    });

    const getPackageName = useCallback(
        (id: string) => {
            let details = getDetailsFromPackageSessionId({ packageSessionId: id });
            if (!details && instituteDetails?.batches_for_sessions) {
                details =
                    instituteDetails.batches_for_sessions.find(
                        (batch: any) => batch.package_dto?.id === id || batch.id === id
                    ) || null;
            }
            if (details) {
                const pkg = (details as any).package_dto?.package_name || '';
                const lvl = (details as any).level?.level_name || '';
                if (pkg && lvl) return `${pkg} - ${lvl}`;
                if (pkg) return pkg;
            }
            return id;
        },
        [getDetailsFromPackageSessionId, instituteDetails]
    );

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

    const columns = useMemo<ColumnDef<StudentFeePaymentRowDTO>[]>(
        () => [
            {
                id: 'student',
                header: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                accessorFn: (row) => row.student_name || '',
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="min-w-36 space-y-0.5">
                            <div className="font-semibold text-neutral-800">
                                {r.student_name || '\u2014'}
                            </div>
                            {r.phone && (
                                <div className="text-caption text-neutral-400">{r.phone}</div>
                            )}
                        </div>
                    );
                },
                size: 260,
            },
            {
                id: 'package',
                header: t('table.coursePackage'),
                accessorFn: (row) => {
                    const ids = row.package_session_ids || [];
                    return ids.length ? ids.map((id) => getPackageName(id)).join(', ') : '\u2014';
                },
                cell: ({ row }) => {
                    const ids = row.original.package_session_ids || [];
                    const names = ids.map((id) => getPackageName(id));
                    const display = names.length > 0 ? names.join(', ') : '\u2014';
                    return (
                        <div className="truncate text-sm text-neutral-700" title={display}>
                            {display}
                        </div>
                    );
                },
                size: 340,
            },
            {
                id: 'dueAmount',
                header: t('table.due'),
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
                size: 180,
            },
            {
                id: 'overdueAmount',
                header: t('table.overdue'),
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
                size: 180,
            },
            {
                id: 'status',
                header: t('table.status'),
                accessorFn: (row) => row.status || '',
                cell: ({ row }) => <StatusPill status={row.original.status} />,
                size: 160,
            },
        ],
        [getPackageName, t]
    );

    const handlePageChange = (page: number) => {
        setFilter((prev) => ({ ...prev, page }));
    };

    return (
        <div className="space-y-4">
            {/* Search Input */}
            <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <UserCircle size={18} className="text-primary-500" />
                    <h3 className="text-subtitle font-semibold text-neutral-800">
                        {t('redesign.findTitle', { learner: learnerTerm.toLowerCase() })}
                    </h3>
                    <span className="flex items-center gap-1 text-caption text-neutral-500">
                        <CursorClick size={14} />
                        {t('redesign.findHint', { learner: learnerTerm.toLowerCase() })}
                    </span>
                </div>
                <div className="relative max-w-md">
                    <MagnifyingGlass
                        size={18}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <Input
                        placeholder={t('searchPlaceholder')}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* Results */}
            {isLoading && (
                <div className="flex h-48 items-center justify-center">
                    <DashboardLoader />
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-danger-200 bg-danger-50 p-8 text-center">
                    <p className="font-semibold text-danger-700">{t('errors.unableToLoad')}</p>
                    <p className="mt-2 text-sm text-danger-600">
                        {error instanceof Error ? error.message : t('errors.tryAgain')}
                    </p>
                </div>
            )}

            {!isLoading && !error && tableData && tableData.content.length === 0 && (
                <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center">
                    <p className="text-lg font-semibold text-neutral-600">
                        {t('empty.noStudentsFound')}
                    </p>
                    <p className="mt-2 text-sm text-neutral-400">{t('empty.trySearching')}</p>
                </div>
            )}

            {!isLoading && !error && tableData && tableData.content.length > 0 && (
                <div className="space-y-4">
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                        <MyTable
                            data={tableData}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={filter.page}
                            scrollable={true}
                            enableColumnResizing={true}
                            enableColumnPinning={false}
                            onCellClick={(row: StudentFeePaymentRowDTO) => {
                                onSelectStudent(row);
                            }}
                        />
                    </div>

                    {tableData.total_pages > 1 && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-5 py-3 shadow-sm">
                            <div className="text-sm font-medium text-neutral-500">
                                {t('pagination.showing')}{' '}
                                <span className="font-semibold text-neutral-800">
                                    {tableData.page_no * tableData.page_size + 1}
                                </span>
                                {' \u2013 '}
                                <span className="font-semibold text-neutral-800">
                                    {Math.min(
                                        (tableData.page_no + 1) * tableData.page_size,
                                        tableData.total_elements
                                    )}
                                </span>{' '}
                                {t('pagination.of')}{' '}
                                <span className="font-semibold text-neutral-800">
                                    {tableData.total_elements}
                                </span>
                            </div>
                            <MyPagination
                                currentPage={filter.page}
                                totalPages={tableData.total_pages}
                                onPageChange={handlePageChange}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
