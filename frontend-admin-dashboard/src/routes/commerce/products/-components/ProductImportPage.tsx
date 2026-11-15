import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple, FileArrowUp } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { saveBlob } from '@/lib/save-blob';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceErrorState,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import {
    type DownloadedFile,
    blobErrorMessage,
    downloadImportTemplate,
    downloadJobErrorRows,
    downloadProductExport,
    downloadValidationErrorRows,
    importJobIsRunning,
    importJobPercent,
    startImport,
    validateImport,
} from '@/routes/commerce/-shared/catalogue-api';
import {
    catalogueKeys,
    useImportColumns,
    useImportJob,
} from '@/routes/commerce/-shared/catalogue-hooks';
import {
    IMPORT_MAX_FILE_BYTES,
    IMPORT_MAX_ROWS,
    type ImportIssue,
    type ImportJob,
    type ImportValidation,
} from '@/routes/commerce/-shared/catalogue-types';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';

const ACCEPT = '.csv,.xlsx';
/** Rows of problems drawn on the page; the error-rows file has all of them. */
const ISSUES_SHOWN = 200;
/** Links to created products drawn on the result. */
const CREATED_SHOWN = 10;

type Busy = 'template-xlsx' | 'template-csv' | 'export' | 'validate' | 'commit' | 'error-rows';

/**
 * Import and export, three steps:
 *  1. choose a CSV or Excel file in the fixed template;
 *  2. check it: the server reads every row, writes nothing, and answers what
 *     it would add and update and which products it would leave out;
 *  3. import: a background job with a progress bar. Products with an error
 *     are left out; the others are written.
 * Export gives the same columns, so export, edit, import is the bulk edit.
 * Stock is never changed by an import, and images are not downloaded by it.
 */
export function ProductImportPage() {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage
            navId="commerce-products"
            title={t('import.title')}
            description={t('import.description')}
            backTo={{ to: '/commerce/products', label: t('products.editor.back') }}
        >
            <ImportContent />
        </CommercePage>
    );
}

function ImportContent() {
    const { t } = useTranslation('commerce');
    const queryClient = useQueryClient();
    const fileInput = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState<Busy | null>(null);
    const [validation, setValidation] = useState<ImportValidation | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [started, setStarted] = useState<ImportJob | null>(null);
    const [error, setError] = useState<string | null>(null);

    const polled = useImportJob(jobId);
    const job = polled.data ?? started;
    const running = importJobIsRunning(job);
    const finished = !!job && !running;

    // The list and the editors must show what the job wrote.
    useEffect(() => {
        if (finished) {
            void queryClient.invalidateQueries({ queryKey: catalogueKeys.productsRoot() });
        }
    }, [finished, queryClient]);

    const fail = async (cause: unknown, fallback: string) => {
        const fromBlob = await blobErrorMessage(cause);
        const message = fromBlob ?? readCommerceError(cause, fallback).message;
        setError(message);
        toast.error(message);
    };

    const pick = (picked: File | undefined) => {
        if (!picked) return;
        if (picked.size > IMPORT_MAX_FILE_BYTES) {
            toast.error(t('import.errors.tooLarge'));
            return;
        }
        setFile(picked);
        setValidation(null);
        setJobId(null);
        setStarted(null);
        setError(null);
    };

    const download = async (
        kind: Busy,
        fetchFile: () => Promise<DownloadedFile>,
        fallbackName: string,
        fallbackError: string
    ) => {
        setBusy(kind);
        setError(null);
        try {
            const result = await fetchFile();
            await saveBlob(result.blob, result.filename ?? fallbackName);
        } catch (cause) {
            await fail(cause, fallbackError);
        } finally {
            setBusy(null);
        }
    };

    const validate = async () => {
        if (!file) return;
        setBusy('validate');
        setError(null);
        setJobId(null);
        setStarted(null);
        try {
            setValidation(await validateImport(file));
        } catch (cause) {
            setValidation(null);
            await fail(cause, t('import.errors.validate'));
        } finally {
            setBusy(null);
        }
    };

    const commit = async () => {
        if (!file || !validation) return;
        if (
            validation.products_with_errors > 0 &&
            !window.confirm(
                t('import.commitWithErrorsConfirm', { count: validation.products_with_errors })
            )
        ) {
            return;
        }
        setBusy('commit');
        setError(null);
        try {
            const created = await startImport(file);
            setStarted(created);
            setJobId(created.job_id);
        } catch (cause) {
            await fail(cause, t('import.errors.commit'));
        } finally {
            setBusy(null);
        }
    };

    const writable = validation ? validation.products_total - validation.products_with_errors : 0;
    const canCommit = !!validation && writable > 0 && !job;
    const working = busy === 'validate' || busy === 'commit' || running;

    return (
        <div className="flex flex-col gap-4">
            <SectionCard
                title={t('import.steps.upload.title')}
                description={t('import.steps.upload.description')}
                actions={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            type="button"
                            disable={busy !== null}
                            onClick={() =>
                                void download(
                                    'template-xlsx',
                                    () => downloadImportTemplate('xlsx'),
                                    t('import.templateFileNameXlsx'),
                                    t('import.errors.template')
                                )
                            }
                        >
                            <DownloadSimple size={14} />
                            {t('import.downloadTemplateXlsx')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            type="button"
                            disable={busy !== null}
                            onClick={() =>
                                void download(
                                    'template-csv',
                                    () => downloadImportTemplate('csv'),
                                    t('import.templateFileNameCsv'),
                                    t('import.errors.template')
                                )
                            }
                        >
                            <DownloadSimple size={14} />
                            {t('import.downloadTemplateCsv')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            type="button"
                            disable={busy !== null}
                            onClick={() =>
                                void download(
                                    'export',
                                    () => downloadProductExport(),
                                    t('products.exportFileName'),
                                    t('products.errors.export')
                                )
                            }
                        >
                            <DownloadSimple size={14} />
                            {t('import.exportAll')}
                        </MyButton>
                    </>
                }
            >
                <input
                    ref={fileInput}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(event) => {
                        pick(event.target.files?.[0]);
                        event.target.value = '';
                    }}
                />
                <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4 sm:flex-row sm:items-center">
                    <FileArrowUp size={28} className="shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body text-foreground">
                            {file ? file.name : t('import.noFile')}
                        </span>
                        <span className="text-caption text-muted-foreground">
                            {t('import.fileHint', { rows: IMPORT_MAX_ROWS })}
                        </span>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        disable={working}
                        onClick={() => fileInput.current?.click()}
                    >
                        {file ? t('import.changeFile') : t('import.chooseFile')}
                    </MyButton>
                </div>
                <ul className="flex list-disc flex-col gap-1 ps-5 text-caption text-muted-foreground">
                    <li>{t('import.rules.oneRow')}</li>
                    <li>{t('import.rules.externalRef')}</li>
                    <li>{t('import.rules.noStock')}</li>
                    <li>{t('import.rules.images')}</li>
                </ul>
                <ColumnGuide />
            </SectionCard>

            <SectionCard
                title={t('import.steps.validate.title')}
                description={t('import.steps.validate.description')}
                actions={
                    <MyButton
                        buttonType={canCommit ? 'secondary' : 'primary'}
                        scale="medium"
                        type="button"
                        disable={!file || working}
                        onClick={() => void validate()}
                    >
                        {busy === 'validate'
                            ? t('import.validating')
                            : validation
                              ? t('import.validateAgain')
                              : t('import.validate')}
                    </MyButton>
                }
            >
                {!validation && (
                    <p className="text-caption text-muted-foreground">{t('import.notValidated')}</p>
                )}
                {validation && (
                    <>
                        <Tiles
                            tiles={[
                                ['import.summary.rows', validation.rows_total],
                                ['import.summary.productsToCreate', validation.products_to_create],
                                ['import.summary.productsToUpdate', validation.products_to_update],
                                ['import.summary.variantsToCreate', validation.variants_to_create],
                                ['import.summary.variantsToUpdate', validation.variants_to_update],
                                [
                                    'import.summary.productsWithErrors',
                                    validation.products_with_errors,
                                ],
                                ['import.summary.warnings', validation.warning_count],
                            ]}
                        />
                        {validation.rows_skipped > 0 && (
                            <p className="text-caption text-muted-foreground">
                                {t('import.blankRows', { count: validation.rows_skipped })}
                            </p>
                        )}
                        {validation.error_count === 0 && validation.rows_total > 0 && (
                            <p
                                role="status"
                                className="rounded-md bg-success-50 p-2 text-caption text-success-600"
                            >
                                {t('import.readyToImport')}
                            </p>
                        )}
                        {validation.rows_total === 0 && (
                            <p
                                role="status"
                                className="rounded-md bg-warning-50 p-2 text-caption text-warning-600"
                            >
                                {t('import.noRows')}
                            </p>
                        )}
                        <IssueList
                            issues={validation.issues}
                            truncated={validation.issues_truncated}
                            downloading={busy === 'error-rows'}
                            onDownload={
                                validation.rows_with_errors > 0 && file
                                    ? () =>
                                          void download(
                                              'error-rows',
                                              () => downloadValidationErrorRows(file),
                                              t('import.errorRowsFileName'),
                                              t('import.errors.errorRows')
                                          )
                                    : undefined
                            }
                        />
                    </>
                )}
            </SectionCard>

            <SectionCard
                title={t('import.steps.commit.title')}
                description={t('import.steps.commit.description')}
                actions={
                    canCommit ? (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            type="button"
                            disable={working}
                            onClick={() => void commit()}
                        >
                            {busy === 'commit'
                                ? t('import.starting')
                                : t('import.commit', { count: writable })}
                        </MyButton>
                    ) : null
                }
            >
                {!job && !validation && (
                    <p className="text-caption text-muted-foreground">
                        {t('import.validateFirst')}
                    </p>
                )}
                {!job && validation && validation.products_with_errors > 0 && (
                    <p
                        role="status"
                        className="rounded-md bg-warning-50 p-2 text-caption text-warning-600"
                    >
                        {writable > 0
                            ? t('import.someLeftOut', {
                                  count: validation.products_with_errors,
                                  writable,
                              })
                            : t('import.allHaveErrors')}
                    </p>
                )}
                {job && (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <CommerceStatusChip kind="importJob" value={job.status} />
                            <span className="font-mono text-caption text-muted-foreground">
                                {t('import.jobId', { id: job.job_id })}
                            </span>
                        </div>
                        {running && (
                            <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
                                <Progress
                                    value={importJobPercent(job)}
                                    aria-label={t('import.progressLabel')}
                                    className="h-2 border border-border"
                                />
                                <span className="text-caption tabular-nums text-muted-foreground">
                                    {job.rows_total > 0
                                        ? t('import.progress', {
                                              done: job.rows_done + job.rows_failed,
                                              total: job.rows_total,
                                          })
                                        : t('import.waiting')}
                                </span>
                            </div>
                        )}
                        {polled.isError && (
                            <CommerceErrorState
                                message={
                                    readCommerceError(polled.error, t('import.errors.progress'))
                                        .message
                                }
                                onRetry={() => void polled.refetch()}
                            />
                        )}
                        {job.status === 'FAILED' && (
                            <CommerceErrorState
                                message={job.failure_message ?? t('import.errors.commit')}
                            />
                        )}
                        {finished && (
                            <>
                                <Tiles
                                    tiles={[
                                        ['import.summary.productsCreated', job.products_created],
                                        ['import.summary.productsUpdated', job.products_updated],
                                        ['import.summary.productsFailed', job.products_failed],
                                        ['import.summary.variantsCreated', job.variants_created],
                                        ['import.summary.variantsUpdated', job.variants_updated],
                                        ['import.summary.imagesQueued', job.image_urls_queued],
                                    ]}
                                />
                                {job.created_package_ids.length > 0 && (
                                    <div className="flex flex-col gap-1">
                                        <p className="text-body font-medium text-foreground">
                                            {t('import.createdTitle')}
                                        </p>
                                        <ul className="flex flex-wrap gap-x-4 gap-y-1">
                                            {job.created_package_ids
                                                .slice(0, CREATED_SHOWN)
                                                .map((packageId, index) => (
                                                    <li key={packageId}>
                                                        <Link
                                                            to="/commerce/products/$productId"
                                                            params={{ productId: packageId }}
                                                            className="text-caption text-primary-500 hover:underline"
                                                        >
                                                            {t('import.createdLink', {
                                                                number: index + 1,
                                                            })}
                                                        </Link>
                                                    </li>
                                                ))}
                                        </ul>
                                    </div>
                                )}
                                <IssueList
                                    issues={job.issues}
                                    truncated={job.issues_truncated}
                                    downloading={busy === 'error-rows'}
                                    onDownload={
                                        job.error_rows_available
                                            ? () =>
                                                  void download(
                                                      'error-rows',
                                                      () => downloadJobErrorRows(job.job_id),
                                                      t('import.errorRowsFileName'),
                                                      t('import.errors.errorRows')
                                                  )
                                            : undefined
                                    }
                                />
                                <Link
                                    to="/commerce/products"
                                    className="w-fit text-body text-primary-500 hover:underline"
                                >
                                    {t('import.viewProducts')}
                                </Link>
                            </>
                        )}
                    </div>
                )}
            </SectionCard>

            {error && <CommerceErrorState message={error} />}
        </div>
    );
}

/** The columns of the template, from the server, behind a disclosure. */
function ColumnGuide() {
    const { t } = useTranslation('commerce');
    const columns = useImportColumns();
    if (!columns.data || columns.data.length === 0) return null;
    return (
        <details className="rounded-lg border border-border">
            <summary className="cursor-pointer p-3 text-body text-foreground">
                {t('import.guide.title', { count: columns.data.length })}
            </summary>
            <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-start text-caption">
                    <thead className="bg-muted text-muted-foreground">
                        <tr>
                            {(
                                ['column', 'level', 'required', 'description', 'example'] as const
                            ).map((heading) => (
                                <th
                                    key={heading}
                                    scope="col"
                                    className="whitespace-nowrap p-2 text-start font-medium"
                                >
                                    {t(`import.guide.${heading}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {columns.data.map((column) => (
                            <tr key={column.column} className="border-t border-border align-top">
                                <td className="p-2 font-mono text-foreground">{column.column}</td>
                                <td className="whitespace-nowrap p-2 text-foreground">
                                    {t(`import.guide.levels.${column.level}`, {
                                        defaultValue: column.level,
                                    })}
                                </td>
                                <td className="p-2 text-foreground">
                                    {column.required
                                        ? t('import.guide.requiredYes')
                                        : t('import.guide.requiredNo')}
                                </td>
                                {/* The server's own text: English until it sends codes or Hindi. */}
                                <td className="p-2 text-foreground" lang="en">
                                    {column.description}
                                </td>
                                <td className="p-2 font-mono text-muted-foreground">
                                    {column.example ?? '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}

function Tiles({ tiles }: { tiles: ReadonlyArray<readonly [string, number]> }) {
    const { t } = useTranslation('commerce');
    return (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(([labelKey, value]) => (
                <div key={labelKey} className="flex flex-col rounded-lg border border-border p-3">
                    <dt className="text-caption text-muted-foreground">{t(labelKey)}</dt>
                    <dd className="text-h3 font-medium tabular-nums text-foreground">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function IssueList({
    issues,
    truncated,
    downloading,
    onDownload,
}: {
    issues: ImportIssue[];
    truncated: boolean;
    downloading: boolean;
    /** Absent when the server has no error-rows file to give. */
    onDownload?: () => void;
}) {
    const { t } = useTranslation('commerce');
    if (issues.length === 0 && !onDownload) return null;
    const shown = issues.slice(0, ISSUES_SHOWN);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body font-medium text-foreground">{t('import.issuesTitle')}</p>
                {onDownload && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={downloading}
                        onClick={onDownload}
                    >
                        <DownloadSimple size={14} />
                        {t('import.downloadErrorRows')}
                    </MyButton>
                )}
            </div>
            {shown.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-start text-caption">
                        <thead className="bg-muted text-muted-foreground">
                            <tr>
                                {(['row', 'handle', 'field', 'severity', 'message'] as const).map(
                                    (column) => (
                                        <th
                                            key={column}
                                            scope="col"
                                            className="whitespace-nowrap p-2 text-start font-medium"
                                        >
                                            {t(`import.columns.${column}`)}
                                        </th>
                                    )
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((issue, index) => (
                                <tr key={index} className="border-t border-border align-top">
                                    <td className="p-2 tabular-nums text-foreground">
                                        {issue.row ?? '—'}
                                    </td>
                                    <td className="p-2 font-mono text-foreground">
                                        {issue.handle ?? '—'}
                                    </td>
                                    <td className="p-2 font-mono text-foreground">
                                        {issue.column ?? '—'}
                                    </td>
                                    <td className="p-2">
                                        <CommerceStatusChip
                                            kind="importSeverity"
                                            value={issue.severity}
                                        />
                                    </td>
                                    <td className="p-2 text-foreground" lang="en">
                                        {issue.message}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {(truncated || issues.length > shown.length) && (
                <p className="text-caption text-muted-foreground">
                    {t('import.moreIssues', { shown: shown.length })}
                </p>
            )}
        </div>
    );
}
