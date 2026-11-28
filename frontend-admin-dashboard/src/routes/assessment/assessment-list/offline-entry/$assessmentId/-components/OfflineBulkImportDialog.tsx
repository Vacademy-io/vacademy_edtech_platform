import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
import i18next from 'i18next';
import {
    CheckCircle,
    Download,
    FileZip,
    UploadSimple,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { Form } from '@/components/ui/form';
import { Progress } from '@/components/ui/progress';
import { useFileUpload } from '@/hooks/use-file-upload';
import { ensureFileHasExtension } from '@/lib/file-download';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import {
    openZipFile,
    type ZipHandle,
} from '@/components/common/study-library/bulk-content-uploading/zip-parser';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { StudentRow } from './StudentSelector';
import {
    bulkImportOfflineEntries,
    fetchBatchLearners,
} from '../-services/offline-entry-services';
import {
    OfflineBulkImportEntry,
    OfflineBulkImportResult,
} from '../-utils/types';
import {
    buildErrorCsv,
    buildManifestCsv,
    buildSampleZip,
    downloadTextFile,
    findManifestPath,
    MANIFEST_COLUMNS,
    parseManifest,
    type ManifestRow,
    type ParsedManifest,
} from '../-utils/bulk-manifest';

type Step = 'PICK' | 'PREVIEW' | 'DONE';

interface RowFailure {
    line: number;
    username: string;
    errors: string[];
}

// A preview of 500 scanned sheets doesn't need 500 rendered rows; problem rows
// are always shown in full since those are the ones that need reading.
const MAX_PREVIEW_ROWS = 100;

const readableError = (error: unknown, fallback: string): string => {
    // Backend rejections carry the admin-facing text in `ex` (ErrorInfo shape).
    const backendMessage = (error as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
    if (backendMessage) return backendMessage;
    if ((error as { message?: string })?.message === 'Network Error') {
        return i18next.t('assessmentOfflineBulkImportDialog:network.unreachable');
    }
    return error instanceof Error && error.message ? error.message : fallback;
};

interface OfflineBulkImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentId: string;
    instituteId: string;
    /** The assessment's batches — the source of the username match set. */
    packageSessionIds: string[];
    /** Lets the caller refresh the student list once marks land. */
    onImported?: () => void;
}

interface ZipForm {
    zip: FileList | null;
}

export const OfflineBulkImportDialog = ({
    open,
    onOpenChange,
    assessmentId,
    instituteId,
    packageSessionIds,
    onImported,
}: OfflineBulkImportDialogProps) => {
    const { t } = useTranslation('assessmentOfflineBulkImportDialog');
    // Bulk import matches on username, which only the batch-learner listing
    // carries — individually registered participants have no username to match
    // against, so they stay on the one-student-at-a-time flow. Fetched here
    // (unpaginated) rather than taken from the picker, which only holds a page.
    const {
        data: matchableStudents = [],
        isLoading: isLoadingStudents,
        error: studentsError,
    } = useQuery({
        queryKey: ['OFFLINE_BULK_MATCH_STUDENTS', instituteId, packageSessionIds.join(',')],
        queryFn: async (): Promise<StudentRow[]> => {
            if (packageSessionIds.length === 0) return [];
            const data = await fetchBatchLearners(instituteId, packageSessionIds, 0, 5000);
            return (data?.content ?? []).map((learner) => ({
                id: learner.user_id,
                name: learner.full_name,
                email: learner.email,
                username: learner.username,
                mobileNumber: learner.phone_number,
                batchName: '',
                batchId: learner.package_session_id,
                status: 'Registered',
                score: null,
                registrationId: null,
                userId: learner.user_id,
                source: 'batch' as const,
            }));
        },
        enabled: open,
        staleTime: 5 * 60 * 1000,
    });
    const students = matchableStudents;

    const [step, setStep] = useState<Step>('PICK');
    const [zipHandle, setZipHandle] = useState<ZipHandle | null>(null);
    const [zipName, setZipName] = useState('');
    const [manifest, setManifest] = useState<ParsedManifest | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState<OfflineBulkImportResult[]>([]);
    // Errors that must survive on screen — a toast is the wrong home for
    // something the admin has to read and act on.
    const [zipError, setZipError] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    // Rows whose files couldn't be uploaded. Collected instead of thrown so one
    // unreadable scan doesn't strand the other 199 rows' uploads in storage.
    const [uploadFailures, setUploadFailures] = useState<RowFailure[]>([]);
    // Entries whose files ARE already uploaded, kept when the bulk request
    // itself fails so "Retry" re-sends them instead of re-uploading everything.
    const [pendingEntries, setPendingEntries] = useState<OfflineBulkImportEntry[] | null>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const form = useForm<ZipForm>({ defaultValues: { zip: null } });
    const { uploadFile } = useFileUpload();
    const adminUserId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    const reset = async () => {
        await zipHandle?.close().catch(() => undefined);
        setZipHandle(null);
        setZipName('');
        setManifest(null);
        setResults([]);
        setProgress({ done: 0, total: 0 });
        setZipError(null);
        setImportError(null);
        setUploadFailures([]);
        setPendingEntries(null);
        setStep('PICK');
        form.reset();
    };

    const handleChooseAnotherFile = () => {
        void reset();
    };

    const handleOpenChange = (next: boolean) => {
        if (isBusy) return; // never tear down mid-upload
        onOpenChange(next);
        if (!next) void reset();
    };

    // Both downloads report failure on screen, not just as a toast: a template
    // that silently never downloads looks identical to a browser that blocked it.
    const handleDownloadCsv = () => {
        setZipError(null);
        try {
            downloadTextFile(buildManifestCsv(students), 'manifest.csv', 'text/csv;charset=utf-8;');
        } catch (error) {
            console.error('Failed to build the CSV template:', error);
            setZipError(readableError(error, t('errors.couldNotBuildCsvTemplate')));
        }
    };

    const handleDownloadSampleZip = async () => {
        setZipError(null);
        try {
            const blob = await buildSampleZip(students);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'offline-entry-sample.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to build the sample zip:', error);
            setZipError(readableError(error, t('errors.couldNotBuildSampleZip')));
        }
    };

    const handleZipSelected = async (file: File) => {
        setIsBusy(true);
        setZipError(null);
        try {
            const looksLikeZip =
                file.name.toLowerCase().endsWith('.zip') ||
                file.type === 'application/zip' ||
                file.type === 'application/x-zip-compressed';
            if (!looksLikeZip) {
                throw new Error(t('validation.notZip', { fileName: file.name }));
            }
            if (file.size === 0) {
                throw new Error(t('validation.emptyZip', { fileName: file.name }));
            }

            // Refuse to match against an empty/failed student list — otherwise every
            // row reports "no student with this username" and an outage looks
            // exactly like a file full of bad roll numbers.
            if (studentsError) {
                throw new Error(t('validation.studentsNotLoaded'));
            }
            if (students.length === 0) {
                throw new Error(t('validation.noBatchLearners'));
            }

            await zipHandle?.close().catch(() => undefined);
            const handle = await openZipFile(file);

            const manifestPath = findManifestPath(handle);
            if (!manifestPath) {
                await handle.close().catch(() => undefined);
                throw new Error(t('validation.noManifestFound'));
            }

            const csvText = await handle.readText(manifestPath);
            if (!csvText.trim()) {
                await handle.close().catch(() => undefined);
                throw new Error(t('validation.manifestEmpty', { manifestPath }));
            }

            const parsed = parseManifest(csvText, handle, students);
            if (parsed.rows.length === 0 && parsed.fatalErrors.length === 0) {
                await handle.close().catch(() => undefined);
                throw new Error(t('validation.manifestNoDataRows', { manifestPath }));
            }

            setZipHandle(handle);
            setZipName(file.name);
            setManifest(parsed);
            setStep('PREVIEW');
        } catch (error) {
            console.error('Failed to read the zip:', error);
            setZipError(readableError(error, t('errors.couldNotReadZip')));
        } finally {
            setIsBusy(false);
        }
    };

    // Uploads every referenced PDF, then sends one bulk request. Files upload
    // row by row so a huge batch never holds more than one PDF in memory.
    const handleImport = async () => {
        if (!zipHandle || !manifest || manifest.validRows.length === 0) return;

        const fileCount = manifest.validRows.reduce(
            (total, row) =>
                total +
                [row.studentPath, row.checkedPath, row.reportPath].filter(Boolean).length,
            0
        );
        setIsBusy(true);
        setImportError(null);

        try {
            let entries = pendingEntries;
            let failures: RowFailure[] = uploadFailures;

            // Skip straight to the send on a retry — the files are already in
            // storage, so re-uploading them would only create duplicates.
            if (entries) {
                // Nothing is uploading this time round; a stale full bar would
                // read as "uploading" while the request is in flight.
                setProgress({ done: 0, total: 0 });
            } else {
                setProgress({ done: 0, total: fileCount });
                failures = [];
                const built: OfflineBulkImportEntry[] = [];
                let uploaded = 0;

                for (const row of manifest.validRows) {
                    const uploadSlot = async (path: string | null) => {
                        if (!path) return undefined;
                        const name = path.split('/').pop() ?? path;
                        const extracted = await zipHandle.extractFile(path, name);
                        const fileId = await uploadFile({
                            file: ensureFileHasExtension(extracted),
                            // The dialog owns the progress bar; letting the uploader
                            // drive the busy flag would clear it after the first file.
                            setIsUploading: () => {},
                            userId: adminUserId,
                            source: instituteId,
                            sourceId: 'ASSESSMENT_OFFLINE_ENTRY',
                        });
                        if (!fileId) throw new Error(t('errors.uploadNoFileId', { name }));
                        uploaded += 1;
                        setProgress({ done: uploaded, total: fileCount });
                        return fileId as string;
                    };

                    const student = row.student as StudentRow;
                    try {
                        built.push({
                            row_label: `Line ${row.line}`,
                            ...(student.registrationId
                                ? { registration_id: student.registrationId }
                                : {
                                      user_id: student.userId,
                                      full_name: student.name,
                                      email: student.email,
                                      username: student.username,
                                      mobile_number: student.mobileNumber,
                                      batch_id: student.batchId,
                                  }),
                            username: student.username,
                            ...(row.totalMarks !== null ? { total_marks: row.totalMarks } : {}),
                            student_file_id: await uploadSlot(row.studentPath),
                            checked_file_id: await uploadSlot(row.checkedPath),
                            report_file_id: await uploadSlot(row.reportPath),
                        });
                    } catch (rowError) {
                        // Drop just this student. Aborting here would leave every
                        // already-uploaded PDF orphaned in storage with nothing
                        // imported — the admin would have to redo the entire batch.
                        console.error(`Row ${row.line} failed to upload:`, rowError);
                        failures.push({
                            line: row.line,
                            username: row.username,
                            errors: [readableError(rowError, t('errors.fileUploadFailed'))],
                        });
                    }
                }

                entries = built;
                setUploadFailures(failures);
                // Bank the uploaded file ids BEFORE the send, so a failed request
                // can be retried without re-uploading (and re-duplicating) files.
                setPendingEntries(built);
            }

            if (entries.length === 0) {
                setImportError(t('errors.noRowsUploaded'));
                return;
            }

            const response = await bulkImportOfflineEntries(assessmentId, instituteId, { entries });

            // Uploads succeeded and the server accepted them — clear the retry
            // buffer so closing and reopening starts genuinely fresh.
            setPendingEntries(null);
            setResults(response?.results ?? []);
            setStep('DONE');

            const failed = (response?.failure_count ?? 0) + failures.length;
            if (failed > 0) {
                toast.warning(
                    t('toasts.importedWithFailures', {
                        success: response?.success_count ?? 0,
                        count: manifest.validRows.length,
                        failed,
                    })
                );
            } else {
                toast.success(
                    t('toasts.importedSuccess', { count: response?.success_count ?? 0 })
                );
            }
            onImported?.();
        } catch (error) {
            console.error('Bulk import failed:', error);
            setImportError(readableError(error, t('errors.bulkImportFailed')));
        } finally {
            setIsBusy(false);
        }
    };

    // Every way a row can fail ends up in one file the admin can fix and
    // re-upload: rejected by validation, failed to upload, or rejected by the
    // server. Splitting these across three places would guarantee one gets missed.
    const allFailures = (): RowFailure[] => {
        const invalid = (manifest?.rows ?? [])
            .filter((row) => row.errors.length > 0)
            .map((row) => ({ line: row.line, username: row.username, errors: row.errors }));
        const rejected = results
            .filter((result) => result.status === 'FAILED')
            .map((result) => ({
                line: Number(result.row_label?.replace(/\D/g, '') || 0),
                username: result.username ?? '',
                errors: [result.message ?? t('errors.importFailedGeneric')],
            }));
        return [...invalid, ...uploadFailures, ...rejected].sort((a, b) => a.line - b.line);
    };

    const failureCount = allFailures().length;

    // How many PDFs the import will actually upload. Zero here with files sitting
    // in the zip is the failure mode that shipped: marks imported, scans dropped.
    const attachedCount = (manifest?.validRows ?? []).reduce(
        (total, row) =>
            total + [row.studentPath, row.checkedPath, row.reportPath].filter(Boolean).length,
        0
    );

    const handleDownloadErrors = () => {
        const failures = allFailures();
        if (failures.length === 0) {
            toast.info(t('toasts.noProblemsToDownload'));
            return;
        }
        try {
            downloadTextFile(
                buildErrorCsv(failures),
                'bulk-import-problems.csv',
                'text/csv;charset=utf-8;'
            );
        } catch (error) {
            console.error('Failed to build the problems CSV:', error);
            setImportError(readableError(error, t('errors.couldNotBuildProblemsCsv')));
        }
    };

    const validCount = manifest?.validRows.length ?? 0;

    return (
        <MyDialog
            open={open}
            onOpenChange={handleOpenChange}
            heading={t('dialog.heading')}
            dialogWidth="max-w-4xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        disable={isBusy}
                        onClick={() => handleOpenChange(false)}
                    >
                        {step === 'DONE' ? t('footer.close') : t('footer.cancel')}
                    </MyButton>
                    {step === 'PREVIEW' && (
                        <>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                type="button"
                                disable={isBusy}
                                onClick={handleChooseAnotherFile}
                            >
                                {t('footer.chooseAnotherFile')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                type="button"
                                disable={isBusy || validCount === 0}
                                onAsyncClick={handleImport}
                                loadingText={
                                    pendingEntries ? t('footer.retryingText') : t('footer.importingText')
                                }
                            >
                                {pendingEntries
                                    ? t('footer.retryImport')
                                    : t('footer.importStudents', { count: validCount })}
                            </MyButton>
                        </>
                    )}
                </>
            }
        >
            <div className="flex max-h-screen flex-col gap-4 overflow-y-auto">
                {step === 'PICK' && (
                    <>
                        {studentsError != null && (
                            <ErrorNotice
                                title={t('pick.errors.studentsLoadFailed.title')}
                                detail={t('pick.errors.studentsLoadFailed.detail')}
                            />
                        )}
                        {studentsError == null && !isLoadingStudents && students.length === 0 && (
                            <ErrorNotice
                                title={t('pick.errors.noBatchLearners.title')}
                                detail={t('pick.errors.noBatchLearners.detail')}
                            />
                        )}
                        {zipError && (
                            <ErrorNotice title={t('pick.errors.zipInvalid.title')} detail={zipError} />
                        )}

                        <div className="rounded-lg border border-neutral-200 p-4">
                            <p className="text-body font-medium text-neutral-700">
                                {t('pick.template.title')}
                            </p>
                            <p className="mb-3 text-caption text-neutral-500">
                                {isLoadingStudents
                                    ? t('pick.template.loadingStudents')
                                    : t('pick.template.description', { count: students.length })}
                            </p>
                            <div className="flex flex-wrap gap-3">
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    type="button"
                                    disable={isLoadingStudents}
                                    onClick={handleDownloadCsv}
                                >
                                    <Download className="size-4" /> {t('pick.template.downloadCsv')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    type="button"
                                    disable={isLoadingStudents}
                                    onAsyncClick={handleDownloadSampleZip}
                                    loadingText={t('pick.template.building')}
                                >
                                    <FileZip className="size-4" />{' '}
                                    {t('pick.template.downloadSampleZip')}
                                </MyButton>
                            </div>
                        </div>

                        <div className="rounded-lg border border-neutral-200 p-4">
                            <p className="text-body font-medium text-neutral-700">
                                {t('pick.upload.title')}
                            </p>
                            <p className="mb-3 text-caption text-neutral-500">
                                <Trans
                                    t={t}
                                    i18nKey="pick.upload.description"
                                    components={{
                                        manifest: <span className="font-medium" />,
                                        answers: <span className="font-medium" />,
                                        checked: <span className="font-medium" />,
                                        reports: <span className="font-medium" />,
                                    }}
                                />
                            </p>
                            <Form {...form}>
                                <FileUploadComponent
                                    fileInputRef={fileInputRef}
                                    onFileSubmit={(file) => void handleZipSelected(file)}
                                    control={form.control}
                                    name="zip"
                                    // Deliberately no `acceptedFileTypes` — the
                                    // dropzone discards a non-matching file without
                                    // telling anyone, so dragging in a PDF or a .rar
                                    // did nothing at all. handleZipSelected checks
                                    // it and says what was wrong.
                                    isUploading={isBusy}
                                >
                                    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-300 p-8 text-center hover:border-primary-300">
                                        <UploadSimple className="size-8 text-neutral-400" />
                                        <p className="text-body font-medium text-neutral-700">
                                            {isBusy
                                                ? t('pick.upload.readingZip')
                                                : t('pick.upload.clickOrDrag')}
                                        </p>
                                        <p className="text-caption text-neutral-400">
                                            {t('pick.upload.zipOnly')}
                                        </p>
                                    </div>
                                </FileUploadComponent>
                            </Form>
                        </div>
                    </>
                )}

                {step === 'PREVIEW' && manifest && (
                    <>
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-caption text-neutral-500">{zipName}</span>
                            <span className="flex items-center gap-1 text-caption text-success-600">
                                <CheckCircle className="size-4" /> {t('preview.readyCount', { count: validCount })}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {t('preview.pdfsToUpload', { count: attachedCount })}
                            </span>
                            {failureCount > 0 && (
                                <>
                                    <span className="flex items-center gap-1 text-caption text-danger-600">
                                        <XCircle className="size-4" />{' '}
                                        {t('preview.problemsCount', { count: failureCount })}
                                    </span>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        type="button"
                                        onClick={handleDownloadErrors}
                                    >
                                        {t('preview.downloadProblemsCsv')}
                                    </MyButton>
                                </>
                            )}
                        </div>

                        {manifest.fatalErrors.length > 0 && (
                            <ErrorNotice
                                title={t('preview.errors.manifestInvalid.title')}
                                detail={manifest.fatalErrors.join(' ')}
                            />
                        )}

                        {importError && (
                            <ErrorNotice
                                title={t('preview.errors.importFailed.title')}
                                detail={
                                    pendingEntries
                                        ? `${importError} ${t('preview.errors.importFailed.retryNote')}`
                                        : importError
                                }
                            />
                        )}

                        {uploadFailures.length > 0 && (
                            <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
                                <p className="text-caption font-medium text-danger-700">
                                    {t('preview.uploadFailures.header', { count: uploadFailures.length })}
                                </p>
                                {uploadFailures.slice(0, 5).map((failure) => (
                                    <p key={failure.line} className="text-caption text-danger-600">
                                        {t('preview.uploadFailures.lineDetail', {
                                            line: failure.line,
                                            username: failure.username,
                                            errors: failure.errors.join('; '),
                                        })}
                                    </p>
                                ))}
                                {uploadFailures.length > 5 && (
                                    <p className="text-caption text-danger-600">
                                        {t('preview.uploadFailures.andMore', {
                                            count: uploadFailures.length - 5,
                                        })}
                                    </p>
                                )}
                            </div>
                        )}

                        {validCount === 0 && manifest.fatalErrors.length === 0 && (
                            <ErrorNotice
                                title={t('preview.errors.noRowsReady.title')}
                                detail={t('preview.errors.noRowsReady.detail')}
                            />
                        )}

                        <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
                            <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                            <div className="text-caption text-warning-700">
                                {manifest.validRows.some((row) => row.totalMarks !== null) && (
                                    <p>{t('preview.warnings.marksReleased')}</p>
                                )}
                                {/* Each import creates a fresh attempt (same as entering a
                                    student by hand), so a full re-upload double-enters
                                    everyone rather than correcting them. */}
                                <p>{t('preview.warnings.newAttempt')}</p>
                            </div>
                        </div>

                        {manifest.unrecognizedHeaders.length > 0 && (
                            <div className="rounded-lg border border-neutral-200 p-3">
                                <p className="text-caption font-medium text-neutral-700">
                                    {t('preview.ignoredColumns.header', {
                                        columns: manifest.unrecognizedHeaders.join(', '),
                                    })}
                                </p>
                                <p className="mt-1 text-caption text-neutral-400">
                                    {t('preview.ignoredColumns.hint', {
                                        columns: MANIFEST_COLUMNS.join(', '),
                                    })}
                                </p>
                            </div>
                        )}

                        {/* Loud, not grey: a zip full of scans that nothing points
                            at means the marks import but every PDF is dropped —
                            exactly the silent failure this warns about. */}
                        {manifest.unreferencedFiles.length > 0 && (
                            <div
                                className={cn(
                                    'rounded-lg border p-3',
                                    attachedCount === 0
                                        ? 'border-warning-200 bg-warning-50'
                                        : 'border-neutral-200'
                                )}
                            >
                                <p
                                    className={cn(
                                        'text-caption font-medium',
                                        attachedCount === 0
                                            ? 'text-warning-700'
                                            : 'text-neutral-700'
                                    )}
                                >
                                    {t('preview.unreferencedFiles.header', {
                                        count: manifest.unreferencedFiles.length,
                                    })}
                                    {attachedCount === 0 &&
                                        t('preview.unreferencedFiles.noFileAttachedSuffix')}
                                </p>
                                <p className="mt-1 text-caption text-neutral-500">
                                    <Trans
                                        t={t}
                                        i18nKey="preview.unreferencedFiles.hint"
                                        components={{
                                            answers: <span className="font-medium" />,
                                            checked: <span className="font-medium" />,
                                            reports: <span className="font-medium" />,
                                        }}
                                    />
                                </p>
                                <p className="mt-1 truncate text-caption text-neutral-400">
                                    {manifest.unreferencedFiles.slice(0, 5).join(', ')}
                                    {manifest.unreferencedFiles.length > 5 ? ', …' : ''}
                                </p>
                            </div>
                        )}

                        <PreviewTable rows={manifest.rows} />

                        {isBusy && progress.total > 0 && (
                            <div className="flex flex-col gap-1">
                                <Progress
                                    value={(progress.done / progress.total) * 100}
                                    className="h-2"
                                />
                                <p className="text-caption text-neutral-500">
                                    {t('preview.progress.uploading', {
                                        done: progress.done,
                                        total: progress.total,
                                    })}
                                </p>
                            </div>
                        )}
                    </>
                )}

                {step === 'DONE' && (
                    <div className="flex flex-col gap-3">
                        {importError && (
                            <ErrorNotice title={t('done.errors.somethingWrong.title')} detail={importError} />
                        )}
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="flex items-center gap-1 text-body text-success-600">
                                <CheckCircle className="size-5" />
                                {t('done.importedCount', {
                                    count: results.filter((r) => r.status === 'SUCCESS').length,
                                })}
                            </span>
                            {/* Counts rows the server rejected AND rows whose files
                                never uploaded — the latter never reach the server,
                                so results alone would under-report the damage. */}
                            {failureCount > 0 && (
                                <>
                                    <span className="flex items-center gap-1 text-body text-danger-600">
                                        <XCircle className="size-5" />
                                        {t('done.notImportedCount', { count: failureCount })}
                                    </span>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        type="button"
                                        onClick={handleDownloadErrors}
                                    >
                                        {t('preview.downloadProblemsCsv')}
                                    </MyButton>
                                </>
                            )}
                        </div>
                        {uploadFailures.map((failure) => (
                            <p
                                key={`upload-${failure.line}`}
                                className="text-caption text-danger-600"
                            >
                                {t('preview.uploadFailures.lineDetail', {
                                    line: failure.line,
                                    username: failure.username,
                                    errors: failure.errors.join('; '),
                                })}
                            </p>
                        ))}
                        {results
                            .filter((r) => r.status === 'FAILED')
                            .map((result) => (
                                <p
                                    key={`${result.row_label}-${result.username}`}
                                    className="text-caption text-danger-600"
                                >
                                    {t('done.resultLine', {
                                        rowLabel: result.row_label,
                                        username: result.username,
                                        message: result.message,
                                    })}
                                </p>
                            ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
};

const SlotCell = ({ path, auto }: { path: string | null; auto: boolean }) => {
    const { t } = useTranslation('assessmentOfflineBulkImportDialog');
    return (
        <td className="p-2 text-neutral-500" title={path ?? undefined}>
            {path ? (
                <>
                    ✓{auto && <span className="ms-1 text-neutral-400">{t('slotCell.auto')}</span>}
                </>
            ) : (
                t('common.emptyValue')
            )}
        </td>
    );
};

const ErrorNotice = ({ title, detail }: { title: string; detail: string }) => (
    <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3"
    >
        <WarningCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
        <div>
            <p className="text-caption font-medium text-danger-700">{title}</p>
            <p className="text-caption text-danger-600">{detail}</p>
        </div>
    </div>
);

const PreviewTable = ({ rows }: { rows: ManifestRow[] }) => {
    const { t } = useTranslation('assessmentOfflineBulkImportDialog');
    // Problem rows always render; clean rows are capped so a 500-sheet batch
    // doesn't lock the dialog up just to show 500 identical "Ready" lines.
    const problemRows = rows.filter((row) => row.errors.length > 0);
    const cleanRows = rows.filter((row) => row.errors.length === 0);
    const visible = [...problemRows, ...cleanRows.slice(0, Math.max(0, MAX_PREVIEW_ROWS - problemRows.length))]
        .sort((a, b) => a.line - b.line);
    const hiddenCount = rows.length - visible.length;

    return (
        <div className="flex flex-col gap-1">
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
                {/* w-max + min-w-full: the table keeps its natural width so the wrapper
                    scrolls horizontally on narrow screens instead of squashing columns. */}
                <table className="w-max min-w-full text-caption">
            <thead className="bg-neutral-50 text-left text-neutral-500">
                <tr>
                    <th className="p-2 font-medium">{t('table.headers.line')}</th>
                    <th className="p-2 font-medium">{t('table.headers.student')}</th>
                    <th className="p-2 font-medium">{t('table.headers.marks')}</th>
                    <th className="p-2 font-medium">{t('table.headers.answer')}</th>
                    <th className="p-2 font-medium">{t('table.headers.checked')}</th>
                    <th className="p-2 font-medium">{t('table.headers.report')}</th>
                    <th className="p-2 font-medium">{t('table.headers.status')}</th>
                </tr>
            </thead>
                    <tbody>
                        {visible.map((row) => (
                            <tr
                                key={row.line}
                                className={cn(
                                    'border-t border-neutral-200',
                                    row.errors.length > 0 && 'bg-danger-50'
                                )}
                            >
                                <td className="p-2 text-neutral-500">{row.line}</td>
                                <td className="p-2 text-neutral-700">
                                    {row.student?.name || row.username || t('common.emptyValue')}
                                    <span className="block text-neutral-400">{row.username}</span>
                                </td>
                                <td className="p-2 text-neutral-700">
                                    {row.totalMarks ?? t('common.emptyValue')}
                                </td>
                                {/* "auto" = matched from the zip's folder layout
                                    rather than named in the CSV. */}
                                <SlotCell path={row.studentPath} auto={row.autoMatchedSlots.includes('student')} />
                                <SlotCell path={row.checkedPath} auto={row.autoMatchedSlots.includes('checked')} />
                                <SlotCell path={row.reportPath} auto={row.autoMatchedSlots.includes('report')} />
                                <td className="p-2">
                                    {row.errors.length === 0 ? (
                                        <span className="text-success-600">{t('table.status.ready')}</span>
                                    ) : (
                                        <span className="text-danger-600">
                                            {row.errors.join('; ')}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {hiddenCount > 0 && (
                <p className="text-caption text-neutral-400">
                    {t('table.footerNote', {
                        visible: visible.length,
                        total: rows.length,
                        hidden: hiddenCount,
                        count: hiddenCount,
                    })}
                </p>
            )}
        </div>
    );
};
