import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ArrowCounterClockwise, ArrowLeft, CaretLeft, CaretRight, CurrencyInr, DownloadSimple, PencilSimple, Spinner, Wallet, WarningCircle, X } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { StudentFeePaymentRowDTO, StudentFeeDueDTO } from '@/types/manage-finances';
import {
    fetchStudentDues,
    getStudentDuesQueryKey,
    generateInvoiceForInstallments,
    sendInvoiceEmail,
    getReceiptUrlForInstallment,
    StudentDuesFilterRequest,
} from '@/services/manage-finances';
import { useTheme } from '@/providers/theme/theme-provider';
import { InvoiceActionDialog } from './InvoiceActionDialog';
import { AdjustmentDialog } from './AdjustmentDialog';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { StatStrip } from '@/components/shared/crm-enhance';

const PAGE_SIZE = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
    PAID: { bg: 'bg-success-50', text: 'text-success-700', dot: 'bg-success-500' },
    OVERDUE: { bg: 'bg-danger-50', text: 'text-danger-700', dot: 'bg-danger-500' },
    PARTIAL_PAID: { bg: 'bg-warning-50', text: 'text-warning-700', dot: 'bg-warning-500' },
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

function buildFilterStatusConfig(t: TFunction) {
    return [
        {
            value: 'ALL',
            label: t('filters.all'),
            activeBg: 'bg-primary-100',
            activeText: 'text-primary-600',
            activeBorder: 'border-primary-300',
        },
        {
            value: 'OVERDUE',
            label: t('filters.overdue'),
            activeBg: 'bg-danger-100',
            activeText: 'text-danger-700',
            activeBorder: 'border-danger-300',
        },
        {
            value: 'PENDING',
            label: t('filters.due'),
            activeBg: 'bg-warning-100',
            activeText: 'text-warning-700',
            activeBorder: 'border-warning-300',
        },
        {
            value: 'PARTIAL_PAID',
            label: t('filters.partial'),
            activeBg: 'bg-warning-100',
            activeText: 'text-warning-700',
            activeBorder: 'border-warning-300',
        },
        {
            value: 'PAID',
            label: t('filters.paid'),
            activeBg: 'bg-success-100',
            activeText: 'text-success-700',
            activeBorder: 'border-success-300',
        },
    ];
}

// ─── Component ──────────────────────────────────────────────────────────────

interface InstallmentSelectionStepProps {
    student: StudentFeePaymentRowDTO;
    onBack: () => void;
    onProceedToPayment: (selectedDues: StudentFeeDueDTO[]) => void;
}

export function InstallmentSelectionStep({
    student,
    onBack,
    onProceedToPayment,
}: InstallmentSelectionStepProps) {
    const { t } = useTranslation('financialManagementInstallmentSelectionStep');
    const { getPrimaryColorCode } = useTheme();
    const queryClient = useQueryClient();
    const filterStatusConfig = useMemo(() => buildFilterStatusConfig(t), [t]);

    // Filters + pagination
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [dueDateFrom, setDueDateFrom] = useState('');
    const [dueDateTo, setDueDateTo] = useState('');
    const [page, setPage] = useState(0);

    const filterBody = useMemo<StudentDuesFilterRequest>(() => ({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        start_due_date: dueDateFrom || undefined,
        end_due_date: dueDateTo || undefined,
        page,
        size: PAGE_SIZE,
    }), [statusFilter, dueDateFrom, dueDateTo, page]);

    // Reset to first page whenever filter inputs change
    useEffect(() => {
        setPage(0);
    }, [statusFilter, dueDateFrom, dueDateTo]);

    const { data: pageData, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: [...getStudentDuesQueryKey(student.student_id), filterBody],
        queryFn: () => fetchStudentDues(student.student_id, filterBody),
        staleTime: 30000,
        placeholderData: keepPreviousData,
    });

    // Cross-page selection: persist full DTOs as user navigates/filters
    const [selectedDuesMap, setSelectedDuesMap] = useState<Map<string, StudentFeeDueDTO>>(new Map());
    const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
    const [isSelectingAll, setIsSelectingAll] = useState(false);

    const pageContent = pageData?.content ?? [];
    const pageSelectable = useMemo(
        () => pageContent.filter((d) => d.status !== 'PAID'),
        [pageContent]
    );
    const selectedDues = useMemo(() => Array.from(selectedDuesMap.values()), [selectedDuesMap]);
    const selectedIds = useMemo(() => new Set(selectedDuesMap.keys()), [selectedDuesMap]);

    const totalSelectedDue = useMemo(
        () => selectedDues.reduce((sum, d) => sum + d.amount_due, 0),
        [selectedDues]
    );

    const summaryTotals = {
        totalFee: pageData?.total_fee ?? 0,
        totalPaid: pageData?.total_paid ?? 0,
        totalDue: pageData?.total_due ?? 0,
    };

    const totalElements = pageData?.total_elements ?? 0;
    const totalPages = pageData?.total_pages ?? 0;

    const hasActiveFilters = statusFilter !== 'ALL' || dueDateFrom || dueDateTo;

    const clearFilters = () => {
        setStatusFilter('ALL');
        setDueDateFrom('');
        setDueDateTo('');
    };

    const toggleSelect = (id: string, due: StudentFeeDueDTO) => {
        setSelectedDuesMap((prev) => {
            const next = new Map(prev);
            if (next.has(id)) next.delete(id);
            else next.set(id, due);
            return next;
        });
    };

    const pageFullySelected =
        pageSelectable.length > 0 && pageSelectable.every((d) => selectedDuesMap.has(d.id));

    const togglePageSelection = () => {
        setSelectedDuesMap((prev) => {
            const next = new Map(prev);
            if (pageFullySelected) {
                pageSelectable.forEach((d) => next.delete(d.id));
            } else {
                pageSelectable.forEach((d) => next.set(d.id, d));
            }
            return next;
        });
    };

    const handleSelectAllFiltered = async () => {
        setIsSelectingAll(true);
        try {
            const allMatching = await fetchStudentDues(student.student_id, {
                ...filterBody,
                fetch_all: true,
            });
            setSelectedDuesMap((prev) => {
                const next = new Map(prev);
                for (const d of allMatching.content) {
                    if (d.status !== 'PAID') next.set(d.id, d);
                }
                return next;
            });
            toast.success(
                t('toast.selectedInstallments', {
                    count: allMatching.content.filter((d) => d.status !== 'PAID').length,
                })
            );
        } catch {
            toast.error(t('toast.selectAllFailed'));
        } finally {
            setIsSelectingAll(false);
        }
    };

    const clearSelection = () => setSelectedDuesMap(new Map());

    const [adjustmentDialogInstallment, setAdjustmentDialogInstallment] = useState<StudentFeeDueDTO | null>(null);
    const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);

    const handleDownloadReceipt = async (installmentId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDownloadingReceiptId(installmentId);
        try {
            const data = await getReceiptUrlForInstallment(installmentId);
            window.open(data.download_url, '_blank');
        } catch {
            toast.error(t('toast.noReceiptFound'));
        } finally {
            setDownloadingReceiptId(null);
        }
    };

    const invoiceMutation = useMutation({
        mutationFn: () =>
            generateInvoiceForInstallments(student.student_id, Array.from(selectedIds)),
        onSuccess: (data) => {
            if (data.download_url) {
                window.open(data.download_url, '_blank');
                toast.success(t('toast.invoiceDownloaded'));
                setShowInvoiceDialog(false);
            } else {
                toast.error(t('toast.invoiceDownloadUrlMissing'));
            }
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.error || err?.message || t('toast.invoiceGenerateFailed'));
        },
    });

    const emailInvoiceMutation = useMutation({
        mutationFn: async (email: string) => {
            const data = await generateInvoiceForInstallments(
                student.student_id,
                Array.from(selectedIds)
            );
            if (!data.download_url) throw new Error(t('toast.invoiceDownloadUrlMissing'));
            await sendInvoiceEmail(email, student.student_name, data.download_url, getPrimaryColorCode());
        },
        onSuccess: () => {
            toast.success(t('toast.invoiceEmailed'));
            setShowInvoiceDialog(false);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.error || err?.message || t('toast.invoiceEmailFailed'));
        },
    });

    // ── Render ───────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="flex h-48 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-xl border border-danger-200 bg-danger-50 p-8 text-center">
                <p className="font-semibold text-danger-700">{t('errors.unableToLoad')}</p>
                <p className="mt-2 text-sm text-danger-600">
                    {error instanceof Error ? error.message : t('errors.tryAgain')}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* ── Top section ── */}
            <div className="space-y-4 mb-4">
                {/* Header */}
                <div className="flex items-center gap-4 rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-primary-600"
                    >
                        <ArrowLeft size={16} />
                        {t('changeStudent')}
                    </button>
                    <div className="h-5 w-px bg-neutral-200" />
                    <div>
                        <span className="font-semibold text-neutral-800">
                            {student.student_name}
                        </span>
                        {student.phone && (
                            <span className="ml-2 text-sm text-neutral-400">{student.phone}</span>
                        )}
                    </div>
                </div>

                {totalElements === 0 && !hasActiveFilters && (
                    <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center">
                        <p className="text-lg font-semibold text-neutral-600">
                            {t('emptyState.noDues')}
                        </p>
                        <p className="mt-2 text-sm text-neutral-400">
                            {t('emptyState.noPendingInstallments')}
                        </p>
                    </div>
                )}
            </div>

            {(totalElements > 0 || hasActiveFilters) && (
                <>
                    {/* Summary Cards */}
                    <div className="mb-4">
                        <StatStrip
                            items={[
                                {
                                    key: 'totalFee',
                                    icon: CurrencyInr,
                                    tint: 'info',
                                    label: t('summaryCards.totalFee'),
                                    value: formatCurrency(summaryTotals.totalFee),
                                },
                                {
                                    key: 'paid',
                                    icon: Wallet,
                                    tint: 'success',
                                    label: t('summaryCards.paid'),
                                    value: formatCurrency(summaryTotals.totalPaid),
                                },
                                {
                                    key: 'due',
                                    icon: WarningCircle,
                                    tint: 'danger',
                                    label: t('summaryCards.due'),
                                    value: formatCurrency(summaryTotals.totalDue),
                                },
                            ]}
                        />
                    </div>

                    {/* Filters */}
                    <div className="mb-4 rounded-xl border border-neutral-100 bg-white p-4 shadow-sm">
                        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                            <div className="flex flex-wrap items-center gap-2">
                                {filterStatusConfig.map((s) => (
                                    <button
                                        key={s.value}
                                        onClick={() => setStatusFilter(s.value)}
                                        className={cn(
                                            'px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors',
                                            statusFilter === s.value
                                                ? `${s.activeBg} ${s.activeText} ${s.activeBorder}`
                                                : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50'
                                        )}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            <div className="hidden h-5 w-px bg-neutral-200 sm:block" />

                            <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-neutral-500">
                                    {t('filters.from')}
                                </label>
                                <input
                                    type="date"
                                    value={dueDateFrom}
                                    onChange={(e) => setDueDateFrom(e.target.value)}
                                    className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm text-neutral-700 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                />
                                <label className="text-xs font-medium text-neutral-500">
                                    {t('filters.to')}
                                </label>
                                <input
                                    type="date"
                                    value={dueDateTo}
                                    onChange={(e) => setDueDateTo(e.target.value)}
                                    className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm text-neutral-700 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                />
                            </div>

                            {hasActiveFilters && (
                                <button
                                    onClick={clearFilters}
                                    className="flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors hover:text-danger-600"
                                >
                                    <X size={14} />
                                    {t('filters.clear')}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Select all filtered banner */}
                    {pageFullySelected && totalElements > pageContent.length && (
                        <div className="mb-2 flex items-center justify-between rounded-lg border border-primary-100 bg-primary-50/60 px-4 py-2 text-xs text-primary-600">
                            <span>
                                {t('selectAllBanner.allSelectedOnPage', {
                                    count: pageSelectable.length,
                                })}
                            </span>
                            <button
                                type="button"
                                onClick={handleSelectAllFiltered}
                                disabled={isSelectingAll}
                                className="font-semibold underline hover:text-primary-600 disabled:opacity-50"
                            >
                                {isSelectingAll
                                    ? t('selectAllBanner.selecting')
                                    : t('selectAllBanner.selectAllFiltered', {
                                          count: totalElements,
                                      })}
                            </button>
                        </div>
                    )}

                    {/* ── Refresh + Table ── */}
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-neutral-500">
                            {t('resultsRange.showing')}{' '}
                            <span className="font-semibold text-neutral-700">
                                {pageContent.length === 0 ? 0 : page * PAGE_SIZE + 1}
                            </span>
                            {'\u2013'}
                            <span className="font-semibold text-neutral-700">
                                {page * PAGE_SIZE + pageContent.length}
                            </span>{' '}
                            {t('resultsRange.of')}{' '}
                            <span className="font-semibold text-neutral-700">{totalElements}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                        >
                            <ArrowCounterClockwise size={14} className={isFetching ? 'animate-spin' : ''} />
                            {t('refresh')}
                        </button>
                    </div>
                    <div className="mb-4 min-h-0 flex-1 overflow-hidden rounded-xl border border-neutral-100 bg-white shadow-sm">
                        <div className="h-full overflow-auto">
                            <table className="w-full min-w-max border-collapse text-left">
                                <thead className="sticky top-0 z-10">
                                    <tr className="border-b-2 border-neutral-200 bg-neutral-50/95 backdrop-blur-sm">
                                        <th className="py-3 px-4 w-10">
                                            <input
                                                type="checkbox"
                                                checked={pageFullySelected}
                                                onChange={togglePageSelection}
                                                disabled={pageSelectable.length === 0}
                                                className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 disabled:opacity-30"
                                            />
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.feeType')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.cpoPlan')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.expected')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.adjustment')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.paid')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.due')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.dueOverdue')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.dueDate')}
                                        </th>
                                        <th className="px-4 py-3 text-caption font-semibold uppercase tracking-wider text-neutral-500">
                                            {t('table.status')}
                                        </th>
                                        <th className="w-10 px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100 text-sm font-medium">
                                    {pageContent.length === 0 && (
                                        <tr>
                                            <td
                                                colSpan={10}
                                                className="py-12 text-center text-neutral-400"
                                            >
                                                {t('table.noResults')}
                                            </td>
                                        </tr>
                                    )}
                                    {pageContent.map((inst: StudentFeeDueDTO) => {
                                        const isSelectable = inst.status !== 'PAID';
                                        const isSelected = selectedDuesMap.has(inst.id);
                                        return (
                                            <tr
                                                key={inst.id}
                                                className={`transition-colors ${
                                                    isSelected
                                                        ? 'bg-primary-50/40'
                                                        : 'hover:bg-neutral-50/60'
                                                } ${!isSelectable ? 'opacity-50' : 'cursor-pointer'}`}
                                                onClick={() => isSelectable && toggleSelect(inst.id, inst)}
                                            >
                                                <td className="py-3 px-4">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        disabled={!isSelectable}
                                                        onChange={() => toggleSelect(inst.id, inst)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 disabled:opacity-30"
                                                    />
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-neutral-800">
                                                    {inst.fee_type_name}
                                                </td>
                                                <td className="px-4 py-3 text-neutral-600">
                                                    {inst.cpo_name || '\u2014'}
                                                </td>
                                                <td className="px-4 py-3 text-neutral-700">
                                                    {formatCurrency(inst.amount_expected)}
                                                </td>
                                                <td className="px-4 py-3 text-neutral-500">
                                                    <div className="flex items-center gap-2">
                                                        {inst.adjustment_status ? (
                                                            <div className="flex flex-col gap-1">
                                                                <span
                                                                    className={cn(
                                                                        'text-xs font-medium',
                                                                        inst.adjustment_type ===
                                                                            'PENALTY'
                                                                            ? 'text-danger-600'
                                                                            : 'text-success-600'
                                                                    )}
                                                                >
                                                                    {inst.adjustment_type ===
                                                                    'PENALTY'
                                                                        ? '+'
                                                                        : '-'}
                                                                    {formatCurrency(
                                                                        inst.adjustment_amount
                                                                    )}
                                                                </span>
                                                                <span
                                                                    className={cn(
                                                                        'inline-flex w-fit items-center rounded-full px-1.5 py-0.5 text-caption font-semibold uppercase',
                                                                        inst.adjustment_status ===
                                                                            'APPROVED' &&
                                                                            'bg-success-100 text-success-700',
                                                                        inst.adjustment_status ===
                                                                            'PENDING_FOR_APPROVAL' &&
                                                                            'bg-warning-100 text-warning-700',
                                                                        inst.adjustment_status ===
                                                                            'REJECTED' &&
                                                                            'bg-danger-100 text-danger-700'
                                                                    )}
                                                                >
                                                                    {inst.adjustment_status ===
                                                                    'PENDING_FOR_APPROVAL'
                                                                        ? t('adjustment.pending')
                                                                        : inst.adjustment_status}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <span>{'\u2014'}</span>
                                                        )}
                                                        {isSelectable && (
                                                            <button
                                                                type="button"
                                                                title={t('adjustment.adjustTooltip')}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setAdjustmentDialogInstallment(inst);
                                                                }}
                                                                className="flex size-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-primary-50 hover:text-primary-600"
                                                            >
                                                                <PencilSimple size={13} weight="bold" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-success-700">
                                                    {formatCurrency(inst.amount_paid)}
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-danger-600">
                                                    {inst.amount_due > 0
                                                        ? formatCurrency(inst.amount_due)
                                                        : '—'}
                                                </td>
                                                <td className="py-3 px-4">
                                                    {inst.is_overdue ? (
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-50 px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wide text-danger-700">
                                                            <span className="inline-block size-1.5 rounded-full bg-danger-500" />
                                                            {t('status.overdue')}
                                                            {inst.days_overdue > 0 && (
                                                                <span className="font-normal text-danger-500">
                                                                    {t('status.daysOverdue', {
                                                                        count: inst.days_overdue,
                                                                    })}
                                                                </span>
                                                            )}
                                                        </span>
                                                    ) : inst.amount_due > 0 ? (
                                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wide text-warning-700">
                                                            <span className="inline-block size-1.5 rounded-full bg-warning-500" />
                                                            {t('status.due')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-neutral-400">
                                                            {'\u2014'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-neutral-600">
                                                    {inst.due_date
                                                        ? dayjs(inst.due_date).format('D MMM YYYY')
                                                        : '\u2014'}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <StatusPill status={inst.status} />
                                                </td>
                                                <td className="py-3 px-2">
                                                    {inst.status === 'PAID' && (
                                                        <button
                                                            title={t('downloadReceiptTooltip')}
                                                            onClick={(e) =>
                                                                handleDownloadReceipt(inst.id, e)
                                                            }
                                                            disabled={
                                                                downloadingReceiptId === inst.id
                                                            }
                                                            className="flex size-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-success-50 hover:text-success-600 disabled:opacity-50"
                                                        >
                                                            {downloadingReceiptId === inst.id
                                                                ? <Spinner size={14} className="animate-spin" />
                                                                : <DownloadSimple size={14} weight="bold" />
                                                            }
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pagination controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 py-3 mb-4">
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                disabled={page === 0 || isFetching}
                                className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <CaretLeft size={12} weight="bold" />
                                {t('pagination.prev')}
                            </button>
                            <span className="px-3 text-xs text-neutral-500">
                                {t('pagination.page')}{' '}
                                <span className="font-bold text-neutral-800">{page + 1}</span>{' '}
                                {t('pagination.of')}{' '}
                                <span className="font-bold text-neutral-800">{totalPages}</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1 || isFetching}
                                className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {t('pagination.next')}
                                <CaretRight size={12} weight="bold" />
                            </button>
                        </div>
                    )}

                    {/* ── Fixed bottom action bar ── */}
                    <div className="sticky bottom-0 z-10 rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="text-sm text-neutral-600">
                                <span className="font-bold text-neutral-800">
                                    {selectedDuesMap.size}
                                </span>{' '}
                                {t('bottomBar.installmentsSelected', {
                                    count: selectedDuesMap.size,
                                })}
                                {selectedDuesMap.size > 0 && (
                                    <>
                                        {' \u00b7 '}
                                        {t('bottomBar.totalDue')}{' '}
                                        <span className="font-bold text-neutral-800">
                                            {formatCurrency(totalSelectedDue)}
                                        </span>
                                        {' \u00b7 '}
                                        <button
                                            type="button"
                                            onClick={clearSelection}
                                            className="text-xs font-medium text-neutral-500 underline transition-colors hover:text-danger-600"
                                        >
                                            {t('filters.clear')}
                                        </button>
                                    </>
                                )}
                            </div>

                            <div className="flex-1" />

                            <div className="flex items-center gap-3">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => setShowInvoiceDialog(true)}
                                    disable={selectedDuesMap.size === 0}
                                    className="whitespace-nowrap"
                                >
                                    {t('bottomBar.generateInvoice')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => onProceedToPayment(selectedDues)}
                                    disable={selectedDuesMap.size === 0}
                                    className="whitespace-nowrap"
                                >
                                    {t('bottomBar.proceedToPay')}
                                    <CaretRight size={14} weight="bold" className="ml-1" />
                                </MyButton>
                            </div>
                        </div>
                    </div>
                </>
            )}

            <InvoiceActionDialog
                open={showInvoiceDialog}
                onOpenChange={setShowInvoiceDialog}
                studentName={student.student_name}
                studentEmail={student.email}
                isGenerating={invoiceMutation.isPending}
                isSendingEmail={emailInvoiceMutation.isPending}
                onDownload={() => invoiceMutation.mutate()}
                onSendEmail={(email) => emailInvoiceMutation.mutate(email)}
            />

            {adjustmentDialogInstallment && (
                <AdjustmentDialog
                    open={!!adjustmentDialogInstallment}
                    onOpenChange={(open) => {
                        if (!open) setAdjustmentDialogInstallment(null);
                    }}
                    installment={adjustmentDialogInstallment}
                    studentId={student.student_id}
                />
            )}
        </div>
    );
}
