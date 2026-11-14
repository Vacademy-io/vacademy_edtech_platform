import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DownloadSimple, FileXls, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Progress } from '@/components/ui/progress';
import {
    importLibraryQuestions,
    libraryErrorMessage,
} from '../-services/question-library-services';
import {
    TEMPLATE_EXAMPLES,
    TEMPLATE_HEADERS,
    chunk,
    countByPath,
    parseTemplateRows,
    toImportItem,
    type SheetResult,
} from '../-utils/library-import';

const SAVE_CHUNK = 200;
const MAX_ERRORS_SHOWN = 20;
const MAX_TOPICS_SHOWN = 30;

/** xlsx is only needed in this dialog, so it is loaded when the dialog is used. */
const loadXlsx = () => import('xlsx');

/**
 * Owner only: many questions at once from the Excel template. Each row names its topic
 * (Course, Subject, Chapter, Topic, Sub-topic); missing topics are created on import.
 */
export const ImportExcelDialog = ({
    open,
    onOpenChange,
    instituteId,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    onSaved: () => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const fileInput = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState('');
    const [sheet, setSheet] = useState<SheetResult | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    const downloadTemplate = async () => {
        const XLSX = await loadXlsx();
        const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Questions');
        XLSX.writeFile(wb, 'question_library_template.xlsx');
    };

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            const XLSX = await loadXlsx();
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const first = workbook.Sheets[workbook.SheetNames[0] ?? ''];
            const rows: unknown[][] = first
                ? XLSX.utils.sheet_to_json(first, { header: 1, defval: '' })
                : [];
            setFileName(file.name);
            setSheet(parseTemplateRows(rows));
        } catch {
            toast.error(t('excel.unreadable'));
        } finally {
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const runImport = async () => {
        if (!sheet || sheet.drafts.length === 0) return;
        const items = sheet.drafts.map(toImportItem);
        const parts = chunk(items, SAVE_CHUNK);
        let created = 0;
        let topics = 0;
        const errors: string[] = [];
        setProgress({ done: 0, total: items.length });
        try {
            for (const part of parts) {
                const result = await importLibraryQuestions(instituteId, {
                    parent_id: null,
                    items: part,
                });
                created += result.created;
                topics += result.nodes_created;
                errors.push(...(result.errors ?? []));
                setProgress((prev) => (prev ? { ...prev, done: prev.done + part.length } : prev));
            }
        } catch (error) {
            toast.error(libraryErrorMessage(error, t('toasts.failed')));
        } finally {
            setProgress(null);
        }
        if (created > 0) {
            onSaved();
            toast.success(t('excel.done', { count: created, topics }));
        }
        if (errors.length > 0) {
            toast.warning(t('add.someFailed', { count: errors.length }), {
                description: errors.slice(0, 3).join('\n'),
            });
        }
        if (created > 0) onOpenChange(false);
    };

    const paths = sheet ? countByPath(sheet.drafts) : [];

    return (
        <MyDialog
            heading={t('excel.title')}
            open={open}
            onOpenChange={(value) => !progress && onOpenChange(value)}
            dialogWidth="max-w-2xl"
            footer={
                sheet ? (
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={!!progress}
                            onClick={() => {
                                setSheet(null);
                                setFileName('');
                            }}
                        >
                            {t('excel.chooseAnother')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={sheet.drafts.length === 0}
                            onAsyncClick={runImport}
                        >
                            {t('excel.import', { count: sheet.drafts.length })}
                        </MyButton>
                    </>
                ) : undefined
            }
        >
            <div className="flex flex-col gap-4">
                <input
                    ref={fileInput}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(event) => void onFile(event.target.files?.[0])}
                />

                {!sheet && (
                    <>
                        <p className="text-body text-neutral-600">{t('excel.intro')}</p>
                        <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-neutral-500">
                            <li>{t('excel.rule1')}</li>
                            <li>{t('excel.rule2')}</li>
                            <li>{t('excel.rule3')}</li>
                            <li>{t('excel.rule4')}</li>
                        </ul>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                className="gap-2"
                                onAsyncClick={downloadTemplate}
                            >
                                <DownloadSimple size={16} />
                                {t('excel.template')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="gap-2"
                                onClick={() => fileInput.current?.click()}
                            >
                                <FileXls size={16} />
                                {t('excel.choose')}
                            </MyButton>
                        </div>
                    </>
                )}

                {sheet && (
                    <>
                        <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3">
                            <span className="truncate text-body font-semibold text-neutral-700">
                                {fileName}
                            </span>
                            <span className="text-caption text-neutral-600">
                                {t('excel.summary', {
                                    ready: sheet.drafts.length,
                                    problems: sheet.errors.length,
                                    topics: paths.length,
                                })}
                            </span>
                        </div>

                        {progress && (
                            <div className="flex flex-col gap-2">
                                <span className="text-caption text-neutral-600">
                                    {t('excel.saving', progress)}
                                </span>
                                <Progress
                                    value={(progress.done / Math.max(progress.total, 1)) * 100}
                                    className="h-2"
                                />
                            </div>
                        )}

                        {sheet.errors.length > 0 && (
                            <div className="flex flex-col gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                                <span className="flex items-center gap-2 text-body font-semibold text-neutral-700">
                                    <WarningCircle size={16} className="text-warning-600" />
                                    {t('excel.problemsTitle', { count: sheet.errors.length })}
                                </span>
                                <ul className="flex flex-col gap-1 text-caption text-neutral-700">
                                    {sheet.errors.slice(0, MAX_ERRORS_SHOWN).map((error) => (
                                        <li key={error.row}>
                                            {t('excel.rowProblem', {
                                                row: error.row,
                                                problem: t(`excel.problem.${error.problem}`),
                                            })}
                                        </li>
                                    ))}
                                    {sheet.errors.length > MAX_ERRORS_SHOWN && (
                                        <li className="text-neutral-500">
                                            {t('excel.moreProblems', {
                                                count: sheet.errors.length - MAX_ERRORS_SHOWN,
                                            })}
                                        </li>
                                    )}
                                </ul>
                            </div>
                        )}

                        {paths.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <span className="text-caption font-semibold uppercase text-neutral-500">
                                    {t('excel.whereTheyGo')}
                                </span>
                                <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
                                    {paths.slice(0, MAX_TOPICS_SHOWN).map((item) => (
                                        <li
                                            key={item.path}
                                            className="flex items-center justify-between gap-3 px-3 py-2 text-body"
                                        >
                                            <span className="min-w-0 truncate text-neutral-700">
                                                {item.path}
                                            </span>
                                            <span className="shrink-0 text-caption text-neutral-500">
                                                {t('browse.questionCount', { count: item.count })}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                {paths.length > MAX_TOPICS_SHOWN && (
                                    <span className="text-caption text-neutral-500">
                                        {t('excel.moreTopics', {
                                            count: paths.length - MAX_TOPICS_SHOWN,
                                        })}
                                    </span>
                                )}
                                <span className="text-caption text-neutral-500">
                                    {t('excel.newTopicsNote')}
                                </span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </MyDialog>
    );
};
