// Bulk Content Uploading — CSV "select files directly" flow (no zip).
//
// Step 1: pick files. Step 2: download a bulkcontent.csv with the file names
// already filled (and a chapter reference for the ids). Step 3: upload the
// filled CSV. Best when you only have a handful of files.

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { CircleNotch, FileArrowDown, FilePlus, Table, UploadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { cn } from '@/lib/utils';
import { formatBytes } from '../conventions';
import { downloadBlob } from '../sample-zip';
import { generatePrefilledManifestCsv } from '../csv-manifest';
import { generateChapterReferenceCsv } from '../chapter-reference';
import { setDirectFiles } from '../file-source';
import { useBulkContentUploadingStore } from '../use-bulk-content-uploading-store';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface CsvDirectUploadProps {
    onManifestCsvSelected: (csvText: string) => void;
}

export const CsvDirectUpload = ({ onManifestCsvSelected }: CsvDirectUploadProps) => {
    const context = useBulkContentUploadingStore((state) => state.context);
    const studyLibraryData = useStudyLibraryStore((state) => state.studyLibraryData);
    const [files, setFiles] = useState<File[]>([]);
    const [downloadingRef, setDownloadingRef] = useState(false);
    const [refProgress, setRefProgress] = useState<{ done: number; total: number } | null>(null);

    const filesDropzone = useDropzone({
        onDrop: (accepted) => {
            if (accepted.length === 0) return;
            setFiles(accepted);
            setDirectFiles(accepted);
        },
        noKeyboard: true,
    });

    const csvDropzone = useDropzone({
        onDrop: async (accepted) => {
            const csv = accepted[0];
            if (!csv) return;
            if (!csv.name.toLowerCase().endsWith('.csv')) {
                toast.error('Please select your filled-in .csv');
                return;
            }
            onManifestCsvSelected(await csv.text());
        },
        accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv'] },
        maxFiles: 1,
        multiple: false,
        noKeyboard: true,
    });

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

    const handleDownloadPrefilled = () => {
        if (files.length === 0) return;
        downloadBlob(generatePrefilledManifestCsv(files), 'bulkcontent.csv');
        toast.success('Add package_session_id, chapter_id and order to each row, then upload it.');
    };

    const handleDownloadReference = async () => {
        if (downloadingRef) return;
        setDownloadingRef(true);
        try {
            const blob = await generateChapterReferenceCsv(
                studyLibraryData ?? [],
                context?.instituteId ?? '',
                { onProgress: (done, total) => setRefProgress({ done, total }) }
            );
            downloadBlob(blob, 'chapter-reference.csv');
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Could not generate the reference';
            toast.error(message);
        } finally {
            setDownloadingRef(false);
            setRefProgress(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Step 1 — pick files */}
            <div>
                <p className="mb-1 text-caption font-semibold text-neutral-700">
                    1. Select your files
                </p>
                <div
                    {...filesDropzone.getRootProps()}
                    className={cn(
                        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 transition-colors',
                        filesDropzone.isDragActive
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-neutral-300 bg-white hover:border-primary-300'
                    )}
                >
                    <input {...filesDropzone.getInputProps()} />
                    <FilePlus className="size-8 text-primary-500" />
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {files.length > 0
                            ? `${files.length} file${files.length === 1 ? '' : 's'} selected · ${formatBytes(totalBytes)}`
                            : 'Drag & drop your files, or click to select'}
                    </p>
                    <p className="text-caption text-neutral-500">
                        PDF, Word, PowerPoint, images, videos — pick as many as you like.
                    </p>
                </div>
            </div>

            {/* Step 2 — build the CSV */}
            <div className={cn(files.length === 0 && 'pointer-events-none opacity-50')}>
                <p className="mb-1 text-caption font-semibold text-neutral-700">
                    2. Fill in the spreadsheet
                </p>
                <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
                    <p className="text-caption text-neutral-500">
                        Download the CSV (your file names are already filled in), then add{' '}
                        <span className="font-mono">package_session_id</span>,{' '}
                        <span className="font-mono">chapter_id</span>, optional{' '}
                        <span className="font-mono">title</span> and{' '}
                        <span className="font-mono">order</span> (top/bottom) to each row.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <MyButton
                            buttonType="primary"
                            onClick={handleDownloadPrefilled}
                            disable={files.length === 0}
                            className="flex items-center gap-1.5"
                        >
                            <FileArrowDown className="size-4" />
                            Download bulkcontent.csv
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={() => void handleDownloadReference()}
                            disable={downloadingRef}
                            className="flex items-center gap-1.5"
                        >
                            {downloadingRef ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <Table className="size-4" />
                            )}
                            {downloadingRef
                                ? refProgress
                                    ? `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} ids… ${refProgress.done}/${refProgress.total}`
                                    : `${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} ids…`
                                : `Need ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()} ids?`}
                        </MyButton>
                    </div>
                </div>
            </div>

            {/* Step 3 — upload the filled CSV */}
            <div className={cn(files.length === 0 && 'pointer-events-none opacity-50')}>
                <p className="mb-1 text-caption font-semibold text-neutral-700">
                    3. Upload the filled-in CSV
                </p>
                <div
                    {...csvDropzone.getRootProps()}
                    className={cn(
                        'flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-6 transition-colors',
                        csvDropzone.isDragActive
                            ? 'border-primary-500 bg-primary-50'
                            : 'border-neutral-300 bg-white hover:border-primary-300'
                    )}
                >
                    <input {...csvDropzone.getInputProps()} />
                    <UploadSimple className="size-5 text-primary-500" />
                    <span className="text-subtitle text-neutral-700">
                        Drop your filled-in bulkcontent.csv here
                    </span>
                </div>
            </div>
        </div>
    );
};
