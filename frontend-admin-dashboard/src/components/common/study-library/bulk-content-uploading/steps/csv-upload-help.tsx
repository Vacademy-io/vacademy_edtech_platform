// Bulk Content Uploading — CSV-mode help card: short format guide + reference.

import { useState } from 'react';
import { toast } from 'sonner';
import { CircleNotch, Table } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import { Switch } from '@/components/ui/switch';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { downloadBlob } from '../sample-zip';
import { generateChapterReferenceCsv } from '../chapter-reference';
import { useBulkContentUploadingStore } from '../use-bulk-content-uploading-store';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const EXAMPLE_CSV = [
    'bulkcontent.csv',
    'file_name,package_session_id,chapter_id,title,order',
    'notes.pdf,PS_ID,CHAPTER_ID,Chapter 1 notes,top',
    'lecture.mp4,PS_ID,CHAPTER_ID,,bottom',
].join('\n');

export const CsvUploadHelp = () => {
    const context = useBulkContentUploadingStore((state) => state.context);
    const studyLibraryData = useStudyLibraryStore((state) => state.studyLibraryData);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [pickCourses, setPickCourses] = useState(false);
    const [courseIds, setCourseIds] = useState<string[]>([]);

    const courseOptions = (studyLibraryData ?? []).map((entry) => ({
        label: entry.course.package_name,
        value: entry.course.id,
    }));

    const handleDownload = async () => {
        if (downloading) return;
        if (pickCourses && courseIds.length === 0) {
            toast.error(
                `Select at least one ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`
            );
            return;
        }
        setDownloading(true);
        try {
            const blob = await generateChapterReferenceCsv(
                studyLibraryData ?? [],
                context?.instituteId ?? '',
                {
                    courseIds: pickCourses ? courseIds : undefined,
                    onProgress: (done, total) => setProgress({ done, total }),
                }
            );
            downloadBlob(blob, 'chapter-reference.csv');
            toast.success('Reference downloaded — add a file_name to each row you want to upload');
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Could not generate the reference';
            toast.error(message);
        } finally {
            setDownloading(false);
            setProgress(null);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div>
                <h4 className="text-subtitle font-semibold text-neutral-700">bulkcontent.csv</h4>
                <p className="mt-1 text-caption text-neutral-500">
                    Put a <span className="font-mono">bulkcontent.csv</span> in the zip — one row
                    per file, saying which{' '}
                    {getTerminology(
                        ContentTerms.Chapters,
                        SystemTerms.Chapters
                    ).toLocaleLowerCase()}{' '}
                    it belongs to.
                </p>
            </div>

            <pre className="overflow-x-auto rounded-md bg-neutral-50 p-3 font-mono text-caption text-neutral-600">
                {EXAMPLE_CSV}
            </pre>

            <ul className="flex list-disc flex-col gap-1 pl-4 text-caption text-neutral-500">
                <li>
                    Required: <span className="font-mono">package_session_id</span>,{' '}
                    <span className="font-mono">chapter_id</span>, and{' '}
                    <span className="font-mono">file_name</span> (or a{' '}
                    <span className="font-mono">url</span> for a link).
                </li>
                <li>
                    <span className="font-mono">order</span>: <span className="font-mono">top</span>{' '}
                    or <span className="font-mono">bottom</span> (default) — where it sits among
                    existing slides. Anything else falls back to bottom.
                </li>
                <li>Bad rows are skipped and listed; the rest still upload.</li>
            </ul>

            <div className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
                <label className="flex items-center justify-between gap-4">
                    <span className="text-caption font-medium text-neutral-700">
                        Limit reference to specific{' '}
                        {getTerminologyPlural(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase()}
                    </span>
                    <Switch checked={pickCourses} onCheckedChange={setPickCourses} />
                </label>
                {pickCourses && (
                    <MultiSelect
                        options={courseOptions}
                        selected={courseIds}
                        onChange={setCourseIds}
                        placeholder={`Select ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}…`}
                        className="mt-2"
                    />
                )}
            </div>

            <MyButton
                buttonType="secondary"
                onClick={() => void handleDownload()}
                disable={downloading || (pickCourses && courseIds.length === 0)}
                className="flex items-center gap-1.5"
            >
                {downloading ? (
                    <CircleNotch className="size-4 animate-spin" />
                ) : (
                    <Table className="size-4" />
                )}
                {downloading
                    ? progress
                        ? `Building… ${progress.done}/${progress.total}`
                        : 'Building…'
                    : `Download ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()} reference (ids + skeleton)`}
            </MyButton>
        </div>
    );
};
