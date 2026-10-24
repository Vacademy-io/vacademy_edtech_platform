import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, DownloadSimple, EnvelopeSimple, Plus, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { resolveInstituteCurrency } from '@/utils/institute-currency';
import type { SelectOption } from '@/components/design-system/SelectChips';
import type {
    PaymentLogEntry,
    PaymentLogsRequest,
    PackageSessionFilter,
    BatchForSession,
} from '@/types/payment-logs';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import {
    fetchBillingSummary,
    fetchInstalmentForecast,
    fetchOutstandingLearners,
} from '@/services/payment-logs';
import type { OutstandingLearner } from '@/services/payment-logs';
import { ManageColumnsPopover } from '@/components/shared/leads/manage-columns-popover';
import {
    useLeadColumnPrefs,
    useColumnOrderPrefs,
    orderColumnIds,
    type LeadColumnToggle,
} from '@/components/shared/leads/use-lead-column-prefs';
import { InvoicePreviewByIdDialog } from '@/components/common/invoice/invoice-preview-by-id-dialog';
import { downloadInvoicesZip, type PaymentLogInvoiceDTO } from '@/services/invoice-service';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { PaymentFilters } from './PaymentFilters';
import { PaymentControlBar, type SegmentKey, type StatusSegment } from './PaymentControlBar';
import { DueLearnersTable } from './DueLearnersTable';
import { DueLearnerDetailSheet } from './DueLearnerDetailSheet';
import { InstalmentForecast, formatForecastMonth, isInstalmentFirst } from './InstalmentForecast';
import { PaymentLogsTable } from './PaymentLogsTable';
import { hideColumnsAddedLater } from '../-utils/hideColumnsAddedLater';
import { PaymentKpiCards, type RecordStatusKey, type SummaryStatusKey } from './PaymentKpiCards';
import { KpiCardSettings, useKpiCardPrefs } from './KpiCardSettings';
import { PaymentDetailSheet } from './PaymentDetailSheet';
import { SendRemindersModal } from './SendRemindersModal';
import { RecordPaymentModal } from './RecordPaymentModal';
import { DateRangeDropdown } from './DateRangeDropdown';
import { exportEntriesToCsv, fetchAllPaymentLogs } from '../-utils/exportPaymentLogsCsv';
import { fetchPaymentLogs, fetchPaymentLogsSummary } from '@/services/payment-logs';
import { summaryFromStatusTotals, summarizeBucketAmount } from '../-utils/paymentSummary';
import { ALL_TIME_RANGE, type DateRangeValue } from '../-utils/dateRange';
import { resolvePaymentLogInvoices } from '../-utils/resolvePaymentLogInvoices';

const PAGE_SIZE = 20;

/** Where this table's column layout is remembered, per browser. */
const COLUMN_PREFS_KEY = 'manage-payments:hidden-columns';

/** Where the left-to-right column order is remembered, per browser. */
const COLUMN_ORDER_KEY = 'manage-payments:column-order';

/**
 * Columns hidden until someone asks for them — the tracking trio is a niche reconciliation aid,
 * and the enrolment / next-due dates are opt-in extras.
 */
const DEFAULT_HIDDEN_COLUMNS = [
    'tracking_id',
    'tracking_source',
    'order_status',
    'enrolled_date',
    'next_due_date',
];

/**
 * Columns shipped after admins may already have saved a layout. A saved layout replaces the
 * defaults outright, so these are added to it once (see hideColumnsAddedLater).
 */
const COLUMNS_ADDED_HIDDEN = ['enrolled_date', 'next_due_date'];
const COLUMNS_ADDED_FLAG = 'manage-payments:hidden-columns:dates-added';

/** Header actions (Send reminders / Record payment) are hidden until the flows are ready. */
const SHOW_HEADER_ACTIONS = false;

/** `invoices_acme_2026-10-01_to_2026-10-31.zip` — the window in the admin's own dates. */
const invoicesZipFileName = (start: string, end: string, instituteName?: string): string => {
    const localDate = (iso: string) => {
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const namePart = (instituteName || 'institute')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    const period =
        start || end
            ? `${start ? localDate(start) : 'start'}_to_${end ? localDate(end) : localDate(new Date().toISOString())}`
            : 'all-time';
    return `invoices_${namePart}_${period}.zip`;
};

interface ActiveChip {
    id: string;
    label: string;
    onRemove: () => void;
}

/** The redesigned transactions screen: KPIs, control bar, filters slide-over, table, detail panel. */
export function TransactionsView() {
    // Pagination
    const [currentPage, setCurrentPage] = useState(0);

    // Free-text search — debounced before it reaches the API.
    const [searchValue, setSearchValue] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchValue.trim());
            setCurrentPage(0);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchValue]);

    // Filters. The date window lives in the toolbar (not the slide-over) so changing the period
    // is one click; start/end are the UTC instants it resolves to.
    const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME_RANGE);
    const [exporting, setExporting] = useState<'csv' | 'zip' | null>(null);
    const { start: startDate, end: endDate } = dateRange;
    // Status is one control — the KPI tiles and the segmented switch drive this single bucket, and
    // it filters the loaded rows locally (see classifyEntry).
    const [statusBucket, setStatusBucket] = useState<RecordStatusKey>('total');
    // 'balances' answers "who owes money", which the payment records cannot: an unpaid balance
    // normally has no row to filter to. It swaps the table rather than narrowing it.
    const [view, setView] = useState<'records' | 'balances'>('records');
    // Which balances list is open: 'due' (something already overdue) or 'outstanding' (anything
    // still to collect, whatever its date — how an admin sees each learner's next instalment).
    // 'upcoming' is the same list opened from the instalment Upcoming card.
    const [balanceScope, setBalanceScope] = useState<'due' | 'outstanding' | 'upcoming'>('due');
    // One month of the instalment forecast (yyyy-MM) narrowing the Upcoming list; null = all of it.
    const [dueMonth, setDueMonth] = useState<string | null>(null);
    const [selectedUserPlanStatuses, setSelectedUserPlanStatuses] = useState<SelectOption[]>([]);
    // Payment plan is the one detailed filter the API can't apply; it narrows the loaded set
    // locally, before the KPI tiles are computed, so it behaves like the server-side ones.
    const [selectedPaymentPlans, setSelectedPaymentPlans] = useState<SelectOption[]>([]);
    const [selectedPaymentSources, setSelectedPaymentSources] = useState<SelectOption[]>([]);
    const [selectedPaymentTypes, setSelectedPaymentTypes] = useState<SelectOption[]>([]);
    const [packageSessionFilter, setPackageSessionFilter] = useState<PackageSessionFilter>({});

    // Overlays
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [remindersOpen, setRemindersOpen] = useState(false);
    const [recordOpen, setRecordOpen] = useState(false);
    const [detailEntry, setDetailEntry] = useState<PaymentLogEntry | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    // The Due list nets a learner to one figure; this opens the plans behind it.
    const [dueLearner, setDueLearner] = useState<OutstandingLearner | null>(null);
    const [dueDetailOpen, setDueDetailOpen] = useState(false);

    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);

    const batchesForSessions: BatchForSession[] = useMemo(() => {
        const batches = instituteDetails?.batches_for_sessions;
        return batches && Array.isArray(batches) ? (batches as unknown as BatchForSession[]) : [];
    }, [instituteDetails]);

    const hasOrgAssociatedBatches = useMemo(
        () => batchesForSessions.some((batch) => batch.is_org_associated === true),
        [batchesForSessions]
    );

    // Column layout, remembered per browser: which columns are on, and their order. The
    // migration runs first, in this render, so the prefs hook reads the updated hidden set.
    useState(() =>
        hideColumnsAddedLater(COLUMN_PREFS_KEY, COLUMNS_ADDED_HIDDEN, COLUMNS_ADDED_FLAG)
    );
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(
        COLUMN_PREFS_KEY,
        DEFAULT_HIDDEN_COLUMNS
    );
    const { columnOrder, setColumnOrder, resetColumnOrder } = useColumnOrderPrefs(COLUMN_ORDER_KEY);
    // The enrolment / next-due dates cost the API an extra query per page, so they are only asked
    // for while one of their columns is switched on. With both hidden the request is unchanged.
    const showPlanDates =
        !hiddenColumns.has('enrolled_date') || !hiddenColumns.has('next_due_date');

    const requestFilters: Omit<PaymentLogsRequest, 'institute_id'> = useMemo(() => {
        const filters: Omit<PaymentLogsRequest, 'institute_id'> = {
            sort_columns: { createdAt: 'DESC' },
        };
        if (startDate) filters.start_date_in_utc = startDate;
        if (endDate) filters.end_date_in_utc = endDate;
        if (selectedUserPlanStatuses.length > 0)
            filters.user_plan_statuses = selectedUserPlanStatuses.map((s) => s.value);
        if (selectedPaymentSources.length > 0)
            filters.sources = selectedPaymentSources.map((s) => s.value) as ('USER' | 'SUB_ORG')[];
        if (selectedPaymentTypes.length > 0)
            filters.payment_types = selectedPaymentTypes.map((t) => t.value);
        if (debouncedSearch) filters.search_string = debouncedSearch;
        if (showPlanDates) filters.include_plan_dates = true;

        if (
            packageSessionFilter.packageSessionIds &&
            packageSessionFilter.packageSessionIds.length > 0
        ) {
            filters.package_session_ids = packageSessionFilter.packageSessionIds;
        } else if (packageSessionFilter.packageSessionId) {
            filters.package_session_ids = [packageSessionFilter.packageSessionId];
        } else if (packageSessionFilter.packageId) {
            const resolvedIds = batchesForSessions
                .filter(
                    (batch) =>
                        batch.package_dto.id === packageSessionFilter.packageId &&
                        (!packageSessionFilter.levelId ||
                            batch.level.id === packageSessionFilter.levelId) &&
                        (!packageSessionFilter.sessionId ||
                            batch.session.id === packageSessionFilter.sessionId)
                )
                .map((batch) => batch.id);
            if (resolvedIds.length > 0) filters.package_session_ids = resolvedIds;
        }
        if (selectedPaymentPlans.length > 0) {
            filters.payment_plan_names = selectedPaymentPlans.map((plan) => plan.value);
        }
        return filters;
    }, [
        startDate,
        endDate,
        selectedUserPlanStatuses,
        selectedPaymentSources,
        selectedPaymentTypes,
        debouncedSearch,
        packageSessionFilter,
        batchesForSessions,
        showPlanDates,
        selectedPaymentPlans,
    ]);

    // Paging is the server's job now, so a narrowed result no longer silently clamps the page the
    // way slicing an array did: without this, applying a filter while deep in the list asks for a
    // page past the end and shows nothing. Covers every filter at once, including ones added later.
    useEffect(() => {
        setCurrentPage(0);
    }, [requestFilters]);

    // The table asks for one bucket; the tiles have to keep describing every bucket, so the
    // selected tile is deliberately not part of the filters the summary is fetched with.
    const tableFilters = useMemo(
        () => ({ ...requestFilters, status_bucket: statusBucket }),
        [requestFilters, statusBucket]
    );

    const {
        data: pageData,
        isLoading: isLoadingPayments,
        error: paymentsError,
        refetch: refetchPaymentLogs,
    } = useQuery({
        queryKey: ['payment-logs-page', tableFilters, currentPage],
        queryFn: () => fetchPaymentLogs(currentPage, PAGE_SIZE, tableFilters),
        staleTime: 30000,
        placeholderData: (previous) => previous,
    });

    // Totals over every matching row, and the institute's full plan list. One small call, so the
    // tiles stay accurate without the table having to download the whole result set.
    const { data: summaryData, refetch: refetchSummary } = useQuery({
        queryKey: ['payment-logs-summary', requestFilters],
        queryFn: () => fetchPaymentLogsSummary(requestFilters),
        staleTime: 30000,
    });

    // Every plan the institute has, listed by the server — not just the plans present in the rows
    // on screen, so choosing one never empties the picker.
    const paymentPlanOptions = useMemo<SelectOption[]>(
        () =>
            (summaryData?.payment_plan_names ?? []).map((name) => ({
                label: name,
                value: name,
                _id: name,
            })),
        [summaryData]
    );

    // The tiles describe every row matching the filters — the selected tile is not among them, so
    // the numbers don't collapse to whichever tile is selected.
    const paymentSummary = useMemo(
        () => summaryFromStatusTotals(summaryData?.status_totals ?? []),
        [summaryData]
    );

    /**
     * What came in, what learners with access still owe, and what falls due next. Payment records
     * can't answer the last two: an overdue instalment nobody paid has no row at all, and a lapsed
     * renewal leaves only the failed attempt. Same window and course scope as the table.
     */
    const { data: billingSummary, isFetchedAfterMount: billingIsFresh } = useQuery({
        queryKey: [
            'payment-billing-summary',
            startDate,
            endDate,
            requestFilters.package_session_ids,
        ],
        queryFn: () =>
            fetchBillingSummary({
                start_date_in_utc: startDate ? startDate.slice(0, 19) : undefined,
                end_date_in_utc: endDate ? endDate.slice(0, 19) : undefined,
                package_session_ids: requestFilters.package_session_ids,
            }),
        staleTime: 60_000,
        // Balances change on other screens — a learner removed from a course, a payment deleted —
        // so a return to this page re-asks rather than showing the copy cached before the change.
        refetchOnMount: 'always',
        retry: false,
    });

    // The server's currency is the most common one on live plans, and free plans carry a default
    // INR — a UK institute with only free plans read ₹0. With every figure at zero no money backs
    // that pick, so the institute's own currency is shown, as on the home Dashboard. Once any
    // money exists the server's currency stands: an Indian institute charging in USD must read $.
    // The server picks it from live plans only, so a window with payments but no live plan (a past
    // year whose learners owe nothing) gets none back — the institute's currency fills that gap.
    const instituteCurrency = resolveInstituteCurrency(instituteDetails);
    const billingHasMoney =
        !!billingSummary &&
        [
            billingSummary.collected,
            billingSummary.due,
            billingSummary.upcoming,
            billingSummary.outstanding,
            billingSummary.upcoming_all,
        ].some(Boolean);

    // No client-side fallback for the balance cards: pricing the rows on screen is exactly the
    // model that reported abandoned checkouts and coupon discounts as debt. Without the server
    // figures Due and Upcoming show a dash.
    const billing = useMemo(
        () =>
            billingSummary
                ? {
                      collected: billingSummary.collected,
                      due: billingSummary.due,
                      upcoming: billingSummary.upcoming,
                      upcomingDays: billingSummary.upcoming_days,
                      learnersOwing: billingSummary.learners_owing,
                      learnersUpcoming: billingSummary.learners_upcoming,
                      activatedWithoutPaymentCount: billingSummary.activated_without_payment_count,
                      outstanding: billingSummary.outstanding,
                      learnersOutstanding: billingSummary.learners_outstanding,
                      upcomingAll: billingSummary.upcoming_all ?? undefined,
                      learnersUpcomingAll: billingSummary.learners_upcoming_all,
                      nextDueDate: billingSummary.next_due_date,
                      usesInstallments: billingSummary.uses_installments,
                      instalmentPlanCount: billingSummary.instalment_plan_count,
                      livePlanCount: billingSummary.live_plan_count,
                      currency:
                          (!billingHasMoney && billingSummary.currency && instituteCurrency) ||
                          billingSummary.currency ||
                          instituteCurrency ||
                          '',
                  }
                : null,
        [billingSummary, billingHasMoney, instituteCurrency]
    );

    // Which cards — and their tabs — the admin chose to show. Defaults follow the fee model.
    const cardPrefs = useKpiCardPrefs(billing);
    const upcomingHasList = !!billing?.usesInstallments && cardPrefs.visible.has('upcoming');
    // Instalments are this institute's main fee model — counted across the whole institute, so the
    // page keeps its shape whatever date or course the admin filters to.
    const instalmentFirst = isInstalmentFirst(billing?.instalmentPlanCount, billing?.livePlanCount);
    // The month-by-month panel: a card setting (on by default only where instalments are the fee
    // model), offered wherever there is an instalment plan. Months open the Upcoming list, so it
    // needs that list too. Only when it is on is the forecast ever asked for.
    const scheduleVisible =
        upcomingHasList &&
        cardPrefs.visible.has('schedule') &&
        (billing?.instalmentPlanCount ?? 0) > 0;

    // A tab can disappear under an open list or filter — a date change removes Outstanding, or
    // the admin switches a card off. Fall back rather than leave an unmarked view on screen.
    // Waits for the billing figures, so a refetch in flight does not bounce the view.
    useEffect(() => {
        if (!billing) return;
        if (
            (balanceScope === 'outstanding' && !cardPrefs.visible.has('outstanding')) ||
            (balanceScope === 'upcoming' && !upcomingHasList)
        ) {
            setBalanceScope('due');
            setDueMonth(null);
        }
    }, [billing, balanceScope, cardPrefs.visible, upcomingHasList]);

    /** Instalment progress and the Upcoming card split by month — only while the panel is on. */
    const {
        data: forecast,
        isLoading: isLoadingForecast,
        error: forecastError,
    } = useQuery({
        queryKey: [
            'payment-instalment-forecast',
            startDate,
            endDate,
            requestFilters.package_session_ids,
        ],
        queryFn: () =>
            fetchInstalmentForecast({
                start_date_in_utc: startDate ? startDate.slice(0, 19) : undefined,
                end_date_in_utc: endDate ? endDate.slice(0, 19) : undefined,
                package_session_ids: requestFilters.package_session_ids,
            }),
        enabled: scheduleVisible,
        staleTime: 60_000,
        // Refetched with the cards, so the months and the Upcoming card describe one moment.
        refetchOnMount: 'always',
        retry: false,
    });

    // Whether the admin has picked a view yet — the landing rule below never overrides a choice.
    const viewChosenRef = useRef(false);

    // A month only narrows the Upcoming list while its panel is on screen. Drop it once the panel
    // goes (switched off, Upcoming hidden) or the new forecast no longer has that month —
    // otherwise the list stays filtered by a panel nobody can see.
    useEffect(() => {
        if (!dueMonth || !billing) return;
        if (!scheduleVisible || (forecast && !forecast.months.some((m) => m.month === dueMonth))) {
            setDueMonth(null);
        }
    }, [dueMonth, billing, scheduleVisible, forecast]);
    useEffect(() => {
        const hiddenBucket =
            ((statusBucket === 'pending' || statusBucket === 'abandoned') &&
                !cardPrefs.visible.has('pending')) ||
            (statusBucket === 'failed' && !cardPrefs.visible.has('failed'));
        if (hiddenBucket) setStatusBucket('total');
    }, [statusBucket, cardPrefs.visible]);

    const pagedData = pageData;

    // Rows can disappear between fetches (a void, a refund). If that empties the page being
    // viewed, fall back to the last page that still has rows rather than leaving a blank table.
    useEffect(() => {
        const totalPages = pageData?.totalPages ?? 0;
        if (totalPages > 0 && currentPage > totalPages - 1) setCurrentPage(totalPages - 1);
    }, [pageData, currentPage]);

    const packageSessionsMap = useMemo(() => {
        const map: Record<string, string> = {};
        batchesForSessions.forEach((batch) => {
            map[batch.id] =
                `${batch.package_dto.package_name} - ${batch.session.session_name} - ${batch.level.level_name}`;
        });
        return map;
    }, [batchesForSessions]);

    /**
     * Every column the table can render, in the order PaymentLogsTable defines them. Date &
     * Time and Amount are `locked` — they can be dragged but not switched off, because a
     * payment row without them isn't a payment row.
     */
    const naturalColumnToggles = useMemo<LeadColumnToggle[]>(() => {
        const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
        const toggles: LeadColumnToggle[] = [
            { id: 'payment_date', label: 'Date & Time', locked: true },
            { id: 'user_info', label: 'User' },
        ];
        if (hasOrgAssociatedBatches) toggles.push({ id: 'org_name', label: 'Organization Name' });
        toggles.push(
            { id: 'amount', label: 'Amount', locked: true },
            { id: 'current_payment_status', label: 'Payment' },
            { id: 'vendor', label: 'Payment Method' },
            { id: 'user_plan_status', label: 'Plan Status' },
            { id: 'enroll_invite', label: `${courseTerm}/Membership` },
            { id: 'enrolled_date', label: 'Enrollment Date' },
            { id: 'next_due_date', label: 'Next Due Date' },
            { id: 'invoice', label: 'Invoice' },
            { id: 'transaction_id', label: 'Transaction ID' },
            { id: 'tracking_id', label: 'Tracking ID' },
            { id: 'tracking_source', label: 'Tracking Source' },
            { id: 'order_status', label: 'Order Status' },
            { id: 'tracking_actions', label: 'Actions' },
            { id: 'payment_plan', label: 'Payment Plan' }
        );
        return toggles;
    }, [hasOrgAssociatedBatches]);

    // The popover lists columns in the order they appear on screen, so dragging a row there
    // and dragging a header are the same gesture on the same list.
    const columnToggles = useMemo(() => {
        const byId = new Map(naturalColumnToggles.map((t) => [t.id, t]));
        return orderColumnIds([...byId.keys()], columnOrder)
            .map((id) => byId.get(id))
            .filter((t): t is LeadColumnToggle => !!t);
    }, [naturalColumnToggles, columnOrder]);

    /** "Reset" restores both halves of the layout — hidden columns and order. */
    const handleResetColumns = () => {
        resetColumns();
        resetColumnOrder();
    };

    /**
     * Dragging a header reports the order of the columns the table actually renders — hidden
     * ones aren't there to be dragged. Splice that back into the full saved order so a hidden
     * column keeps its slot and reappears where the admin left it, instead of being dropped
     * from the layout the moment someone reorders while it's off.
     */
    const handleColumnOrderChange = useCallback(
        (visibleOrder: string[]) => {
            const full = orderColumnIds(
                naturalColumnToggles.map((t) => t.id),
                columnOrder
            );
            const reported = new Set(visibleOrder);
            let next = 0;
            setColumnOrder(full.map((id) => (reported.has(id) ? visibleOrder[next++]! : id)));
        },
        [naturalColumnToggles, columnOrder, setColumnOrder]
    );

    // ─── Invoice column ───────────────────────────────────────────────────────
    // Resolved for the rows actually on screen (20 at a time), not for the whole result set:
    // the lookup is per payment log and the column is optional, so paying for it up front
    // would tax every admin including the ones who hide it.
    const instituteId = getCurrentInstituteId();
    const invoiceColumnVisible = !hiddenColumns.has('invoice');

    // Small enough to double as the cache key — see PaymentLogInvoiceLookupInput.
    const invoiceLookupInputs = useMemo(
        () =>
            (pagedData?.content ?? [])
                // Rows that ARE an invoice already carry it inline — asking the server for it
                // again would be a wasted round trip.
                .filter((entry) => entry?.payment_log?.id && !entry.invoice)
                .map((entry) => ({
                    paymentLogId: entry.payment_log.id,
                    // Admin-invoice payments carry no user_plan, and the listing doesn't always
                    // hydrate `user` for them — payment_log.user_id is always there.
                    userId: entry?.user?.id ?? entry.payment_log.user_id ?? null,
                })),
        [pagedData]
    );

    const { data: invoicesByPaymentLog, isLoading: isLoadingInvoices } = useQuery({
        queryKey: ['payment-log-invoices', instituteId, invoiceLookupInputs],
        queryFn: () => resolvePaymentLogInvoices(instituteId as string, invoiceLookupInputs),
        enabled: invoiceColumnVisible && !!instituteId && invoiceLookupInputs.length > 0,
        staleTime: 60_000,
        // A missing/failed lookup must not take the payments table down with it — the column
        // just renders dashes.
        retry: false,
    });

    // Which invoice the PDF preview is showing, if any.
    const [previewInvoice, setPreviewInvoice] = useState<PaymentLogInvoiceDTO | null>(null);

    // Paging only applies while the balances list is on screen; leaving it at 0 otherwise keeps
    // the count in the segmented switch from refetching every time the records table is paged.
    const balancesPage = view === 'balances' ? currentPage : 0;
    // Same for the search box: it narrows the balances list only while that list is open, so
    // searching the payment records neither refetches it nor changes the Due count in the switch.
    const balancesSearch = view === 'balances' ? debouncedSearch : '';
    // A forecast month only ever narrows the Upcoming list.
    const listMonth = balanceScope === 'upcoming' ? dueMonth : null;
    const {
        data: outstanding,
        isLoading: isLoadingOutstanding,
        error: outstandingError,
    } = useQuery({
        queryKey: [
            'payment-outstanding-learners',
            startDate,
            endDate,
            requestFilters.package_session_ids,
            balancesPage,
            balanceScope,
            listMonth,
            balancesSearch,
        ],
        queryFn: () =>
            fetchOutstandingLearners(
                {
                    start_date_in_utc: startDate ? startDate.slice(0, 19) : undefined,
                    end_date_in_utc: endDate ? endDate.slice(0, 19) : undefined,
                    package_session_ids: requestFilters.package_session_ids,
                    // Before, typing a name on Due or Outstanding changed nothing.
                    search_string: balancesSearch || undefined,
                },
                balancesPage,
                PAGE_SIZE,
                balanceScope !== 'due',
                listMonth
            ),
        staleTime: 60_000,
        // Refetched with the cards above it, so the list and the cards never describe two moments.
        refetchOnMount: 'always',
        retry: false,
    });

    /** 'due' / 'outstanding' open a balances list; everything else narrows the payment records. */
    const handleSegmentSelect = (key: SegmentKey) => {
        viewChosenRef.current = true;
        setCurrentPage(0);
        // A tab or card always opens its whole list; a month is picked from the forecast.
        setDueMonth(null);
        if (key === 'due' || key === 'outstanding' || (key === 'upcoming' && upcomingHasList)) {
            setBalanceScope(key);
            setView('balances');
            return;
        }
        // The 30-day Upcoming is informational — there is no list behind it.
        if (key === 'upcoming') return;
        setView('records');
        // Clicking the active tile again clears back to "all".
        setStatusBucket(key === statusBucket ? 'total' : key);
    };

    const handleSummarySelect = (key: SummaryStatusKey) => handleSegmentSelect(key);

    /** A forecast month lists who pays in it; clicking the picked month again shows all upcoming. */
    const handleSelectMonth = (month: string | null) => {
        viewChosenRef.current = true;
        setCurrentPage(0);
        setDueMonth(month);
        setBalanceScope('upcoming');
        setView('balances');
    };

    // Segmented switch. The first five narrow the payment records; the last swaps in the learners
    // who owe money, counted from the balances query rather than from the records. Abandoned is
    // the stale-checkout pile — a warm-lead list for counsellors, not money in flight.
    // Each tab follows its card in the Cards settings; All and Paid are always there.
    const shown = cardPrefs.visible;
    const segments: StatusSegment[] = [
        { key: 'total', label: 'All', count: paymentSummary.total.count },
        { key: 'paid', label: 'Paid', count: paymentSummary.paid.count },
        ...(shown.has('pending')
            ? [
                  {
                      key: 'pending' as const,
                      label: 'Pending',
                      count: paymentSummary.pending.count,
                  },
                  {
                      key: 'abandoned' as const,
                      label: 'Abandoned',
                      count: paymentSummary.abandoned.count,
                  },
              ]
            : []),
        ...(shown.has('failed')
            ? [{ key: 'failed' as const, label: 'Failed', count: paymentSummary.failed.count }]
            : []),
        ...(shown.has('outstanding')
            ? [
                  {
                      key: 'outstanding' as const,
                      label: 'Outstanding',
                      count: billing?.learnersOutstanding ?? 0,
                  },
              ]
            : []),
        ...(shown.has('due')
            ? [
                  {
                      key: 'due' as const,
                      label: 'Due',
                      count:
                          balanceScope === 'due'
                              ? outstanding?.totalElements ?? 0
                              : billing?.learnersOwing ?? 0,
                  },
              ]
            : []),
        ...(upcomingHasList
            ? [
                  {
                      key: 'upcoming' as const,
                      label: 'Upcoming',
                      count: billing?.learnersUpcomingAll ?? 0,
                  },
              ]
            : []),
    ];

    // Detailed-filter count for the Filters button badge. Status lives in the segmented switch and
    // the date window in the toolbar dropdown, so neither is counted here.
    const detailedFilterCount =
        selectedPaymentTypes.length +
        selectedUserPlanStatuses.length +
        selectedPaymentPlans.length +
        selectedPaymentSources.length +
        (packageSessionFilter.packageSessionIds?.length ||
            (packageSessionFilter.packageId ? 1 : 0));

    // An instalment-first institute with nothing overdue opens on who pays next: an empty Due list
    // or a page of past payments answers neither "what is coming in" nor "who do I remind".
    // Decided once, on the first billing figures, and only on a page nobody has touched yet — a
    // tab, page, search, filter or date picked before the figures arrived always wins.
    const landedRef = useRef(false);
    useEffect(() => {
        // Decide on figures fetched for this visit, never on a copy cached from the last one.
        if (landedRef.current || !billing || !billingIsFresh) return;
        landedRef.current = true;
        const untouched =
            !viewChosenRef.current &&
            view === 'records' &&
            statusBucket === 'total' &&
            currentPage === 0 &&
            !searchValue &&
            detailedFilterCount === 0 &&
            dateRange === ALL_TIME_RANGE;
        if (
            untouched &&
            instalmentFirst &&
            upcomingHasList &&
            billing.due <= 0 &&
            (billing.upcomingAll ?? 0) > 0
        ) {
            setBalanceScope('upcoming');
            setView('balances');
        }
    }, [
        billing,
        billingIsFresh,
        instalmentFirst,
        upcomingHasList,
        view,
        statusBucket,
        currentPage,
        searchValue,
        detailedFilterCount,
        dateRange,
    ]);

    // Removable chips for the active detailed filters.
    const activeChips: ActiveChip[] = useMemo(() => {
        const chips: ActiveChip[] = [];
        selectedPaymentTypes.forEach((t) =>
            chips.push({
                id: `type-${t.value}`,
                label: `Type: ${t.label}`,
                onRemove: () =>
                    setSelectedPaymentTypes((prev) => prev.filter((x) => x.value !== t.value)),
            })
        );
        selectedUserPlanStatuses.forEach((s) =>
            chips.push({
                id: `plan-${s.value}`,
                label: `Plan: ${s.label}`,
                onRemove: () =>
                    setSelectedUserPlanStatuses((prev) => prev.filter((x) => x.value !== s.value)),
            })
        );
        selectedPaymentPlans.forEach((p) =>
            chips.push({
                id: `payment-plan-${p.value}`,
                label: `Payment plan: ${p.label}`,
                onRemove: () =>
                    setSelectedPaymentPlans((prev) => prev.filter((x) => x.value !== p.value)),
            })
        );
        selectedPaymentSources.forEach((s) =>
            chips.push({
                id: `source-${s.value}`,
                label: `Source: ${s.label}`,
                onRemove: () =>
                    setSelectedPaymentSources((prev) => prev.filter((x) => x.value !== s.value)),
            })
        );
        if (packageSessionFilter.packageId || packageSessionFilter.packageSessionIds?.length)
            chips.push({
                id: 'course',
                label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} / session`,
                onRemove: () => setPackageSessionFilter({}),
            });
        if (listMonth)
            chips.push({
                id: 'due-month',
                label: `Due in: ${formatForecastMonth(listMonth)}`,
                onRemove: () => setDueMonth(null),
            });
        return chips;
    }, [
        selectedPaymentTypes,
        selectedUserPlanStatuses,
        selectedPaymentPlans,
        selectedPaymentSources,
        packageSessionFilter,
        listMonth,
    ]);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDateRangeChange = (range: DateRangeValue) => {
        setDateRange(range);
        setCurrentPage(0);
    };

    const handleClearFilters = () => {
        setDateRange(ALL_TIME_RANGE);
        setStatusBucket('total');
        setView('records');
        setBalanceScope('due');
        setDueMonth(null);
        setSelectedUserPlanStatuses([]);
        setSelectedPaymentPlans([]);
        setSelectedPaymentSources([]);
        setSelectedPaymentTypes([]);
        setPackageSessionFilter({});
        setCurrentPage(0);
    };

    const handleExportCsv = async () => {
        try {
            if (paymentSummary.total.count === 0) {
                toast.info('No payment records to export.');
                return;
            }
            // The table only holds one page now, so the export fetches the rows it needs at click
            // time — with the tile the admin is looking at, so the file matches what they see.
            const { entries } = await fetchAllPaymentLogs(tableFilters);
            if (entries.length === 0) {
                toast.info('No payment records to export.');
                return;
            }
            const count = exportEntriesToCsv(entries, instituteDetails?.institute_name);
            toast.success(`Exported ${count.toLocaleString()} payment records.`);
        } catch (error) {
            console.error('Failed to export payment logs:', error);
            toast.error('Failed to export payment logs. Please try again.');
        }
    };

    // Every invoice issued in the toolbar's window, as one ZIP. Only the date window applies —
    // an accounting pack is "all invoices for the period", not the slice of payments in view.
    const handleExportInvoicesZip = async () => {
        if (!instituteId) return;
        const toastId = toast.loading('Preparing invoices… large periods can take a minute.');
        try {
            await downloadInvoicesZip(
                instituteId,
                {
                    startDate: startDate ? startDate.slice(0, 19) : undefined,
                    endDate: endDate ? endDate.slice(0, 19) : undefined,
                },
                invoicesZipFileName(startDate, endDate, instituteDetails?.institute_name)
            );
            toast.success('Invoices downloaded.', { id: toastId });
        } catch (error) {
            console.error('Failed to export invoices:', error);
            const message =
                error instanceof Error && error.message && !error.message.startsWith('Request failed')
                    ? error.message
                    : 'Failed to download invoices. Please try again.';
            toast.error(message, { id: toastId });
        }
    };

    const runExport = async (kind: 'csv' | 'zip') => {
        setExporting(kind);
        try {
            await (kind === 'csv' ? handleExportCsv() : handleExportInvoicesZip());
        } finally {
            setExporting(null);
        }
    };

    const openDetail = (entry: PaymentLogEntry) => {
        setDetailEntry(entry);
        setDetailOpen(true);
    };

    // Subline: "N payments · ₹X collected · M need attention". Abandoned checkouts are not
    // "attention" — nothing can be done about a gateway order that has already expired.
    const collectedAmount = summarizeBucketAmount(paymentSummary.paid.amountByCurrency).display;
    const needAttention = paymentSummary.pending.count + paymentSummary.failed.count;

    return (
        <StudentSidebarProvider>
            <div className="space-y-4">
                {/* Toolbar: date window (one click, no filter panel) + live subline + actions */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <DateRangeDropdown value={dateRange} onChange={handleDateRangeChange} />
                        <p className="text-body text-neutral-500">
                            {isLoadingPayments ? (
                                'Loading payments…'
                            ) : (
                                <>
                                    <span className="font-medium text-neutral-700">
                                        {paymentSummary.total.count.toLocaleString()}
                                    </span>{' '}
                                    payments
                                    {collectedAmount && (
                                        <>
                                            {' · '}
                                            <span className="font-medium text-neutral-700">
                                                {collectedAmount}
                                            </span>{' '}
                                            collected
                                        </>
                                    )}
                                    {needAttention > 0 && <> · {needAttention} need attention</>}
                                </>
                            )}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <KpiCardSettings
                            visible={cardPrefs.visible}
                            onToggle={cardPrefs.toggle}
                            onReset={cardPrefs.reset}
                            isCustomised={cardPrefs.isCustomised}
                            // The schedule option only means something with an instalment plan.
                            // Offered only where it can show something: instalment plans that have
                            // a schedule (the same condition that gives Upcoming its list).
                            hiddenOptions={
                                billing?.usesInstallments && (billing.instalmentPlanCount ?? 0) > 0
                                    ? undefined
                                    : ['schedule']
                            }
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    className="gap-2"
                                    disable={exporting !== null}
                                >
                                    <DownloadSimple size={16} />
                                    {exporting ? 'Exporting…' : 'Export'}
                                    <CaretDown size={14} />
                                </MyButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuItem
                                    disabled={paymentSummary.total.count === 0}
                                    onSelect={() => void runExport('csv')}
                                    className="flex flex-col items-start gap-0.5"
                                >
                                    <span className="font-medium">Payments (CSV)</span>
                                    <span className="text-caption text-neutral-500">
                                        The payment records in view
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onSelect={() => void runExport('zip')}
                                    className="flex flex-col items-start gap-0.5"
                                >
                                    <span className="font-medium">Invoices (ZIP)</span>
                                    <span className="text-caption text-neutral-500">
                                        Every invoice PDF issued in the selected dates
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {SHOW_HEADER_ACTIONS && (
                            <>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => setRemindersOpen(true)}
                                    className="gap-2"
                                >
                                    <EnvelopeSimple size={16} />
                                    Send reminders
                                </MyButton>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => setRecordOpen(true)}
                                    className="gap-2"
                                >
                                    <Plus size={16} />
                                    Record payment
                                </MyButton>
                            </>
                        )}
                    </div>
                </div>

                {/* KPI tiles — Collected / Due / Upcoming / Pending / Failed (same row as the dashboard) */}
                <PaymentKpiCards
                    summary={paymentSummary}
                    billing={billing}
                    isLoading={isLoadingPayments}
                    activeKey={view === 'balances' ? balanceScope : statusBucket}
                    onSelect={handleSummarySelect}
                    visibleKeys={cardPrefs.visible}
                />

                {/* Instalment schedule — progress + Upcoming by month (instalment-first views only) */}
                {scheduleVisible && (
                    <InstalmentForecast
                        data={forecast}
                        isLoading={isLoadingForecast}
                        error={forecastError}
                        currency={billing?.currency ?? ''}
                        selectedMonth={view === 'balances' ? listMonth : null}
                        onSelectMonth={handleSelectMonth}
                        // Only while the Total card is on screen — hide it and the panel's own
                        // progress row comes back.
                        cardTotals={
                            billing && cardPrefs.visible.has('billed')
                                ? { collected: billing.collected, outstanding: billing.outstanding }
                                : null
                        }
                    />
                )}

                {/* Control bar */}
                <PaymentControlBar
                    searchValue={searchValue}
                    onSearchChange={(value) => {
                        setSearchValue(value);
                        setCurrentPage(0);
                    }}
                    segments={segments}
                    activeStatus={view === 'balances' ? balanceScope : statusBucket}
                    onStatusSelect={handleSegmentSelect}
                    filterCount={detailedFilterCount}
                    onOpenFilters={() => setFiltersOpen(true)}
                    actions={
                        <ManageColumnsPopover
                            columns={columnToggles}
                            hiddenColumns={hiddenColumns}
                            onToggle={toggleColumn}
                            onReset={handleResetColumns}
                            onReorder={setColumnOrder}
                        />
                    }
                />

                {/* Active filter chips */}
                {activeChips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        {activeChips.map((chip) => (
                            <span
                                key={chip.id}
                                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 py-1 pl-3 pr-1.5 text-caption text-neutral-600"
                            >
                                {chip.label}
                                <button
                                    type="button"
                                    onClick={() => {
                                        chip.onRemove();
                                        setCurrentPage(0);
                                    }}
                                    className="flex size-4 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600"
                                    aria-label={`Remove ${chip.label}`}
                                >
                                    <X size={11} weight="bold" />
                                </button>
                            </span>
                        ))}
                        <button
                            type="button"
                            onClick={handleClearFilters}
                            className="text-caption font-semibold text-primary-600 hover:text-primary-700"
                        >
                            Clear all
                        </button>
                    </div>
                )}

                {/* Table — payment records, or the learners who owe money */}
                {view === 'balances' ? (
                    <DueLearnersTable
                        data={outstanding}
                        mode={balanceScope === 'due' ? 'due' : 'outstanding'}
                        monthLabel={listMonth ? formatForecastMonth(listMonth) : null}
                        // An empty Due list is a dead end for an instalment institute — point it
                        // at the instalments still to come.
                        emptyAction={
                            scheduleVisible && (billing?.upcomingAll ?? 0) > 0
                                ? {
                                      label: 'See upcoming instalments',
                                      onClick: () => handleSegmentSelect('upcoming'),
                                  }
                                : null
                        }
                        isLoading={isLoadingOutstanding}
                        error={outstandingError as Error}
                        currentPage={currentPage}
                        onPageChange={handlePageChange}
                        onSelectLearner={(learner) => {
                            setDueLearner(learner);
                            setDueDetailOpen(true);
                        }}
                    />
                ) : (
                    <PaymentLogsTable
                        data={pagedData}
                        isLoading={isLoadingPayments}
                        error={paymentsError as Error}
                        currentPage={currentPage}
                        onPageChange={handlePageChange}
                        packageSessions={packageSessionsMap}
                        hasOrgAssociatedBatches={hasOrgAssociatedBatches}
                        hiddenColumns={hiddenColumns}
                        columnOrder={columnOrder}
                        onColumnOrderChange={handleColumnOrderChange}
                        invoicesByPaymentLog={invoicesByPaymentLog}
                        isLoadingInvoices={isLoadingInvoices}
                        onPreviewInvoice={setPreviewInvoice}
                        onRefresh={() => {
                            refetchPaymentLogs();
                            refetchSummary();
                        }}
                        onViewDetails={openDetail}
                    />
                )}

                {/* Filters slide-over */}
                <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                    <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                        <SheetHeader className="text-left">
                            <SheetTitle>Filters</SheetTitle>
                        </SheetHeader>
                        <div className="mt-5">
                            <PaymentFilters
                                panelOnly
                                searchValue={searchValue}
                                onSearchChange={setSearchValue}
                                startDate={startDate}
                                endDate={endDate}
                                hideDateFilters
                                onStartDateChange={(date) =>
                                    handleDateRangeChange({
                                        ...dateRange,
                                        start: date,
                                        preset: 'custom',
                                    })
                                }
                                onEndDateChange={(date) =>
                                    handleDateRangeChange({
                                        ...dateRange,
                                        end: date,
                                        preset: 'custom',
                                    })
                                }
                                selectedUserPlanStatuses={selectedUserPlanStatuses}
                                onUserPlanStatusesChange={(statuses) => {
                                    setSelectedUserPlanStatuses(statuses);
                                    setCurrentPage(0);
                                }}
                                paymentPlanOptions={paymentPlanOptions}
                                selectedPaymentPlans={selectedPaymentPlans}
                                onPaymentPlansChange={(plans) => {
                                    setSelectedPaymentPlans(plans);
                                    setCurrentPage(0);
                                }}
                                selectedPaymentSources={selectedPaymentSources}
                                onPaymentSourcesChange={(sources) => {
                                    setSelectedPaymentSources(sources);
                                    setCurrentPage(0);
                                }}
                                selectedPaymentTypes={selectedPaymentTypes}
                                onPaymentTypesChange={(types) => {
                                    setSelectedPaymentTypes(types);
                                    setCurrentPage(0);
                                }}
                                hasOrgAssociatedBatches={hasOrgAssociatedBatches}
                                packageSessionFilter={packageSessionFilter}
                                onPackageSessionFilterChange={(filter) => {
                                    setPackageSessionFilter(filter);
                                    setCurrentPage(0);
                                }}
                                batchesForSessions={batchesForSessions}
                                onQuickFilterSelect={(range) =>
                                    handleDateRangeChange({ ...range, preset: 'custom' })
                                }
                                onClearFilters={handleClearFilters}
                            />
                        </div>
                    </SheetContent>
                </Sheet>

                {/* Payment detail slide-over */}
                <PaymentDetailSheet
                    entry={detailEntry}
                    open={detailOpen}
                    onOpenChange={setDetailOpen}
                    onVoided={() => {
                        refetchPaymentLogs();
                        refetchSummary();
                    }}
                />

                {/* Balance breakdown, opened from a Due row */}
                <DueLearnerDetailSheet
                    learner={dueLearner}
                    open={dueDetailOpen}
                    onOpenChange={setDueDetailOpen}
                    // The exact scope the clicked row was computed under, so the enrolments in the
                    // sheet always add up to the totals it shows.
                    filters={{
                        start_date_in_utc: startDate ? startDate.slice(0, 19) : undefined,
                        end_date_in_utc: endDate ? endDate.slice(0, 19) : undefined,
                        package_session_ids: requestFilters.package_session_ids,
                    }}
                    onViewPayment={(entry) => {
                        setDueDetailOpen(false);
                        openDetail(entry);
                    }}
                />

                {/* Invoice PDF preview, opened from the Invoice column */}
                <InvoicePreviewByIdDialog
                    invoiceId={previewInvoice?.invoice_id ?? null}
                    invoiceNumber={previewInvoice?.invoice_number}
                    onClose={() => setPreviewInvoice(null)}
                />

                {/* Header action modals */}
                {SHOW_HEADER_ACTIONS && (
                    <>
                        <SendRemindersModal
                            open={remindersOpen}
                            onOpenChange={setRemindersOpen}
                            pendingCount={paymentSummary.pending.count}
                            failedCount={paymentSummary.failed.count}
                        />
                        <RecordPaymentModal open={recordOpen} onOpenChange={setRecordOpen} />
                    </>
                )}
            </div>
        </StudentSidebarProvider>
    );
}
