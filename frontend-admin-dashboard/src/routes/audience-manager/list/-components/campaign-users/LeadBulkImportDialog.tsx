import { useRef, useState, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    Download,
    UploadSimple as Upload,
    FileCsv as FileSpreadsheet,
    CheckCircle as CheckCircle2,
    XCircle,
    Warning as AlertTriangle,
    CircleNotch as Loader2,
    CaretDown as ChevronDown,
    CaretUp as ChevronUp,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSTITUTE_USERS } from '@/constants/urls';
import { fetchLeadStatuses } from '@/hooks/use-lead-statuses';
import {
    submitBulkAudienceLead,
    type BulkSubmitLeadResponse,
    type BulkSubmitLeadResultItem,
} from '../../-services/bulk-submit-audience-lead';
import { type SubmitLeadRequest } from '../../-services/submit-audience-lead';
import {
    type CustomFieldConfig,
    type CounsellorOption,
    type OwnerResolution,
    type StatusResolution,
    parseCustomFieldsFromJson,
    generateCsvTemplate,
    buildHeaderToFieldIdMap,
    extractUserInfoFromRow,
    validateRow,
    getMissingMandatoryColumns,
    detectOwnerHeader,
    detectStatusHeader,
    buildCounsellorResolver,
    buildStatusResolver,
    resolveOwner,
    resolveStatus,
} from '../../-utils/lead-bulk-import-utils';
import { useGetCampaignById } from '../../-hooks/useGetCampaignById';
import { cn } from '@/lib/utils';

const BATCH_SIZE = 1000;

/**
 * Institute counsellors/admins/teachers, including email, so owners resolve by email or name.
 * No status filter (matches the assign-counsellor picker — INVITED/inactive staff are still valid
 * owners), and pages through the whole staff list so a large directory isn't truncated and a real
 * counsellor never shows up as "unknown".
 */
async function fetchCounsellorOptions(instituteId: string): Promise<CounsellorOption[]> {
    const all: CounsellorOption[] = [];
    const pageSize = 1000;
    for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
        const { data } = await authenticatedAxiosInstance({
            method: 'POST',
            url: GET_INSTITUTE_USERS,
            params: { instituteId, pageNumber, pageSize },
            data: { roles: ['COUNSELLOR', 'ADMIN', 'TEACHER'] },
        });
        const content = Array.isArray(data) ? data : data?.content || [];
        for (const u of content as Array<Record<string, unknown>>) {
            all.push({
                id: u.id as string,
                full_name: (u.full_name as string) || '',
                email: (u.email as string) || undefined,
            });
        }
        // Stop at the last page, a short/empty page, or a non-paged response.
        if (Array.isArray(data) || data?.last === true || content.length < pageSize) break;
    }
    return all;
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

type Step = 'upload' | 'preview' | 'results';

interface ParsedRow {
    raw: Record<string, string>;
    /** Custom-field validation errors. Owner/status errors are merged in at resolve time. */
    baseErrors: string[];
    isDuplicate: boolean;
}

interface ResolvedRow extends ParsedRow {
    owner: OwnerResolution;
    status: StatusResolution;
    errors: string[];
}

interface LeadBulkImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    campaignId: string;
    campaignName: string;
    instituteId: string;
    customFields?: CustomFieldConfig[];
    onSuccess?: () => void;
}

// Large cap to support migrations (e.g. tens of thousands of leads). Rows are submitted
// to the backend in batches of BATCH_SIZE rather than one giant request.
const MAX_ROWS = 100000;

export function LeadBulkImportDialog({
    open,
    onOpenChange,
    campaignId,
    campaignName,
    instituteId,
    customFields: customFieldsProp = [],
    onSuccess,
}: LeadBulkImportDialogProps) {
    const { t, i18n } = useTranslation(['audienceManagerLeadBulkImportDialog', 'audienceManagerLeadBulkImportUtils']);
    const { t: tBulkSubmitLead } = useTranslation('audienceManagerBulkSubmitAudienceLead');
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch campaign details to get custom fields when not provided via props
    const needsFetch = customFieldsProp.length === 0;
    const { data: fetchedCampaign, isLoading: isFetchingCampaign } = useGetCampaignById({
        instituteId,
        audienceId: campaignId,
        enabled: open && needsFetch,
    });

    const fetchedFields = useMemo(() => {
        if (!fetchedCampaign?.institute_custom_fields) return [];
        return parseCustomFieldsFromJson(JSON.stringify(fetchedCampaign.institute_custom_fields));
    }, [fetchedCampaign]);

    const customFields = customFieldsProp.length > 0 ? customFieldsProp : fetchedFields;

    const [step, setStep] = useState<Step>('upload');
    const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
    const [headerToFieldId, setHeaderToFieldId] = useState<Map<string, string>>(new Map());
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [ownerHeader, setOwnerHeader] = useState<string | null>(null);
    const [statusHeader, setStatusHeader] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitProgress, setSubmitProgress] = useState<{ done: number; total: number } | null>(null);
    const [result, setResult] = useState<BulkSubmitLeadResponse | null>(null);
    const [showErrors, setShowErrors] = useState(false);
    // Mandatory custom-field columns absent from the uploaded file. validateRow only inspects
    // columns that exist, so a mandatory field whose column is missing entirely produces no row
    // error — every row looks valid and the import lands with that field blank for all leads.
    // Tracked here so it can block submission outright rather than only warning.
    const [missingMandatoryCols, setMissingMandatoryCols] = useState<string[]>([]);

    // Counsellor + lead-status catalogs, refetched each time the dialog opens (staleTime 0 +
    // refetchOnMount) so a counsellor or status added moments ago resolves instead of erroring
    // against a stale cache. Used to resolve the optional Lead Owner / Lead Status CSV columns.
    const { data: counsellors = [] } = useQuery({
        queryKey: ['bulk-import-counsellors', instituteId],
        queryFn: () => fetchCounsellorOptions(instituteId),
        enabled: open && !!instituteId,
        staleTime: 0,
        refetchOnMount: 'always',
    });
    const { data: leadStatuses = [] } = useQuery({
        queryKey: ['bulk-import-lead-statuses', instituteId],
        queryFn: fetchLeadStatuses,
        enabled: open,
        staleTime: 0,
        refetchOnMount: 'always',
    });

    const counsellorResolver = useMemo(() => buildCounsellorResolver(counsellors), [counsellors]);
    const statusResolver = useMemo(() => buildStatusResolver(leadStatuses), [leadStatuses]);
    const defaultStatusLabel = useMemo(
        () => leadStatuses.find((s) => s.is_default)?.label,
        [leadStatuses]
    );
    // Maps a resolved status_key back to its human label, so the preview table can show
    // "Interested" instead of the raw backend key.
    const statusLabelByKey = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of leadStatuses) {
            if (s.status_key) map.set(s.status_key, s.label);
        }
        return map;
    }, [leadStatuses]);

    // Re-resolve owner/status whenever the parsed rows or the catalogs change, so resolution
    // is correct even if the file was uploaded before the catalogs finished loading.
    const resolvedRows = useMemo<ResolvedRow[]>(() => {
        return parsedRows.map((pr) => {
            const owner: OwnerResolution = ownerHeader
                ? resolveOwner(pr.raw[ownerHeader] || '', counsellorResolver, t)
                : {};
            const status: StatusResolution = statusHeader
                ? resolveStatus(pr.raw[statusHeader] || '', statusResolver, t)
                : {};
            const errors = [...pr.baseErrors];
            if (owner.error) errors.push(owner.error);
            if (status.error) errors.push(status.error);
            return { ...pr, owner, status, errors };
        });
    }, [parsedRows, ownerHeader, statusHeader, counsellorResolver, statusResolver, t]);

    const validRows = useMemo(
        () => resolvedRows.filter((r) => r.errors.length === 0 && !r.isDuplicate),
        [resolvedRows]
    );
    const errorRows = useMemo(() => resolvedRows.filter((r) => r.errors.length > 0), [resolvedRows]);
    const duplicateRows = useMemo(() => resolvedRows.filter((r) => r.isDuplicate), [resolvedRows]);

    // Every row that won't import (validation error and/or duplicate).
    const invalidRows = useMemo(
        () => resolvedRows.filter((r) => r.errors.length > 0 || r.isDuplicate),
        [resolvedRows]
    );

    // Hard gate on writing anything to the database, reserved for problems that no row survives.
    //
    // A missing mandatory column is file-level: there is no "good" subset to let through, because
    // every lead would be written with that field empty (exactly how a whole list once imported
    // nameless). So it blocks the import outright.
    //
    // Per-row problems deliberately do NOT block — a row that fails validation is skipped and the
    // correct rows still import, which is the point of a bulk upload. Duplicates likewise: first
    // occurrence wins and the rest are skipped.
    const blockReason = useMemo<string | null>(() => {
        if (missingMandatoryCols.length > 0) {
            return t('preview.blocked.reason', {
                count: missingMandatoryCols.length,
                columns: missingMandatoryCols.join(', '),
            });
        }
        return null;
    }, [missingMandatoryCols, t]);

    // Group failures by reason (text before the first ':') with counts, so the admin can see
    // *why* tens of thousands of rows failed at a glance instead of hovering each one.
    const errorSummary = useMemo(() => {
        const duplicateReasonLabel = t('preview.invalidRows.duplicateReasonLabel');
        const counts = new Map<string, number>();
        for (const r of invalidRows) {
            const reasons = new Set(r.errors.map((e) => e.split(':')[0]!.trim()));
            if (r.isDuplicate) reasons.add(duplicateReasonLabel);
            for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [invalidRows, t]);

    const resetState = useCallback(() => {
        setStep('upload');
        setParsedRows([]);
        setHeaderToFieldId(new Map());
        setCsvHeaders([]);
        setOwnerHeader(null);
        setStatusHeader(null);
        setIsSubmitting(false);
        setSubmitProgress(null);
        setResult(null);
        setShowErrors(false);
        setMissingMandatoryCols([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const handleClose = useCallback(() => {
        resetState();
        onOpenChange(false);
    }, [resetState, onOpenChange]);

    // --- Step 1: Download Template ---
    const handleDownloadTemplate = useCallback(() => {
        const csv = generateCsvTemplate(customFields, t, { statusSample: defaultStatusLabel });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${campaignName.replace(/[^a-zA-Z0-9]/g, '_')}_template.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }, [customFields, campaignName, defaultStatusLabel, t]);

    // --- Download a report of every row that won't import, with its reason(s) ---
    const downloadErrorReport = useCallback(() => {
        const bad = resolvedRows.filter((r) => r.errors.length > 0 || r.isDuplicate);
        if (bad.length === 0) return;
        const escape = (v: string) =>
            /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        const headers = [...csvHeaders, t('preview.invalidRows.reportColumnHeader')];
        const lines = [headers.map(escape).join(',')];
        const duplicateReasonLabel = t('preview.invalidRows.duplicateReasonLabel');
        for (const r of bad) {
            const reasons = r.isDuplicate ? [...r.errors, duplicateReasonLabel] : r.errors;
            const cells = csvHeaders.map((h) => escape(String(r.raw[h] ?? '')));
            cells.push(escape(reasons.join('; ')));
            lines.push(cells.join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${campaignName.replace(/[^a-zA-Z0-9]/g, '_')}_import_errors.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }, [resolvedRows, csvHeaders, campaignName, t]);

    // --- Step 1: Parse CSV ---
    const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            Papa.parse<Record<string, string>>(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    const data = results.data;

                    if (data.length === 0) {
                        toast.error(t('toasts.csvEmpty'));
                        return;
                    }

                    if (data.length > MAX_ROWS) {
                        toast.error(t('toasts.tooManyRows', { count: data.length, max: MAX_ROWS }));
                        return;
                    }

                    const headers = results.meta.fields || [];
                    setCsvHeaders(headers);

                    const fieldMap = buildHeaderToFieldIdMap(headers, customFields);
                    setHeaderToFieldId(fieldMap);

                    // Detect the optional Lead Owner / Lead Status columns (resolved later).
                    setOwnerHeader(detectOwnerHeader(headers));
                    setStatusHeader(detectStatusHeader(headers));

                    // Check for missing mandatory columns. This is a file-level (structural)
                    // problem, not a per-row one, so it blocks the import entirely — importing
                    // without a mandatory column silently writes every lead with it blank.
                    const missingCols = getMissingMandatoryColumns(fieldMap, customFields);
                    setMissingMandatoryCols(missingCols);
                    if (missingCols.length > 0) {
                        toast.error(
                            t('toasts.missingMandatoryColumns', { columns: missingCols.join(', ') })
                        );
                    }

                    // Validate rows and detect duplicates (owner/status resolution happens in a memo)
                    const seenEmails = new Set<string>();
                    const parsed: ParsedRow[] = data.map((row) => {
                        const baseErrors = validateRow(row, fieldMap, customFields, t);

                        // Deduplicate by email
                        const { email } = extractUserInfoFromRow(row, fieldMap, customFields);
                        const emailKey = email.trim().toLowerCase();
                        let isDuplicate = false;
                        if (emailKey && seenEmails.has(emailKey)) {
                            isDuplicate = true;
                        } else if (emailKey) {
                            seenEmails.add(emailKey);
                        }

                        return { raw: row, baseErrors, isDuplicate };
                    });

                    setParsedRows(parsed);
                    setStep('preview');
                },
                error: (error) => {
                    toast.error(t('toasts.parseFailed', { message: error.message }));
                },
            });
        },
        [customFields, t]
    );

    // --- Step 2: Submit ---
    const handleSubmit = useCallback(async () => {
        // Mirrors the disabled state on the submit button. Kept as its own check so the import
        // cannot be triggered while the file still has unresolved problems.
        if (blockReason) {
            toast.error(t('toasts.cannotImport', { reason: blockReason }));
            return;
        }
        if (validRows.length === 0) {
            toast.error(t('toasts.noValidRows'));
            return;
        }

        setIsSubmitting(true);

        try {
            const rows: SubmitLeadRequest[] = validRows.map((pr) => {
                // Build custom_field_values: { fieldId: value }
                const customFieldValues: Record<string, string> = {};
                for (const [header, fieldId] of headerToFieldId) {
                    const value = (pr.raw[header] || '').trim();
                    if (value) {
                        customFieldValues[fieldId] = value;
                    }
                }

                const { email, phone, fullName } = extractUserInfoFromRow(
                    pr.raw,
                    headerToFieldId,
                    customFields
                );

                const row: SubmitLeadRequest = {
                    audience_id: campaignId,
                    source_type: 'AUDIENCE_CAMPAIGN',
                    source_id: campaignId,
                    custom_field_values: customFieldValues,
                    user_dto: {
                        id: '',
                        username: email || '',
                        email: email || '',
                        full_name: fullName || '',
                        mobile_number: phone || '',
                        date_of_birth: null,
                        gender: '',
                        password: '',
                        roles: [],
                        last_login_time: null,
                        root_user: false,
                    },
                };
                if (pr.owner.counsellorId) {
                    row.counsellor_id = pr.owner.counsellorId;
                    row.counsellor_name = pr.owner.counsellorName;
                }
                if (pr.status.leadStatusKey) {
                    row.lead_status_key = pr.status.leadStatusKey;
                }
                return row;
            });

            // Submit in batches so very large imports don't hit a single huge request.
            const batches = chunk(rows, BATCH_SIZE);
            setSubmitProgress({ done: 0, total: batches.length });

            const summary = { total_requested: 0, successful: 0, failed: 0, skipped: 0 };
            const results: BulkSubmitLeadResultItem[] = [];

            for (let b = 0; b < batches.length; b++) {
                const resp = await submitBulkAudienceLead(
                    {
                        audience_id: campaignId,
                        rows: batches[b]!,
                    },
                    tBulkSubmitLead
                );
                summary.total_requested += resp.summary.total_requested;
                summary.successful += resp.summary.successful;
                summary.failed += resp.summary.failed;
                summary.skipped += resp.summary.skipped;
                const offset = b * BATCH_SIZE;
                for (const r of resp.results) {
                    results.push({ ...r, index: r.index + offset });
                }
                setSubmitProgress({ done: b + 1, total: batches.length });
            }

            setResult({ summary, results });
            setStep('results');

            if (summary.failed === 0 && summary.skipped === 0) {
                toast.success(t('toasts.allImportedSuccess', { count: summary.successful }));
            } else {
                toast.info(
                    t('toasts.importComplete', {
                        success: summary.successful,
                        failed: summary.failed,
                        skipped: summary.skipped,
                    })
                );
            }

            queryClient.invalidateQueries({ queryKey: ['campaignUsers'] });
            onSuccess?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('toasts.submitFailed'));
        } finally {
            setIsSubmitting(false);
        }
    }, [
        blockReason,
        validRows,
        headerToFieldId,
        customFields,
        campaignId,
        queryClient,
        onSuccess,
        t,
    ]);

    return (
        <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
            {/* Preview step needs extra width for the multi-column table */}
            <DialogContent
                className={cn(
                    // Base DialogContent pins a fixed 400px width; override to full width so max-w widens it.
                    'max-h-screen w-full overflow-y-auto transition-all duration-200',
                    step === 'preview' ? 'sm:max-w-6xl' : 'sm:max-w-4xl'
                )}
            >
                {/* Step indicator */}
                <div className="mb-1 flex items-center gap-2">
                    {(['upload', 'preview', 'results'] as Step[]).map((s, idx) => (
                        <div key={s} className="flex items-center gap-2">
                            {idx > 0 && (
                                <div
                                    className={cn(
                                        'h-px w-6 shrink-0',
                                        idx <= (['upload', 'preview', 'results'] as Step[]).indexOf(step)
                                            ? 'bg-primary-500'
                                            : 'bg-border'
                                    )}
                                />
                            )}
                            <div
                                className={cn(
                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption',
                                    s === step
                                        ? 'bg-primary-500 text-white'
                                        : (['upload', 'preview', 'results'] as Step[]).indexOf(s) <
                                            (['upload', 'preview', 'results'] as Step[]).indexOf(step)
                                          ? 'bg-success-500 text-white'
                                          : 'bg-muted text-muted-foreground'
                                )}
                            >
                                {idx + 1}
                            </div>
                            <span
                                className={cn(
                                    'text-caption capitalize',
                                    s === step ? 'font-semibold text-foreground' : 'text-muted-foreground'
                                )}
                            >
                                {t(`steps.${s}`)}
                            </span>
                        </div>
                    ))}
                </div>

                <DialogHeader>
                    <DialogTitle>{t('dialog.title', { campaignName })}</DialogTitle>
                    <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>

                {/* ===== STEP 1: UPLOAD ===== */}
                {step === 'upload' && isFetchingCampaign && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="mr-2 size-5 animate-spin text-muted-foreground" />
                        <span className="text-body text-muted-foreground">
                            {t('loading.campaignFields')}
                        </span>
                    </div>
                )}
                {step === 'upload' && !isFetchingCampaign && customFields.length === 0 && (
                    <div className="py-12 text-center">
                        <FileSpreadsheet className="mx-auto mb-3 size-10 text-muted-foreground" />
                        <p className="text-body font-semibold text-foreground">
                            {t('noCustomFields.title')}
                        </p>
                        <p className="mt-1 text-caption text-muted-foreground">
                            {t('noCustomFields.description')}
                        </p>
                    </div>
                )}
                {step === 'upload' && !isFetchingCampaign && customFields.length > 0 && (
                    <div className="flex flex-col gap-5 py-2">
                        {/* Download template row */}
                        <div className="flex items-center gap-3">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={handleDownloadTemplate}
                            >
                                <Download className="mr-1.5 size-4" />
                                {t('upload.downloadTemplateButton')}
                            </MyButton>
                            <span className="text-caption text-muted-foreground">
                                {t('upload.fieldsCount', { count: customFields.length })}
                            </span>
                        </div>

                        {/* Drop zone */}
                        <div
                            className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-10 transition-colors hover:border-primary-300 hover:bg-primary-50"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                                <Upload className="size-6 text-muted-foreground" />
                            </div>
                            <div className="text-center">
                                <p className="text-body font-semibold text-foreground">
                                    {t('upload.dropzone.cta')}
                                </p>
                                <p className="mt-0.5 text-caption text-muted-foreground">
                                    {t('upload.dropzone.maxRows', { count: MAX_ROWS })}
                                </p>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                        </div>

                        {/* Expected columns hint */}
                        <div className="rounded-md border border-border bg-muted/40 p-4">
                            <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                                {t('upload.expectedColumns.title')}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {customFields.map((f) => (
                                    <span
                                        key={f.id}
                                        className="inline-flex items-center rounded-sm border border-border bg-card px-2 py-0.5 text-caption text-foreground"
                                    >
                                        {f.fieldName}
                                        {f.isMandatory && (
                                            <span className="ml-0.5 text-danger-500">*</span>
                                        )}
                                    </span>
                                ))}
                                <span className="inline-flex items-center rounded-sm border border-info-200 bg-info-50 px-2 py-0.5 text-caption text-info-700">
                                    {t('upload.expectedColumns.leadOwnerChip')}
                                </span>
                                <span className="inline-flex items-center rounded-sm border border-info-200 bg-info-50 px-2 py-0.5 text-caption text-info-700">
                                    {t('upload.expectedColumns.leadStatusChip')}
                                </span>
                            </div>
                            <p className="mt-3 text-caption text-muted-foreground">
                                <span className="font-semibold">
                                    {t('upload.expectedColumns.leadOwnerLabel')}
                                </span>{' '}
                                {t('upload.expectedColumns.andConnector')}{' '}
                                <span className="font-semibold">
                                    {t('upload.expectedColumns.leadStatusLabel')}
                                </span>{' '}
                                {t('upload.expectedColumns.hintSuffix', {
                                    statusExamples:
                                        leadStatuses.length > 0
                                            ? leadStatuses
                                                  .slice(0, 4)
                                                  .map((s) => s.label)
                                                  .join(', ')
                                            : t('upload.expectedColumns.defaultStatusExamples'),
                                    defaultStatus:
                                        defaultStatusLabel ||
                                        t('upload.expectedColumns.defaultStatusFallback'),
                                })}
                            </p>
                        </div>
                    </div>
                )}

                {/* ===== STEP 2: PREVIEW ===== */}
                {step === 'preview' && (
                    <div className="flex flex-col gap-5 py-2">
                        {/* Summary stat tiles */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatTile
                                label={t('preview.statTiles.totalRows')}
                                value={parsedRows.length}
                                icon={<FileSpreadsheet className="size-4" />}
                            />
                            <StatTile
                                label={t('preview.statTiles.valid')}
                                value={validRows.length}
                                icon={<CheckCircle2 className="size-4" />}
                                variant="success"
                            />
                            <StatTile
                                label={t('preview.statTiles.errors')}
                                value={errorRows.length}
                                icon={<XCircle className="size-4" />}
                                variant={errorRows.length > 0 ? 'danger' : 'neutral'}
                            />
                            <StatTile
                                label={t('preview.statTiles.duplicates')}
                                value={duplicateRows.length}
                                icon={<AlertTriangle className="size-4" />}
                                variant={duplicateRows.length > 0 ? 'warning' : 'neutral'}
                            />
                        </div>

                        {/* Error breakdown — why rows failed (grouped) + downloadable report.
                            Critical for large files where failing rows aren't in the first 100. */}
                        {blockReason && (
                            <div className="rounded-md border border-danger-300 bg-danger-50 p-4">
                                <p className="text-body font-semibold text-danger-700">
                                    {t('preview.blocked.title', { reason: blockReason })}
                                </p>
                                <p className="mt-1.5 text-caption text-danger-600">
                                    {t('preview.blocked.descriptionPrefix')}{' '}
                                    <span className="font-semibold">
                                        {missingMandatoryCols.join(', ')}
                                    </span>
                                    {t('preview.blocked.descriptionSuffix', {
                                        count: missingMandatoryCols.length,
                                    })}
                                </p>
                            </div>
                        )}

                        {invalidRows.length > 0 && (
                            <div className="rounded-md border border-danger-200 bg-danger-50 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <p className="text-body font-semibold text-danger-700">
                                        {t('preview.invalidRows.count', {
                                            count: invalidRows.length,
                                            formatted: invalidRows.length.toLocaleString(i18n.language),
                                        })}
                                    </p>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={downloadErrorReport}
                                    >
                                        <Download className="mr-1.5 size-4" />
                                        {t('preview.invalidRows.downloadReportButton')}
                                    </MyButton>
                                </div>
                                <div className="flex flex-col gap-1">
                                    {errorSummary.map(([reason, count]) => (
                                        <div
                                            key={reason}
                                            className="flex items-center justify-between gap-4 text-caption text-danger-700"
                                        >
                                            <span className="truncate" title={reason}>
                                                {reason}
                                            </span>
                                            <span className="shrink-0 font-semibold">
                                                {count.toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-3 text-caption text-danger-600">
                                    {t('preview.invalidRows.note')}
                                </p>
                            </div>
                        )}

                        {/* Column mapping */}
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
                            <p className="mb-1.5 text-caption font-medium text-muted-foreground">
                                {t('preview.columnMapping.title')}{' '}
                                <span className="text-foreground">
                                    {t('preview.columnMapping.mappedCount', {
                                        mapped: headerToFieldId.size,
                                        total: csvHeaders.length,
                                    })}
                                </span>
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {csvHeaders.map((h) => {
                                    const isSpecial = h === ownerHeader || h === statusHeader;
                                    const mapped = headerToFieldId.has(h) || isSpecial;
                                    return (
                                        <span
                                            key={h}
                                            className={cn(
                                                'inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs leading-none',
                                                isSpecial
                                                    ? 'bg-info-50 text-info-700'
                                                    : mapped
                                                      ? 'bg-success-50 text-success-700'
                                                      : 'bg-danger-50 text-danger-700'
                                            )}
                                        >
                                            {h}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Preview table */}
                        <div className="overflow-hidden rounded-md border border-border">
                            <div className="max-h-72 overflow-auto">
                                <table className="w-full text-caption">
                                    <thead className="sticky top-0 z-10 bg-muted">
                                        <tr>
                                            <th className="border-b border-border px-3 py-2 text-left font-semibold text-muted-foreground">
                                                {t('preview.table.rowNumberHeader')}
                                            </th>
                                            <th className="border-b border-border px-3 py-2 text-left font-semibold text-muted-foreground">
                                                {t('preview.table.statusHeader')}
                                            </th>
                                            {csvHeaders
                                                .filter((h) => headerToFieldId.has(h))
                                                .map((h) => (
                                                    <th
                                                        key={h}
                                                        className="border-b border-border px-3 py-2 text-left font-semibold text-muted-foreground"
                                                    >
                                                        {h}
                                                    </th>
                                                ))}
                                            {ownerHeader && (
                                                <th className="border-b border-border px-3 py-2 text-left font-semibold text-info-700">
                                                    {t('preview.table.ownerColumnHeader')}
                                                </th>
                                            )}
                                            {statusHeader && (
                                                <th className="border-b border-border px-3 py-2 text-left font-semibold text-info-700">
                                                    {t('preview.table.statusColumnHeader')}
                                                </th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {resolvedRows.slice(0, 100).map((pr, i) => {
                                            const hasError = pr.errors.length > 0;
                                            return (
                                                <tr
                                                    key={i}
                                                    className={cn(
                                                        'transition-colors',
                                                        hasError
                                                            ? 'bg-danger-50'
                                                            : pr.isDuplicate
                                                              ? 'bg-warning-50'
                                                              : 'bg-card hover:bg-muted/40'
                                                    )}
                                                >
                                                    <td className="px-3 py-1.5 text-muted-foreground">
                                                        {i + 1}
                                                    </td>
                                                    <td className="px-3 py-1.5">
                                                        {hasError ? (
                                                            <span
                                                                className="cursor-help text-danger-600"
                                                                title={pr.errors.join('; ')}
                                                            >
                                                                <XCircle className="size-3.5" />
                                                            </span>
                                                        ) : pr.isDuplicate ? (
                                                            <span
                                                                className="cursor-help text-warning-600"
                                                                title={t('preview.table.duplicateEmailTooltip')}
                                                            >
                                                                <AlertTriangle className="size-3.5" />
                                                            </span>
                                                        ) : (
                                                            <span className="text-success-600">
                                                                <CheckCircle2 className="size-3.5" />
                                                            </span>
                                                        )}
                                                    </td>
                                                    {csvHeaders
                                                        .filter((h) => headerToFieldId.has(h))
                                                        .map((h) => (
                                                            <td
                                                                key={h}
                                                                className="max-w-40 truncate px-3 py-1.5 text-foreground"
                                                            >
                                                                {pr.raw[h] || ''}
                                                            </td>
                                                        ))}
                                                    {ownerHeader && (
                                                        <td className="max-w-40 truncate px-3 py-1.5">
                                                            {pr.owner.error ? (
                                                                <span
                                                                    className="cursor-help text-danger-600"
                                                                    title={pr.owner.error}
                                                                >
                                                                    {pr.raw[ownerHeader] || ''}{' '}
                                                                    <XCircle className="inline size-3" />
                                                                </span>
                                                            ) : (
                                                                <span className="text-neutral-700">
                                                                    {pr.owner.counsellorName || '—'}
                                                                </span>
                                                            )}
                                                        </td>
                                                    )}
                                                    {statusHeader && (
                                                        <td className="max-w-40 truncate px-3 py-1.5">
                                                            {pr.status.error ? (
                                                                <span
                                                                    className="cursor-help text-danger-600"
                                                                    title={pr.status.error}
                                                                >
                                                                    {pr.raw[statusHeader] || ''}{' '}
                                                                    <XCircle className="inline size-3" />
                                                                </span>
                                                            ) : (
                                                                <span className="text-neutral-700">
                                                                    {(pr.status.leadStatusKey &&
                                                                        statusLabelByKey.get(
                                                                            pr.status.leadStatusKey
                                                                        )) ||
                                                                        pr.status.leadStatusKey ||
                                                                        '—'}
                                                                </span>
                                                            )}
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {resolvedRows.length > 100 && (
                                <div className="border-t border-border bg-muted/40 px-3 py-2 text-center text-caption text-muted-foreground">
                                    {t('preview.table.showingFirst100', {
                                        count: resolvedRows.length,
                                        shown: 100,
                                        formatted: resolvedRows.length.toLocaleString(i18n.language),
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer actions */}
                        <div className="flex items-center justify-between border-t border-border pt-4">
                            <MyButton buttonType="secondary" scale="medium" onClick={resetState}>
                                {t('preview.footer.backButton')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                disable={validRows.length === 0 || isSubmitting || !!blockReason}
                                onClick={handleSubmit}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        {submitProgress && submitProgress.total > 1
                                            ? t('preview.footer.submittingBatch', {
                                                  done: submitProgress.done,
                                                  total: submitProgress.total,
                                              })
                                            : t('preview.footer.submittingRows', {
                                                  count: validRows.length,
                                              })}
                                    </>
                                ) : (
                                    <>
                                        <Upload className="mr-2 size-4" />
                                        {t('preview.footer.submitButton', { count: validRows.length })}
                                    </>
                                )}
                            </MyButton>
                        </div>
                    </div>
                )}

                {/* ===== STEP 3: RESULTS ===== */}
                {step === 'results' && result && (
                    <div className="flex flex-col gap-5 py-2">
                        {/* Summary stat tiles */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <SummaryCard
                                label={t('results.summary.total')}
                                value={result.summary.total_requested}
                                icon={<FileSpreadsheet className="size-4" />}
                            />
                            <SummaryCard
                                label={t('results.summary.success')}
                                value={result.summary.successful}
                                icon={<CheckCircle2 className="size-4 text-success-600" />}
                                className="bg-success-50 border-success-200"
                                valueClassName="text-success-700"
                            />
                            <SummaryCard
                                label={t('results.summary.failed')}
                                value={result.summary.failed}
                                icon={<XCircle className="size-4 text-danger-600" />}
                                className="bg-danger-50 border-danger-200"
                                valueClassName="text-danger-700"
                            />
                            <SummaryCard
                                label={t('results.summary.skipped')}
                                value={result.summary.skipped}
                                icon={<AlertTriangle className="size-4 text-warning-600" />}
                                className="bg-warning-50 border-warning-200"
                                valueClassName="text-warning-700"
                            />
                        </div>

                        {/* Error details (collapsible) */}
                        {(result.summary.failed > 0 || result.summary.skipped > 0) && (
                            <div className="rounded-md border border-border">
                                <button
                                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-body font-semibold text-foreground hover:bg-muted/40"
                                    onClick={() => setShowErrors((v) => !v)}
                                >
                                    <span>
                                        {showErrors
                                            ? t('results.hideDetailsButton')
                                            : t('results.showDetailsButton')}
                                    </span>
                                    {showErrors ? (
                                        <ChevronUp className="size-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="size-4 text-muted-foreground" />
                                    )}
                                </button>
                                {showErrors && (
                                    <div className="max-h-52 overflow-auto border-t border-border">
                                        {result.results
                                            .filter((r) => r.status !== 'SUCCESS')
                                            .map((r) => (
                                                <div
                                                    key={r.index}
                                                    className="flex items-start gap-3 border-b border-border px-4 py-2 text-caption last:border-0"
                                                >
                                                    <span className="shrink-0 font-mono text-muted-foreground">
                                                        {t('results.rowLabel', {
                                                            number: r.index + 1,
                                                        })}
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            'shrink-0 font-semibold',
                                                            r.status === 'FAILED'
                                                                ? 'text-danger-600'
                                                                : 'text-warning-600'
                                                        )}
                                                    >
                                                        [{t(`results.statusLabel.${r.status}`)}]
                                                    </span>
                                                    <span className="text-foreground">{r.message}</span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end border-t border-border pt-4">
                            <MyButton buttonType="primary" scale="medium" onClick={handleClose}>
                                {t('results.doneButton')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Stat tile used in the preview summary row */
function StatTile({
    label,
    value,
    icon,
    variant = 'neutral',
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    variant?: 'neutral' | 'success' | 'danger' | 'warning';
}) {
    const variantClasses: Record<string, string> = {
        neutral: 'bg-card border-border',
        success: 'bg-success-50 border-success-200',
        danger: 'bg-danger-50 border-danger-200',
        warning: 'bg-warning-50 border-warning-200',
    };
    const valueClasses: Record<string, string> = {
        neutral: 'text-foreground',
        success: 'text-success-700',
        danger: 'text-danger-700',
        warning: 'text-warning-700',
    };
    const iconClasses: Record<string, string> = {
        neutral: 'text-muted-foreground',
        success: 'text-success-600',
        danger: 'text-danger-600',
        warning: 'text-warning-600',
    };
    return (
        <div
            className={cn(
                'flex flex-col gap-1.5 rounded-md border p-4',
                variantClasses[variant]
            )}
        >
            <div className={cn('flex items-center gap-1.5', iconClasses[variant])}>
                {icon}
                <span className="text-caption text-muted-foreground">{label}</span>
            </div>
            <span className={cn('text-h3-semibold', valueClasses[variant])}>
                {value.toLocaleString()}
            </span>
        </div>
    );
}

function SummaryCard({
    label,
    value,
    icon,
    className = '',
    valueClassName = '',
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    className?: string;
    valueClassName?: string;
}) {
    return (
        <div className={cn('flex flex-col gap-1.5 rounded-md border p-4', className)}>
            <div className="flex items-center gap-1.5 text-muted-foreground">
                {icon}
                <span className="text-caption">{label}</span>
            </div>
            <span className={cn('text-h3-semibold text-foreground', valueClassName)}>
                {value.toLocaleString()}
            </span>
        </div>
    );
}
