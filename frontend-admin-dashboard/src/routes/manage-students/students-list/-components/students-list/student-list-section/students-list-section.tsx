// StudentListSection.tsx
import { useEffect, useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { GetFilterData } from '@/routes/manage-students/students-list/-constants/all-filters';
import { MyTable } from '@/components/design-system/table';
import { counsellorDisplayName } from '@/components/shared/leads/counsellor-display';
import { MyPagination } from '@/components/design-system/pagination';
import { StudentListHeader } from './student-list-header';
import { StudentFilters } from './student-filters';
import { useStudentFilters } from '@/routes/manage-students/students-list/-hooks/useStudentFilters';
import { useStudentTable } from '@/routes/manage-students/students-list/-hooks/useStudentTable';
import { useStudentCounts } from '@/routes/manage-students/students-list/-hooks/useStudentCounts';
import { StudentTable } from '@/types/student-table-types';
import {
    getColumnsVisibility,
    getCustomColumns,
} from '@/components/design-system/utils/constants/table-column-data';
import { STUDENT_LIST_COLUMN_WIDTHS } from '@/components/design-system/utils/constants/table-layout';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useLeadProfiles } from '@/hooks/use-lead-profiles';
import { LeadScoreBadge } from '@/components/shared/lead-score-badge';
import { MembershipBadge } from '@/components/shared/membership-badge';
import { AssignCounselorToLeadDialog } from '@/components/shared/assign-counselor-to-lead-dialog';
import { UserCircle } from '@phosphor-icons/react';
import { BulkActions } from './bulk-actions/bulk-actions';
import { useCrossPageSelection } from '@/hooks/use-cross-page-selection';
import { reportApiError } from '@/lib/report-api-error';
import { MyButton } from '@/components/design-system/button';
import { useQuery } from '@tanstack/react-query';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { listAccessibleSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId, getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getCustomFieldSettingsFromCache, getCustomFieldSettings } from '@/services/custom-field-settings';
import { DashboardLoader, ErrorBoundary } from '@/components/core/dashboard-loader';
import { SmartErrorPage } from '@/components/core/SmartErrorPage';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebar } from '../student-side-view/student-side-view';
import EmptyStudentListImage from '@/assets/svgs/empty-students-image.svg';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { NoCourseDialog } from '@/components/common/students/no-course-dialog';
import { useSearch } from '@tanstack/react-router';
import { Route } from '@/routes/manage-students/students-list';
import { DropdownItemType } from '@/components/common/students/enroll-manually/dropdownTypesForPackageItems';
import { ShareCredentialsDialog } from './bulk-actions/share-credentials-dialog';
import { IndividualShareCredentialsDialog } from './bulk-actions/individual-share-credentials-dialog';
import { SendMessageDialog } from './bulk-actions/send-message-dialog';
import { SendEmailDialog } from './bulk-actions/send-email-dialog';
import { AcceptRequestDialog } from '@/routes/manage-students/enroll-requests/-components/bulk-actions/bulk-actions-component/accept-request-dialog';
import { DeclineRequestDialog } from '@/routes/manage-students/enroll-requests/-components/bulk-actions/bulk-actions-component/decline-request-dialog';
import { InviteFormProvider } from '@/routes/manage-students/invite/-context/useInviteFormContext';
import { Users, FileMagnifyingGlass } from '@phosphor-icons/react';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { useListCustomFieldControls } from '@/components/shared/leads/use-list-custom-field-controls';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Row statuses that mean the user actually holds (or held) an enrolment, as opposed to
// INVITED / PENDING_FOR_APPROVAL rows and audience-only respondents.
const ENROLLED_STATUSES: string[] = ['ACTIVE', 'INACTIVE', 'TERMINATED'];

export const StudentsListSection = () => {
    const { t } = useTranslation('manageStudentsListSection');
    const { t: tAllFilters } = useTranslation('manageStudentsAllFilters');
    const { setNavHeading } = useNavHeadingStore();
    const { isError, isLoading } = useQuery(useInstituteQuery());
    const [isOpen, setIsOpen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { getCourseFromPackage, instituteDetails } = useInstituteDetailsStore();
    const tableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element | null;
            // The student sidebar renders into a Radix portal at <body>, outside
            // tableRef. Treat any click inside the portal as "inside" so internal
            // taps (tabs, scroll, etc.) don't close the sheet — especially on touch.
            // Also ignore clicks inside any portaled overlay (dialog, menu,
            // popover/select, toast) — they render at <body>, outside tableRef,
            // so closing e.g. the Assign-Course dialog must not close the panel.
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

    useEffect(() => {
        const courseList = getCourseFromPackage();
        if (courseList.length === 0) {
            setIsOpen(true);
        }
    }, [instituteDetails]);

    useEffect(() => {
        setNavHeading(
            <h1 className="text-lg">{getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner)}</h1>
        );
    }, []);

    // Ensure the custom-field settings cache is populated/fresh. After saving a
    // toggle the cache is cleared, and the column-visibility readers fail open
    // (show everything) on an empty cache. Fetch on mount, then force a re-render
    // so the inline column-visibility recomputes with the fresh data.
    const [, bumpCustomFieldsVersion] = useState(0);
    useEffect(() => {
        getCustomFieldSettings()
            .then(() => bumpCustomFieldsVersion((v) => v + 1))
            .catch(() => {});
    }, []);

    const {
        columnFilters,
        appliedFilters,
        clearFilters,
        searchInput,
        searchFilter,
        currentSession,
        sessionList,
        getActiveFiltersState,
        handleFilterChange,
        handleFilterClick,
        handleClearFilters,
        handleSearchInputChange,
        handleSearchEnter,
        handleClearSearch,
        setAppliedFilters,
        handleSessionChange,
        setColumnFilters,
        textCustomFields,
        rangeCustomFields,
    } = useStudentFilters({ allowAllSessions: true });

    // Fetch campaigns once so the audience filter chip can render its options.
    // The actual audience JOIN only kicks in server-side when the user picks one.
    const audienceInstituteId = getCurrentInstituteId() || '';
    const { data: campaignsData } = useQuery(
        handleFetchCampaignsList({
            institute_id: audienceInstituteId,
            page: 0,
            size: 100,
        })
    );

    // Sub-orgs for the Sub-Org filter chip. listAccessibleSubOrgs returns {id, name} where
    // id is the child-institute id (= ssigm.sub_org_id), matching the backend filter; it also
    // scopes to the caller (institute admin → all; sub-org admin → their own).
    const { data: subOrgsData } = useQuery({
        queryKey: ['ACCESSIBLE_SUB_ORGS', audienceInstituteId],
        queryFn: () => listAccessibleSubOrgs(audienceInstituteId),
        enabled: !!audienceInstituteId,
        staleTime: 5 * 60 * 1000,
    });

    const hasOrgAssociatedBatches = useMemo(
        () =>
            (instituteDetails?.batches_for_sessions || []).some(
                (b) => b.is_org_associated === true
            ),
        [instituteDetails]
    );

    // Role-based column hiding: read the current role's display settings from cache.
    // Cache miss → empty hidden set → no role-driven hiding (institute defaults apply).
    const roleHiddenColumns = useMemo(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        return new Set(cached?.learnerListColumns?.hiddenColumns ?? []);
    }, []);
    // Custom fields are hidden by default. Admin opts a custom field IN per role by
    // adding its accessor (custom_field_id) to enabledCustomFields. Anything NOT in
    // this set is force-hidden in the table.
    const roleEnabledCustomFields = useMemo(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        return new Set(cached?.learnerListColumns?.enabledCustomFields ?? []);
    }, []);
    // Count badges (Total/Active/Inactive) are shown unless this role turned them off
    // in Settings → Display Settings. Default visible.
    const showCountBadges = useMemo(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        return cached?.learnerListColumns?.showCountBadges !== false;
    }, []);

    // Institute-wide custom-field filter gate (STUDENTS surface of Settings →
    // Display Settings → "List Filters & Sorting — Custom Fields"). null until
    // the surface is configured → legacy auto-expose behavior in GetFilterData.
    const { configured: studentCfGateConfigured, fields: studentCfGateFields } =
        useListCustomFieldControls('STUDENTS', audienceInstituteId || undefined);
    const studentCfFilterGate = useMemo(
        () =>
            studentCfGateConfigured
                ? new Set(studentCfGateFields.map((f) => f.customFieldId))
                : null,
        [studentCfGateConfigured, studentCfGateFields]
    );

    // Full set of custom field accessors known for this institute (any source).
    // Anything in this set that's NOT in roleEnabledCustomFields gets force-hidden.
    const allCustomFieldAccessors = useMemo(() => {
        const cache = getCustomFieldSettingsFromCache();
        if (!cache) return new Set<string>();
        const all = [
            ...cache.instituteFields,
            ...cache.customFields,
            ...cache.fieldGroups.flatMap((g) => g.fields),
        ];
        return new Set(all.map((f) => f.id).filter(Boolean));
    }, []);

    // Filter-id → column accessors it controls. A filter chip is omitted when ALL its
    // mapped columns are role-hidden. Filters not in this map (Approval Status, Cart
    // Status, Audience, Role, Audience) never get role-hidden — they don't map to a
    // single column. Custom-field filter ids are field.fieldKey; their column accessor
    // is field.id, so we handle them dynamically below.
    const FILTER_TO_COLUMNS: Record<string, string[]> = {
        batch: ['package_session_id'],
        statuses: ['status'],
        gender: ['gender'],
        session_expiry_days: ['expiry_date'],
        payment_statuses: ['plan_type', 'amount_paid'],
        enroll_invite_ids: ['enroll_invite_name'],
    };

    const customFieldIdByKey = useMemo(() => {
        const map = new Map<string, string>();
        instituteDetails?.dropdown_custom_fields?.forEach((f) => map.set(f.fieldKey, f.id));
        textCustomFields.forEach((f) => map.set(f.field_key, f.custom_field_id));
        rangeCustomFields.forEach((f) => map.set(f.field_key, f.custom_field_id));
        return map;
    }, [instituteDetails, textCustomFields, rangeCustomFields]);

    // Range (DATE/NUMBER) custom fields have no legacy auto-expose — they only
    // appear once explicitly enabled in the settings gate.
    const gatedRangeCustomFields = useMemo(
        () =>
            studentCfFilterGate
                ? rangeCustomFields.filter((f) => studentCfFilterGate.has(f.custom_field_id))
                : [],
        [studentCfFilterGate, rangeCustomFields]
    );

    // Whether this institute runs trials at all, reported by the list endpoint rather than
    // configured. Held in state because the filter bar is built before the table hook has
    // run: it starts false and flips once the first page arrives, which re-renders the bar.
    const [membershipTypesAvailable, setMembershipTypesAvailable] = useState(false);

    const allFilters = GetFilterData(
        tAllFilters,
        instituteDetails,
        currentSession.id,
        campaignsData?.content,
        subOrgsData,
        textCustomFields,
        studentCfFilterGate,
        gatedRangeCustomFields,
        membershipTypesAvailable
    );
    const filters = allFilters.filter((f) => {
        const fixed = FILTER_TO_COLUMNS[f.id];
        if (fixed) return fixed.some((accessor) => !roleHiddenColumns.has(accessor));
        const customColAccessor = customFieldIdByKey.get(f.id);
        // Custom field filter chips follow the same opt-in rule as their columns:
        // visible only if the role has enabled this custom field.
        if (customColAccessor) return roleEnabledCustomFields.has(customColAccessor);
        return true; // unmapped filters (approval/cart/role/audience) survive
    });

    const search = useSearch({ from: Route.id });

    const {
        studentTableData,
        isLoading: loadingData,
        error: loadingError,
        page,
        handleSort,
        handlePageChange,
        totalElements,
        fetchAllMatching,
    } = useStudentTable(
        appliedFilters,
        setAppliedFilters,
        search.package_session_id ? [search.package_session_id] : null
    );

    // Flip the gate once the first page lands. Only on a real change, so this never loops.
    useEffect(() => {
        const available = Boolean(studentTableData?.membership_types_available);
        setMembershipTypesAvailable((current) => (current === available ? current : available));
    }, [studentTableData]);

    // Header badge counts (Total / Active / Inactive) — independent of the status
    // filter so the breakdown is always visible. Pass the same pinned
    // package_session_id the table uses so counts match in the Course Details tab.
    // The Invited badge shows on the learner list only, not when this section is
    // pinned to one batch inside Course Details.
    const learnersEnhanced = !search.package_session_id;
    const studentCounts = useStudentCounts(
        appliedFilters,
        !isLoading && showCountBadges,
        search.package_session_id ? [search.package_session_id] : null,
        learnersEnhanced
    );

    const leadSettings = useLeadSettings();
    // Don't render lead UI while settings are loading (defaults have enabled:true which would flash)
    const leadReady = !leadSettings.isLoading && leadSettings.enabled;
    const showLeadScore = leadReady && leadSettings.showScoreInStudentsTable;
    const [assignDialog, setAssignDialog] = useState<{ userId: string; userName: string } | null>(null);

    const studentUserIds = useMemo(
        () => (studentTableData?.content ?? []).map((s) => s.user_id).filter(Boolean) as string[],
        [studentTableData]
    );
    // Fetch lead profiles when lead system is enabled (needed for both score badge and counsellor column)
    const { profiles: leadProfiles } = useLeadProfiles(studentUserIds, leadReady);

    // Selection spans pages: "Select all" pulls every learner matching the active filters, so a
    // bulk action isn't capped at the ten rows on screen. (The hook remembers each visited page's
    // rows itself, which is what the local allPagesData map used to do.)
    const {
        currentPageSelection,
        onRowSelectionChange: handleRowSelectionChange,
        selectedRows: selectedStudents,
        selectedCount: totalSelectedCount,
        reset: handleResetSelections,
        selectAllMatching,
        isSelectingAll,
        canSelectAll,
    } = useCrossPageSelection<StudentTable>({
        page,
        pageRows: studentTableData?.content ?? [],
        getId: (student) => student.id,
        totalElements,
        fetchAllMatching,
        // Changing a filter invalidates a "select all" made under the previous one.
        resetKey: JSON.stringify(appliedFilters),
        onError: (error) =>
            reportApiError(error, {
                feature: 'students-select-all',
                fallbackMessage: t('bulkActionsBar.selectAllError'),
            }),
    });

    const getSelectedStudents = (): StudentTable[] => selectedStudents;

    const getSelectedStudentIds = (): string[] => selectedStudents.map((student) => student.id);

    // Approval actions (row-level Accept/Decline and the bulk Accept action) are shown
    // whenever the Approval Status filter (Pending for Approval / Invited) is active.
    const showApprovalActions =
        appliedFilters.statuses?.some((s) => ['INVITED', 'PENDING_FOR_APPROVAL'].includes(s)) ||
        false;

    if (isLoading) return <DashboardLoader />;
    if (isError) return <SmartErrorPage />;

    // Enhanced empty state component
    const EmptyState = () => (
        <div className="animate-fadeIn flex flex-col items-center justify-center px-3 py-8 text-center">
            <div className="mb-3 rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 p-3 shadow-inner">
                <EmptyStudentListImage className="size-12 opacity-50" />
            </div>
            <h3 className="mb-2 text-base font-semibold text-neutral-700">
                {t('emptyState.title', {
                    term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                })}
            </h3>
            <p className="mb-4 max-w-md text-xs leading-relaxed text-neutral-500">
                {t('emptyState.description', {
                    termLower: getTerminology(
                        RoleTerms.Learner,
                        SystemTerms.Learner
                    ).toLocaleLowerCase(),
                })}
            </p>
            <div className="flex flex-col items-center gap-2 sm:flex-row">
                <InviteFormProvider>
                    <button className="group flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary-500 to-primary-600 px-3 py-1.5 text-sm text-white shadow-md transition-all duration-200 hover:scale-105 hover:from-primary-600 hover:to-primary-700">
                        <Users className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                        {t('emptyState.inviteButton', {
                            term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                        })}
                    </button>
                </InviteFormProvider>
                <button
                    onClick={handleClearFilters}
                    className="group flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 transition-all duration-200 hover:scale-105 hover:bg-neutral-200"
                >
                    <FileMagnifyingGlass className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                    {t('emptyState.clearFiltersButton')}
                </button>
            </div>
        </div>
    );

    const handleResetAll = () => {
        handleClearFilters();
    };

    return (
        <ErrorBoundary>
            <section className="animate-fadeIn flex max-w-full flex-col gap-3 overflow-visible">
                <div className="flex flex-col gap-3">
                    <InviteFormProvider>
                        <StudentListHeader
                            currentSession={currentSession}
                            showCounts={showCountBadges}
                            total={studentCounts.total}
                            active={studentCounts.active}
                            inactive={studentCounts.inactive}
                            invited={studentCounts.invited}
                            countsLoading={studentCounts.isLoading}
                        />
                    </InviteFormProvider>

                    <StudentFilters
                        currentSession={currentSession}
                        filters={filters}
                        searchInput={searchInput}
                        searchFilter={searchFilter}
                        columnFilters={columnFilters}
                        clearFilters={clearFilters}
                        getActiveFiltersState={getActiveFiltersState}
                        onSessionChange={handleSessionChange}
                        onSearchChange={handleSearchInputChange}
                        onSearchEnter={handleSearchEnter}
                        onClearSearch={handleClearSearch}
                        onFilterChange={handleFilterChange}
                        onFilterClick={handleFilterClick}
                        onClearFilters={handleResetAll}
                        appliedFilters={appliedFilters}
                        page={page}
                        pageSize={10}
                        totalElements={studentTableData?.total_elements || 0}
                        sessionList={sessionList}
                    />

                    {loadingData ? (
                        <div className="flex w-full flex-col items-center gap-2 py-6">
                            <DashboardLoader />
                            <p className="animate-pulse text-xs text-neutral-500">
                                {t('loadingData', {
                                    termLower: getTerminology(
                                        RoleTerms.Learner,
                                        SystemTerms.Learner
                                    ).toLocaleLowerCase(),
                                })}
                            </p>
                        </div>
                    ) : !studentTableData || studentTableData.content.length == 0 ? (
                        <EmptyState />
                    ) : (
                        <div className="animate-slideInRight flex flex-col gap-2">
                            {/* The bulk-action bar sits above the table, where the eye already is
                                after ticking the header checkbox. Below the table it was easy to
                                miss entirely on a full page of rows. */}
                            {totalSelectedCount > 0 && (
                                <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
                                    <BulkActions
                                        selectedCount={totalSelectedCount}
                                        selectedStudentIds={getSelectedStudentIds()}
                                        selectedStudents={getSelectedStudents()}
                                        onReset={handleResetSelections}
                                        showApprovalActions={showApprovalActions}
                                        leftSlot={
                                            canSelectAll ? (
                                                <MyButton
                                                    buttonType="text"
                                                    scale="small"
                                                    disable={isSelectingAll}
                                                    onClick={selectAllMatching}
                                                >
                                                    {isSelectingAll
                                                        ? t('bulkActionsBar.selecting')
                                                        : t('bulkActionsBar.selectAllCount', {
                                                              count: totalElements,
                                                          })}
                                                </MyButton>
                                            ) : (
                                                <span className="text-caption text-neutral-500">
                                                    {t('bulkActionsBar.allMatchingFilters', {
                                                        term: getTerminologyPlural(
                                                            RoleTerms.Learner,
                                                            SystemTerms.Learner
                                                        ).toLocaleLowerCase(),
                                                    })}
                                                </span>
                                            )
                                        }
                                    />
                                </div>
                            )}

                            {/* Modern table container */}
                            <div className="overflow-hidden rounded-lg border border-neutral-200/50 bg-gradient-to-br from-white to-neutral-50/30 shadow-sm">
                                <div className="max-w-full" ref={tableRef}>
                                    <SidebarProvider
                                        style={{ ['--sidebar-width' as string]: '565px' }}
                                        defaultOpen={false}
                                        open={isSidebarOpen}
                                        onOpenChange={setIsSidebarOpen}
                                    >
                                        <MyTable<StudentTable>
                                            data={{
                                                content: studentTableData.content.map(
                                                    (student) => ({
                                                        ...student,
                                                        id: student.user_id,
                                                    })
                                                ),
                                                total_pages: studentTableData.total_pages,
                                                page_no: studentTableData.page_no,
                                                page_size: studentTableData.page_size,
                                                total_elements: studentTableData.total_elements,
                                                last: studentTableData.last,
                                            }}
                                            columns={(() => {
                                                const baseCols = getCustomColumns(showApprovalActions);
                                                // Trial/Paid chip under the name. Applied before the
                                                // lead-system early return, so it shows for institutes
                                                // that run trials whether or not leads are enabled.
                                                const cols = membershipTypesAvailable
                                                    ? baseCols.map((col) => {
                                                          if (col.id !== 'full_name') return col;
                                                          const inner = col.cell;
                                                          return {
                                                              ...col,
                                                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                              cell: (props: any) => (
                                                                  <div className="flex flex-col gap-0.5">
                                                                      {typeof inner === 'function'
                                                                          ? inner(props)
                                                                          : null}
                                                                      <MembershipBadge
                                                                          membershipType={
                                                                              props.row.original
                                                                                  .membership_type
                                                                          }
                                                                          available
                                                                      />
                                                                  </div>
                                                              ),
                                                          };
                                                      })
                                                    : baseCols;
                                                // If lead system is entirely off, return cols unchanged
                                                if (!leadReady) return cols;

                                                // Augment full_name cell with score badge (only when score visible)
                                                const augmented = cols.map((col) => {
                                                    if (col.id !== 'full_name' || !showLeadScore)
                                                        return col;
                                                    const originalCell = col.cell;
                                                    return {
                                                        ...col,
                                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                        cell: (props: any) => {
                                                            const userId = props.row.original
                                                                .user_id as string;
                                                            const profile = leadProfiles[userId];
                                                            // An enrolled learner is past the lead stage,
                                                            // whatever their lead profile still says (e.g.
                                                            // enrolled outside the normal flow, so it was
                                                            // never marked CONVERTED). Only people who
                                                            // haven't joined yet keep the badge.
                                                            const isEnrolled =
                                                                !props.row.original
                                                                    .is_audience_only &&
                                                                ENROLLED_STATUSES.includes(
                                                                    props.row.original.status
                                                                );
                                                            return (
                                                                <div className="flex flex-col gap-0.5">
                                                                    {typeof originalCell ===
                                                                    'function'
                                                                        ? originalCell(props)
                                                                        : null}
                                                                    {profile &&
                                                                        !isEnrolled &&
                                                                        profile.conversion_status !==
                                                                            'CONVERTED' && (
                                                                            <LeadScoreBadge
                                                                                score={
                                                                                    profile.best_score
                                                                                }
                                                                                tier={
                                                                                    profile.lead_tier
                                                                                }
                                                                                size="sm"
                                                                            />
                                                                        )}
                                                                </div>
                                                            );
                                                        },
                                                    };
                                                });

                                                // Counsellor column: always shown when lead system is enabled
                                                augmented.push({
                                                    id: 'counsellor',
                                                    header: t('table.counsellorHeader'),
                                                    size: 160,
                                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                    cell: (props: any) => {
                                                        const userId = props.row.original
                                                            .user_id as string;
                                                        const name = props.row.original
                                                            .full_name as string;
                                                        const profile = leadProfiles[userId];
                                                        const counselorName =
                                                            counsellorDisplayName(profile);
                                                        if (counselorName) {
                                                            return (
                                                                <button
                                                                    className="flex items-center gap-1 truncate text-sm text-neutral-700 hover:text-primary-600"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setAssignDialog({
                                                                            userId,
                                                                            userName: name,
                                                                        });
                                                                    }}
                                                                    title={t(
                                                                        'table.reassignTooltip'
                                                                    )}
                                                                >
                                                                    <UserCircle className="size-4 shrink-0 text-neutral-400" />
                                                                    <span className="truncate">
                                                                        {counselorName}
                                                                    </span>
                                                                </button>
                                                            );
                                                        }
                                                        return (
                                                            <button
                                                                className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-primary-50 hover:text-primary-700"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setAssignDialog({
                                                                        userId,
                                                                        userName: name,
                                                                    });
                                                                }}
                                                            >
                                                                {t('table.assignButton')}
                                                            </button>
                                                        );
                                                    },
                                                });
                                                return augmented;
                                            })()}
                                            tableState={{
                                                columnVisibility: (() => {
                                                    // Layers, highest precedence first:
                                                    //   1. Filter-driven (Batch/Invite/Plan/Amount) — when the filter
                                                    //      is active these MUST show so admin sees what they filtered.
                                                    //   2. Role hidden columns — force hidden for system accessors in
                                                    //      hiddenColumns (admin's explicit hide for this role).
                                                    //   3. Custom field default-hide — every custom field accessor not
                                                    //      in enabledCustomFields is force-hidden. Custom fields are
                                                    //      hidden by default; admin opts in per role.
                                                    //   4. Institute-wide system field visibility from CustomFieldsSettings.
                                                    const base = getColumnsVisibility();
                                                    roleHiddenColumns.forEach((accessor) => {
                                                        base[accessor] = false;
                                                    });
                                                    // Hide every custom field accessor that isn't explicitly enabled
                                                    // for this role — custom fields are opt-in via display-settings.
                                                    allCustomFieldAccessors.forEach((accessor) => {
                                                        if (!roleEnabledCustomFields.has(accessor)) {
                                                            base[accessor] = false;
                                                        }
                                                    });

                                                    const batchFilterApplied =
                                                        (appliedFilters.package_session_ids?.length ?? 0) > 0;
                                                    const paymentFilterApplied =
                                                        (appliedFilters.payment_statuses?.length ?? 0) > 0;
                                                    const enrollInviteFilterApplied =
                                                        (appliedFilters.enroll_invite_ids?.length ?? 0) > 0;
                                                    return {
                                                        ...base,
                                                        // Filter-driven overrides win over role hide.
                                                        package_session_id: batchFilterApplied,
                                                        enroll_invite_name: enrollInviteFilterApplied,
                                                        plan_type: paymentFilterApplied,
                                                        amount_paid: paymentFilterApplied,
                                                        preffered_batch: false,
                                                        // Only surface the Sub-Org column for institutes that actually
                                                        // have sub-orgs (matches the Sub-Org filter chip gating).
                                                        sub_org_name: (subOrgsData?.length ?? 0) > 0,
                                                        membership_role:
                                                            hasOrgAssociatedBatches &&
                                                            roleEnabledCustomFields.has(
                                                                'membership_role'
                                                            ),
                                                        membership_type:
                                                            hasOrgAssociatedBatches &&
                                                            roleEnabledCustomFields.has(
                                                                'membership_type'
                                                            ),
                                                    };
                                                })(),
                                            }}
                                            isLoading={loadingData}
                                            error={loadingError}
                                            onSort={handleSort}
                                            columnWidths={STUDENT_LIST_COLUMN_WIDTHS}
                                            rowSelection={currentPageSelection}
                                            onRowSelectionChange={handleRowSelectionChange}
                                            currentPage={page}
                                        />
                                        <div>
                                            <StudentSidebar
                                                selectedTab={'ENDED,PENDING,LIVE'}
                                                examType={'EXAM'}
                                                isStudentList={true}
                                            />
                                        </div>
                                    </SidebarProvider>
                                </div>
                            </div>

                            {/* Enhanced footer with bulk actions and pagination */}
                            <div className="flex flex-col justify-between gap-2 rounded-lg border border-neutral-200/50 bg-gradient-to-r from-neutral-50/50 to-white px-3 py-2 lg:flex-row lg:items-center">
                                {/* Bulk actions moved to the bar above the table; this row is now
                                    just pagination. */}
                                <div className="flex justify-center lg:justify-end">
                                    <MyPagination
                                        currentPage={page}
                                        totalPages={studentTableData?.total_pages || 1}
                                        onPageChange={handlePageChange}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <NoCourseDialog
                    isOpen={isOpen}
                    setIsOpen={setIsOpen}
                    type={t('noCourseDialog.enrollStudentsLabel')}
                    content={t('noCourseDialog.defaultContent')}
                />
                <ShareCredentialsDialog />
                <IndividualShareCredentialsDialog />
                <SendMessageDialog />
                <SendEmailDialog />
                <AcceptRequestDialog />
                <DeclineRequestDialog />
                {leadReady && assignDialog && (
                    <AssignCounselorToLeadDialog
                        open={!!assignDialog}
                        onOpenChange={(open) => {
                            if (!open) setAssignDialog(null);
                        }}
                        userId={assignDialog.userId}
                        userName={assignDialog.userName}
                        invalidateKeys={[['lead-profiles-batch']]}
                    />
                )}
            </section>
        </ErrorBoundary>
    );
};
