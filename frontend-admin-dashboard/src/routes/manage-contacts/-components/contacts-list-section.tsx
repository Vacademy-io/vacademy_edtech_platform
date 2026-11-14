import { useState, useRef, useEffect } from 'react';
import { useContactFilters } from '../-hooks/useContactFilters';
import { useContactTable } from '../-hooks/useContactTable';
import { ContactFilters } from './contact-filters';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { DashboardLoader, ErrorBoundary } from '@/components/core/dashboard-loader';
import { SmartErrorPage } from '@/components/core/SmartErrorPage';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { ContactUser } from '../-types/contact-types';
import { getContactColumnLabel, getContactColumns } from './contacts-table-columns';
import { CountBadge } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/count-badge';
import { ManageColumnsPopover } from '@/components/shared/leads/manage-columns-popover';
import {
    useLeadColumnPrefs,
    useColumnOrderPrefs,
    orderColumnIds,
    type LeadColumnToggle,
} from '@/components/shared/leads/use-lead-column-prefs';
import { useCompactMode } from '@/hooks/use-compact-mode';
import EmptyStudentListImage from '@/assets/svgs/empty-students-image.svg';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { AssignCounselorToLeadDialog } from '@/components/shared/assign-counselor-to-lead-dialog';
import { getSystemFieldColumnVisibility } from '@/components/design-system/utils/constants/system-field-columns';
import { getCustomFieldSettings } from '@/services/custom-field-settings';

/** Per-browser column layout, same keys convention as Manage Payments / sub-orgs. */
const COLUMN_PREFS_KEY = 'contacts:hidden-columns';
const COLUMN_ORDER_KEY = 'contacts:column-order';

/** System fields an institute can switch off in Settings → Custom Fields; ids are `user.<accessor>`. */
const SYSTEM_FIELD_ACCESSORS = [
    'full_name',
    'username',
    'email',
    'mobile_number',
    'gender',
    'region',
    'city',
] as const;

/** Opens the side view and is pinned left by MyTable, so it is neither hidden nor moved. */
const DETAILS_COLUMN_ID = 'details';
/** A row without the name is not a contact row: it can be moved but not switched off. */
const LOCKED_COLUMN_IDS = new Set(['user.full_name']);

export const ContactsListSection = () => {
    const { setNavHeading } = useNavHeadingStore();
    const filters = useContactFilters();
    const { contactTableData, isLoading, error, handleSort, handlePageChange, page } =
        useContactTable(filters.appliedFilters, filters.setAppliedFilters);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const tableRef = useRef<HTMLDivElement>(null);

    // Keep the custom-field settings cache fresh (it's cleared on save) and
    // re-render so the column-visibility recomputes — otherwise the readers fail
    // open and show columns that were toggled off.
    const [, bumpCustomFieldsVersion] = useState(0);
    useEffect(() => {
        getCustomFieldSettings()
            .then(() => bumpCustomFieldsVersion((v) => v + 1))
            .catch(() => {});
    }, []);

    const leadSettings = useLeadSettings();
    // Don't render lead UI while settings are loading (defaults have enabled:true which would flash)
    const leadReady = !leadSettings.isLoading && leadSettings.enabled;
    const showLeadScore = leadReady && leadSettings.showScoreInContactsTable;
    const showCounselor = leadReady;

    const [assignDialog, setAssignDialog] = useState<{ userId: string; userName: string } | null>(null);

    const { isCompact } = useCompactMode();
    // Column layout, remembered per browser: which columns are on, and their order.
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(COLUMN_PREFS_KEY);
    const { columnOrder, setColumnOrder, resetColumnOrder } = useColumnOrderPrefs(COLUMN_ORDER_KEY);
    /** "Reset" restores both halves of the layout — hidden columns and order. */
    const handleResetColumns = () => {
        resetColumns();
        resetColumnOrder();
    };

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">Contacts</h1>);
    }, []);

    // Close sidebar on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element | null;
            // Side-view panel + any portaled overlay (dialog, menu, popover/select,
            // toast) render at <body>, outside tableRef. Treat clicks inside them as
            // "inside" so e.g. closing the Assign-Course dialog's X doesn't also
            // close the side view.
            if (
                target?.closest(
                    '[data-sidebar="sidebar"],[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[data-sonner-toaster]'
                )
            )
                return;
            if (
                tableRef.current &&
                !tableRef.current.contains(event.target as Node) &&
                isSidebarOpen
            ) {
                setIsSidebarOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isSidebarOpen]);

    const EmptyState = () => (
        <div className="animate-fadeIn flex flex-col items-center justify-center px-3 py-8 text-center">
            <div className="mb-3 rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 p-3 shadow-inner">
                <EmptyStudentListImage className="size-12 opacity-50" />
            </div>
            <h3 className="mb-2 text-base font-semibold text-neutral-700">No Contacts Found</h3>
            <p className="mb-4 max-w-md text-xs leading-relaxed text-neutral-500">
                No contact data matches your current filters.
            </p>
        </div>
    );

    if (error) return <SmartErrorPage />;

    // Columns — counsellor assign callback only when lead system is active
    const allColumns = getContactColumns(
        handleSort,
        showLeadScore,
        showCounselor ? (userId, userName) => setAssignDialog({ userId, userName }) : undefined,
        showCounselor
    );
    // A system field switched off in Settings → Custom Fields stays off and is not offered in
    // Manage Column either; turning it back on belongs to that setting. Read on every render,
    // like before, so the refreshed settings cache takes effect.
    const systemVisibility = getSystemFieldColumnVisibility();
    const systemHidden = new Set(
        SYSTEM_FIELD_ACCESSORS.filter((accessor) => systemVisibility[accessor] === false).map(
            (accessor) => `user.${accessor}`
        )
    );
    const detailsColumn = allColumns.find((column) => column.id === DETAILS_COLUMN_ID);
    const columnsById = new Map(
        allColumns
            .filter(
                (column) =>
                    column.id && column.id !== DETAILS_COLUMN_ID && !systemHidden.has(column.id)
            )
            .map((column) => [column.id as string, column])
    );
    // Saved order reconciled with the columns that exist now (the lead columns appear only
    // once lead settings load), so a new column keeps its natural slot.
    const orderedColumnIds = orderColumnIds([...columnsById.keys()], columnOrder);
    const columnToggles: LeadColumnToggle[] = orderedColumnIds.map((id) => ({
        id,
        label: getContactColumnLabel(columnsById.get(id)!),
        locked: LOCKED_COLUMN_IDS.has(id),
    }));
    const columns = [
        ...(detailsColumn ? [detailsColumn] : []),
        ...orderedColumnIds
            .filter((id) => LOCKED_COLUMN_IDS.has(id) || !hiddenColumns.has(id))
            .map((id) => columnsById.get(id)!),
    ];

    return (
        <ErrorBoundary>
            {leadReady && assignDialog && (
                <AssignCounselorToLeadDialog
                    open={!!assignDialog}
                    onOpenChange={(open) => {
                        if (!open) setAssignDialog(null);
                    }}
                    userId={assignDialog.userId}
                    userName={assignDialog.userName}
                />
            )}
            <StudentSidebarProvider>
                <section className="animate-fadeIn flex max-w-full flex-col gap-3 overflow-visible">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <h2 className="text-subtitle font-semibold text-neutral-700">
                                All Contacts
                            </h2>
                            {/* Total for the current filters — the same number the pages add up to. */}
                            {isLoading ? (
                                <span className="h-4 w-20 animate-pulse rounded-full bg-neutral-100" />
                            ) : (
                                <CountBadge
                                    label="Total"
                                    value={contactTableData?.total_elements ?? 0}
                                    tone="total"
                                    isCompact={isCompact}
                                />
                            )}
                        </div>
                        <ManageColumnsPopover
                            columns={columnToggles}
                            hiddenColumns={hiddenColumns}
                            onToggle={toggleColumn}
                            onReset={handleResetColumns}
                            onReorder={setColumnOrder}
                        />
                    </div>

                    <ContactFilters filters={filters} />

                    {isLoading ? (
                        <div className="flex w-full flex-col items-center gap-2 py-6">
                            <DashboardLoader />
                            <p className="animate-pulse text-xs text-neutral-500">
                                Loading contacts...
                            </p>
                        </div>
                    ) : !contactTableData || contactTableData.users.length === 0 ? (
                        <EmptyState />
                    ) : (
                        <div className="animate-slideInRight flex flex-col gap-2">
                            <div className="overflow-hidden rounded-lg border border-neutral-200/50 bg-gradient-to-br from-white to-neutral-50/30 shadow-sm">
                                <div className="max-w-full" ref={tableRef}>
                                    <SidebarProvider
                                        style={{ ['--sidebar-width' as string]: '565px' }}
                                        defaultOpen={false}
                                        open={isSidebarOpen}
                                        onOpenChange={setIsSidebarOpen}
                                    >
                                        <MyTable<ContactUser>
                                            data={{
                                                content: contactTableData.users,
                                                total_pages: contactTableData.total_pages,
                                                page_no: contactTableData.current_page,
                                                page_size: contactTableData.page_size,
                                                total_elements: contactTableData.total_elements,
                                                last: contactTableData.is_last,
                                            }}
                                            // Already ordered and narrowed to the visible
                                            // columns (Manage Column + Settings → Custom Fields).
                                            columns={columns}
                                            isLoading={isLoading}
                                            error={error}
                                            onSort={handleSort}
                                            columnWidths={{}} // Default widths
                                            currentPage={page}
                                        />
                                        <div>
                                            <StudentSidebar
                                                selectedTab={'overview'}
                                                examType={'EXAM'}
                                                isStudentList={false} // Maybe acts differently?
                                            />
                                        </div>
                                    </SidebarProvider>
                                </div>
                            </div>

                            <div className="flex justify-center lg:justify-end">
                                <MyPagination
                                    currentPage={page}
                                    totalPages={contactTableData?.total_pages || 1}
                                    onPageChange={handlePageChange}
                                    totalElements={contactTableData.total_elements}
                                    pageSize={contactTableData.page_size}
                                />
                            </div>
                        </div>
                    )}
                </section>
            </StudentSidebarProvider>
        </ErrorBoundary>
    );
};
