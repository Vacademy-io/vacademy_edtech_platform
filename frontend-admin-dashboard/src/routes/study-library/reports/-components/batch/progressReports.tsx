import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { fetchSubjectWiseProgress } from '../../-services/utils';
import { resolveInstituteLogoUrl } from '../live/-utils/instituteLogo';
import { exportSubjectProgressPdf } from '../../-utils/exportSubjectProgressPdf';
import {
    SubjectProgressResponse,
    SubjectOverviewBatchColumns,
    SubjectOverviewBatchColumnType,
} from '../../-types/types';
import { useQueries } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyTable } from '@/components/design-system/table';
import { usePacageDetails } from '../../-store/usePacageDetails';
import { formatToTwoDecimalPlaces, convertMinutesToTimeFormat } from '../../-services/helper';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { toast } from 'sonner';
import { Export, FileCsv, Warning } from '@phosphor-icons/react';
import BatchMultiSelect, { useBatchLookup, type BatchOption } from '../batchMultiSelect';
import { buildReportCsv, csvFileName, downloadCsv, num } from '../../-utils/reportCsv';

const buildFormSchema = (t: TFunction) =>
    z.object({
        batches: z.array(z.string()).min(1, t('validation.batchRequired')),
    });

type FormValues = z.infer<ReturnType<typeof buildFormSchema>>;

interface BatchResult {
    batchId: string;
    option: BatchOption | undefined;
    /** `null` is what the service returns on a failed request. */
    data: SubjectProgressResponse | null | undefined;
    isError: boolean;
}

interface ProgressReportsProps {
    /**
     * When rendered inside a batch-scoped surface (e.g. Course Details → Reports),
     * the batch is already known — the batch picker is hidden and the report is
     * generated for this package session directly.
     */
    fixedPackageSessionId?: string;
    /** Course id backing `fixedPackageSessionId`, used only to title the report. */
    fixedCourseId?: string;
}

/** Rows for one batch; each carries its batch so "View details" queries the right one. */
const transformToSubjectOverview = (
    data: SubjectProgressResponse,
    batchId: string,
    option: BatchOption | undefined,
    courseName: string
): SubjectOverviewBatchColumnType[] =>
    data.flatMap((subject) =>
        subject.modules.map((module) => ({
            subject: subject.subject_name, // Show subject name in every row
            module: module.module_name,
            module_id: module.module_id,
            module_completed_by_batch: `${formatToTwoDecimalPlaces(
                module.module_completion_percentage_by_batch
            )}%`,
            average_time_spent_by_batch: convertMinutesToTimeFormat(
                module.avg_time_spent_minutes_by_batch ?? 0
            ),
            package_session_id: batchId,
            course_name: courseName,
            session_name: option?.sessionName ?? '',
            level_name: option?.levelName ?? '',
        }))
    );

// Courses shallower than the full Subject → Module structure come back with
// the literal "DEFAULT" placeholder for the missing level(s). Hide any
// structural column whose every row is that placeholder instead of showing
// a whole column of "DEFAULT". Metric columns are never hidden this way.
const isStructuralColumnAllDefault = (
    rows: SubjectOverviewBatchColumnType[],
    key: 'subject' | 'module'
) =>
    rows.length > 0 &&
    rows.every((row) => (row[key] ?? '').toString().trim().toUpperCase() === 'DEFAULT');

export default function ProgressReports({
    fixedPackageSessionId,
    fixedCourseId,
}: ProgressReportsProps = {}) {
    const { t } = useTranslation('studyLibraryBatchProgressReports');
    const isBatchFixed = Boolean(fixedPackageSessionId);
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const { setPacageSessionId, setCourse, setSession, setLevel } = usePacageDetails();
    const courseList = getCourseFromPackage();
    const batchLookup = useBatchLookup();
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const subjectTerm = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
    const moduleTerm = getTerminology(ContentTerms.Modules, SystemTerms.Modules);

    const [appliedBatchIds, setAppliedBatchIds] = useState<string[]>([]);
    // Stamped per "Generate" so re-running the same batch always refetches.
    const [runId, setRunId] = useState(0);
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
        defaultValues: { batches: fixedPackageSessionId ? [fixedPackageSessionId] : [] },
    });
    const selectedBatches = watch('batches');

    const queries = useQueries({
        queries: appliedBatchIds.map((batchId) => ({
            queryKey: ['batchSubjectWiseProgress', batchId, runId],
            queryFn: () =>
                fetchSubjectWiseProgress({
                    packageSessionId: batchId,
                }) as Promise<SubjectProgressResponse | null>,
            staleTime: 5 * 60 * 1000,
        })),
    });
    const isPending = queries.some((q) => q.isLoading);
    const resultsKey = queries.map((q) => `${q.status}:${q.dataUpdatedAt}`).join('|');
    const results = useMemo<BatchResult[]>(
        () =>
            appliedBatchIds.map((batchId, index) => ({
                batchId,
                option: batchLookup.get(batchId),
                data: queries[index]?.data,
                isError: Boolean(queries[index]?.isError),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [appliedBatchIds, batchLookup, resultsKey]
    );
    const isMulti = appliedBatchIds.length > 1;
    const hasAnyData = results.some((r) => r.data?.length);

    const blockTitle = (result: BatchResult) =>
        isBatchFixed
            ? courseList.find((c) => c.id === fixedCourseId)?.name || result.option?.label || ''
            : result.option?.label || result.option?.courseName || '';

    const onSubmit = (data: FormValues) => {
        setAppliedBatchIds(data.batches);
        setRunId(Date.now());
        // The chapter-wise "View details" dialog reads the batch + names from
        // this store; keep the first selection there so it keeps working.
        const first = batchLookup.get(data.batches[0] ?? '');
        setPacageSessionId(data.batches[0] ?? '');
        setCourse(first?.courseName || '');
        setSession(first?.sessionName || '');
        setLevel(first?.levelName || '');
    };

    // Batch is already known (Course Details → Reports): generate straight away.
    useEffect(() => {
        if (fixedPackageSessionId) {
            setAppliedBatchIds([fixedPackageSessionId]);
            setRunId(Date.now());
            setPacageSessionId(fixedPackageSessionId);
        }
    }, [fixedPackageSessionId, setPacageSessionId]);

    const handleExportPDF = async (result: BatchResult) => {
        if (!result.data?.length) {
            toast.error(t('toast.noDataToExport'));
            return;
        }
        setIsExportingPdf(result.batchId);
        try {
            const logoUrl = await resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id);
            await exportSubjectProgressPdf(
                {
                    instituteName: instituteDetails?.institute_name || 'Vacademy',
                    logoUrl,
                    courseName: isBatchFixed
                        ? courseList.find((c) => c.id === fixedCourseId)?.name || ''
                        : result.option?.courseName || '',
                    sessionName: result.option?.sessionName || '',
                    levelName: result.option?.levelName || '',
                    courseTerm,
                    sessionTerm: getTerminology(ContentTerms.Session, SystemTerms.Session),
                    levelTerm: getTerminology(ContentTerms.Level, SystemTerms.Level),
                    moduleTerm,
                    subjectTerm,
                    batchTerm,
                    variant: 'batch',
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
        if (!hasAnyData) {
            toast.error(t('toast.noDataToExport'));
            return;
        }
        setIsExportingCsv(true);
        try {
            const csv = buildReportCsv([
                {
                    title: t('csv.title', { term: subjectTerm }),
                    headers: [
                        batchTerm,
                        courseTerm,
                        subjectTerm,
                        moduleTerm,
                        t('csv.moduleCompletedByBatch', { module: moduleTerm, batch: batchTerm }),
                        t('csv.dailyTimeByBatchMin', { batch: batchTerm }),
                    ],
                    rows: results.flatMap((r) =>
                        (r.data ?? []).flatMap((subject) =>
                            subject.modules.map((module) => [
                                blockTitle(r),
                                r.option?.courseName ?? '',
                                subject.subject_name,
                                module.module_name,
                                num(module.module_completion_percentage_by_batch),
                                num(module.avg_time_spent_minutes_by_batch),
                            ])
                        )
                    ),
                },
            ]);
            downloadCsv(
                csvFileName(
                    t('csv.fileStem'),
                    isMulti ? `${results.length}-${batchTerm}` : blockTitle(results[0]!)
                ),
                csv
            );
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
            {/* Filter card — hidden when the batch is already scoped by the parent */}
            {!isBatchFixed && (
                <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <BatchMultiSelect
                            selected={selectedBatches}
                            onChange={(ids) => {
                                setValue('batches', ids);
                                if (ids.length) clearErrors('batches');
                            }}
                            error={errors.batches?.message}
                        />
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
            )}

            {isPending && <DashboardLoader />}

            {appliedBatchIds.length > 0 && !isPending && (
                <div className="space-y-6">
                    {/* Report Header */}
                    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <h3 className="text-subtitle font-semibold text-primary-600">
                                {isMulti
                                    ? t('report.multiBatchTitle', {
                                          count: results.length,
                                          term: batchTerm,
                                      })
                                    : blockTitle(results[0]!)}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                                {!isMulti && results[0] && exportPdfButton(results[0])}
                                <MyButton
                                    buttonType="secondary"
                                    onClick={handleExportCsv}
                                    className="h-9 px-4 text-body"
                                    disable={isExportingCsv}
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
                                  result.batchId,
                                  result.option,
                                  isBatchFixed
                                      ? courseList.find((c) => c.id === fixedCourseId)?.name || ''
                                      : result.option?.courseName || ''
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
                                                    : t('report.subjectWiseOverview', {
                                                          term: subjectTerm,
                                                      })}
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
                                                columns={SubjectOverviewBatchColumns}
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
