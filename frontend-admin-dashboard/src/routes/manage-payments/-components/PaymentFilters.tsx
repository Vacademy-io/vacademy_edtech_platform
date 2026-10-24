import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyInput } from '@/components/design-system/input';
import SelectChips from '@/components/design-system/SelectChips';
import { ChipToggleGroup } from '@/components/design-system/chips';
import PackageSelector from '@/components/design-system/PackageSelector';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { SelectOption } from '@/components/design-system/SelectChips';
import { Funnel, GraduationCap, MagnifyingGlass, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { BatchForSession, PackageSessionFilter } from '@/types/payment-logs';

interface PaymentFiltersProps {
    startDate: string;
    endDate: string;
    onStartDateChange: (date: string) => void;
    onEndDateChange: (date: string) => void;
    /**
     * Omit both to drop the Payment Status field — Manage Payments drives status from the KPI
     * tiles / segmented switch instead, because the "Due" bucket also holds rows whose
     * payment_status is NULL and those can never come back from an `IN (...)` filter.
     */
    selectedPaymentStatuses?: SelectOption[];
    onPaymentStatusesChange?: (statuses: SelectOption[]) => void;
    selectedUserPlanStatuses: SelectOption[];
    onUserPlanStatusesChange: (statuses: SelectOption[]) => void;
    /**
     * Payment Plan field. Omit `onPaymentPlansChange` to drop it. The options are whatever plans the
     * caller has seen in the loaded rows (there is no plan-listing endpoint scoped to payments), so
     * the caller derives them and the filter itself is applied client-side — see paymentPlanFilter.
     */
    paymentPlanOptions?: SelectOption[];
    selectedPaymentPlans?: SelectOption[];
    onPaymentPlansChange?: (plans: SelectOption[]) => void;
    selectedPaymentSources: SelectOption[];
    onPaymentSourcesChange: (sources: SelectOption[]) => void;
    selectedPaymentTypes: SelectOption[];
    onPaymentTypesChange: (types: SelectOption[]) => void;
    hasOrgAssociatedBatches: boolean;
    packageSessionFilter: PackageSessionFilter;
    onPackageSessionFilterChange: (filter: PackageSessionFilter) => void;
    batchesForSessions: BatchForSession[];
    onQuickFilterSelect: (range: { start: string; end: string }) => void;
    onClearFilters: () => void;
    searchValue: string;
    onSearchChange: (value: string) => void;
    /** Optional action(s) rendered on the right of the control bar (e.g. export). */
    exportSlot?: ReactNode;
    /**
     * Render ONLY the detailed filter grid (payment type / status / plan status / plan / source / dates /
     * course), always expanded and without the search + toggle bar. Used to embed the filters
     * inside the redesign's slide-over panel, where search/segmented-status live in the control bar.
     */
    panelOnly?: boolean;
    /**
     * Drop the quick-range pills and the Start/End inputs. Set when the caller owns the date window
     * itself (Manage Payments puts it in the toolbar dropdown), so the same period can't be set two
     * ways in two places.
     */
    hideDateFilters?: boolean;
}

const PAYMENT_STATUS_OPTIONS: SelectOption[] = [
    { value: 'PAID', label: 'Paid' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'PAYMENT_PENDING', label: 'Pending' },
];

const USER_PLAN_STATUS_OPTIONS: SelectOption[] = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'PAYMENT_FAILED', label: 'Payment Failed' },
    { value: 'EXPIRED', label: 'Expired' },
    { value: 'INACTIVE', label: 'Inactive' },
];

const PAYMENT_SOURCE_OPTIONS: SelectOption[] = [
    { value: 'USER', label: 'User' },
    { value: 'SUB_ORG', label: 'Org' },
];

const PAYMENT_TYPE_OPTIONS: SelectOption[] = [
    { value: 'SUB_ORG_ADMIN', label: 'Sub-Org Admin' },
    { value: 'SUB_ORG_LEARNER', label: 'Sub-Org Learner' },
    { value: 'LIVE_CLASS', label: 'Live Class' },
    { value: 'COURSE', label: 'Course / Package' },
    { value: 'CPO', label: 'Custom Installment' },
    { value: 'ENROLL_INVITE', label: 'Enroll Invite' },
    { value: 'USER_INVOICE', label: 'User Invoice' },
];

const QUICK_RANGE_OPTIONS = [
    { value: '1h', label: 'Last 1 Hour' },
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: 'all', label: 'All Time' },
];

/** Consistent label + control wrapper for the filter grid. */
function FilterField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label className="text-caption font-medium text-neutral-600">{label}</Label>
            {children}
        </div>
    );
}

export function PaymentFilters({
    startDate,
    endDate,
    onStartDateChange,
    onEndDateChange,
    selectedPaymentStatuses,
    onPaymentStatusesChange,
    selectedUserPlanStatuses,
    onUserPlanStatusesChange,
    paymentPlanOptions = [],
    selectedPaymentPlans,
    onPaymentPlansChange,
    selectedPaymentSources,
    onPaymentSourcesChange,
    selectedPaymentTypes,
    onPaymentTypesChange,
    hasOrgAssociatedBatches,
    packageSessionFilter,
    onPackageSessionFilterChange,
    onQuickFilterSelect,
    onClearFilters,
    searchValue,
    onSearchChange,
    exportSlot,
    panelOnly = false,
    hideDateFilters = false,
}: PaymentFiltersProps) {
    const [showFilters, setShowFilters] = useState(false);
    // Which quick-range pill is highlighted. Cleared when the user edits dates manually
    // or clears everything, so the highlight never lies about the active range.
    const [activeQuick, setActiveQuick] = useState<string>('');

    const handlePackageSessionChange = (selection: {
        packageSessionId: string | null;
        levelId: string;
        sessionId: string;
        packageId: string;
        packageSessionIds?: string[];
    }) => {
        onPackageSessionFilterChange({
            ...packageSessionFilter,
            packageSessionId: selection.packageSessionId || '',
            levelId: selection.levelId,
            sessionId: selection.sessionId,
            packageId: selection.packageId,
            packageSessionIds: selection.packageSessionIds,
        });
    };

    /**
     * Reading back is the half that was wrong: feeding the input `toISOString()` made it render
     * the UTC clock, so picking "Today" showed a start of 18:30 the previous day, and typing
     * 2:00 PM snapped the field to 08:30. Render the same instant as a local wall clock instead —
     * the value posted to the API is untouched.
     */
    const toLocalInputValue = (iso: string): string => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
            d.getHours()
        )}:${pad(d.getMinutes())}`;
    };

    const getQuickDateRange = (type: string) => {
        const now = new Date();
        const start = new Date();

        switch (type) {
            case '1h':
                start.setHours(now.getHours() - 1);
                break;
            case 'today':
                start.setHours(0, 0, 0, 0);
                break;
            case '7d':
                start.setDate(now.getDate() - 7);
                break;
            case '30d':
                start.setDate(now.getDate() - 30);
                break;
            case '90d':
                start.setDate(now.getDate() - 90);
                break;
            case 'all':
                return { start: '', end: '' };
        }

        return {
            start: start.toISOString(),
            end: now.toISOString(),
        };
    };

    const handleQuickFilter = (type: string) => {
        setActiveQuick(type);
        onQuickFilterSelect(getQuickDateRange(type));
    };

    // A datetime-local input both reads and writes a wall-clock string in the user's own zone,
    // while startDate/endDate are stored (and sent to the API) as UTC instants. Writing is already
    // correct — `new Date(value)` reads the string as local and .toISOString() converts to UTC.
    const handleDateChange = (setter: (date: string) => void, value: string) => {
        setActiveQuick('');
        setter(value ? new Date(value).toISOString() : '');
    };

    const activeFilterCount =
        (selectedPaymentStatuses?.length || 0) +
        (selectedUserPlanStatuses.length || 0) +
        (selectedPaymentPlans?.length || 0) +
        (selectedPaymentSources.length || 0) +
        (selectedPaymentTypes.length || 0) +
        (hideDateFilters ? 0 : (startDate ? 1 : 0) + (endDate ? 1 : 0)) +
        (packageSessionFilter.packageSessionIds?.length ||
            (packageSessionFilter.packageId ? 1 : 0));

    const hasActiveFilters = activeFilterCount > 0;

    const handleClearAll = () => {
        setActiveQuick('');
        onClearFilters();
    };

    // Shared detailed filter grid (attribute chips + quick/precise dates + course selector).
    const filterGrid = (
        <div className="space-y-5">
            {/* Attribute filters */}
            <div
                className={cn(
                    'grid grid-cols-1 gap-4 sm:grid-cols-2',
                    !panelOnly && 'lg:grid-cols-4'
                )}
            >
                <FilterField label="Payment Type">
                    <SelectChips
                        options={PAYMENT_TYPE_OPTIONS}
                        selected={selectedPaymentTypes}
                        onChange={onPaymentTypesChange}
                        placeholder="All types"
                        multiSelect
                        fullWidth
                        clearable
                    />
                </FilterField>
                {onPaymentStatusesChange && (
                    <FilterField label="Payment Status">
                        <SelectChips
                            options={PAYMENT_STATUS_OPTIONS}
                            selected={selectedPaymentStatuses ?? []}
                            onChange={onPaymentStatusesChange}
                            placeholder="All statuses"
                            multiSelect
                            fullWidth
                            clearable
                        />
                    </FilterField>
                )}
                <FilterField label="Plan Status">
                    <SelectChips
                        options={USER_PLAN_STATUS_OPTIONS}
                        selected={selectedUserPlanStatuses}
                        onChange={onUserPlanStatusesChange}
                        placeholder="All plan statuses"
                        multiSelect
                        fullWidth
                        clearable
                    />
                </FilterField>
                {onPaymentPlansChange && (
                    <FilterField label="Payment Plan">
                        <SelectChips
                            options={paymentPlanOptions}
                            selected={selectedPaymentPlans ?? []}
                            onChange={onPaymentPlansChange}
                            placeholder={
                                paymentPlanOptions.length === 0 ? 'No plans loaded' : 'All plans'
                            }
                            disabled={
                                paymentPlanOptions.length === 0 &&
                                (selectedPaymentPlans?.length ?? 0) === 0
                            }
                            multiSelect
                            fullWidth
                            clearable
                        />
                    </FilterField>
                )}
                {hasOrgAssociatedBatches && (
                    <FilterField label="Payment Source">
                        <SelectChips
                            options={PAYMENT_SOURCE_OPTIONS}
                            selected={selectedPaymentSources}
                            onChange={onPaymentSourcesChange}
                            placeholder="All sources"
                            multiSelect
                            fullWidth
                            clearable
                        />
                    </FilterField>
                )}
            </div>

            <div className="h-px bg-border" />

            {/* Date range — omitted when the caller owns the window (see hideDateFilters). */}
            {!hideDateFilters && (
                <>
                    <div className="space-y-2">
                        <span className="text-caption font-medium text-neutral-500">
                            Quick range
                        </span>
                        <ChipToggleGroup
                            value={activeQuick}
                            onChange={handleQuickFilter}
                            options={QUICK_RANGE_OPTIONS}
                            ariaLabel="Quick date range"
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FilterField label="Start Date">
                            <Input
                                type="datetime-local"
                                value={startDate ? toLocalInputValue(startDate) : ''}
                                onChange={(e) =>
                                    handleDateChange(onStartDateChange, e.target.value)
                                }
                                className="h-9"
                            />
                        </FilterField>
                        <FilterField label="End Date">
                            <Input
                                type="datetime-local"
                                value={endDate ? toLocalInputValue(endDate) : ''}
                                onChange={(e) => handleDateChange(onEndDateChange, e.target.value)}
                                className="h-9"
                            />
                        </FilterField>
                    </div>

                    <div className="h-px bg-border" />
                </>
            )}

            {/* Course / session */}
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <GraduationCap size={16} className="text-neutral-500" />
                    <Label className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                        {getTerminology(ContentTerms.Course, SystemTerms.Course)} /{' '}
                        {getTerminology(ContentTerms.Session, SystemTerms.Session)}
                    </Label>
                </div>
                <PackageSelector
                    instituteId={getCurrentInstituteId() || ''}
                    onChange={handlePackageSessionChange}
                    initialLevelId={packageSessionFilter.levelId}
                    initialSessionId={packageSessionFilter.sessionId}
                    initialPackageId={packageSessionFilter.packageId}
                    multiSelect={true}
                    initialPackageSessionIds={packageSessionFilter.packageSessionIds}
                />
            </div>
        </div>
    );

    // Slide-over embed: just the filters, plus a Clear-all when something is active.
    if (panelOnly) {
        return (
            <div className="space-y-5">
                {filterGrid}
                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearAll}
                        className="gap-2 text-danger-600 hover:text-danger-700"
                    >
                        <X size={16} />
                        Clear all filters
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Control bar: search + filters toggle + export */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full sm:flex-1">
                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-neutral-500" />
                    <MyInput
                        inputType="text"
                        input={searchValue}
                        onChangeFunction={(e) => onSearchChange(e.target.value)}
                        inputPlaceholder="Search by name, email, phone, or amount"
                        className="pl-9 sm:w-full"
                    />
                </div>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(
                        'h-9 gap-2',
                        hasActiveFilters && 'border-primary-500 bg-primary-50 text-primary-600'
                    )}
                >
                    <Funnel size={16} weight={hasActiveFilters ? 'fill' : 'regular'} />
                    Filters
                    {hasActiveFilters && (
                        <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-primary-500 text-caption text-neutral-50">
                            {activeFilterCount}
                        </span>
                    )}
                </Button>

                {exportSlot}
            </div>

            {showFilters && (
                <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                    {filterGrid}
                </div>
            )}
        </div>
    );
}
