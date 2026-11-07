import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import ReportRecipientsDialogBox from './reportRecipientsDialogBox';
import { useLearnerDetailsForBatches } from '../../-store/useLearnersDetails';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { MyTable } from '@/components/design-system/table';
import {
    SubjectProgressResponse,
    SubjectOverviewColumns,
    SubjectOverviewColumnType,
} from '../../-types/types';
import { fetchLearnersSubjectWiseProgress } from '../../-services/utils';
import { useQueries } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { usePacageDetails } from '../../-store/usePacageDetails';
import { convertMinutesToTimeFormat, formatToTwoDecimalPlaces } from '../../-services/helper';
import { resolveInstituteLogoUrl } from '../live/-utils/instituteLogo';
import { exportSubjectProgressPdf } from '../../-utils/exportSubjectProgressPdf';
import { useSearch } from '@tanstack/react-router';
import { Route } from '@/routes/study-library/reports';
import { toast } from 'sonner';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { Export, FileCsv, Warning } from '@phosphor-icons/react';
import BatchMultiSelect, { useBatchLookup, type BatchOption } from '../batchMultiSelect';
import { buildReportCsv, csvFileName, downloadCsv, num } from '../../-utils/reportCsv';

const buildFormSchema = (t: TFunction) =>
    z.object({
        batches: z.array(z.string()).min(1, t('validation.batchRequired')),
        student: z.string().min(1, t('validation.studentRequired')),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface Applied {
    userId: string;
    learnerName: string;
    /** Only the selected batches this learner is actually enrolled in. */
    batchIds: string[];
    /**
     * Stamped per "Generate" click and part of every query key, so re-running the
     * same batch + range always fetches fresh numbers (the mutation-based
     * version fetched on every click) while paging within a run stays cached.
     */
    runId: number;
}

interface BatchResult {
    batchId: string;
    option: BatchOption | undefined;
    /** `null` is what the service returns on a failed request. */
    data: SubjectProgressResponse | null | undefined;
    isError: boolean;
}

/** Rows for one batch; each carries its batch so "View details" queries the right one. */
const transformToSubjectOverview = (
    data: SubjectProgressResponse,
    userId: string,
    batchId: string,
    option: BatchOption | undefined
): SubjectOverviewColumnType[] =>
    data.flatMap((subject) =>
        subject.modules.map((module) => ({
            subject: subject.subject_name,
            module: module.module_name,
            module_id: module.module_id,
            module_completed: `${formatToTwoDecimalPlaces(module.module_completion_percentage)}%`,
            module_completed_by_batch: `${formatToTwoDecimalPlaces(
                module.module_completion_percentage_by_batch
            )}%`,
            average_time_spent: `${convertMinutesToTimeFormat(module.avg_time_spent_minutes)}`,
            average_time_spent_by_batch: `${convertMinutesToTimeFormat(
                module.avg_time_spent_minutes_by_batch ?? 0
            )}`,
            user_id: userId,
            package_session_id: batchId,
            course_name: option?.courseName ?? '',
            session_name: option?.sessionName ?? '',
            level_name: option?.levelName ?? '',
        }))
    );

// Courses shallower than the full Subject → Module structure come back with
// the literal "DEFAULT" placeholder for the missing level(s). Rather than
// showing a whole column of "DEFAULT", hide any structural column whose
// every row is that placeholder. Metric columns are never hidden this way.
const isStructuralColumnAllDefault = (
    rows: SubjectOverviewColumnType[],
    key: 'subject' | 'module'
) =>
    rows.length > 0 &&
    rows.every((row) => (row[key] ?? '').toString().trim().toUpperCase() === 'DEFAULT');

export default function ProgressReports() {
    const { t } = useTranslation('studyLibraryReportsProgressReports');
    const { getPackageSessionId } = useInstituteDetailsStore();
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const { setPacageSessionId, setCourse, setSession, setLevel, setLearnerName } =
        usePacageDetails();
    const batchLookup = useBatchLookup();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const subjectTerm = getTerminology(ContentTerms.Subject, SystemTerms.Subject);
    const moduleTerm = getTerminology(ContentTerms.Module, SystemTerms.Module);

    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
    const search = useSearch({ from: Route.id });

    const [applied, setApplied] = useState<Applied | null>(null);
    const [isExportingPdf, setIsExportingPdf] = useState<string | null>(null);
    const [isExportingCsv, setIsExportingCsv] = useState(false);

    const {
        handleSubmit,
        setValue,
        watch,
        clearErrors,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(buildFormSchema(t)),
        defaultValues: { batches: [], student: '' },
    });
    const selectedBatches = watch('batches');
    const selectedStudent = watch('student');

    const { learners: studentList, isLoading: isLearnersLoading } = useLearnerDetailsForBatches(
        selectedBatches,
        INSTITUTE_ID || ''
    );

    // A learner that is no longer in any selected batch can't stay picked.
    useEffect(() => {
        if (
            selectedStudent &&
            !isLearnersLoading &&
            !studentList.some((s) => s.user_id === selectedStudent)
        ) {
            setValue('student', '');
        }
    }, [studentList, isLearnersLoading, selectedStudent, setValue]);

    // Prefill the form when the user lands here from the learner profile's
    // "Learning Progress" button — see the matching block in timelineReports.tsx.
    const prefill = search.studentReport;
    // Each half applies exactly once: the batch as soon as the institute store
    // can resolve it, the learner as soon as that batch's list contains them.
    // Without the guards an institute refetch (new `instituteDetails` identity)
    // or a later list change would snap the admin's own picks back to the URL.
    const prefillBatchDone = useRef(false);
    const prefillLearnerDone = useRef(false);
    useEffect(() => {
        if (prefillBatchDone.current) return;
        if (prefill?.courseId && prefill.sessionId && prefill.levelId) {
            const batchId = getPackageSessionId({
                courseId: prefill.courseId,
                sessionId: prefill.sessionId,
                levelId: prefill.levelId,
            });
            if (batchId) {
                setValue('batches', [batchId]);
                prefillBatchDone.current = true;
            }
        } else {
            prefillBatchDone.current = true;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteDetails]);
    useEffect(() => {
        if (prefillLearnerDone.current) return;
        if (prefill?.userId && studentList.some((s) => s.user_id === prefill.userId)) {
            setValue('student', prefill.userId);
            prefillLearnerDone.current = true;
        }
    }, [studentList, prefill?.userId, setValue]);

    const onSubmit = (data: FormValues) => {
        const learner = studentList.find((s) => s.user_id === data.student);
        const batchIds = data.batches.filter((id) => learner?.batchIds.includes(id));
        if (!batchIds.length) {
            toast.error(t('toast.learnerNotInBatches'));
            return;
        }
        setApplied({
            userId: data.student,
            learnerName: learner?.full_name ?? '',
            batchIds,
            runId: Date.now(),
        });
        // The chapter-wise "View details" dialog also reads names from this
        // store; keep the first batch there so its header stays populated.
        const first = batchLookup.get(batchIds[0] ?? '');
        setPacageSessionId(batchIds[0] ?? '');
        setCourse(first?.courseName || '');
        setSession(first?.sessionName || '');
        setLevel(first?.levelName || '');
        setLearnerName(learner?.full_name || '');
    };

    const queries = useQueries({
        queries: (applied?.batchIds ?? []).map((batchId) => ({
            queryKey: ['learnerSubjectWiseProgress', applied?.userId, batchId, applied?.runId],
            queryFn: () =>
                fetchLearnersSubjectWiseProgress({
                    packageSessionId: batchId,
                    userId: applied?.userId ?? '',
                }) as Promise<SubjectProgressResponse | null>,
            staleTime: 5 * 60 * 1000,
        })),
    });
    const isPending = queries.some((q) => q.isLoading);
    const resultsKey = queries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join('|');
    const results = useMemo<BatchResult[]>(
        () =>
            (applied?.batchIds ?? []).map((batchId, index) => ({
                batchId,
                option: batchLookup.get(batchId),
                data: queries[index]?.data,
                isError: Boolean(queries[index]?.isError),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [applied, batchLookup, resultsKey]
    );
    const isMulti = (applied?.batchIds.length ?? 0) > 1;
    const hasAnyData = results.some((r) => r.data?.length);
    const blockTitle = (r: BatchResult) => r.option?.label || r.option?.courseName || '';

    const handleExportPDF = async (result: BatchResult) => {
        if (!result.data || !applied) return;
        setIsExportingPdf(result.batchId);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportSubjectProgressPdf(
                {
                    instituteName: instituteDetails?.institute_name || 'Vacademy',
                    logoUrl,
                    learnerName: applied.learnerName,
                    courseName: result.option?.courseName || '',
                    sessionName: result.option?.sessionName || '',
                    levelName: result.option?.levelName || '',
                    courseTerm,
                    sessionTerm: getTerminology(ContentTerms.Session, SystemTerms.Session),
                    levelTerm: getTerminology(ContentTerms.Level, SystemTerms.Level),
                    moduleTerm,
                    subjectTerm,
                    batchTerm,
                },
                result.data,
                t
            );
            toast.success(t('toast.exportSuccess'));
        } catch {
            toast.error(t('toast.exportFailed'));
        } finally {
            setIsExportingPdf(null);
        }
    };

    const handleExportCsv = () => {
        if (!applied || !hasAnyData) return;
        setIsExportingCsv(true);
        try {
            const csv = buildReportCsv([
                {
                    title: t('csv.title', { term: subjectTerm }),
                    headers: [
                        batchTerm,
                        courseTerm,
                        learnerTerm,
                        subjectTerm,
                        moduleTerm,
                        t('csv.moduleCompleted', { module: moduleTerm }),
                        t('csv.moduleCompletedByBatch', { module: moduleTerm, batch: batchTerm }),
                        t('csv.dailyTimeMin'),
                        t('csv.dailyTimeByBatchMin', { batch: batchTerm }),
                    ],
                    rows: results.flatMap((r) =>
                        (r.data ?? []).flatMap((subject) =>
                            subject.modules.map((module) => [
                                blockTitle(r),
                                r.option?.courseName ?? '',
                                applied.learnerName,
                                subject.subject_name,
                                module.module_name,
                                num(module.module_completion_percentage),
                                num(module.module_completion_percentage_by_batch),
                                num(module.avg_time_spent_minutes),
                                num(module.avg_time_spent_minutes_by_batch),
                            ])
                        )
                    ),
                },
            ]);
            downloadCsv(csvFileName(t('csv.fileStem'), applied.learnerName), csv);
            toast.success(t('toast.csvExportSuccess'));
        } catch {
            toast.error(t('toast.csvExportFailed'));
        } finally {
            setIsExportingCsv(false);
        }
    };

    const exportPdfButton = (result: BatchResult) => (
        <MyButton
            buttonType="secondary"
            onClick={() => handleExportPDF(result)}
            className="h-9 px-4 text-body"
            disable={isExportingPdf === result.batchId}
        >
            <Export className="me-1.5 size-4" />
            {isExportingPdf === result.batchId ? t('report.exporting') : t('report.exportPdf')}
        </MyButton>
    );

    return (
        <div className="space-y-6">
            {/* Filter card */}
            <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <BatchMultiSelect
                            selected={selectedBatches}
                            onChange={(ids) => {
                                setValue('batches', ids);
                                if (ids.length) clearErrors('batches');
                            }}
                            error={errors.batches?.message}
                        />
                        <div className="flex flex-col gap-1">
                            <label className="text-caption font-medium text-neutral-700">
                                {learnerTerm}
                                <span className="ms-1 text-danger-600">*</span>
                            </label>
                            <SearchableSelect
                                options={studentList.map((s) => ({
                                    label: s.full_name,
                                    value: s.user_id,
                                }))}
                                value={selectedStudent || ''}
                                onChange={(value) => {
                                    setValue('student', value);
                                    clearErrors('student');
                                }}
                                placeholder={
                                    isLearnersLoading
                                        ? t('form.loadingStudents')
                                        : t('form.selectStudent')
                                }
                                searchPlaceholder={t('form.searchStudent')}
                                emptyText={t('form.noStudentsFound')}
                                disabled={!selectedBatches.length || !studentList.length}
                                triggerClassName="h-9 text-body"
                            />
                            {errors.student ? (
                                <span className="text-caption text-danger-600">
                                    {errors.student.message}
                                </span>
                            ) : (
                                <span className="text-caption text-neutral-500">
                                    {selectedBatches.length
                                        ? t('form.learnerHint', { count: studentList.length })
                                        : t('form.pickBatchFirst', {
                                              batch: batchTerm.toLowerCase(),
                                          })}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-start">
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            className="h-9 px-4 text-body font-medium"
                        >
                            {t('form.generateReport')}
                        </MyButton>
                    </div>
                </form>
            </div>

            {isPending && <DashboardLoader />}

            {applied && !isPending && (
                <div className="space-y-6">
                    {/* Report Header */}
                    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-2">
                                <h3 className="text-subtitle font-semibold text-primary-600">
                                    {applied.learnerName}
                                </h3>
                                {isMulti && (
                                    <span className="inline-block rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-neutral-700">
                                        {t('report.batchCount', {
                                            count: results.length,
                                            term: batchTerm,
                                        })}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <ReportRecipientsDialogBox userId={applied.userId} />
                                {!isMulti && results[0]?.data && exportPdfButton(results[0])}
                                <MyButton
                                    buttonType="secondary"
                                    onClick={handleExportCsv}
                                    className="h-9 px-4 text-body"
                                    disable={isExportingCsv || !hasAnyData}
                                >
                                    <FileCsv className="me-1.5 size-4" />
                                    {isExportingCsv ? t('report.exporting') : t('report.exportCsv')}
                                </MyButton>
                            </div>
                        </div>
                    </div>

                    {results.map((result) => {
                        const rows = result.data
                            ? transformToSubjectOverview(
                                  result.data,
                                  applied.userId,
                                  result.batchId,
                                  result.option
                              )
                            : [];
                        const tableState = {
                            columnVisibility: {
                                module_id: false,
                                user_id: false,
                                subject: !isStructuralColumnAllDefault(rows, 'subject'),
                                module: !isStructuralColumnAllDefault(rows, 'module'),
                            },
                        };
                        return (
                            <div
                                key={result.batchId}
                                className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
                            >
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {isMulti && (
                                                <span className="rounded-md bg-primary-50 px-2 py-1 text-caption font-semibold uppercase tracking-wide text-primary-500">
                                                    {batchTerm}
                                                </span>
                                            )}
                                            <h4 className="text-body font-semibold text-primary-600">
                                                {isMulti
                                                    ? blockTitle(result)
                                                    : t('report.subjectWiseHeading')}
                                            </h4>
                                        </div>
                                        {isMulti && result.data?.length
                                            ? exportPdfButton(result)
                                            : null}
                                    </div>
                                    {result.isError || result.data === null ? (
                                        <div className="flex items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-body text-danger-700">
                                            <Warning className="size-5 shrink-0" />
                                            {t('report.batchLoadFailed', {
                                                name: blockTitle(result),
                                            })}
                                        </div>
                                    ) : (
                                        <div className="!min-w-full overflow-x-auto [&_table]:!w-full [&_table]:!min-w-full [&_td]:!whitespace-nowrap [&_th]:!whitespace-nowrap">
                                            <MyTable
                                                data={{
                                                    content: rows,
                                                    total_pages: 0,
                                                    page_no: 0,
                                                    page_size: 10,
                                                    total_elements: 0,
                                                    last: false,
                                                }}
                                                columns={SubjectOverviewColumns}
                                                isLoading={false}
                                                error={null}
                                                currentPage={0}
                                                tableState={tableState}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
