import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone } from 'react-dropzone';
import { UploadSimple, CircleNotch, Warning, CheckCircle } from '@phosphor-icons/react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { BulkSessionRow } from '../-schema/bulkSchema';
import {
    parseScheduleCsv,
    type BatchForSessionLite,
    type ScheduleCsvParseResult,
} from '../-utils/bulkCsv';

interface BulkCsvImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    batches: BatchForSessionLite[];
    allowedPlatforms: string[];
    onImport: (rows: BulkSessionRow[]) => void;
}

export function BulkCsvImportDialog({
    open,
    onOpenChange,
    batches,
    allowedPlatforms,
    onImport,
}: BulkCsvImportDialogProps) {
    // Reuses the bulkCsv.ts namespace: parseScheduleCsv's validation/error messages
    // live there, and this dialog just needs to pass a `t` through to it.
    const { t } = useTranslation('studyLibraryBulkCsv');
    const [parsing, setParsing] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [result, setResult] = useState<ScheduleCsvParseResult | null>(null);

    const reset = () => {
        setParsing(false);
        setFileName(null);
        setResult(null);
    };

    const handleFile = async (file: File) => {
        setFileName(file.name);
        setParsing(true);
        setResult(null);
        const parsed = await parseScheduleCsv(file, { batches, allowedPlatforms }, t);
        setResult(parsed);
        setParsing(false);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        accept: { 'text/csv': ['.csv'] },
        maxFiles: 1,
        multiple: false,
        disabled: parsing,
        onDrop: (files) => {
            const file = files[0];
            if (file) handleFile(file);
        },
    });

    const validCount = result?.validRows.length ?? 0;

    const close = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Import sessions from CSV</DialogTitle>
                    <DialogDescription>
                        Upload a filled template. Batches are matched by their{' '}
                        <span className="font-medium">package_session_id</span> — use the
                        &ldquo;Batch reference&rdquo; download to get the IDs. Teachers go in the{' '}
                        <span className="font-medium">teacher_emails</span> column by email
                        (recommended) or username, several separated by{' '}
                        <span className="font-medium">|</span> &mdash; the &ldquo;Teacher
                        reference&rdquo; download lists them. Leave it blank and whoever runs the
                        import becomes the teacher.
                    </DialogDescription>
                </DialogHeader>

                <div
                    {...getRootProps()}
                    className={cn(
                        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-6 text-center transition-colors',
                        isDragActive && 'border-primary-400 bg-primary-50',
                        parsing && 'pointer-events-none opacity-60'
                    )}
                >
                    <input {...getInputProps()} />
                    {parsing ? (
                        <CircleNotch size={24} className="animate-spin text-neutral-400" />
                    ) : (
                        <UploadSimple size={24} className="text-neutral-500" />
                    )}
                    <p className="text-sm text-neutral-700">
                        {fileName
                            ? fileName
                            : 'Drag a .csv here, or click to choose a file'}
                    </p>
                    <p className="text-xs text-neutral-500">
                        Expected columns: title, subject, start_date, start_time, duration_hours,
                        duration_minutes, platform, link, package_session_ids, teacher_emails,
                        description
                    </p>
                </div>

                {result && (
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="inline-flex items-center gap-1.5 text-success-600">
                                <CheckCircle size={16} />
                                {validCount} ready to import
                            </span>
                            {result.errors.length > 0 && (
                                <span className="inline-flex items-center gap-1.5 text-danger-600">
                                    <Warning size={16} />
                                    {result.errors.length} row
                                    {result.errors.length === 1 ? '' : 's'} skipped
                                </span>
                            )}
                            <span className="text-neutral-500">
                                {result.totalCount} total
                            </span>
                        </div>

                        {result.errors.length > 0 && (
                            <ScrollArea className="max-h-48 rounded-md border border-neutral-200">
                                <ul className="divide-y divide-neutral-100 text-sm">
                                    {result.errors.map((e) => (
                                        <li
                                            key={`${e.rowNumber}-${e.title ?? ''}`}
                                            className="px-3 py-2"
                                        >
                                            <div className="font-medium text-neutral-800">
                                                {e.rowNumber === 0
                                                    ? 'File'
                                                    : `Row ${e.rowNumber}`}
                                                {e.title ? `: ${e.title}` : ''}
                                            </div>
                                            <ul className="ml-4 list-disc text-xs text-danger-600">
                                                {e.messages.map((m, idx) => (
                                                    <li key={idx}>{m}</li>
                                                ))}
                                            </ul>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    <MyButton type="button" buttonType="secondary" onClick={() => close(false)}>
                        Cancel
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        disable={validCount === 0}
                        onClick={() => {
                            if (result) onImport(result.validRows);
                            close(false);
                        }}
                    >
                        {validCount > 0
                            ? `Import ${validCount} row${validCount === 1 ? '' : 's'}`
                            : 'Import'}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
