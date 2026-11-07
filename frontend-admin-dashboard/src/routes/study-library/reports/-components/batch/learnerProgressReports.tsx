import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight, FileCsv, MagnifyingGlass, Warning, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { cn } from '@/lib/utils';

import { fetchStudents } from '@/routes/manage-students/students-list/-services/getStudentTable';
import { fetchStudentSubjectsProgress } from '@/routes/manage-students/students-list/-services/getStudentSubjects';
import calculateLearningPercentage from '@/routes/manage-students/students-list/-utils/calculateLearningPercentage';
import type { StudentSubjectsDetailsTypes } from '@/routes/manage-students/students-list/-types/student-subjects-details-types';
import {
    ProfileMiniBar,
    ProfileStat,
} from '@/routes/manage-students/students-list/-components/students-list/student-side-view/profile-ui';

import { LearnerProgressBreakdown } from './learnerProgressBreakdown';
import BatchMultiSelect, { useBatchLookup } from '../batchMultiSelect';
import { buildReportCsv, csvFileName, downloadCsv, num } from '../../-utils/reportCsv';

/**
 * Course Details → Reports → {Learner} Progress.
 *
 * The same numbers the learner side-view Progress panel shows, but for every
 * learner enrolled in the batch at once: one paginated, searchable row per
 * learner with their course completion, expanding into
 * {@link ContentTerms.Subject} → {@link ContentTerms.Module} → chapter.
 *
 * Both APIs already exist — the learner list (`fetchStudents`) and the
 * per-learner subject tree (`fetchStudentSubjectsProgress`, the endpoint behind
 * the side-view panel). The subject tree is fetched once per learner on the
 * current page under the *same* query key the side view uses, so the two
 * surfaces share a cache and expanding a row costs no extra request.
 */

const PAGE_SIZE = 10;
/** CSV export walks the whole list in pages this big… */
const EXPORT_PAGE_SIZE = 100;
/** …up to this many learners, so one click can't fan out thousands of requests. */
const EXPORT_MAX_LEARNERS = 2000;
/** Per-learner progress requests in flight at once during the export. */
const EXPORT_CONCURRENCY = 6;

/** Course % for one learner — the same nested rollup the side-view gauge uses. */
const courseCompletion = (subjects: StudentSubjectsDetailsTypes | null | undefined) =>
    subjects && subjects.length ? calculateLearningPercentage(subjects) : 0;

/** Two-letter avatar fallback, matching the learner list's initials treatment. */
const initials = (name: string) =>
    name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || '?';

/** Completion → chip. Same bands the side-view hero uses for its ring tone. */
const completionStatus = (t: TFunction, value: number): { status: StatusType; label: string } => {
    if (value >= 100) return { status: 'SUCCESS', label: t('status.completed') };
    if (value >= 75) return { status: 'SUCCESS', label: t('status.onTrack') };
    if (value >= 40) return { status: 'INFO', label: t('status.inProgress') };
    if (value > 0) return { status: 'WARNING', label: t('status.behind') };
    return { status: 'DANGER', label: t('status.notStarted') };
};

/**
 * Course-progress cell.
 *
 * Written rather than reusing ProfileMiniBar because that bar's track is
 * `bg-neutral-100` at `h-1.5`, which on a white row reads as nothing at all —
 * a whole page of 0% learners looked like empty cells. Here the track is a
 * visible `bg-neutral-200`, the fill is tone-banded, and the number always
 * carries its own weight so progress is never conveyed by colour alone.
 */
const ProgressMeter = ({ value }: { value: number }) => {
    const pct = Math.max(0, Math.min(100, value));
    const rounded = Math.round(pct);
    const fill =
        pct >= 100
            ? 'bg-success-500'
            : pct >= 75
              ? 'bg-success-500'
              : pct >= 40
                ? 'bg-primary-500'
                : pct > 0
                  ? 'bg-warning-500'
                  : 'bg-transparent';

    // The bar width is the datum itself — the one value that cannot be a token.
    const barWidth = { width: `${pct}%` };

    return (
        <div className="flex max-w-56 items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200">
                <div
                    className={cn('h-full rounded-full transition-all duration-500', fill)}
                    style={barWidth}
                />
            </div>
            <span
                className={cn(
                    'w-10 shrink-0 text-right text-body font-semibold tabular-nums',
                    rounded > 0 ? 'text-neutral-800' : 'text-neutral-400'
                )}
            >
                {rounded}%
            </span>
        </div>
    );
};

/** Chapters finished vs total across every subject — the "content covered" cell. */
const contentCounts = (subjects: StudentSubjectsDetailsTypes | null) => {
    let chaptersDone = 0;
    let chaptersTotal = 0;
    (subjects ?? []).forEach((subject) => {
        (subject.modules ?? []).forEach((mod) => {
            (mod.chapters ?? []).forEach((chapter) => {
                chaptersTotal += 1;
                if ((chapter.percentage_completed ?? 0) >= 100) chaptersDone += 1;
            });
        });
    });
    return { chaptersDone, chaptersTotal };
};

/** One table row: the learner, plus their progress payload once it lands. */
interface LearnerProgressRow {
    user_id: string;
    full_name: string;
    email: string;
    username: string | null;
    enrollment_number?: string;
    /** Batch this enrolment row belongs to (one row per learner per batch). */
    package_session_id: string;
    batchLabel: string;
    subjects: StudentSubjectsDetailsTypes | null;
    isProgressLoading: boolean;
    coursePercentage: number;
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            out[index] = await fn(items[index] as T);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

interface LearnerProgressReportsProps {
    /**
     * Batch the report is scoped to. Course Details supplies this and the
     * course/session/level picker is hidden. Omitted on the standalone Learning
     * Reports page, where the admin picks the course here instead.
     */
    packageSessionId?: string;
    /** Course id backing `packageSessionId`, when the parent already knows it. */
    courseId?: string;
}

export default function LearnerProgressReports({
    packageSessionId,
    courseId,
}: LearnerProgressReportsProps = {}) {
    const { t } = useTranslation('studyLibraryLearnerProgressReports');
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const instituteId = getCurrentInstituteId();
    const { instituteDetails, getCourseFromPackage } = useInstituteDetailsStore();
    const batchLookup = useBatchLookup();
    const queryClient = useQueryClient();

    // Batch is fixed by the parent (Course Details) → no picker.
    const isBatchFixed = Boolean(packageSessionId);

    const [page, setPage] = useState(0);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    /** "userId|packageSessionId" — a learner in two selected batches has two rows. */
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
    const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(
        null
    );

    // ── Batch picker (standalone mode only) ──────────────────────────────────
    const [selectedBatches, setSelectedBatches] = useState<string[]>([]);

    /** The batches every query below runs against. */
    const activePackageSessionIds = useMemo(
        () => (packageSessionId ? [packageSessionId] : selectedBatches),
        [packageSessionId, selectedBatches]
    );
    const activeKey = activePackageSessionIds.join('|');
    const isMulti = activePackageSessionIds.length > 1;

    /** Label for a row's batch: the course name in fixed mode, else the picker label. */
    const batchLabelFor = (batchId: string) => {
        if (isBatchFixed) {
            return (
                getCourseFromPackage().find((c) => c.id === courseId)?.name ||
                batchLookup.get(batchId)?.label ||
                ''
            );
        }
        return batchLookup.get(batchId)?.label ?? '';
    };

    /**
     * Batch an enrolment row belongs to. The list is filtered by the selected
     * batches so this is one of them; fall back to the only selection if the
     * row ever arrives without it, so progress keeps loading as before.
     */
    const batchIdOf = (learner: { package_session_id?: string | null }) =>
        learner.package_session_id ||
        (activePackageSessionIds.length === 1 ? activePackageSessionIds[0] ?? '' : '');

    // Debounce so typing doesn't fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput.trim()), 400);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // A new search or batch starts from page 1, and the open row no longer exists.
    useEffect(() => {
        setPage(0);
        setExpandedUserId(null);
    }, [search, activeKey]);

    const statuses = useMemo(
        () => instituteDetails?.student_statuses ?? ['ACTIVE'],
        [instituteDetails?.student_statuses]
    );

    const {
        data: studentPage,
        isLoading: isLearnersLoading,
        isFetching,
        isError,
        refetch,
    } = useQuery({
        queryKey: [
            'COURSE_REPORT_LEARNERS',
            activePackageSessionIds,
            page,
            search,
            statuses,
            instituteId,
        ],
        queryFn: () =>
            fetchStudents({
                pageNo: page,
                pageSize: PAGE_SIZE,
                filters: {
                    name: search,
                    institute_ids: instituteId ? [instituteId] : [],
                    package_session_ids: activePackageSessionIds,
                    statuses,
                    sort_columns: {},
                },
            }),
        enabled: activePackageSessionIds.length > 0,
        staleTime: 60 * 1000,
    });

    const learners = useMemo(() => studentPage?.content ?? [], [studentPage?.content]);

    // One subject-tree request per learner on this page, against the batch the
    // enrolment row belongs to (a learner in two selected batches gets a row
    // per batch). Same query key as useStudentSubjectsProgressQuery, so
    // anything the side view already loaded is reused rather than refetched.
    const progressResults = useQueries({
        queries: learners.map((learner) => ({
            queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS', learner.user_id, batchIdOf(learner)],
            queryFn: () =>
                fetchStudentSubjectsProgress(
                    learner.user_id,
                    batchIdOf(learner)
                ) as Promise<StudentSubjectsDetailsTypes | null>,
            enabled: Boolean(learner.user_id && batchIdOf(learner)),
            staleTime: 3600000,
        })),
    });

    const progressKey = progressResults.map((r) => `${r.status}:${r.dataUpdatedAt}`).join('|');

    const rows = useMemo<LearnerProgressRow[]>(
        () =>
            learners.map((learner, index) => {
                const result = progressResults[index];
                const subjects = (result?.data ?? null) as StudentSubjectsDetailsTypes | null;
                return {
                    user_id: learner.user_id,
                    full_name: learner.full_name,
                    email: learner.email,
                    username: learner.username,
                    enrollment_number: learner.institute_enrollment_number,
                    package_session_id: batchIdOf(learner),
                    batchLabel: batchLabelFor(batchIdOf(learner)),
                    subjects,
                    isProgressLoading: Boolean(result?.isLoading),
                    coursePercentage: courseCompletion(subjects),
                };
            }),
        // progressResults is a fresh array each render; its useQueries entries are
        // stable per (learner, batch), so key off the resolved values instead.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [learners, batchLookup, progressKey]
    );

    // Page-scoped, because only this page's learners have their progress loaded.
    // Labelled as such in the UI so it never reads as a whole-batch average.
    const pageSummary = useMemo(() => {
        const scored = rows.filter((row) => !row.isProgressLoading);
        if (!scored.length) return { average: 0, completed: 0, notStarted: 0 };
        return {
            average: scored.reduce((sum, row) => sum + row.coursePercentage, 0) / scored.length,
            completed: scored.filter((row) => row.coursePercentage >= 100).length,
            notStarted: scored.filter((row) => row.coursePercentage <= 0).length,
        };
    }, [rows]);

    const tableData = useMemo(
        () => ({
            content: rows,
            total_pages: studentPage?.total_pages ?? 0,
            page_no: page,
            page_size: PAGE_SIZE,
            total_elements: studentPage?.total_elements ?? 0,
            last: studentPage?.last ?? true,
        }),
        [rows, studentPage?.total_pages, studentPage?.total_elements, studentPage?.last, page]
    );

    const columns = useMemo<ColumnDef<LearnerProgressRow>[]>(
        () => [
            {
                accessorKey: 'full_name',
                header: learnerTerm,
                size: 320,
                cell: ({ row }) => {
                    const name =
                        row.original.full_name ||
                        t('unnamedLearner', { learner: learnerTerm.toLowerCase() });
                    const pct = row.original.coursePercentage;
                    return (
                        // max-w-sm bounds the cell: MyTable's <table> is auto-layout,
                        // so the width hint alone lets a long name stretch the column
                        // (and push the rest off-screen). A hard max makes truncate bite.
                        <div className="flex max-w-sm items-center gap-3 py-0.5">
                            <span
                                className={cn(
                                    'flex size-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                                    pct >= 100
                                        ? 'bg-success-100 text-success-600'
                                        : pct > 0
                                          ? 'bg-primary-100 text-primary-600'
                                          : 'bg-neutral-100 text-neutral-500'
                                )}
                            >
                                {initials(name)}
                            </span>
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-body font-semibold text-neutral-800">
                                    {name}
                                </span>
                                <span className="truncate text-2xs text-neutral-500">
                                    {row.original.email || row.original.username || '—'}
                                </span>
                            </span>
                        </div>
                    );
                },
            },
            // Only worth a column when more than one batch is on screen.
            ...(isMulti
                ? [
                      {
                          accessorKey: 'batchLabel',
                          header: batchTerm,
                          size: 220,
                          cell: ({ row }) => (
                              <span className="line-clamp-2 max-w-56 text-caption text-neutral-600">
                                  {row.original.batchLabel || '—'}
                              </span>
                          ),
                      } satisfies ColumnDef<LearnerProgressRow>,
                  ]
                : []),
            {
                accessorKey: 'coursePercentage',
                header: t('columns.courseProgress', { course: courseTerm }),
                size: 300,
                cell: ({ row }) =>
                    row.original.isProgressLoading ? (
                        <div className="h-2 w-full max-w-52 animate-pulse rounded-full bg-neutral-200" />
                    ) : (
                        <ProgressMeter value={row.original.coursePercentage} />
                    ),
            },
            {
                id: 'status',
                header: t('columns.status'),
                size: 170,
                cell: ({ row }) => {
                    if (row.original.isProgressLoading) {
                        return (
                            <span className="text-caption text-neutral-400">{t('loading')}</span>
                        );
                    }
                    const { status, label } = completionStatus(t, row.original.coursePercentage);
                    return <StatusChip status={status} textSize="text-caption" text={label} />;
                },
            },
            {
                id: 'content',
                header: t('columns.chaptersDone'),
                size: 150,
                cell: ({ row }) => {
                    const { chaptersDone, chaptersTotal } = contentCounts(row.original.subjects);
                    if (row.original.isProgressLoading) {
                        return <span className="text-caption text-neutral-400">—</span>;
                    }
                    return (
                        <span className="text-body tabular-nums text-neutral-700">
                            <span
                                className={cn(
                                    'font-semibold',
                                    chaptersDone > 0 ? 'text-neutral-900' : 'text-neutral-400'
                                )}
                            >
                                {chaptersDone}
                            </span>
                            <span className="text-neutral-400"> / {chaptersTotal}</span>
                        </span>
                    );
                },
            },
            {
                // NOT `details` — MyTable left-pins any column whose id is
                // checkbox / details / full_name, which threw this action button
                // to the front of the row.
                id: 'rowAction',
                header: '',
                size: 130,
                cell: ({ row }) => (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        aria-label={t('viewProgressBreakdownAriaLabel', {
                            name: row.original.full_name,
                        })}
                        onClick={() =>
                            setExpandedUserId(
                                `${row.original.user_id}|${row.original.package_session_id}`
                            )
                        }
                    >
                        {t('view')}
                        <CaretRight className="size-3" weight="bold" />
                    </MyButton>
                ),
            },
        ],
        [learnerTerm, courseTerm, batchTerm, isMulti]
    );

    /**
     * CSV of EVERY learner matching the current batches + search (not just
     * this page): walk the list in big pages, then fetch each learner's
     * progress with bounded concurrency, reusing whatever the table already
     * cached. One row per learner per batch, plus a subject-level section.
     */
    const handleExportCsv = async () => {
        if (!activePackageSessionIds.length || exportProgress) return;
        setExportProgress({ done: 0, total: 0 });
        try {
            const all: typeof learners = [];
            let pageNo = 0;
            let totalPages = 1;
            let truncated = false;
            do {
                const res = await fetchStudents({
                    pageNo,
                    pageSize: EXPORT_PAGE_SIZE,
                    filters: {
                        name: search,
                        institute_ids: instituteId ? [instituteId] : [],
                        package_session_ids: activePackageSessionIds,
                        statuses,
                        sort_columns: {},
                    },
                });
                totalPages = res.total_pages ?? 1;
                all.push(...(res.content ?? []));
                pageNo += 1;
                if (all.length >= EXPORT_MAX_LEARNERS) {
                    truncated = pageNo < totalPages;
                    break;
                }
            } while (pageNo < totalPages);
            const learnersToExport = all.slice(0, EXPORT_MAX_LEARNERS);
            setExportProgress({ done: 0, total: learnersToExport.length });

            let done = 0;
            const trees = await mapWithConcurrency(
                learnersToExport,
                EXPORT_CONCURRENCY,
                async (learner) => {
                    const subjects = await queryClient
                        .fetchQuery({
                            queryKey: [
                                'GET_STUDENT_SUBJECTS_PROGRESS',
                                learner.user_id,
                                batchIdOf(learner),
                            ],
                            queryFn: () =>
                                fetchStudentSubjectsProgress(
                                    learner.user_id,
                                    batchIdOf(learner)
                                ) as Promise<StudentSubjectsDetailsTypes | null>,
                            staleTime: 3600000,
                        })
                        .catch(() => null);
                    done += 1;
                    setExportProgress({ done, total: learnersToExport.length });
                    return subjects;
                }
            );

            const csv = buildReportCsv([
                {
                    title: t('csv.summaryTitle', { learner: learnerTerm }),
                    headers: [
                        batchTerm,
                        learnerTerm,
                        t('csv.email'),
                        t('csv.username'),
                        t('csv.enrollmentNumber'),
                        t('csv.courseProgress', { course: courseTerm }),
                        t('columns.status'),
                        t('csv.chaptersDone'),
                        t('csv.chaptersTotal'),
                    ],
                    rows: learnersToExport.map((learner, index) => {
                        const subjects = trees[index] ?? null;
                        const pct = courseCompletion(subjects);
                        const { chaptersDone, chaptersTotal } = contentCounts(subjects);
                        return [
                            batchLabelFor(batchIdOf(learner)),
                            learner.full_name,
                            learner.email,
                            learner.username ?? '',
                            learner.institute_enrollment_number ?? '',
                            num(pct),
                            completionStatus(t, pct).label,
                            chaptersDone,
                            chaptersTotal,
                        ];
                    }),
                },
                {
                    title: t('csv.subjectTitle', { learner: learnerTerm }),
                    headers: [
                        batchTerm,
                        learnerTerm,
                        t('csv.email'),
                        getTerminology(ContentTerms.Subjects, SystemTerms.Subjects),
                        getTerminology(ContentTerms.Modules, SystemTerms.Modules),
                        t('csv.moduleProgress', {
                            module: getTerminology(ContentTerms.Modules, SystemTerms.Modules),
                        }),
                    ],
                    rows: learnersToExport.flatMap((learner, index) =>
                        (trees[index] ?? []).flatMap((subject) =>
                            (subject.modules ?? []).map((module) => [
                                batchLabelFor(batchIdOf(learner)),
                                learner.full_name,
                                learner.email,
                                subject.subject_dto?.subject_name ?? '',
                                module.module?.module_name ?? '',
                                num(module.percentage_completed ?? 0),
                            ])
                        )
                    ),
                },
            ]);
            downloadCsv(
                csvFileName(
                    t('csv.fileStem', { learner: learnerTerm }),
                    isMulti
                        ? `${activePackageSessionIds.length}-${batchTerm}`
                        : batchLabelFor(activePackageSessionIds[0] ?? '')
                ),
                csv
            );
            toast.success(
                truncated
                    ? t('csv.exportTruncated', { count: EXPORT_MAX_LEARNERS })
                    : t('csv.exportSuccess', { count: learnersToExport.length })
            );
        } catch {
            toast.error(t('csv.exportFailed'));
        } finally {
            setExportProgress(null);
        }
    };

    /** The learner whose breakdown drawer is open. */
    const rowKey = (row: LearnerProgressRow) => `${row.user_id}|${row.package_session_id}`;
    const openLearner = useMemo(
        () => rows.find((row) => rowKey(row) === expandedUserId) ?? null,
        [rows, expandedUserId]
    );

    /** Batch picker — standalone (Learning Reports) mode. */
    const picker = !isBatchFixed && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
            <BatchMultiSelect selected={selectedBatches} onChange={setSelectedBatches} />
        </div>
    );

    // Nothing to report on until a batch is picked. The picker stays mounted
    // so the admin can carry on choosing.
    if (!activePackageSessionIds.length) {
        return (
            <div className="space-y-4">
                {picker}
                <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
                    <p className="text-body font-medium text-neutral-700">
                        {t('emptyBatch.selectBatch', {
                            batch: batchTerm.toLowerCase(),
                            learner: learnerTerm.toLowerCase(),
                        })}
                    </p>
                    {!isBatchFixed && (
                        <p className="mt-1 text-caption text-neutral-500">
                            {t('emptyBatch.multiHint', { batch: batchTerm.toLowerCase() })}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {picker}

            {/* Batch summary — computed from the current page's learners, so the
                caption says so rather than implying a whole-batch average. */}
            <div className="flex flex-wrap gap-3">
                <ProfileStat
                    label={t('stats.enrolled', {
                        count: studentPage?.total_elements ?? 0,
                        learner: learnerTerm.toLowerCase(),
                    })}
                    value={studentPage?.total_elements ?? 0}
                    tone="primary"
                />
                <ProfileStat
                    label={t('stats.avgProgressThisPage')}
                    value={`${Math.round(pageSummary.average)}%`}
                    tone={pageSummary.average >= 40 ? 'success' : 'warning'}
                />
                <ProfileStat
                    label={t('stats.completedThisPage')}
                    value={pageSummary.completed}
                    tone="success"
                />
                <ProfileStat
                    label={t('stats.notStartedThisPage')}
                    value={pageSummary.notStarted}
                    tone={pageSummary.notStarted > 0 ? 'danger' : 'neutral'}
                />
            </div>

            {/* Search — the only filter; the batch is already fixed by the page. */}
            <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="relative">
                        <MyInput
                            inputType="text"
                            input={searchInput}
                            onChangeFunction={(event) => setSearchInput(event.target.value)}
                            inputPlaceholder={t('search.placeholder', {
                                learner: learnerTerm.toLowerCase(),
                            })}
                            label={t('search.label')}
                            size="medium"
                            className="w-full ps-8 sm:w-80"
                        />
                        <MagnifyingGlass
                            size={16}
                            className="pointer-events-none absolute bottom-2.5 start-2.5 text-neutral-400"
                        />
                    </div>
                    {search && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setSearchInput('')}
                        >
                            <X size={14} />
                            {t('search.clear')}
                        </MyButton>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-caption text-neutral-500">
                        {isFetching
                            ? t('loading')
                            : t('search.enrolledCount', {
                                  count: studentPage?.total_elements ?? 0,
                                  learner: learnerTerm.toLowerCase(),
                              })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleExportCsv}
                        disable={
                            Boolean(exportProgress) || (studentPage?.total_elements ?? 0) === 0
                        }
                    >
                        <FileCsv className="size-4" />
                        {exportProgress
                            ? exportProgress.total
                                ? t('csv.exporting', {
                                      done: exportProgress.done,
                                      total: exportProgress.total,
                                  })
                                : t('csv.preparing')
                            : t('csv.exportCsv')}
                    </MyButton>
                </div>
            </div>

            {isError ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-6 text-center">
                    <Warning size={22} className="text-danger-600" />
                    <p className="text-body text-danger-600">
                        {t('error.loadFailed', { learner: learnerTerm.toLowerCase() })}
                    </p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => refetch()}
                    >
                        {t('error.retry')}
                    </MyButton>
                </div>
            ) : !isLearnersLoading && rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center">
                    <p className="text-body font-medium text-neutral-700">
                        {search
                            ? t('empty.noMatch', { learner: learnerTerm.toLowerCase(), search })
                            : t('empty.noneEnrolled', {
                                  learner: learnerTerm.toLowerCase(),
                                  batch: batchTerm.toLowerCase(),
                              })}
                    </p>
                    <p className="mt-1 text-caption text-neutral-500">
                        {search
                            ? t('empty.tryDifferentName')
                            : t('empty.progressAppearsHere', {
                                  learner: learnerTerm.toLowerCase(),
                              })}
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* No scroll wrapper here — MyTable owns its own capped,
                        auto-overflow container with a sticky header; nesting a
                        second scroll container clips the first row under it.

                        The breakdown is deliberately NOT an in-table expanded row:
                        MyTable pins the <table> to a fixed pixel width and scrolls
                        it horizontally, so a colSpan panel inherits that overflow
                        and its labels get clipped as the columns scroll. A drawer
                        also matches the learner side-view, which is itself a drawer. */}
                    <div className="rounded-lg bg-white">
                        <MyTable<LearnerProgressRow>
                            data={tableData}
                            columns={columns}
                            isLoading={isLearnersLoading}
                            error={null}
                            currentPage={page}
                            // Whole row opens the drawer — a 40px-tall target beats
                            // hunting for the button, and MyTable rows already carry
                            // cursor-pointer. The View button stays as the affordance.
                            onCellClick={(row) => setExpandedUserId(rowKey(row))}
                        />
                    </div>
                    {(studentPage?.total_pages ?? 0) > 1 && (
                        <MyPagination
                            currentPage={page}
                            totalPages={studentPage?.total_pages ?? 0}
                            onPageChange={setPage}
                        />
                    )}
                </div>
            )}

            {/* Per-learner breakdown drawer — the same surface the learner
                side-view Progress panel uses, so it has room for the full
                subject / module / chapter tree without clipping. */}
            <Sheet
                open={Boolean(openLearner)}
                onOpenChange={(open) => !open && setExpandedUserId(null)}
            >
                <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
                    {openLearner && (
                        <>
                            <SheetHeader className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-5 py-4 text-left">
                                <SheetTitle className="flex items-center gap-3">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-caption font-semibold text-primary-600">
                                        {initials(openLearner.full_name || '?')}
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-subtitle font-semibold text-neutral-800">
                                            {openLearner.full_name ||
                                                t('unnamedLearner', {
                                                    learner: learnerTerm.toLowerCase(),
                                                })}
                                        </span>
                                        <span className="truncate text-caption font-regular text-neutral-500">
                                            {openLearner.email || openLearner.username || '—'}
                                        </span>
                                    </span>
                                </SheetTitle>
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <StatusChip
                                        status={
                                            completionStatus(t, openLearner.coursePercentage).status
                                        }
                                        textSize="text-caption"
                                        text={
                                            completionStatus(t, openLearner.coursePercentage).label
                                        }
                                    />
                                    <span className="text-caption text-neutral-500">
                                        {t('drawer.percentComplete', {
                                            percent: Math.round(openLearner.coursePercentage),
                                            course: courseTerm.toLowerCase(),
                                        })}
                                    </span>
                                    {isMulti && openLearner.batchLabel && (
                                        <span className="rounded-md bg-primary-50 px-2 py-0.5 text-caption font-medium text-neutral-700">
                                            {openLearner.batchLabel}
                                        </span>
                                    )}
                                </div>
                                <ProfileMiniBar value={openLearner.coursePercentage} label="" />
                            </SheetHeader>
                            <LearnerProgressBreakdown
                                subjects={openLearner.subjects}
                                isLoading={openLearner.isProgressLoading}
                            />
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
