import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';
import { Export, FilePdf, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    getAdminParticipants,
    getResultExportColumns,
    handleExportResultCSV,
    handleGetAssessmentTotalMarksData,
    ResultExportCustomFieldColumn,
} from '../-services/assessment-details-services';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { convertToLocalDateTime, extractDateTime } from '@/constants/helper';
import { getBatchNameById } from '../-utils/helper';
import { SubmissionStudentData } from '@/types/assessments/assessment-overview';

interface AssessmentExportCsvDialogProps {
    assessmentId: string;
    instituteId: string | undefined;
    assessmentType: string;
    /** True on the Pending tab: export the learners who never attempted, not the results. */
    notAttempted?: boolean;
    /**
     * The Pending tab's on-screen scope, so the file matches what the admin was looking
     * at when they clicked. Ignored unless notAttempted.
     */
    notAttemptedScope?: { batches: string[]; name: string };
    /**
     * The participants slice currently on screen — 'BATCH_PREVIEW_REGISTRATION',
     * 'ADMIN_PRE_REGISTRATION' or 'OPEN_REGISTRATION'. The participants endpoint rejects
     * anything else with 510 "Invalid Source Request", so it cannot be defaulted here.
     */
    registrationSource: string;
    /** Batch filter in force on screen, so the result sheet matches what is listed. */
    scopedBatches?: Array<{ id: string; name: string }>;
}

const labelForCustomField = (field: ResultExportCustomFieldColumn) =>
    field.field_name?.trim() || field.field_key?.trim() || field.column_label;

/**
 * Export CSV for the submissions tab. The dialog lists every column the file can
 * carry, all ticked by default, so the exported sheet includes that data unless the
 * admin opts out.
 *
 * <p>Which columns are on offer depends on the tab. On Attempted it is the result
 * columns plus the registration-form fields external participants filled in. On
 * Pending it is contact details only — marks, rank and percentage would be blank for
 * a learner who never started, and a zero in a Marks column reads as "sat it and
 * scored nothing".
 */
export const AssessmentExportCsvDialog = ({
    assessmentId,
    instituteId,
    assessmentType,
    notAttempted = false,
    notAttemptedScope,
    registrationSource,
    scopedBatches = [],
}: AssessmentExportCsvDialogProps) => {
    const { t } = useTranslation('assessmentExportCsvDialog');
    const [open, setOpen] = useState(false);
    const [selectedBaseColumns, setSelectedBaseColumns] = useState<string[]>([]);
    const [selectedCustomFieldIds, setSelectedCustomFieldIds] = useState<string[]>([]);
    const [isExporting, setIsExporting] = useState(false);
    const [isBuildingPdf, setIsBuildingPdf] = useState(false);

    const { data: instituteData } = useQuery({ ...useInstituteQuery(), enabled: open });
    const { data: assessmentDetails } = useQuery({
        ...getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' }),
        enabled: open,
    });
    const instituteName = instituteData?.institute_name ?? '';
    const assessmentName = assessmentDetails?.[0]?.saved_data?.name ?? '';
    const batchesForSessions = instituteData?.batches_for_sessions ?? [];

    /**
     * Result Sheet (PDF) — the ranked cohort document. Pulls one large page of attempted
     * submissions (assessments are bounded, and the summary strip already does the same)
     * and lays them out with the shared builder.
     */
    const handleDownloadResultSheet = async () => {
        setIsBuildingPdf(true);
        try {
            const [{ buildResultSheetPdf }, data, marks] = await Promise.all([
                import('../-utils/result-sheet-pdf'),
                getAdminParticipants(assessmentId, instituteId, 0, 1000, {
                    name: '',
                    assessment_type: assessmentType,
                    attempt_type: ['ENDED'],
                    registration_source: registrationSource,
                    batches: scopedBatches,
                    status: ['ACTIVE'],
                    sort_columns: {},
                }),
                handleGetAssessmentTotalMarksData({ assessmentId }).queryFn(),
            ]);

            const rows = (data?.content ?? []).map((r: SubmissionStudentData) => ({
                studentName: r.student_name ?? '',
                email: r.user_email ?? '',
                batch: getBatchNameById(batchesForSessions, r.batch_id) ?? '',
                score: r.score ?? null,
                durationMinutes:
                    typeof r.duration === 'number' ? Math.round(r.duration / 60) : null,
                submittedAt: r.end_time
                    ? extractDateTime(convertToLocalDateTime(r.end_time)).time
                    : null,
            }));

            if (rows.length === 0) {
                toast.error(t('toasts.noSubmissions'));
                return;
            }

            const doc = buildResultSheetPdf(rows, {
                instituteName: instituteName ?? '',
                assessmentName: assessmentName ?? '',
                totalMarks: marks?.total_achievable_marks ?? 0,
            });
            doc.save(`${assessmentName || 'assessment'} - Result Sheet.pdf`);
        } catch (error) {
            console.error('Failed to build the result sheet:', error);
            toast.error(t('toasts.pdfFailed'));
        } finally {
            setIsBuildingPdf(false);
        }
    };

    const columnsQuery = useQuery({
        // notAttempted is part of the key: the two sheets offer different columns, so a
        // cached list from the other tab would tick boxes the file will never contain.
        queryKey: ['RESULT_EXPORT_COLUMNS', instituteId, assessmentId, notAttempted],
        queryFn: () => getResultExportColumns(instituteId, assessmentId, notAttempted),
        enabled: open,
    });

    const baseColumns = useMemo(
        () => columnsQuery.data?.base_columns ?? [],
        [columnsQuery.data?.base_columns]
    );
    const customFields = useMemo(
        () => columnsQuery.data?.custom_fields ?? [],
        [columnsQuery.data?.custom_fields]
    );

    // Every column starts ticked, on each open — the common case is "give me the
    // whole sheet", and a cached column list would otherwise reopen the dialog
    // with the previous export's unticked boxes.
    useEffect(() => {
        if (!open || !columnsQuery.data) return;
        setSelectedBaseColumns(baseColumns);
        setSelectedCustomFieldIds(customFields.map((field) => field.id));
    }, [open, columnsQuery.data, baseColumns, customFields]);

    const toggleBaseColumn = (column: string, checked: boolean) => {
        setSelectedBaseColumns((prev) =>
            checked ? [...prev, column] : prev.filter((item) => item !== column)
        );
    };

    const toggleCustomField = (fieldId: string, checked: boolean) => {
        setSelectedCustomFieldIds((prev) =>
            checked ? [...prev, fieldId] : prev.filter((item) => item !== fieldId)
        );
    };

    const allSelected =
        selectedBaseColumns.length === baseColumns.length &&
        selectedCustomFieldIds.length === customFields.length;

    const handleSelectAll = () => {
        if (allSelected) {
            setSelectedBaseColumns([]);
            setSelectedCustomFieldIds([]);
            return;
        }
        setSelectedBaseColumns(baseColumns);
        setSelectedCustomFieldIds(customFields.map((field) => field.id));
    };

    const selectedColumnCount = selectedBaseColumns.length + selectedCustomFieldIds.length;

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const data = await handleExportResultCSV(
                instituteId,
                assessmentId,
                assessmentType,
                // Column list unavailable → fall back to the full sheet rather
                // than exporting an empty selection.
                columnsQuery.isError ? undefined : selectedCustomFieldIds,
                notAttempted ? notAttemptedScope ?? { batches: [], name: '' } : undefined
            );
            if (!data) {
                toast.error(t('toasts.noData'));
                return;
            }
            const parsed = Papa.parse(data, { header: true, skipEmptyLines: true });
            // Keep the backend's column order, minus whatever the admin unticked.
            // Custom-field columns are already filtered server-side, so only the
            // fixed result columns need dropping here.
            const headers = (parsed.meta.fields ?? []).filter(
                (header) => !baseColumns.includes(header) || selectedBaseColumns.includes(header)
            );
            // unparse(rows, { columns }) yields "" for an empty row set, so an
            // assessment with no submissions would download a blank file instead
            // of the header row telling the admin the sheet is simply empty.
            const csv = parsed.data.length
                ? Papa.unparse(parsed.data, { columns: headers })
                : Papa.unparse({ fields: headers, data: [] });
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                // Name the file after the sheet: two downloads called results_*.csv, one
                // of which is actually the not-attempted list, is a support ticket.
                `${notAttempted ? 'not_attempted' : 'results'}_${assessmentId}_${new Date().toLocaleDateString()}.csv`
            );
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success(t('toasts.exportSuccess'));
            setOpen(false);
        } catch {
            toast.error(t('toasts.exportFailed'));
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            heading={t('dialog.heading')}
            triggerTooltip={t('trigger.tooltip')}
            dialogWidth="max-w-lg"
            trigger={
                <MyButton
                    type="button"
                    scale="small"
                    buttonType="secondary"
                    className="!h-10 !min-w-0 gap-1.5 px-3 font-medium"
                    title={t('trigger.label')}
                    aria-label={t('trigger.label')}
                >
                    <Export size={16} />
                    {t('trigger.label')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-4">
                {columnsQuery.isLoading && <DashboardLoader />}

                {columnsQuery.isError && (
                    <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-caption text-danger-600">
                        <Warning size={16} className="mt-0.5 shrink-0" />
                        <span>{t('errors.columnsLoadFailed')}</span>
                    </div>
                )}

                {!columnsQuery.isLoading && !columnsQuery.isError && (
                    <>
                        <div className="flex items-center justify-between">
                            <p className="text-body text-neutral-600">
                                {t('chooseColumns')}
                            </p>
                            {(baseColumns.length > 0 || customFields.length > 0) && (
                                <button
                                    type="button"
                                    className="text-caption font-medium text-primary-500 hover:text-primary-600"
                                    onClick={handleSelectAll}
                                >
                                    {allSelected ? t('clearAll') : t('selectAll')}
                                </button>
                            )}
                        </div>

                        <div className="flex max-h-80 flex-col gap-4 overflow-y-auto pr-1">
                            {baseColumns.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    <p className="text-caption font-semibold uppercase text-neutral-500">
                                        {t('resultColumns.title')}
                                    </p>
                                    {baseColumns.map((column) => (
                                        <label
                                            key={column}
                                            className="flex cursor-pointer items-center gap-2"
                                        >
                                            <Checkbox
                                                checked={selectedBaseColumns.includes(column)}
                                                onCheckedChange={(checked) =>
                                                    toggleBaseColumn(column, checked === true)
                                                }
                                            />
                                            <span className="text-body text-neutral-600">
                                                {column}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            )}

                            <div className="flex flex-col gap-2">
                                <p className="text-caption font-semibold uppercase text-neutral-500">
                                    {t('registrationFields.title')}
                                </p>
                                {customFields.length === 0 ? (
                                    <p className="text-caption text-neutral-400">
                                        {t('registrationFields.empty')}
                                    </p>
                                ) : (
                                    customFields.map((field) => (
                                        <label
                                            key={field.id}
                                            className="flex cursor-pointer items-center gap-2"
                                        >
                                            <Checkbox
                                                checked={selectedCustomFieldIds.includes(field.id)}
                                                onCheckedChange={(checked) =>
                                                    toggleCustomField(field.id, checked === true)
                                                }
                                            />
                                            <span className="text-body text-neutral-600">
                                                {labelForCustomField(field)}
                                            </span>
                                        </label>
                                    ))
                                )}
                            </div>
                        </div>
                    </>
                )}

                {!columnsQuery.isLoading && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* The ranked cohort sheet — one printable document, as opposed to
                            the CSV (spreadsheet data) or Export Reports (a ZIP of one PDF
                            per student). Column selection does not apply to it: the sheet
                            has a fixed layout. */}
                        {!notAttempted && (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                className="gap-1.5"
                                disable={isBuildingPdf || isExporting}
                                onClick={handleDownloadResultSheet}
                            >
                                <FilePdf size={16} />
                                {isBuildingPdf ? t('buildingPdf') : t('resultSheetButton')}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            scale="medium"
                            buttonType="primary"
                            disable={
                                isExporting || (!columnsQuery.isError && selectedColumnCount === 0)
                            }
                            onClick={handleExport}
                        >
                            {isExporting ? t('exporting') : t('exportCsvButton')}
                        </MyButton>
                    </div>
                )}
            </div>
        </MyDialog>
    );
};

export default AssessmentExportCsvDialog;
