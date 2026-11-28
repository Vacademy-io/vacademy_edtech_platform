// Bulk Content Uploading — CSV-manifest preview: validation table + confirm.

import { useMemo } from 'react';
import { ArrowLeft, CheckCircle, Info, LinkSimple, Warning, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { formatBytes } from '../conventions';
import {
    selectCsvReadiness,
    useBulkContentUploadingStore,
} from '../use-bulk-content-uploading-store';
import type { CsvRowResult } from '../csv-manifest';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const RowStatus = ({ row }: { row: CsvRowResult }) => {
    if (row.status === 'valid') {
        return (
            <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-caption text-success-700">
                    <CheckCircle className="size-4 shrink-0" />
                    Ready
                </span>
                {row.warnings.map((w) => (
                    <span key={w} className="flex items-start gap-1 text-caption text-warning-700">
                        <Warning className="mt-0.5 size-3 shrink-0" />
                        {w}
                    </span>
                ))}
            </span>
        );
    }
    return (
        <span className="flex items-start gap-1 text-caption text-danger-600">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            {row.error}
        </span>
    );
};

export const CsvPreview = ({ onConfirm }: { onConfirm: () => void }) => {
    const csvRows = useBulkContentUploadingStore((state) => state.csvRows);
    const items = useBulkContentUploadingStore((state) => state.items);
    const issues = useBulkContentUploadingStore((state) => state.issues);
    const fatalErrors = useBulkContentUploadingStore((state) => state.fatalErrors);
    const zipFileName = useBulkContentUploadingStore((state) => state.zipFileName);
    const zipTotalBytes = useBulkContentUploadingStore((state) => state.zipTotalBytes);
    const options = useBulkContentUploadingStore((state) => state.options);
    const resetForNewZip = useBulkContentUploadingStore((state) => state.resetForNewZip);

    const readiness = useMemo(
        () => selectCsvReadiness({ items, fatalErrors }),
        [items, fatalErrors]
    );
    const validCount = useMemo(() => csvRows.filter((r) => r.status === 'valid').length, [csvRows]);
    const errorCount = csvRows.length - validCount;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-subtitle font-semibold text-neutral-700">{zipFileName}</span>
                <span className="text-caption text-neutral-500">{formatBytes(zipTotalBytes)}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                    <span className="rounded-md bg-success-50 px-3 py-1.5 text-caption text-success-700">
                        <span className="font-semibold">{validCount}</span> ready
                    </span>
                    {errorCount > 0 && (
                        <span className="rounded-md bg-danger-50 px-3 py-1.5 text-caption text-danger-700">
                            <span className="font-semibold">{errorCount}</span> with errors
                        </span>
                    )}
                </span>
            </div>

            {fatalErrors.map((message) => (
                <div
                    key={message}
                    className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-4"
                >
                    <XCircle className="mt-0.5 size-4 shrink-0 text-danger-600" />
                    <p className="text-subtitle text-danger-700">{message}</p>
                </div>
            ))}

            {issues.map((issue, index) => (
                <div
                    key={`${issue.path}-${index}`}
                    className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-2"
                >
                    {issue.level === 'warning' ? (
                        <Warning className="mt-0.5 size-4 shrink-0 text-warning-600" />
                    ) : (
                        <Info className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                    )}
                    <span className="text-caption text-neutral-600">{issue.message}</span>
                </div>
            ))}

            <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                <table className="w-full text-left">
                    <thead className="sticky top-0 bg-neutral-50 text-caption text-neutral-500">
                        <tr>
                            <th className="px-4 py-2 font-medium">Row</th>
                            <th className="px-4 py-2 font-medium">File / link</th>
                            <th className="px-4 py-2 font-medium">
                                {getTerminology(ContentTerms.Course, SystemTerms.Course)} →{' '}
                                {getTerminology(
                                    ContentTerms.Chapters,
                                    SystemTerms.Chapters
                                ).toLocaleLowerCase()}
                            </th>
                            <th className="px-4 py-2 font-medium">Order</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                        {csvRows.map((row) => (
                            <tr
                                key={row.rowNumber}
                                className={cn(row.status === 'error' && 'bg-danger-50/40')}
                            >
                                <td className="px-4 py-2 align-top text-caption text-neutral-400">
                                    {row.rowNumber}
                                </td>
                                <td className="max-w-xs px-4 py-2 align-top">
                                    <span className="flex items-center gap-1 truncate text-subtitle text-neutral-700">
                                        {row.url && !row.fileName && (
                                            <LinkSimple className="size-3.5 shrink-0 text-neutral-400" />
                                        )}
                                        {row.fileName || row.url || '—'}
                                    </span>
                                    {row.title && (
                                        <span className="text-caption text-neutral-400">
                                            {row.title}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2 align-top text-caption text-neutral-600">
                                    {row.courseName ?? '—'}
                                    {row.chapterName ? ` → ${row.chapterName}` : ''}
                                </td>
                                <td className="px-4 py-2 align-top text-caption text-neutral-500">
                                    {row.status === 'valid' ? row.placement ?? 'bottom' : '—'}
                                </td>
                                <td className="px-4 py-2 align-top">
                                    <RowStatus row={row} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <MyButton buttonType="secondary" onClick={resetForNewZip}>
                    <ArrowLeft className="size-4" />
                    Choose another zip
                </MyButton>
                <div className="flex items-center gap-3">
                    <span className="text-caption text-neutral-500">
                        {!readiness.ready
                            ? readiness.reason
                            : `${errorCount > 0 ? `${errorCount} invalid row(s) will be skipped. ` : ''}${
                                  options.publish
                                      ? 'Slides will be published'
                                      : 'Slides will be saved as drafts'
                              }`}
                    </span>
                    <MyButton buttonType="primary" onClick={onConfirm} disable={!readiness.ready}>
                        Upload {validCount} file{validCount === 1 ? '' : 's'}
                    </MyButton>
                </div>
            </div>
        </div>
    );
};
