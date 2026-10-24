import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Tag, Info, SealPercent } from '@phosphor-icons/react';
import { ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { MyButton } from '@/components/design-system/button';
import { FilterChips } from '@/components/design-system/chips';
import { StudentSearchBox } from '@/components/common/student-search-box';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    useBatchesSummary,
    usePackageTable,
} from '@/routes/admin-package-management/-hooks/usePackageTable';
import { FilterOption } from '@/routes/admin-package-management/-hooks/usePackageFilters';
import {
    PackageFilterRequest,
    PackageSessionDTO,
} from '@/routes/admin-package-management/-types/package-types';
import {
    applyMarkdown,
    computeMarkdownPercent,
    lookupMarkdown,
    MarkdownLookupItem,
    MarkdownMode,
    MarkdownResponse,
    resetMarkdown,
} from '@/services/markdown-offers';
import { ApplyOfferDialog } from './apply-offer-dialog';
import { OfferResultsDialog } from './offer-results-dialog';
import { useCourseSettings } from '@/hooks/useCourseSettings';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
    { id: 'ACTIVE', label: 'Active' },
    { id: 'HIDDEN', label: 'Hidden' },
    { id: 'INACTIVE', label: 'Inactive' },
];

export const OffersPage = () => {
    const { t } = useTranslation('adminPackageManagement');
    const queryClient = useQueryClient();
    const { settings: courseSettings, loading: courseSettingsLoading } = useCourseSettings();
    const offerPricingEnabled = courseSettings?.offerPricing?.enabled === true;

    const [searchInput, setSearchInput] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [sessionFilter, setSessionFilter] = useState<FilterOption[]>([]);
    const [levelFilter, setLevelFilter] = useState<FilterOption[]>([]);
    const [statusFilter, setStatusFilter] = useState<FilterOption[]>([
        { id: 'ACTIVE', label: 'Active' },
    ]);
    const [page, setPage] = useState(0);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const [applyOpen, setApplyOpen] = useState(false);
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
    const [resultsState, setResultsState] = useState<{
        open: boolean;
        action: 'apply' | 'reset';
        response: MarkdownResponse | null;
    }>({ open: false, action: 'apply', response: null });

    const packageTerm = getTerminology(ContentTerms.Package, SystemTerms.Package);
    const packageTermLower = getTerminologyPlural(
        ContentTerms.Package,
        SystemTerms.Package
    ).toLowerCase();

    const filters: PackageFilterRequest = useMemo(
        () => ({
            page,
            size: PAGE_SIZE,
            sessionId: sessionFilter[0]?.id,
            levelId: levelFilter[0]?.id,
            search: searchFilter || undefined,
            statuses: statusFilter.length > 0 ? statusFilter.map((s) => s.id) : ['ACTIVE'],
            sortBy: 'created_at',
            sortDirection: 'DESC',
        }),
        [page, sessionFilter, levelFilter, searchFilter, statusFilter]
    );

    const { packageData, isLoading: isListLoading } = usePackageTable(filters);
    const { summaryData } = useBatchesSummary(['ACTIVE']);

    const visibleRows: PackageSessionDTO[] = packageData?.content ?? [];
    const visibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);

    const { data: lookupItems, isLoading: isLookupLoading } = useQuery({
        queryKey: ['markdown-lookup', visibleIds],
        queryFn: () => lookupMarkdown(visibleIds),
        enabled: visibleIds.length > 0,
        staleTime: 30000,
    });

    const lookupBySessionId = useMemo(() => {
        const map = new Map<string, MarkdownLookupItem>();
        (lookupItems ?? []).forEach((item) => map.set(item.packageSessionId, item));
        return map;
    }, [lookupItems]);

    const rowLabels = useMemo(() => {
        const map = new Map<string, string>();
        visibleRows.forEach((row) => {
            const parts = [
                row.package_dto?.package_name,
                row.level?.level_name,
                row.session?.session_name,
            ].filter(Boolean);
            map.set(row.id, parts.join(' · '));
        });
        return map;
    }, [visibleRows]);

    const eligibleVisibleIds = useMemo(
        () => visibleRows.filter((r) => lookupBySessionId.get(r.id)?.discountable).map((r) => r.id),
        [visibleRows, lookupBySessionId]
    );

    const allEligibleSelected =
        eligibleVisibleIds.length > 0 &&
        eligibleVisibleIds.every((id) => selectedIds.has(id));

    const toggleRow = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAllVisible = () => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (allEligibleSelected) {
                eligibleVisibleIds.forEach((id) => next.delete(id));
            } else {
                eligibleVisibleIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    const invalidateLookups = () =>
        queryClient.invalidateQueries({ queryKey: ['markdown-lookup'] });

    const applyMutation = useMutation({
        mutationFn: ({ mode, value }: { mode: MarkdownMode; value: number }) =>
            applyMarkdown(Array.from(selectedIds), mode, value),
        onSuccess: (response) => {
            setApplyOpen(false);
            setResultsState({ open: true, action: 'apply', response });
            invalidateLookups();
            clearSelection();
        },
    });

    const resetMutation = useMutation({
        mutationFn: () => resetMarkdown(Array.from(selectedIds)),
        onSuccess: (response) => {
            setResetConfirmOpen(false);
            setResultsState({ open: true, action: 'reset', response });
            invalidateLookups();
            clearSelection();
        },
    });

    const sessionOptions = useMemo(
        () => summaryData?.sessions.map((s) => ({ id: s.id, label: s.name })) || [],
        [summaryData]
    );
    const levelOptions = useMemo(
        () => summaryData?.levels.map((l) => ({ id: l.id, label: l.name })) || [],
        [summaryData]
    );

    const handlePageChange = (next: number) => {
        setPage(next);
        // Selection persists across pages on purpose — user may select books from multiple pages.
    };

    const totalElements = packageData?.total_elements ?? 0;
    const totalPages = packageData?.total_pages ?? 0;

    if (!courseSettingsLoading && !offerPricingEnabled) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
                <Tag className="size-10 text-neutral-300" />
                <h1 className="text-h3 font-semibold text-neutral-700">
                    Offer pricing is disabled
                </h1>
                <p className="max-w-md text-sm text-neutral-500">
                    Enable offer pricing in{' '}
                    {getTerminology(ContentTerms.Course, SystemTerms.Course)} Settings to let admins
                    set an offer price below the MRP on individual {packageTermLower}.
                </p>
                <div className="mt-2 flex gap-2">
                    <Link to="/settings" search={{ selectedTab: 'course' }}>
                        <MyButton buttonType="primary" scale="small" layoutVariant="default">
                            Open {getTerminology(ContentTerms.Course, SystemTerms.Course)} Settings
                        </MyButton>
                    </Link>
                    <Link to="/admin-package-management">
                        <MyButton buttonType="secondary" scale="small" layoutVariant="default">
                            Back
                        </MyButton>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">
            <ScreenHeader
                icon={SealPercent}
                back={
                    <Link
                        to="/admin-package-management"
                        className="inline-flex w-fit items-center gap-1.5 text-caption font-semibold text-neutral-500 hover:text-primary-500"
                    >
                        <ArrowLeft className="size-4" />
                        {t('title', {
                            package: getTerminology(ContentTerms.Package, SystemTerms.Package),
                        })}
                    </Link>
                }
                title="Offer Prices"
                subtitle={`Lower the actual price below MRP for ${packageTermLower}. Elevated price stays as the strike-through reference.`}
                actions={
                    <span className="text-sm text-neutral-500">
                        Total: <strong className="text-neutral-700">{totalElements}</strong>{' '}
                        {packageTermLower}
                    </span>
                }
            />

            <div className="rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3">
                    <div className="w-full lg:max-w-md">
                        <StudentSearchBox
                            searchInput={searchInput}
                            searchFilter={searchFilter}
                            onSearchChange={(e) => setSearchInput(e.target.value)}
                            onSearchEnter={() => {
                                setSearchFilter(searchInput);
                                setPage(0);
                            }}
                            onClearSearch={() => {
                                setSearchInput('');
                                setSearchFilter('');
                                setPage(0);
                            }}
                        />
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <FilterChips
                            label={getTerminology(ContentTerms.Session, SystemTerms.Session)}
                            filterList={sessionOptions}
                            selectedFilters={sessionFilter}
                            clearFilters={false}
                            handleSelect={(option) => {
                                setSessionFilter((prev) =>
                                    prev.some((p) => p.id === option.id)
                                        ? prev.filter((p) => p.id !== option.id)
                                        : [...prev, option]
                                );
                                setPage(0);
                            }}
                            handleClearFilters={() => {
                                setSessionFilter([]);
                                setPage(0);
                            }}
                        />
                        <FilterChips
                            label={getTerminology(ContentTerms.Level, SystemTerms.Level)}
                            filterList={levelOptions}
                            selectedFilters={levelFilter}
                            clearFilters={false}
                            handleSelect={(option) => {
                                setLevelFilter((prev) =>
                                    prev.some((p) => p.id === option.id)
                                        ? prev.filter((p) => p.id !== option.id)
                                        : [...prev, option]
                                );
                                setPage(0);
                            }}
                            handleClearFilters={() => {
                                setLevelFilter([]);
                                setPage(0);
                            }}
                        />
                        <FilterChips
                            label="Status"
                            filterList={STATUS_OPTIONS}
                            selectedFilters={statusFilter}
                            clearFilters={false}
                            handleSelect={(option) => {
                                setStatusFilter((prev) =>
                                    prev.some((p) => p.id === option.id)
                                        ? prev.filter((p) => p.id !== option.id)
                                        : [...prev, option]
                                );
                                setPage(0);
                            }}
                            handleClearFilters={() => {
                                setStatusFilter([]);
                                setPage(0);
                            }}
                        />
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase text-neutral-600">
                        <tr>
                            <th className="w-10 px-3 py-3">
                                <Checkbox
                                    checked={allEligibleSelected}
                                    onCheckedChange={toggleAllVisible}
                                    disabled={eligibleVisibleIds.length === 0}
                                    aria-label="Select all eligible on this page"
                                />
                            </th>
                            <th className="px-3 py-3">{packageTerm} Name</th>
                            <th className="px-3 py-3">
                                {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                            </th>
                            <th className="px-3 py-3">
                                {getTerminology(ContentTerms.Session, SystemTerms.Session)}
                            </th>
                            <th className="px-3 py-3 text-right">MRP</th>
                            <th className="px-3 py-3 text-right">Offer Price</th>
                            <th className="px-3 py-3 text-right">% Off</th>
                            <th className="px-3 py-3">Eligibility</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isListLoading ? (
                            Array.from({ length: 6 }).map((_, idx) => (
                                <tr key={idx} className="border-t border-neutral-100">
                                    <td colSpan={8} className="px-3 py-3">
                                        <Skeleton className="h-6 w-full" />
                                    </td>
                                </tr>
                            ))
                        ) : visibleRows.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={8}
                                    className="px-3 py-10 text-center text-sm text-neutral-500"
                                >
                                    No {packageTermLower} match the current filters.
                                </td>
                            </tr>
                        ) : (
                            visibleRows.map((row) => {
                                const lookup = lookupBySessionId.get(row.id);
                                const eligible = !!lookup?.discountable;
                                const percentOff = computeMarkdownPercent(
                                    lookup?.actualPrice,
                                    lookup?.elevatedPrice
                                );
                                return (
                                    <tr
                                        key={row.id}
                                        className={cn(
                                            'border-t border-neutral-100 transition-colors',
                                            selectedIds.has(row.id) && 'bg-primary-50/40'
                                        )}
                                    >
                                        <td className="px-3 py-3">
                                            <Checkbox
                                                checked={selectedIds.has(row.id)}
                                                onCheckedChange={() => toggleRow(row.id)}
                                                disabled={!eligible}
                                                aria-label={`Select ${row.package_dto?.package_name}`}
                                            />
                                        </td>
                                        <td className="px-3 py-3 font-medium text-neutral-800">
                                            {row.package_dto?.package_name}
                                        </td>
                                        <td className="px-3 py-3 text-neutral-600">
                                            {row.level?.level_name}
                                        </td>
                                        <td className="px-3 py-3 text-neutral-600">
                                            {row.session?.session_name}
                                        </td>
                                        <td className="px-3 py-3 text-right text-neutral-700">
                                            {isLookupLoading
                                                ? '—'
                                                : formatPrice(
                                                      lookup?.elevatedPrice,
                                                      lookup?.currency
                                                  )}
                                        </td>
                                        <td className="px-3 py-3 text-right text-neutral-700">
                                            {isLookupLoading
                                                ? '—'
                                                : formatPrice(
                                                      lookup?.actualPrice,
                                                      lookup?.currency
                                                  )}
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            {percentOff != null && percentOff > 0 ? (
                                                <Badge className="bg-success-500/15 font-semibold text-success-600 hover:bg-success-500/15">
                                                    {percentOff}%
                                                </Badge>
                                            ) : (
                                                <span className="text-neutral-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3">
                                            <EligibilityCell
                                                eligible={eligible}
                                                reason={lookup?.ineligibleReason}
                                                isLoading={isLookupLoading}
                                            />
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-500">
                        Page {page + 1} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            onClick={() => handlePageChange(page - 1)}
                            disable={page === 0}
                        >
                            Previous
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            onClick={() => handlePageChange(page + 1)}
                            disable={page + 1 >= totalPages}
                        >
                            Next
                        </MyButton>
                    </div>
                </div>
            )}

            {selectedIds.size > 0 && (
                <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-primary-300 bg-white p-3 shadow-lg">
                    <div className="flex items-center gap-3">
                        <Tag className="size-5 text-primary-500" weight="fill" />
                        <span className="text-sm font-medium text-neutral-700">
                            {selectedIds.size} selected
                        </span>
                        <button
                            type="button"
                            onClick={clearSelection}
                            className="text-xs text-neutral-500 underline hover:text-neutral-700"
                        >
                            clear
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            onClick={() => setResetConfirmOpen(true)}
                            disable={resetMutation.isPending || applyMutation.isPending}
                        >
                            Reset to MRP
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            layoutVariant="default"
                            onClick={() => setApplyOpen(true)}
                            disable={resetMutation.isPending || applyMutation.isPending}
                        >
                            Apply Offer Price
                        </MyButton>
                    </div>
                </div>
            )}

            <ApplyOfferDialog
                open={applyOpen}
                onOpenChange={setApplyOpen}
                selectedCount={selectedIds.size}
                isSubmitting={applyMutation.isPending}
                onSubmit={(mode, value) => applyMutation.mutate({ mode, value })}
            />

            <ConfirmResetDialog
                open={resetConfirmOpen}
                onOpenChange={setResetConfirmOpen}
                count={selectedIds.size}
                isSubmitting={resetMutation.isPending}
                onConfirm={() => resetMutation.mutate()}
            />

            <OfferResultsDialog
                open={resultsState.open}
                onOpenChange={(o) => setResultsState((s) => ({ ...s, open: o }))}
                action={resultsState.action}
                response={resultsState.response}
                rowLabels={rowLabels}
            />
        </div>
    );
};

const EligibilityCell = ({
    eligible,
    reason,
    isLoading,
}: {
    eligible: boolean;
    reason?: string;
    isLoading: boolean;
}) => {
    if (isLoading) return <span className="text-neutral-400">—</span>;
    if (eligible) {
        return (
            <Badge className="bg-success-500/15 text-success-600 hover:bg-success-500/15">
                Eligible
            </Badge>
        );
    }
    const label = reason ? prettifyReason(reason) : 'Not eligible';
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                        <Info className="size-3.5" />
                        {label}
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                    {explainReason(reason)}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

const prettifyReason = (code: string): string => {
    switch (code) {
        case 'FREE_OPTION_NOT_DISCOUNTABLE':
            return 'Free';
        case 'CPO_OPTION_NOT_SUPPORTED':
            return 'Fee plan';
        case 'INSTITUTE_DEFAULT_OPTION_NOT_DISCOUNTABLE':
            return 'Shared default';
        case 'NO_ACTIVE_PAYMENT_PLAN':
            return 'No plan';
        case 'MULTIPLE_ACTIVE_PAYMENT_PLANS':
            return 'Multiple plans';
        case 'PAYMENT_OPTION_SHARED_WITH_OTHERS':
            return 'Plan is shared';
        case 'NO_ACTIVE_PAYMENT_OPTION':
            return 'No payment option';
        case 'PACKAGE_SESSION_NOT_FOUND':
            return 'Not found';
        default:
            return 'Not eligible';
    }
};

const explainReason = (code?: string): string => {
    switch (code) {
        case 'FREE_OPTION_NOT_DISCOUNTABLE':
            return 'This is a FREE plan — there is no price to discount.';
        case 'CPO_OPTION_NOT_SUPPORTED':
            return 'Multi-installment fee plans are managed under Fee Management, not here.';
        case 'INSTITUTE_DEFAULT_OPTION_NOT_DISCOUNTABLE':
            return 'This is the institute-default payment option, shared across the institute. Changing it would affect every item using it.';
        case 'NO_ACTIVE_PAYMENT_PLAN':
            return 'No active payment plan is attached to this payment option.';
        case 'MULTIPLE_ACTIVE_PAYMENT_PLANS':
            return 'This payment option has more than one active plan; we cannot determine which to update.';
        case 'PAYMENT_OPTION_SHARED_WITH_OTHERS':
            return 'The payment plan here is shared with other items. To discount this, include all sharing items in the same operation.';
        case 'NO_ACTIVE_PAYMENT_OPTION':
            return 'No active payment option is attached.';
        case 'PACKAGE_SESSION_NOT_FOUND':
            return 'No active enrollment configuration found in this institute.';
        default:
            return 'Not eligible for offer pricing.';
    }
};

const formatPrice = (v?: number, currency?: string): string => {
    if (v == null) return '—';
    return `${currency ? currency + ' ' : ''}${v}`;
};

const ConfirmResetDialog = ({
    open,
    onOpenChange,
    count,
    isSubmitting,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    count: number;
    isSubmitting: boolean;
    onConfirm: () => void;
}) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
                <h2 className="text-lg font-semibold text-neutral-800">Reset to MRP</h2>
                <p className="mt-1 text-sm text-neutral-600">
                    This will set the offer price equal to the MRP for {count} selected{' '}
                    {count === 1 ? 'item' : 'items'}, removing any current discount.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        onClick={() => onOpenChange(false)}
                        disable={isSubmitting}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        layoutVariant="default"
                        onClick={onConfirm}
                        disable={isSubmitting}
                    >
                        {isSubmitting ? 'Resetting…' : 'Reset'}
                    </MyButton>
                </div>
            </div>
        </div>
    );
};
