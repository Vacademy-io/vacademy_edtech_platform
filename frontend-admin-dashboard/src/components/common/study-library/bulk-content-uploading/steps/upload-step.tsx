// Bulk Content Uploading — step 1: pick a zip + options.

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import {
    CircleNotch,
    FileArchive,
    FileArrowDown,
    ListNumbers,
    UploadSimple,
} from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import { useStudyLibraryStore } from '@/stores/study-library/use-study-library-store';
import { cn } from '@/lib/utils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    expectedLayoutHelp,
    expectedMultiCourseLayoutHelp,
    formatBytes,
    MAX_SINGLE_FILE_BYTES,
    MAX_ZIP_BYTES,
} from '../conventions';
import {
    downloadBlob,
    generateMultiCourseTemplate,
    generateSingleCourseTemplate,
    type HierarchyTermLabels,
} from '../sample-zip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBulkContentUploadingStore } from '../use-bulk-content-uploading-store';
import { CsvUploadHelp } from './csv-upload-help';
import { CsvDirectUpload } from './csv-direct-upload';

interface UploadStepProps {
    onZipSelected: (file: File) => void;
    /** CSV "select files directly" flow — user uploads a filled bulkcontent.csv. */
    onManifestCsvSelected?: (csvText: string) => void;
}

export const UploadStep = ({ onZipSelected, onManifestCsvSelected }: UploadStepProps) => {
    const context = useBulkContentUploadingStore((state) => state.context);
    const mode = useBulkContentUploadingStore((state) => state.mode);
    const options = useBulkContentUploadingStore((state) => state.options);
    const setOptions = useBulkContentUploadingStore((state) => state.setOptions);
    const studyLibraryData = useStudyLibraryStore((state) => state.studyLibraryData);
    // CSV mode: pick files directly (default) or upload a zip.
    const [csvSource, setCsvSource] = useState<'files' | 'zip'>('files');
    const [downloadingTemplate, setDownloadingTemplate] = useState(false);
    const [templateProgress, setTemplateProgress] = useState<{
        done: number;
        total: number;
    } | null>(null);
    const [pickTemplateCourses, setPickTemplateCourses] = useState(false);
    const [templateCourseIds, setTemplateCourseIds] = useState<string[]>([]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: (accepted) => {
            const file = accepted[0];
            if (file) onZipSelected(file);
        },
        accept: { 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'] },
        maxFiles: 1,
        multiple: false,
        noKeyboard: true,
    });

    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const chapterTerm = getTerminology(ContentTerms.Chapter, SystemTerms.Chapter);
    const chapterTermPlural = getTerminologyPlural(ContentTerms.Chapter, SystemTerms.Chapter);
    const subjectTerm = getTerminology(ContentTerms.Subject, SystemTerms.Subject);
    const moduleTerm = getTerminology(ContentTerms.Module, SystemTerms.Module);
    const layoutLines =
        mode === 'multi'
            ? expectedMultiCourseLayoutHelp(courseTerm, {
                  subject: subjectTerm,
                  module: moduleTerm,
                  chapter: chapterTerm,
              })
            : expectedLayoutHelp(context?.courseDepth ?? 5, {
                  subject: subjectTerm,
                  module: moduleTerm,
                  chapter: chapterTerm,
              });

    const handleDownloadTemplate = async () => {
        if (downloadingTemplate) return;
        const terms: HierarchyTermLabels = {
            course: courseTerm,
            subject: subjectTerm,
            module: moduleTerm,
            chapter: chapterTerm,
            chapterPlural: chapterTermPlural,
        };
        setDownloadingTemplate(true);
        try {
            if (mode === 'multi') {
                if (pickTemplateCourses && templateCourseIds.length === 0) {
                    toast.error(`Select at least one ${courseTerm.toLowerCase()} for the template`);
                    return;
                }
                const instituteId = context?.instituteId ?? '';
                const blob = await generateMultiCourseTemplate(
                    studyLibraryData ?? [],
                    instituteId,
                    terms,
                    {
                        courseIds: pickTemplateCourses ? templateCourseIds : undefined,
                        onProgress: (done, total) => setTemplateProgress({ done, total }),
                    }
                );
                downloadBlob(blob, 'bulk-upload-template.zip');
            } else {
                if (!context) {
                    toast.error(`Select a ${courseTerm.toLowerCase()} first`);
                    return;
                }
                const blob = await generateSingleCourseTemplate(context, terms);
                downloadBlob(blob, 'bulk-upload-template.zip');
            }
            toast.success(
                'Template downloaded — drop your files into its folders and upload it back'
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Could not generate the template';
            toast.error(message);
        } finally {
            setDownloadingTemplate(false);
            setTemplateProgress(null);
        }
    };

    const templateCourseOptions = (studyLibraryData ?? []).map((entry) => ({
        label: entry.course.package_name,
        value: entry.course.id,
    }));

    const renderOptions = () => (
        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
            <h4 className="text-subtitle font-semibold text-neutral-700">Options</h4>
            <label className="flex items-center justify-between gap-4">
                <span className="flex flex-col">
                    <span className="text-subtitle text-neutral-700">Publish immediately</span>
                    <span className="text-caption text-neutral-500">
                        Off = uploaded slides are saved as drafts for review
                    </span>
                </span>
                <Switch
                    checked={options.publish}
                    onCheckedChange={(checked) => setOptions({ publish: checked })}
                />
            </label>
            <label className="flex items-center justify-between gap-4">
                <span className="flex flex-col">
                    <span className="text-subtitle text-neutral-700">Skip duplicate titles</span>
                    <span className="text-caption text-neutral-500">
                        Don’t re-create a slide whose title already exists in the target{' '}
                        {getTerminology(
                            ContentTerms.Chapters,
                            SystemTerms.Chapters
                        ).toLocaleLowerCase()}
                    </span>
                </span>
                <Switch
                    checked={options.skipDuplicateTitles}
                    onCheckedChange={(checked) => setOptions({ skipDuplicateTitles: checked })}
                />
            </label>
            <label className="flex items-center justify-between gap-4">
                <span className="flex flex-col">
                    <span className="text-subtitle text-neutral-700">
                        Create missing {chapterTermPlural.toLowerCase()}
                    </span>
                    <span className="text-caption text-neutral-500">
                        Off = folders that don’t match an existing {chapterTerm.toLowerCase()} are
                        skipped
                    </span>
                </span>
                <Switch
                    checked={options.createMissing}
                    onCheckedChange={(checked) => setOptions({ createMissing: checked })}
                />
            </label>
        </div>
    );

    return (
        <div className="flex flex-col gap-6">
            {mode === 'csv' && (
                <Tabs
                    value={csvSource}
                    onValueChange={(v) => setCsvSource(v === 'zip' ? 'zip' : 'files')}
                >
                    <TabsList>
                        <TabsTrigger value="files">Pick files + CSV</TabsTrigger>
                        <TabsTrigger value="zip">Upload a .zip</TabsTrigger>
                    </TabsList>
                </Tabs>
            )}

            {mode === 'csv' && csvSource === 'files' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                    <CsvDirectUpload onManifestCsvSelected={onManifestCsvSelected ?? (() => {})} />
                    {renderOptions()}
                </div>
            ) : (
                <>
                    <div
                        {...getRootProps()}
                        className={cn(
                            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 transition-colors',
                            isDragActive
                                ? 'border-primary-500 bg-primary-50'
                                : 'border-neutral-300 bg-white hover:border-primary-300'
                        )}
                    >
                        <input {...getInputProps()} />
                        <FileArchive className="size-10 text-primary-500" />
                        <div className="text-center">
                            <p className="text-subtitle font-semibold text-neutral-700">
                                Drag & drop a .zip here, or click to select
                            </p>
                            <p className="mt-1 text-caption text-neutral-500">
                                Up to {formatBytes(MAX_ZIP_BYTES)} per zip,{' '}
                                {formatBytes(MAX_SINGLE_FILE_BYTES)} per file. PDF, Word,
                                PowerPoint, images, videos, SCORM packages (.zip) and link files are
                                supported.
                            </p>
                        </div>
                        <div className="flex items-center gap-1 text-caption text-primary-500">
                            <UploadSimple className="size-4" />
                            <span>
                                {mode === 'csv'
                                    ? `A bulkcontent.csv inside maps each file to a ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLocaleLowerCase()}`
                                    : `Folder names become your ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} structure`}
                            </span>
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        {mode === 'csv' ? (
                            <CsvUploadHelp />
                        ) : (
                            <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                <h4 className="text-subtitle font-semibold text-neutral-700">
                                    Expected zip layout
                                </h4>
                                <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-50 p-3 font-mono text-caption text-neutral-600">
                                    {layoutLines.join('\n')}
                                </pre>
                                <div className="mt-3 rounded-md border border-primary-100 bg-primary-50/50 p-3">
                                    <div className="flex items-center gap-1.5">
                                        <ListNumbers className="size-4 text-primary-500" />
                                        <span className="text-caption font-semibold text-neutral-700">
                                            Want a perfect order? Number your files
                                        </span>
                                    </div>
                                    <ul className="mt-2 flex flex-col gap-1">
                                        <li className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-caption text-neutral-600">
                                                01 Introduction.pdf
                                            </span>
                                            <span className="text-caption text-primary-500">
                                                → 1st slide “Introduction”
                                            </span>
                                        </li>
                                        <li className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-caption text-neutral-600">
                                                02 Practice set.pdf
                                            </span>
                                            <span className="text-caption text-primary-500">
                                                → 2nd slide “Practice set”
                                            </span>
                                        </li>
                                        <li className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-caption text-neutral-600">
                                                Extra material.pdf
                                            </span>
                                            <span className="text-caption text-neutral-500">
                                                → last (no number = A–Z at the end)
                                            </span>
                                        </li>
                                    </ul>
                                    <p className="mt-2 text-caption text-neutral-500">
                                        Works for folders too — number them the same way. The number
                                        is removed from the name. New slides are added after a
                                        chapter’s existing slides.
                                    </p>
                                </div>
                                <p className="mt-2 text-caption text-neutral-500">
                                    Put YouTube/external links in a links.txt file (one “Title |
                                    URL” per line).
                                </p>
                                {mode === 'multi' && (
                                    <div className="mt-3 flex flex-col gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-3">
                                        <label className="flex items-center justify-between gap-4">
                                            <span className="flex flex-col">
                                                <span className="text-caption font-medium text-neutral-700">
                                                    Choose specific{' '}
                                                    {getTerminologyPlural(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    ).toLocaleLowerCase()}{' '}
                                                    for the template
                                                </span>
                                                <span className="text-caption text-neutral-500">
                                                    Off = template includes all{' '}
                                                    {templateCourseOptions.length}{' '}
                                                    {getTerminologyPlural(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    ).toLocaleLowerCase()}
                                                </span>
                                            </span>
                                            <Switch
                                                checked={pickTemplateCourses}
                                                onCheckedChange={setPickTemplateCourses}
                                            />
                                        </label>
                                        {pickTemplateCourses && (
                                            <MultiSelect
                                                options={templateCourseOptions}
                                                selected={templateCourseIds}
                                                onChange={setTemplateCourseIds}
                                                placeholder={`Search & select ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}…`}
                                            />
                                        )}
                                    </div>
                                )}
                                <MyButton
                                    buttonType="secondary"
                                    onClick={() => void handleDownloadTemplate()}
                                    disable={
                                        downloadingTemplate ||
                                        (mode === 'single' && !context) ||
                                        (mode === 'multi' &&
                                            pickTemplateCourses &&
                                            templateCourseIds.length === 0)
                                    }
                                    className="mt-3 flex items-center gap-1.5"
                                >
                                    {downloadingTemplate ? (
                                        <CircleNotch className="size-4 animate-spin" />
                                    ) : (
                                        <FileArrowDown className="size-4" />
                                    )}
                                    {downloadingTemplate
                                        ? templateProgress
                                            ? `Building template… ${templateProgress.done}/${templateProgress.total}`
                                            : 'Building template…'
                                        : 'Download sample zip'}
                                </MyButton>
                                <p className="mt-1 text-caption text-neutral-400">
                                    Folders named after your existing structure — just drop files in
                                    and upload it back.
                                </p>
                            </div>
                        )}

                        {renderOptions()}
                    </div>
                </>
            )}
        </div>
    );
};
