/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { useEffect, useMemo, useState } from 'react';
import { OnChangeFn, RowSelectionState } from '@tanstack/react-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
    getAllColumnsForTable,
    getAllColumnsForTableWidth,
    getAssessmentSubmissionsFilteredDataStudentData,
} from '../-utils/helper';
import { assessmentStatusStudentNotAttemptedColumns } from '../-utils/student-columns';
import { ManageColumnsPopover } from '@/components/shared/leads/manage-columns-popover';
import {
    useLeadColumnPrefs,
    useColumnOrderPrefs,
    orderColumnIds,
    type LeadColumnToggle,
} from '@/components/shared/leads/use-lead-column-prefs';
import { applyColumnLayout, toggleableColumnIds, LOCKED_COLUMN_IDS } from '../-utils/column-layout';
import {
    ASSESSMENT_STATUS_STUDENT_NOT_ATTEMPTED_COLUMNS_WIDTH,
    ASSESSMENT_STATUS_STUDENT_ONGOING_CONTACT_COLUMNS_WIDTH,
    ASSESSMENT_STATUS_STUDENT_PENDING_CONTACT_COLUMNS_WIDTH,
} from '@/components/design-system/utils/constants/table-layout';
import { Route } from '..';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getInstituteId } from '@/constants/helper';
import {
    getAdminParticipants,
    getAttemptsFileStatus,
    handleGetAssessmentTotalMarksData,
} from '../-services/assessment-details-services';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { MyPagination } from '@/components/design-system/pagination';
import { MyButton } from '@/components/design-system/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
    ArrowCounterClockwise,
    ArrowsClockwise,
    ClipboardText,
    Clock,
    Play,
    Sparkle,
    UploadSimple,
    User,
    UsersThree,
} from '@phosphor-icons/react';
import { AssessmentDetailsSearchComponent } from './SearchComponent';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useFilterDataForAssesment } from '@/routes/assessment/assessment-list/-utils.ts/useFiltersData';
import { ScheduleTestFilters } from '@/routes/assessment/assessment-list/-components/ScheduleTestFilters';
import { MyFilterOption } from '@/types/assessments/my-filter';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import AssessmentSubmissionsFilterButtons from './AssessmentSubmissionsFilterButtons';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ControlledStudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/controlled-student-sidebar-provider';
import { BulkActions } from './bulk-actions/bulk-actions';
import { AssessmentSubmissionsStudentTable } from './AssessmentSubmissionsStudentTable';
import { SubmissionsSummaryStrip } from './SubmissionsSummaryStrip';
import { AssessmentReportZipExportDialog } from './AssessmentReportZipExportDialog';
import { AiAssessmentReportDialog } from './AiAssessmentReportDialog';
import { AssessmentExportCsvDialog } from './AssessmentExportCsvDialog';
import { BulkAiCheckDialog } from './copy-intake/BulkAiCheckDialog';
import { CheckSubmittedCopiesDialog } from './copy-intake/CheckSubmittedCopiesDialog';
import { EnableAiChecking } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/enable-ai-checking';
import { CopyIntakeBatchPanel } from './copy-intake/CopyIntakeBatchPanel';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import AssessmentGlobalLevelRevaluateAssessment from './assessment-global-level-revaluate/assessment-global-level-revaluate-assessment';
import { AssessmentGlobalLevelRevaluateQuestionWise } from './assessment-global-level-revaluate/assessment-global-level-revaluate-question-wise';
import { AssessmentGlobalLevelReleaseResultAssessment } from './assessment-global-level-revaluate/assessment-global-level-release-result-assessment';
import { useRef } from 'react';
import { useUsersCredentials } from '@/routes/manage-students/students-list/-services/usersCredentials';
import { OpenStudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/open-student-side-view';
import { useNavigate } from '@tanstack/react-router';
import {
    getAssessmentSettings,
    getAssessmentSettingsFromCache,
} from '@/services/assessment-settings';
import { DEFAULT_ASSESSMENT_SETTINGS } from '@/types/assessment-settings';
import { cn } from '@/lib/utils';
import {
    createLatestRequestGuard,
    initialSelectionMode,
    registrationSourceForMode,
    selectionModeCorrection,
} from './submissions-selection-mode';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import type { SubmissionStudentData } from '@/types/assessments/assessment-overview';
import { SendMessageDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-message-dialog';
import { SendEmailDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-email-dialog';

export interface SelectedSubmissionsFilterInterface {
    name: string;
    assessment_type: string;
    attempt_type: string[];
    registration_source: string;
    batches: MyFilterOption[];
    status: string[];
    // Optional: filter Attempted rows by evaluation state (COMPLETED / PENDING).
    evaluation_status?: MyFilterOption[];
    // Optional (manual evaluation only): filter Attempted rows by whether the
    // attempt has a submitted answer-sheet file.
    submission_status?: MyFilterOption[];
    sort_columns: Record<string, string>;
}

// Options for the Evaluation Status filter. ids are the raw student_attempt
// result_status values the backend filters on.
export const buildEvaluationStatusFilterOptions = (t: TFunction): MyFilterOption[] => [
    { id: 'PENDING', name: t('filters.evaluationStatus.options.pending') },
    { id: 'EVALUATING', name: t('filters.evaluationStatus.options.evaluating') },
    { id: 'COMPLETED', name: t('filters.evaluationStatus.options.evaluated') },
];

// Options for the Submission filter (manual evaluation only). ids are the values
// the backend maps to "attempt has a submitted answer-sheet file" or not.
export const buildSubmissionStatusFilterOptions = (t: TFunction): MyFilterOption[] => [
    { id: 'SUBMITTED', name: t('filters.submissionStatus.options.submitted') },
    { id: 'NOT_SUBMITTED', name: t('filters.submissionStatus.options.notSubmitted') },
];

export interface SelectedReleaseResultFilterInterface {
    attempt_ids: string[];
}

// Column layout is remembered per browser and shared by all four tabs: the ids are the
// same wherever a column appears, so "I never want to see Username" should not have to be
// said once per tab. orderColumnIds reconciles a saved order against whichever columns the
// current tab actually has, dropping the ones it doesn't.
const COLUMN_PREFS_KEY = 'assessment-submissions:hidden-columns';
const COLUMN_ORDER_KEY = 'assessment-submissions:column-order';

// Rows per request when "Select all" pulls the whole Pending list.
const SELECT_ALL_PAGE_SIZE = 200;

// End Time starts hidden: Attempt Date + Start Time + Duration already say when the
// attempt ran, and with everything visible the Attempted table's min-widths total well
// over 2,000px, which pushed Score and both status columns off-screen behind a
// horizontal scroll. Still one click away in Manage Columns, and this only seeds users
// who have never set a preference. Nothing else is hidden by default — the contact
// columns are the only useful ones on the Pending list, which shares this preference key.
const DEFAULT_HIDDEN_COLUMNS: string[] = ['end_time'];

// Width trim for this route only. The shared constants in table-layout.tsx size several
// columns at 180-240px for values that render in half that ("07:38:23 PM", "18 / 20"),
// but they are also used by the homework-creation and evaluation copies of this table,
// so they are narrowed here rather than at the source.
const ATTEMPTED_COLUMN_WIDTH_TRIM: Record<string, string> = {
    // Column pinning, rebuilt. The shared config pins checkbox AND details to `left-0` —
    // two columns claiming the same offset, so they sit on top of one another — and gives
    // the pinned cells no z-index. The sort headers wrap their label in a `relative` div,
    // which is a positioned element later in DOM order, so it painted straight over the
    // pinned cells: scrolling sideways piled "Details", "Name" and "Attempt Date" into
    // one unreadable smear.
    //
    // Pin only the two columns that earn it — identity on the left, the row menu on the
    // right — and lift both above the body cells' own z-10.
    checkbox: 'min-w-[40px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    details: 'min-w-[40px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    serial: 'min-w-[44px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    full_name: 'min-w-[220px] sticky left-0 z-20', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    options: 'min-w-[92px] sticky right-0 z-20', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    package_session_id: 'min-w-[180px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    attempt_date: 'min-w-[140px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    start_time: 'min-w-[130px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    end_time: 'min-w-[130px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    duration: 'min-w-[110px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    score: 'min-w-[110px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    evaluation_status: 'min-w-[150px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
    result_status: 'min-w-[140px]', // design-lint-ignore: pixel column widths, matching table-layout.tsx
};

/** Popover labels. Most headers are render functions (sort dropdowns, chips), so they
 *  can't be read off the column definitions. Batch is resolved at call time because it
 *  follows the institute's own terminology. */
const COLUMN_LABELS: Record<string, string> = {
    serial: 'No.',
    full_name: 'Name',
    attempt_date: 'Attempt Date',
    start_time: 'Start Time',
    end_time: 'End Time',
    duration: 'Duration',
    score: 'Score',
    submission_file: 'Submission',
    evaluation_status: 'Evaluation Status',
    result_status: 'Result Status',
    email: 'Email',
    mobile_number: 'Phone Number',
    username: 'Username',
};

const AssessmentSubmissionsTab = ({ type }: { type: string }) => {
    const { t } = useTranslation('assessmentSubmissionsTab');
    const navigate = useNavigate();
    const { data: initData } = useSuspenseQuery(useInstituteQuery());
    const { BatchesFilterData } = useFilterDataForAssesment(initData);
    const instituteId = getInstituteId();
    const { assessmentId, examType, assesssmentType, assessmentTab } = Route.useParams();
    // Offline Entry is gated on an institute-level setting. Fetch it rather than
    // reading the localStorage cache directly: that cache is only ever written by
    // Settings -> Assessment, so an admin who has never opened that page — or is on a
    // second browser, or whose 24h cache lapsed — would silently fall back to the
    // `enabled: false` default and lose the button while a colleague still sees it.
    // The cached value is the placeholder so the button still paints instantly.
    const { data: assessmentSettings = DEFAULT_ASSESSMENT_SETTINGS } = useQuery({
        queryKey: ['ASSESSMENT_SETTINGS', instituteId],
        queryFn: () => getAssessmentSettings(),
        placeholderData: getAssessmentSettingsFromCache,
        staleTime: 5 * 60 * 1000,
    });
    const isOfflineEntryEnabled = assessmentSettings.offlineEntry.enabled;
    const queryClient = useQueryClient();
    // MANUAL evaluation assessments get an extra "Submission" column showing
    // whether each attempt has a submitted answer-sheet file. Same cached query
    // the row dropdown uses for its menu.
    const { data: assessmentDetailsData } = useSuspenseQuery(
        getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' })
    );
    const isManualEvaluation = assessmentDetailsData?.[0]?.saved_data?.evaluation_type === 'MANUAL';
    // For the "Enable AI checking" card on a placeholder-only offline test: the paper
    // PDF sits in the saved instructions, and the placeholder's marks are the section total.
    const savedInstructionsHtml: string | undefined =
        assessmentDetailsData?.[0]?.saved_data?.instructions?.content ?? undefined;
    const savedTotalMarks: number = (
        (assessmentDetailsData?.[1]?.saved_data?.sections ?? []) as Array<{ total_marks?: number }>
    ).reduce((sum, section) => sum + (Number(section?.total_marks) || 0), 0);
    // The AI copy check is billed per graded question (tool_cost_estimator
    // "copy_check_evaluation"), so the bulk quote needs the paper's question
    // count. The step-2 status payload's sections carry NO questions (SectionDto
    // is built without fillQuestions), so they come from the per-section
    // questions query — the same source the slide's submissions panel counts.
    const questionSectionIds = (
        (assessmentDetailsData?.[1]?.saved_data?.sections ?? []) as Array<{ id?: string }>
    )
        .map((s) => s?.id)
        .filter(Boolean)
        .join(',');
    const { data: sectionQuestions } = useQuery({
        ...getQuestionDataForSection({ assessmentId, sectionIds: questionSectionIds }),
        enabled: Boolean(assessmentId && questionSectionIds && isManualEvaluation),
    });
    const questionsPerCopy: number = Object.values(
        (sectionQuestions ?? {}) as Record<string, unknown[] | undefined>
    ).reduce((sum, questions) => sum + (questions?.length ?? 0), 0);

    // How this assessment was actually handed out. An assessment created against batches
    // has no individually pre-registered learners, so "Individual Selection" could only
    // ever show an empty table — offering it is just a dead end the admin has to discover
    // by clicking. Both counts come from the participants step the creation wizard saved:
    // step order is basic(0), questions(1), participants(2), access(3)
    // (AssessmentStatusController). Reading [1] (the questions step) left both counts
    // undefined, so an individually-registered assessment (e.g. API candidates) sat on an
    // empty Batch view.
    //
    // Deliberately permissive: only hide a mode when the data positively says it is empty.
    // If either field is missing (older assessments, a projection that omits them) both
    // modes stay available, exactly as before.
    const accessData = assessmentDetailsData?.[2]?.saved_data;
    const preUserCount = accessData?.pre_user_registrations;
    const preBatchCount = accessData?.pre_batch_registrations?.length;
    const hasIndividualRegistrations = preUserCount === undefined || preUserCount > 0;
    const hasBatchRegistrations = preBatchCount === undefined || preBatchCount > 0;
    const showSelectionModeToggle = hasIndividualRegistrations && hasBatchRegistrations;
    const { data: totalMarks } = useSuspenseQuery(
        handleGetAssessmentTotalMarksData({ assessmentId })
    );
    const [selectedParticipantsTab, setSelectedParticipantsTab] = useState('internal');
    const [selectedTab, setSelectedTab] = useState('Attempted');
    // Start on the mode that has learners (see initialSelectionMode): correcting it after
    // mount raced the mount fetch below.
    const [initialMode] = useState(() =>
        initialSelectionMode(hasBatchRegistrations, hasIndividualRegistrations)
    );
    const [batchSelectionTab, setBatchSelectionTab] = useState<string>(initialMode);
    const [page, setPage] = useState(0);
    const [selectedStudent, setSelectedStudent] = useState<StudentTable | null>(null);
    const [selectedFilter, setSelectedFilter] = useState<SelectedSubmissionsFilterInterface>({
        name: '',
        assessment_type: assesssmentType,
        attempt_type: ['ENDED'],
        registration_source: registrationSourceForMode(initialMode),
        batches: [],
        status: ['ACTIVE'],
        evaluation_status: [],
        submission_status: [],
        sort_columns: {},
    });

    const [searchText, setSearchText] = useState('');
    const [participantsData, setParticipantsData] = useState({
        content: [],
        total_pages: 0,
        page_no: 0,
        page_size: 10,
        total_elements: 0,
        last: false,
    });
    const [isParticipantsLoading, setIsParticipantsLoading] = useState(false);
    // Last request wins: a slower, older participants response must not overwrite a newer one.
    const [participantsRequestGuard] = useState(createLatestRequestGuard);
    // Rows per page. Every fetch in this file used to hard-code 10; the value now flows
    // from here so the footer selector actually changes the request.
    const [pageSize, setPageSize] = useState(10);
    // Only the very first load blanks the whole tab. Later fetches — page change, filter,
    // sub-tab switch — keep the toolbar, stat strip and column headers on screen and show
    // their loading state as skeleton rows inside the table body instead.
    const hasLoadedOnce = useRef(false);
    useEffect(() => {
        if (!isParticipantsLoading) hasLoadedOnce.current = true;
    }, [isParticipantsLoading]);

    const [rowSelections, setRowSelections] = useState<Record<number, Record<string, boolean>>>({});
    // Bulk-actions entry point for the report ZIP export (dialog opens without
    // its own trigger, scoped to the checked rows).
    const [bulkReportZipOpen, setBulkReportZipOpen] = useState(false);
    const [aiReportOpen, setAiReportOpen] = useState(false);
    // Bulk AI check of uploaded copies. The email a finished batch sends links
    // here with ?intake=<batchId>, which opens the panel on that batch.
    const initialIntakeId = useMemo(() => {
        try {
            return new URLSearchParams(window.location.search).get('intake');
        } catch {
            return null;
        }
    }, []);
    const [bulkCheckOpen, setBulkCheckOpen] = useState(false);
    // "Check submitted copies": null = closed; [] = every submitted copy on the
    // assessment (toolbar button); ids = the checked rows (bulk-actions menu).
    const [submittedCheckScope, setSubmittedCheckScope] = useState<string[] | null>(null);
    const [intakePanelOpen, setIntakePanelOpen] = useState(Boolean(initialIntakeId));
    const [intakeBatchId, setIntakeBatchId] = useState<string | null>(initialIntakeId);
    // Linked batches live on step 3 (index 2) of the details payload, same as
    // the Participants tab and offline entry read them.
    const assessmentBatchIds: string[] = useMemo(
        () =>
            (assessmentDetailsData?.[2]?.saved_data?.pre_batch_registrations ?? [])
                .map((b) => b.batchId)
                .filter(Boolean),
        [assessmentDetailsData]
    );
    // "Select all N" on the Pending tab: every learner matching the current filter, across
    // all pages, fetched up front so the WhatsApp / email reminder reaches the whole list
    // and not just the rows on screen. null = the normal per-page selection is in charge.
    const [allSelectedRows, setAllSelectedRows] = useState<SubmissionStudentData[] | null>(null);
    const [isSelectingAll, setIsSelectingAll] = useState(false);
    // Bumped on every reset, so a select-all fetch that finishes after the admin moved on
    // (other tab, filter, search) is dropped instead of selecting the old list.
    const selectAllRequest = useRef(0);
    const allSelectedIds = useMemo(
        () => (allSelectedRows ? new Set(allSelectedRows.map((row) => row.user_id)) : null),
        [allSelectedRows]
    );
    const currentPageSelection = allSelectedIds
        ? Object.fromEntries(
              (participantsData.content ?? []).flatMap((row, index) =>
                  allSelectedIds.has(row.user_id) ? [[String(index), true]] : []
              )
          )
        : rowSelections[page] || {};
    const totalSelectedCount = allSelectedRows
        ? allSelectedRows.length
        : Object.values(rowSelections).reduce(
              (count, pageSelection) => count + Object.keys(pageSelection).length,
              0
          );

    const [attemptedCount, setAttemptedCount] = useState(0);
    const [ongoingCount, setOngoingCount] = useState(0);
    const [pendingCount, setPendingCount] = useState(0);

    // Which registration source the visible list is built from. `selectedFilter` is NOT a
    // reliable answer: the tab/sub-tab handlers override `registration_source` inline on
    // the request only, so simply switching to External leaves the state on its
    // internal/batch default. The tab badges used to read it from there, which is why a
    // PUBLIC assessment whose participants all registered through the open link (i.e. the
    // External tab) counted BATCH_PREVIEW_REGISTRATION rows and every badge showed (0).
    const registrationSource =
        selectedParticipantsTab === 'external'
            ? 'OPEN_REGISTRATION'
            : batchSelectionTab === 'individual'
              ? 'ADMIN_PRE_REGISTRATION'
              : 'BATCH_PREVIEW_REGISTRATION';
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    // Bumped to force the summary strip to refetch its aggregate stats.
    const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);

    const getParticipantsListData = useMutation({
        mutationFn: ({
            assessmentId,
            instituteId,
            pageNo,
            pageSize,
            selectedFilter,
        }: {
            assessmentId: string;
            instituteId: string | undefined;
            pageNo: number;
            pageSize: number;
            selectedFilter: SelectedSubmissionsFilterInterface;
        }) => getAdminParticipants(assessmentId, instituteId, pageNo, pageSize, selectedFilter),
        onMutate: () => ({ requestToken: participantsRequestGuard.begin() }),
        onSuccess: async (data, _variables, context) => {
            console.log('submissions data', data);
            // For manual-evaluation assessments, batch-fetch which attempts on
            // this page have a submitted answer sheet and seed the per-attempt
            // cache BEFORE rendering rows, so the Submission cells don't each
            // fire their own request.
            if (isManualEvaluation) {
                const attemptIds = (data?.content ?? [])
                    .map((student) => student.attempt_id)
                    .filter(Boolean);
                if (attemptIds.length > 0) {
                    try {
                        const fileMap = await getAttemptsFileStatus(attemptIds);
                        attemptIds.forEach((id) => {
                            queryClient.setQueryData(
                                ['GET_ATTEMPT_SUBMISSION_FILE', id],
                                fileMap?.[id] ?? null
                            );
                        });
                    } catch (error) {
                        // Non-fatal: cells fall back to per-attempt fetches.
                        console.error('Failed to batch-fetch submission file status:', error);
                    }
                }
            }
            if (context && !participantsRequestGuard.isLatest(context.requestToken)) return;
            setParticipantsData(data);
        },
        onError: (error: unknown) => {
            throw error;
        },
    });

    const [allPagesData, setAllPagesData] = useState<Record<number, StudentTable[]>>({});

    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updaterOrValue) => {
        if (allSelectedRows) {
            // Select-all is on: a checkbox on this page adds / drops that learner from the
            // full list rather than falling back to the page-only selection.
            const nextSelection =
                typeof updaterOrValue === 'function'
                    ? updaterOrValue(currentPageSelection)
                    : updaterOrValue;
            const pageRows: SubmissionStudentData[] = participantsData.content ?? [];
            const dropped = new Set(
                pageRows.filter((_, index) => !nextSelection[index]).map((row) => row.user_id)
            );
            const kept = allSelectedRows.filter((row) => !dropped.has(row.user_id));
            const keptIds = new Set(kept.map((row) => row.user_id));
            const added = pageRows.filter(
                (row, index) => nextSelection[index] && !keptIds.has(row.user_id)
            );
            const next = [...kept, ...added];
            // Unticking everyone ends select-all, back to the plain per-page selection.
            setAllSelectedRows(next.length > 0 ? next : null);
            return;
        }
        const newSelection =
            typeof updaterOrValue === 'function'
                ? updaterOrValue(rowSelections[page] || {})
                : updaterOrValue;

        setRowSelections((prev) => ({
            ...prev,
            [page]: newSelection,
        }));
    };

    const handleResetSelections = () => {
        setRowSelections({});
        setAllSelectedRows(null);
        selectAllRequest.current += 1;
        setIsSelectingAll(false);
    };

    // Pages through the same request the table makes (PENDING, current registration
    // source, filters and search) in large chunks, one after another.
    const handleSelectAll = async () => {
        const requestId = ++selectAllRequest.current;
        setIsSelectingAll(true);
        const filter = {
            ...selectedFilter,
            registration_source: registrationSource,
            attempt_type: ['PENDING'],
        };
        try {
            const rows: SubmissionStudentData[] = [];
            for (let pageNo = 0; ; pageNo++) {
                const data = await getAdminParticipants(
                    assessmentId,
                    instituteId,
                    pageNo,
                    SELECT_ALL_PAGE_SIZE,
                    filter
                );
                if (requestId !== selectAllRequest.current) return;
                rows.push(...(data?.content ?? []));
                if (data?.last || pageNo + 1 >= (data?.total_pages ?? 0)) break;
            }
            setRowSelections({});
            setAllSelectedRows(rows);
        } catch (error) {
            if (requestId === selectAllRequest.current) {
                toast.error(t('selectAll.failed'));
            }
            console.error(error);
        } finally {
            if (requestId === selectAllRequest.current) setIsSelectingAll(false);
        }
    };

    // Page-index selections and the select-all list both describe ONE list; another tab,
    // participant source or filter is a different list, so neither may carry over.
    useEffect(() => {
        handleResetSelections();
    }, [selectedTab, registrationSource, selectedFilter]);

    const getSelectedStudents = (): StudentTable[] => {
        if (allSelectedRows) return allSelectedRows;
        return Object.entries(rowSelections).flatMap(([pageNum, selections]) => {
            const pageData = allPagesData[parseInt(pageNum)];
            if (!pageData) return [];

            return Object.entries(selections)
                .filter(([, isSelected]) => isSelected)
                .map(([index]) => pageData[parseInt(index)])
                .filter((student): student is StudentTable => student !== undefined);
        });
    };

    const getSelectedStudentIds = (): string[] => {
        return getSelectedStudents().map((student) => student.user_id);
    };

    // Pending for batch selection is the "never attempted" list, built from batch
    // enrollment rather than an assessment registration, so it is the only Pending list
    // whose rows carry batch and contact details. The other two Pending lists come from
    // projections that never select those, so they keep the name-only columns instead of
    // showing four empty ones.
    const isNotAttemptedList =
        selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch';

    // Memoised because getAllColumnsForTable builds fresh arrays on every call: without
    // this the column definitions were a new identity each render, which both defeats the
    // layout memos below and makes the table rebuild its whole column model every render.
    const getAssessmentColumn = useMemo(
        () => ({
            Attempted: getAllColumnsForTable(type, selectedParticipantsTab, isManualEvaluation)
                .Attempted,
            Pending: isNotAttemptedList
                ? assessmentStatusStudentNotAttemptedColumns
                : getAllColumnsForTable(type, selectedParticipantsTab).Pending,
            Ongoing: getAllColumnsForTable(type, selectedParticipantsTab).Ongoing,
        }),
        [type, selectedParticipantsTab, isManualEvaluation, isNotAttemptedList]
    );

    const getAssessmentColumnWidth = {
        Attempted: {
            ...getAllColumnsForTableWidth(type, selectedParticipantsTab, isManualEvaluation)
                .Attempted,
            ...ATTEMPTED_COLUMN_WIDTH_TRIM,
        },
        Pending: isNotAttemptedList
            ? ASSESSMENT_STATUS_STUDENT_NOT_ATTEMPTED_COLUMNS_WIDTH
            : ASSESSMENT_STATUS_STUDENT_PENDING_CONTACT_COLUMNS_WIDTH,
        Ongoing: ASSESSMENT_STATUS_STUDENT_ONGOING_CONTACT_COLUMNS_WIDTH,
    };

    // ─── Manage Column ────────────────────────────────────────────────────────
    // Which columns are on, and in what order. Same mechanism (and same popover) as
    // Manage Payments and the lead lists, so all three behave identically.
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(
        COLUMN_PREFS_KEY,
        DEFAULT_HIDDEN_COLUMNS
    );
    const { columnOrder, setColumnOrder, resetColumnOrder } = useColumnOrderPrefs(COLUMN_ORDER_KEY);

    const activeColumns = useMemo(
        () => getAssessmentColumn[selectedTab as keyof typeof getAssessmentColumn] || [],
        [getAssessmentColumn, selectedTab]
    );

    /** What the popover lists, in the order the columns appear on screen. */
    const columnToggles = useMemo<LeadColumnToggle[]>(() => {
        const batchLabel = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
        return orderColumnIds(toggleableColumnIds(activeColumns), columnOrder).map((id) => ({
            id,
            label: id === 'package_session_id' ? batchLabel : COLUMN_LABELS[id] ?? id,
            locked: LOCKED_COLUMN_IDS.has(id),
        }));
    }, [activeColumns, columnOrder]);

    /** What the table renders — see applyColumnLayout for why the ends are pinned. */
    const visibleColumns = useMemo(
        () => applyColumnLayout(activeColumns, hiddenColumns, columnOrder),
        [activeColumns, hiddenColumns, columnOrder]
    );

    /** Reset restores both halves of the layout — what is shown and what order it is in. */
    const handleResetColumns = () => {
        resetColumns();
        resetColumnOrder();
    };

    const handleAttemptedTab = (value: string) => {
        setSelectedTab(value);
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        value === 'Attempted' ? 'ENDED' : value === 'Pending' ? 'PENDING' : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        value === 'Attempted' ? 'ENDED' : value === 'Pending' ? 'PENDING' : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        value === 'Attempted' ? 'ENDED' : value === 'Pending' ? 'PENDING' : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleParticipantsTab = (value: string) => {
        setSelectedParticipantsTab(value);
        if (value === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (value === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (value === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleBatchSeletectionTab = (value: string) => {
        setBatchSelectionTab(value);
        if (selectedParticipantsTab === 'internal' && value === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && value === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    // If only one registration mode exists the toggle is hidden, so nothing can move the
    // view off the default 'batch' — an individually-registered assessment would sit on an
    // empty batch table with no visible control to fix it. Snap to whichever mode has data.
    // The initial mode already accounts for this, so on mount it is a no-op; it only acts
    // if the registration counts change while the tab is open.
    useEffect(() => {
        if (selectedParticipantsTab !== 'internal') return;
        const correction = selectionModeCorrection(
            batchSelectionTab === 'individual' ? 'individual' : 'batch',
            hasBatchRegistrations,
            hasIndividualRegistrations
        );
        if (correction) handleBatchSeletectionTab(correction);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasBatchRegistrations, hasIndividualRegistrations, selectedParticipantsTab]);

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: newPage,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: newPage,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: newPage,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    // Changing rows-per-page restarts at page 1. This is an effect rather than a call
    // inside the setter because handlePageChange reads `pageSize` from the render it was
    // created in — calling it straight after setPageSize would refetch with the old size.
    const skipFirstPageSizeEffect = useRef(true);
    useEffect(() => {
        if (skipFirstPageSizeEffect.current) {
            skipFirstPageSizeEffect.current = false;
            return;
        }
        handlePageChange(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize]);

    const handleRefreshLeaderboard = () => {
        setSummaryRefreshKey((k) => k + 1);
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const clearSearch = () => {
        setSearchText('');
        // Commit through setState, not by mutating the object in place: every other
        // handler builds its request from `...selectedFilter`, and a mutation React
        // never sees leaves those reading whatever was last rendered.
        setSelectedFilter((prevFilter) => ({ ...prevFilter, name: '' }));
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleSearch = (searchValue: string) => {
        setSearchText(searchValue);
        // The search term has to live in `selectedFilter`, not just in this one request.
        // Every other fetch (tab switch, paging, batch chips, sort) rebuilds its filter
        // from `...selectedFilter`, so leaving `name` unset there dropped the search on
        // the next interaction while the box still showed the term — an unfiltered list
        // that looks filtered. The CSV export reads `searchText` directly, so it stayed
        // filtered too: the table and its export disagreed about what was being shown.
        setSelectedFilter((prevFilter) => ({ ...prevFilter, name: searchValue }));
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    name: searchValue,
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    name: searchValue,
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    name: searchValue,
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    const handleFilterChange = (filterKey: string, selectedItems: MyFilterOption[]) => {
        setSelectedFilter((prev) => {
            const updatedFilters = { ...prev, [filterKey]: selectedItems };
            return updatedFilters;
        });
    };

    // Resolve the registration_source / attempt_type for the currently-active
    // sub-tab so a sort refetch keeps the same slice of participants in view.
    const getCurrentRegistrationSource = () => registrationSource;

    const getCurrentAttemptType = () =>
        selectedTab === 'Attempted' ? 'ENDED' : selectedTab === 'Pending' ? 'PENDING' : 'LIVE';

    // Server-side sort. Maps the table column id to the backend sort key and
    // refetches page 0 with the new sort_columns. Only columns the gateway
    // accepts are wired (end/submit time is blocked upstream, so it's omitted).
    const handleSort = (columnId: string, direction: string) => {
        const sortKeyMap: Record<string, string> = {
            full_name: 'studentName',
            attempt_date: 'attemptDate',
            duration: 'duration',
            score: 'score',
        };
        const backendKey = sortKeyMap[columnId];
        if (!backendKey) return;

        const nextFilter = {
            ...selectedFilter,
            registration_source: getCurrentRegistrationSource(),
            attempt_type: [getCurrentAttemptType()],
            sort_columns: { [backendKey]: direction },
        };
        setSelectedFilter(nextFilter);
        setPage(0);
        // Row selections are keyed by page index; reordering makes those indices
        // point at different students, so clear them to avoid acting on the wrong rows.
        handleResetSelections();
        getParticipantsListData.mutate({
            assessmentId,
            instituteId,
            pageNo: 0,
            pageSize,
            selectedFilter: nextFilter,
        });
    };

    // Submission filter (manual evaluation, Attempted only) — same immediate-apply
    // behavior as the Evaluation Status filter below.
    const handleSubmissionStatusFilter = (items: MyFilterOption[]) => {
        const nextFilter = {
            ...selectedFilter,
            submission_status: items,
            registration_source: getCurrentRegistrationSource(),
            attempt_type: [getCurrentAttemptType()],
        };
        setSelectedFilter(nextFilter);
        setPage(0);
        // Filtering changes which rows are present; clear index-keyed selections.
        handleResetSelections();
        getParticipantsListData.mutate({
            assessmentId,
            instituteId,
            pageNo: 0,
            pageSize,
            selectedFilter: nextFilter,
        });
    };

    // Evaluation Status filter (Attempted only) — applies immediately and refetches
    // page 0 so a teacher can jump straight to submissions that still need grading.
    const handleEvaluationStatusFilter = (items: MyFilterOption[]) => {
        const nextFilter = {
            ...selectedFilter,
            evaluation_status: items,
            registration_source: getCurrentRegistrationSource(),
            attempt_type: [getCurrentAttemptType()],
        };
        setSelectedFilter(nextFilter);
        setPage(0);
        // Filtering changes which rows are present; clear index-keyed selections.
        handleResetSelections();
        getParticipantsListData.mutate({
            assessmentId,
            instituteId,
            pageNo: 0,
            pageSize,
            selectedFilter: nextFilter,
        });
    };

    const handleResetFilters = () => {
        setSelectedFilter((prevFilter) => ({
            ...prevFilter,
            name: '',
            batches: [],
            evaluation_status: [],
            submission_status: [],
        }));
        setSearchText('');
        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'batch') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    name: '',
                    batches: [],
                    evaluation_status: [],
                    submission_status: [],
                    registration_source: 'BATCH_PREVIEW_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'internal' && batchSelectionTab === 'individual') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    name: '',
                    batches: [],
                    evaluation_status: [],
                    submission_status: [],
                    registration_source: 'ADMIN_PRE_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }

        if (selectedParticipantsTab === 'external') {
            getParticipantsListData.mutate({
                assessmentId,
                instituteId,
                pageNo: page,
                pageSize,
                selectedFilter: {
                    ...selectedFilter,
                    name: '',
                    batches: [],
                    evaluation_status: [],
                    submission_status: [],
                    registration_source: 'OPEN_REGISTRATION',
                    attempt_type: [
                        selectedTab === 'Attempted'
                            ? 'ENDED'
                            : selectedTab === 'Pending'
                              ? 'PENDING'
                              : 'LIVE',
                    ],
                },
            });
        }
    };

    useEffect(() => {
        // Claimed now, not when the timer fires: anything the admin starts during the
        // debounce is newer and must win over this initial load.
        const requestToken = participantsRequestGuard.begin();
        const timer = setTimeout(() => {
            const fetchInitialParticipants = async () => {
                setIsParticipantsLoading(true);
                try {
                    const attemptedData = await getAdminParticipants(
                        assessmentId,
                        instituteId,
                        page,
                        pageSize,
                        selectedFilter
                    );
                    if (participantsRequestGuard.isLatest(requestToken)) {
                        setParticipantsData(attemptedData);
                    }
                } catch (error) {
                    console.log(error);
                } finally {
                    setIsParticipantsLoading(false);
                }
            };
            fetchInitialParticipants();
        }, 300); // Adjust the debounce time as needed

        return () => clearTimeout(timer); // Cleanup the timeout on component unmount
    }, []);

    // The three tab badges. Deliberately separate from the table fetch above and keyed on
    // the registration source, because switching participant tabs re-fetches the table
    // through the mutation but never touched these — so the badges kept showing whatever
    // the internal/batch list had on mount (zeroes, for an open-registration assessment).
    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            // One row each: only total_elements is read. (Reading content.length instead
            // used to cap every count at the page size.)
            const COUNT_ONLY_PAGE_SIZE = 1;
            // A badge is not worth the page: swallow per call and let it read 0 rather
            // than letting one failing count take the whole tab down.
            const countOnly = (attemptType: string) =>
                getAdminParticipants(assessmentId, instituteId, 0, COUNT_ONLY_PAGE_SIZE, {
                    ...selectedFilter,
                    registration_source: registrationSource,
                    attempt_type: [attemptType],
                }).catch(() => null);

            Promise.all([
                countOnly('ENDED'),
                countOnly('LIVE'),
                // 'PENDING' — the backend compares against the enum name, so the old
                // 'Pending' never matched and this call always came back empty.
                countOnly('PENDING'),
            ]).then(([attemptedData, ongoingData, pendingData]) => {
                if (cancelled) return;
                setAttemptedCount(attemptedData?.total_elements ?? 0);
                setOngoingCount(ongoingData?.total_elements ?? 0);
                setPendingCount(pendingData?.total_elements ?? 0);
            });
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [assessmentId, instituteId, registrationSource, selectedFilter]);

    useEffect(() => {
        if (participantsData?.content) {
            setAllPagesData((prev) => ({
                ...prev,
                [page]: participantsData.content,
            }));
        }
    }, [participantsData?.content, page]);

    const tableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element | null;
            // Side-view panel + any portaled overlay (dialog, menu, popover/select,
            // toast) render at <body>, outside tableRef. Treat clicks inside them as
            // "inside" so e.g. closing the Assign-Course dialog doesn't also close
            // the side view.
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

    const getUserCredentialsMutation = useUsersCredentials();

    async function getCredentials() {
        const ids = participantsData?.content.map((student: StudentTable) => student.user_id);
        if (!ids || ids.length === 0) {
            return;
        }
        const credentials = await getUserCredentialsMutation.mutateAsync({ userIds: ids || [] });
        return credentials;
    }

    useEffect(() => {
        async function fetchCredentials() {
            if (participantsData?.content && participantsData.content.length > 0) {
                await getCredentials();
            }
        }
        fetchCredentials();
    }, [participantsData]);

    // Card-style sub-tabs. The active one gets a tinted panel plus a short underline bar
    // centred on its bottom edge, so it still reads as a tab and not just a selected card.
    const subTabClass = (value: string) =>
        `relative flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2.5 text-left sm:flex-none !shadow-none transition-colors after:absolute after:bottom-0 after:left-1/2 after:h-1 after:w-16 after:-translate-x-1/2 after:rounded-full ${
            selectedTab === value
                ? 'border-primary-200 !bg-primary-50 text-primary-500 after:bg-primary-500'
                : 'border-neutral-200 !bg-white text-neutral-700 hover:border-neutral-300 after:bg-transparent'
        }`;

    const subTabIconClass = (value: string) =>
        `flex size-8 shrink-0 items-center justify-center rounded-lg ${
            selectedTab === value
                ? 'bg-primary-100 text-primary-500'
                : 'bg-neutral-100 text-neutral-500'
        }`;

    if (isParticipantsLoading && !hasLoadedOnce.current) return <DashboardLoader />;

    return (
        <ControlledStudentSidebarProvider
            selectedStudent={selectedStudent}
            setSelectedStudent={setSelectedStudent}
            isSubmissionTab={true}
        >
            <Tabs
                value={selectedTab}
                onValueChange={handleAttemptedTab}
                className="flex w-full flex-col gap-3"
            >
                <BulkAiCheckDialog
                    open={bulkCheckOpen}
                    onOpenChange={setBulkCheckOpen}
                    assessmentId={assessmentId}
                    instituteId={instituteId}
                    questionsPerCopy={questionsPerCopy}
                    onStarted={(batch) => {
                        setIntakeBatchId(batch.id);
                        setIntakePanelOpen(true);
                    }}
                />
                {submittedCheckScope !== null && (
                    <CheckSubmittedCopiesDialog
                        open
                        onOpenChange={(next) => {
                            if (!next) setSubmittedCheckScope(null);
                        }}
                        assessmentId={assessmentId}
                        instituteId={instituteId}
                        questionsPerCopy={questionsPerCopy}
                        attemptIds={submittedCheckScope}
                        onStarted={(batch) => {
                            setIntakeBatchId(batch.id);
                            setIntakePanelOpen(true);
                            handleResetSelections();
                            handleRefreshLeaderboard();
                        }}
                    />
                )}
                {/* A manual-upload test still on the "Upload your answer sheet" placeholder
                    cannot be AI-checked; this reads the attached paper into questions and
                    switches it on. Renders nothing once the test has real questions. */}
                {isManualEvaluation && (
                    <EnableAiChecking
                        assessmentId={assessmentId}
                        assessmentName={assessmentDetailsData?.[0]?.saved_data?.name ?? undefined}
                        instructionsHtml={savedInstructionsHtml}
                        totalMarks={savedTotalMarks > 0 ? savedTotalMarks : null}
                        framed
                        onEnabled={() =>
                            queryClient.invalidateQueries({ queryKey: ['GET_ASSESSMENT_DETAILS'] })
                        }
                    />
                )}
                {intakePanelOpen && (
                    <div className="px-4">
                        <CopyIntakeBatchPanel
                            assessmentId={assessmentId}
                            instituteId={instituteId}
                            examType={examType}
                            packageSessionIds={assessmentBatchIds}
                            initialBatchId={intakeBatchId}
                            onClose={() => setIntakePanelOpen(false)}
                        />
                    </div>
                )}
                {/* Sub-tab row: which slice of participants on the left, the actions that
                    operate on that slice on the right. */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4">
                    {/* Sub-tabs render as description cards, not pills: the count alone
                        ("Pending 95") reads as a warning, while "Students who haven't
                        submitted" says what the number actually means. */}
                    <TabsList className="flex h-auto flex-wrap items-stretch justify-start gap-2 rounded-none !bg-transparent p-0">
                        <TabsTrigger value="Attempted" className={subTabClass('Attempted')}>
                            <span className={subTabIconClass('Attempted')}>
                                <ClipboardText size={20} />
                            </span>
                            <span className="flex flex-col items-start gap-0.5">
                                <span className="text-subtitle font-semibold">
                                    {t('tabs.attempted')} ({attemptedCount})
                                </span>
                                <span className="text-2xs font-regular text-neutral-500">
                                    {t('tabs.attemptedSubtitle')}
                                </span>
                            </span>
                        </TabsTrigger>
                        {assessmentTab !== 'previousTests' && (
                            <TabsTrigger value="Ongoing" className={subTabClass('Ongoing')}>
                                <span className={subTabIconClass('Ongoing')}>
                                    <Play size={20} />
                                </span>
                                <span className="flex flex-col items-start gap-0.5">
                                    <span className="text-subtitle font-semibold">
                                        {t('tabs.ongoing')} ({ongoingCount})
                                    </span>
                                    <span className="text-2xs font-regular text-neutral-500">
                                        {t('tabs.ongoingSubtitle')}
                                    </span>
                                </span>
                            </TabsTrigger>
                        )}
                        <TabsTrigger value="Pending" className={subTabClass('Pending')}>
                            <span className={subTabIconClass('Pending')}>
                                <Clock size={20} />
                            </span>
                            <span className="flex flex-col items-start gap-0.5">
                                <span className="text-subtitle font-semibold">
                                    {t('tabs.pending')} ({pendingCount})
                                </span>
                                <span className="text-2xs font-regular text-neutral-500">
                                    {t('tabs.pendingSubtitle')}
                                </span>
                            </span>
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex w-full flex-wrap items-center justify-start gap-1.5 sm:w-auto sm:justify-end">
                        {/* Reevaluate | Release Result | AI Evaluations, per the design.
                            Release Result is the only solid button — it is the one action
                            here that publishes something to learners. */}
                        {selectedTab === 'Attempted' && (
                            <>
                                <Dialog>
                                    <Tooltip>
                                        <DialogTrigger asChild>
                                            <TooltipTrigger asChild>
                                                <MyButton
                                                    type="button"
                                                    scale="small"
                                                    buttonType="secondary"
                                                    className="gap-1.5 font-medium"
                                                >
                                                    <ArrowsClockwise size={16} />
                                                    {t('buttons.revaluate')}
                                                </MyButton>
                                            </TooltipTrigger>
                                        </DialogTrigger>
                                        <TooltipContent side="bottom">
                                            {t('buttons.revaluateTooltip')}
                                        </TooltipContent>
                                    </Tooltip>
                                    <DialogContent className="p-0">
                                        <h1 className="rounded-t-lg bg-primary-50 p-4 text-primary-500">
                                            {t('dialogs.revaluate.title')}
                                        </h1>
                                        <div className="flex flex-col items-center justify-center gap-4 p-4">
                                            <AssessmentGlobalLevelRevaluateAssessment />
                                            <AssessmentGlobalLevelRevaluateQuestionWise />
                                        </div>
                                    </DialogContent>
                                </Dialog>
                                <AssessmentGlobalLevelReleaseResultAssessment />
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="secondary"
                                            className="gap-1.5 font-medium"
                                            onClick={() =>
                                                navigate({
                                                    to: '/assessment/evaluation-ai',
                                                    search: { assessmentId },
                                                })
                                            }
                                        >
                                            <Sparkle size={16} weight="fill" />
                                            {t('buttons.aiEvaluations')}
                                        </MyButton>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        {t('buttons.aiEvaluationsTooltip')}
                                    </TooltipContent>
                                </Tooltip>
                                {/* Copies the learners uploaded themselves: nothing to upload
                                    or match, just queue them all. The upload dialog next to it
                                    is for a pile of scanned PDFs the admin has. */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="primary"
                                            className="gap-1.5 font-medium"
                                            onClick={() => setSubmittedCheckScope([])}
                                        >
                                            <Sparkle size={16} weight="fill" />
                                            {t('buttons.checkSubmitted')}
                                        </MyButton>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        {t('buttons.checkSubmittedTooltip')}
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="secondary"
                                            className="gap-1.5 font-medium"
                                            onClick={() => setBulkCheckOpen(true)}
                                        >
                                            <UploadSimple size={16} />
                                            {t('buttons.bulkAiCheck')}
                                        </MyButton>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        {t('buttons.bulkAiCheckTooltip')}
                                    </TooltipContent>
                                </Tooltip>
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    className="font-medium"
                                    onClick={() => setIntakePanelOpen((v) => !v)}
                                >
                                    {t('buttons.bulkAiBatches')}
                                </MyButton>
                            </>
                        )}
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    className="!h-10 !min-w-0 px-2.5"
                                    aria-label={t('buttons.refresh')}
                                    onClick={handleRefreshLeaderboard}
                                >
                                    <ArrowCounterClockwise size={18} />
                                </MyButton>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {t('buttons.refreshTooltip')}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </div>
                {/* Unified toolbar row: participant toggles + sub-tabs on the left, filters + actions on the right */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 bg-white px-4 py-3">
                    {/* LEFT CLUSTER — participant type + (when internal) batch/individual sub-tabs */}
                    <div className="flex flex-wrap items-center gap-2">
                        {assesssmentType === 'PUBLIC' && (
                            <div className="flex items-center overflow-hidden rounded-lg border border-neutral-200">
                                <button
                                    type="button"
                                    onClick={() => handleParticipantsTab('internal')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        selectedParticipantsTab === 'internal'
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'bg-white text-neutral-600 hover:bg-neutral-50'
                                    )}
                                >
                                    <UsersThree size={18} />
                                    {t('participantType.internal')}
                                </button>
                                <div className="h-5 w-px bg-neutral-200" />
                                <button
                                    type="button"
                                    onClick={() => handleParticipantsTab('external')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        selectedParticipantsTab === 'external'
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'bg-white text-neutral-600 hover:bg-neutral-50'
                                    )}
                                >
                                    <User size={18} />
                                    {t('participantType.external')}
                                </button>
                            </div>
                        )}

                        {/* Batch / Individual — only when viewing internal participants, and
                            only when the assessment actually has both kinds of registration. */}
                        {selectedParticipantsTab === 'internal' && showSelectionModeToggle && (
                            <div className="flex items-center overflow-hidden rounded-lg border border-neutral-200">
                                <button
                                    type="button"
                                    onClick={() => handleBatchSeletectionTab('batch')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        batchSelectionTab === 'batch'
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'bg-white text-neutral-600 hover:bg-neutral-50'
                                    )}
                                >
                                    <UsersThree size={18} />
                                    {t('selectionMode.batch')}
                                </button>
                                <div className="h-5 w-px bg-neutral-200" />
                                <button
                                    type="button"
                                    onClick={() => handleBatchSeletectionTab('individual')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        batchSelectionTab === 'individual'
                                            ? 'bg-primary-50 text-primary-500'
                                            : 'bg-white text-neutral-600 hover:bg-neutral-50'
                                    )}
                                >
                                    <User size={18} />
                                    {t('selectionMode.individual')}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* RIGHT CLUSTER — search and filters only. The result actions used to
                        live here too and wrapped onto a third row once the filters grew; they
                        now sit with the sub-tabs above, which keeps this row purely about
                        narrowing the list. */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Search takes the full row on a phone, then sits inline. */}
                        <AssessmentDetailsSearchComponent
                            onSearch={handleSearch}
                            searchText={searchText}
                            setSearchText={setSearchText}
                            clearSearch={clearSearch}
                            placeholderText={t('search.placeholder')}
                        />
                        <ScheduleTestFilters
                            label={getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}
                            data={BatchesFilterData}
                            selectedItems={selectedFilter['batches'] || []}
                            onSelectionChange={(items) => handleFilterChange('batches', items)}
                        />
                        {selectedTab === 'Attempted' && (
                            <ScheduleTestFilters
                                label={t('filters.evaluationStatus.label')}
                                data={buildEvaluationStatusFilterOptions(t)}
                                selectedItems={selectedFilter.evaluation_status || []}
                                onSelectionChange={handleEvaluationStatusFilter}
                            />
                        )}
                        {/* Response filter — manual evaluation only: filter by
                            whether the attempt has a submitted answer-sheet file. */}
                        {selectedTab === 'Attempted' && isManualEvaluation && (
                            <ScheduleTestFilters
                                label={t('filters.submissionStatus.label')}
                                data={buildSubmissionStatusFilterOptions(t)}
                                selectedItems={selectedFilter.submission_status || []}
                                onSelectionChange={handleSubmissionStatusFilter}
                            />
                        )}
                        <AssessmentSubmissionsFilterButtons
                            selectedQuestionPaperFilters={selectedFilter}
                            handleSubmitFilters={handleRefreshLeaderboard}
                            handleResetFilters={handleResetFilters}
                        />
                        <div className="h-5 w-px bg-neutral-200" />
                        <ManageColumnsPopover
                            compact
                            columns={columnToggles}
                            hiddenColumns={hiddenColumns}
                            onToggle={toggleColumn}
                            onReset={handleResetColumns}
                            onReorder={setColumnOrder}
                        />
                        <AssessmentExportCsvDialog
                            assessmentId={assessmentId}
                            instituteId={initData?.id}
                            assessmentType={assesssmentType}
                            registrationSource={getCurrentRegistrationSource()}
                            scopedBatches={selectedFilter.batches ?? []}
                            // On Pending the export is the "never attempted" list, which
                            // only exists for batch-enrolled learners — Individual and
                            // External participants already get a real registration row and
                            // are covered by the result sheet.
                            notAttempted={
                                selectedTab === 'Pending' &&
                                selectedParticipantsTab === 'internal' &&
                                batchSelectionTab === 'batch'
                            }
                            notAttemptedScope={{
                                batches: (selectedFilter.batches ?? []).map(
                                    (batch: { id: string }) => batch.id
                                ),
                                name: searchText,
                            }}
                        />
                        <AssessmentReportZipExportDialog
                            assessmentId={assessmentId}
                            instituteId={instituteId}
                            selectedFilter={selectedFilter}
                        />
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            className="font-medium"
                            onClick={() => setAiReportOpen(true)}
                        >
                            <Sparkle size={15} weight="fill" />
                            {t('aiReport.download')}
                        </MyButton>
                        <Dialog open={aiReportOpen} onOpenChange={setAiReportOpen}>
                            {aiReportOpen && (
                                <AiAssessmentReportDialog
                                    assessmentId={assessmentId}
                                    instituteId={instituteId}
                                    assessmentName={assessmentDetailsData?.[0]?.saved_data?.name}
                                    onClose={() => setAiReportOpen(false)}
                                />
                            )}
                        </Dialog>
                        {isOfflineEntryEnabled && (
                            <MyButton
                                type="button"
                                scale="small"
                                buttonType="primary"
                                className="font-medium"
                                onClick={() =>
                                    navigate({
                                        to: '/assessment/assessment-list/offline-entry/$assessmentId',
                                        params: { assessmentId },
                                    })
                                }
                            >
                                {t('buttons.offlineEntry')}
                            </MyButton>
                        )}
                    </div>
                </div>
                {/* overflow-x-auto (not overflow-y-auto) — the table is wider than the
                    viewport and its pinned first/last columns anchor to this scroll
                    container. Capping the height here as well nested a second scroller
                    inside the page's own, which stranded the pagination mid-screen. */}
                <div className="flex flex-col gap-6 overflow-x-auto p-4">
                    {selectedTab === 'Attempted' && (
                        <SubmissionsSummaryStrip
                            assessmentId={assessmentId}
                            instituteId={instituteId}
                            assessmentType={assesssmentType}
                            registrationSource={getCurrentRegistrationSource()}
                            batches={selectedFilter.batches}
                            totalMarks={totalMarks.total_achievable_marks}
                            refreshKey={summaryRefreshKey}
                            isManualEvaluation={isManualEvaluation}
                        />
                    )}
                    <TabsContent value={selectedTab} ref={tableRef}>
                        <SidebarProvider
                            style={
                                {
                                    ['--sidebar-width' as string]: '565px',
                                } /* dynamic CSS custom property, cannot use Tailwind token */
                            }
                            defaultOpen={false}
                            open={isSidebarOpen}
                            onOpenChange={setIsSidebarOpen}
                        >
                            <AssessmentSubmissionsStudentTable
                                data={{
                                    content: getAssessmentSubmissionsFilteredDataStudentData(
                                        participantsData.content,
                                        type,
                                        selectedTab,
                                        initData?.batches_for_sessions,
                                        totalMarks.total_achievable_marks
                                    ),
                                    total_pages: participantsData.total_pages,
                                    page_no: page,
                                    page_size: pageSize,
                                    total_elements: participantsData.total_elements,
                                    last: participantsData.last,
                                }}
                                columns={visibleColumns}
                                columnWidths={
                                    getAssessmentColumnWidth[
                                        selectedTab as keyof typeof getAssessmentColumnWidth
                                    ] || []
                                }
                                rowSelection={currentPageSelection}
                                onRowSelectionChange={handleRowSelectionChange}
                                onSort={handleSort}
                                currentPage={page}
                                isLoading={isParticipantsLoading}
                            />
                            {selectedParticipantsTab === 'external' ? (
                                // External participants registered via the public form
                                // — show the form answers and custom-field responses.
                                <OpenStudentSidebar />
                            ) : (
                                // Internal participants (whether the assessment is
                                // PRIVATE or PUBLIC) get the full student profile
                                // sheet, same as the students list.
                                <StudentSidebar
                                    selectedTab={selectedTab}
                                    examType={examType}
                                    selectedStudent={selectedStudent}
                                    isSubmissionTab={true}
                                />
                            )}
                        </SidebarProvider>
                    </TabsContent>
                    <div className="flex justify-between">
                        <BulkActions
                            selectedCount={totalSelectedCount}
                            selectedStudentIds={getSelectedStudentIds()}
                            selectedStudents={getSelectedStudents()}
                            onReset={handleResetSelections}
                            selectedTab={selectedTab}
                            totalCount={participantsData.total_elements}
                            onSelectAll={selectedTab === 'Pending' ? handleSelectAll : undefined}
                            isSelectingAll={isSelectingAll}
                            isAllSelected={
                                allSelectedRows !== null &&
                                allSelectedRows.length >= participantsData.total_elements
                            }
                            onExportReports={() => setBulkReportZipOpen(true)}
                            onCheckWithAi={
                                isManualEvaluation
                                    ? () =>
                                          setSubmittedCheckScope(
                                              getSelectedStudents()
                                                  .map((student) => student.attempt_id)
                                                  .filter((id): id is string => !!id)
                                          )
                                    : undefined
                            }
                        />
                        {/* Controlled instance for the bulk-actions entry — no
                            trigger of its own, scoped to the checked rows. */}
                        <AssessmentReportZipExportDialog
                            assessmentId={assessmentId}
                            instituteId={instituteId}
                            selectedFilter={selectedFilter}
                            attemptIds={getSelectedStudents()
                                .map((student) => student.attempt_id)
                                .filter((id): id is string => !!id)}
                            open={bulkReportZipOpen}
                            onOpenChange={setBulkReportZipOpen}
                        />
                        <MyPagination
                            currentPage={page}
                            totalPages={participantsData.total_pages}
                            onPageChange={handlePageChange}
                            totalElements={participantsData.total_elements}
                            pageSize={pageSize}
                            onPageSizeChange={setPageSize}
                        />
                    </div>
                </div>
            </Tabs>
            {/* Pending-tab reminders (bulk menu and row menu) open these. */}
            <SendMessageDialog />
            <SendEmailDialog />
        </ControlledStudentSidebarProvider>
    );
};

export default AssessmentSubmissionsTab;
