import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormProvider } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowLeft,
    ArrowRight,
    Check,
    CheckCircle,
    CircleNotch,
    Copy,
    File as FileIcon,
    Info,
    Question,
    UploadSimple,
    Warning,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { QuestionPaperTemplateProps } from '@/types/assessments/question-paper-template';
import { useFilterDataForAssesment } from '../../assessment-list/-utils.ts/useFiltersData';
import { uploadDocsFile } from '../-services/question-paper-services';
import { getPPTViewTitle, transformResponseDataToMyQuestionsSchema } from '../-utils/helper';
import {
    filterQuestionsBySkipSet,
    QuestionIssue,
    validateUploadedQuestions,
} from '../-utils/validate-uploaded-questions';
import { QuestionType } from '@/constants/dummy-data';
import { BasicFormFields, useQuestionPaperForm } from './QuestionPaperUpload';
import { QuestionPaperTemplate } from './QuestionPaperTemplate';
import { useSaveQuestionPaper } from '../-hooks/useSaveQuestionPaper';

interface UploadQuestionPaperDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBack: () => void;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
}

type Phase = 'idle' | 'uploading' | 'done';

const stripHtml = (html: string | null | undefined) => {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
};

// The parser ignores whatever markers are sent (DocxToHtmlController overwrites them);
// these match the defaults of the upload form.
const MARKERS = { question: '(1.)', option: '(a.)', answer: 'Ans:', explanation: 'Exp:' };

/**
 * Upload from device, in two steps: details + file (the file is read as soon as it is
 * dropped, like before), then a review of every question with the flagged ones marked —
 * the same checks as the old diagnostics dialog. Fixing a question opens the existing editor.
 */
export const UploadQuestionPaperDialog = ({
    open,
    onOpenChange,
    onBack,
    currentQuestionIndex,
    setCurrentQuestionIndex,
}: UploadQuestionPaperDialogProps) => {
    const { t } = useTranslation('assessmentQuestionPapersPage');
    const { t: tUpload } = useTranslation('assessmentQuestionPaperUpload');
    const { instituteDetails } = useInstituteDetailsStore();
    const { YearClassFilterData, SubjectFilterData } = useFilterDataForAssesment(instituteDetails);
    const form = useQuestionPaperForm('EXAM');
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { save, isSaving } = useSaveQuestionPaper();

    const [step, setStep] = useState<1 | 2>(1);
    const [phase, setPhase] = useState<Phase>('idle');
    const [progress, setProgress] = useState(0);
    const [parsed, setParsed] = useState<MyQuestion[]>([]);
    const [issues, setIssues] = useState<QuestionIssue[]>([]);
    const [skip, setSkip] = useState<Set<number>>(new Set());
    const [reviewFilter, setReviewFilter] = useState<'all' | 'flagged'>('all');
    const [openSections, setOpenSections] = useState<string[]>([]);
    const [editorOpen, setEditorOpen] = useState(false);
    // Once the questions have been opened in the editor, the form holds the edited set;
    // saving from the review step must use that, not the parsed originals.
    const [editedInEditor, setEditedInEditor] = useState(false);

    const title = form.watch('title');
    const file = form.watch('fileUpload') as File | null | undefined;

    const resetFile = () => {
        form.setValue('fileUpload', null as unknown as File);
        form.setValue('questions', []);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setPhase('idle');
        setProgress(0);
        setParsed([]);
        setIssues([]);
        setSkip(new Set());
        setEditedInEditor(false);
    };

    useEffect(() => {
        if (open) {
            form.reset();
            resetFile();
            setStep(1);
            setReviewFilter('all');
            setOpenSections([]);
            setCurrentQuestionIndex(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const uploadMutation = useMutation({
        mutationFn: (selected: File) =>
            uploadDocsFile(
                MARKERS.question,
                MARKERS.option,
                MARKERS.answer,
                MARKERS.explanation,
                selected,
                setProgress
            ),
        onMutate: () => {
            setPhase('uploading');
            setProgress(0);
        },
        onSuccess: (data) => {
            const questions = transformResponseDataToMyQuestionsSchema(data);
            const found = validateUploadedQuestions(questions, 'EXAM');
            setParsed(questions);
            setIssues(found);
            // Errors are skipped by default, warnings kept — as in the old diagnostics dialog.
            setSkip(
                new Set(found.filter((i) => i.severity === 'error').map((i) => i.questionIndex))
            );
            setPhase('done');
            if (questions.length === 0) setOpenSections(['rules']);
        },
        onError: (error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
            resetFile();
        },
    });

    const handleFileSubmit = (selected: File) => {
        form.setValue('fileUpload', selected);
        if (!form.getValues('title')?.trim()) {
            form.setValue(
                'title',
                selected.name.replace(/\.(docx?|html?)$/i, '').replace(/_+/g, ' '),
                {
                    shouldValidate: true,
                }
            );
        }
        uploadMutation.mutate(selected);
    };

    const grouped = useMemo(() => {
        const map = new Map<number, { hasError: boolean; issues: QuestionIssue[] }>();
        issues.forEach((issue) => {
            const entry = map.get(issue.questionIndex) ?? { hasError: false, issues: [] };
            entry.issues.push(issue);
            if (issue.severity === 'error') entry.hasError = true;
            map.set(issue.questionIndex, entry);
        });
        return map;
    }, [issues]);

    const errorCount = [...grouped.values()].filter((g) => g.hasError).length;
    const warningCount = grouped.size - errorCount;
    const editorQuestions = (form.watch('questions') || []) as unknown as MyQuestion[];
    const keptCount = editedInEditor ? editorQuestions.length : parsed.length - skip.size;
    const canReview = phase === 'done' && parsed.length > 0 && !!title?.trim();

    const submit = (questions: MyQuestion[]) => {
        form.setValue('questions', questions);
        form.handleSubmit(
            (values) =>
                save(values, {
                    onSaved: () => {
                        setEditorOpen(false);
                        onOpenChange(false);
                        setCurrentQuestionIndex(0);
                        toast.success(
                            skip.size && !editedInEditor
                                ? t('toasts.addedWithSkipped', {
                                      title: values.title,
                                      skipped: skip.size,
                                  })
                                : t('toasts.added', { title: values.title })
                        );
                    },
                }),
            () => {
                // Something kept still needs a fix: open the editor on it instead of failing silently.
                toast.error(tUpload('toasts.incompleteQuestions'));
                form.trigger('questions');
                setCurrentQuestionIndex(0);
                setEditedInEditor(true);
                setEditorOpen(true);
            }
        )();
    };

    const keepAllAndFix = () => {
        // A second click reopens the editor on what was already edited.
        if (!editedInEditor) form.setValue('questions', parsed);
        form.trigger('questions');
        const firstFlagged = [...grouped.keys()].sort((a, b) => a - b)[0];
        setCurrentQuestionIndex(firstFlagged ?? 0);
        setEditedInEditor(true);
        setEditorOpen(true);
    };

    const copyDiagnostics = async () => {
        const payload = {
            totalQuestions: parsed.length,
            totalIssues: issues.length,
            questionsWithIssues: grouped.size,
            issues: issues.map((i) => ({
                questionIndex: i.questionIndex,
                questionType: i.questionType,
                severity: i.severity,
                code: i.code,
                message: i.message,
                questionPreview: i.questionPreview,
            })),
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
            toast.success(t('upload.review.copied'));
        } catch {
            toast.error(t('upload.review.copyFailed'));
        }
    };

    const nextHint = !file
        ? t('upload.hints.chooseFile')
        : phase !== 'done'
          ? t('upload.hints.reading')
          : parsed.length === 0
            ? t('upload.hints.nothing')
            : !title?.trim()
              ? t('upload.hints.addTitle')
              : t('upload.hints.ready', { count: parsed.length });

    const steps = (
        <div className="flex flex-wrap items-center gap-2 text-caption font-semibold">
            {[t('upload.steps.details'), t('upload.steps.review'), t('upload.steps.saved')].map(
                (label, i) => {
                    const n = i + 1;
                    const done = n < step;
                    const active = n === step;
                    return (
                        <div key={label} className="flex items-center gap-2">
                            {i > 0 && <span className="h-px w-6 bg-neutral-200" />}
                            <span
                                className={cn(
                                    'flex size-5 items-center justify-center rounded-full border text-2xs',
                                    done && 'border-success-500 bg-success-500 text-white',
                                    active && 'border-primary-500 bg-primary-500 text-white',
                                    !done && !active && 'border-neutral-300 text-neutral-400'
                                )}
                            >
                                {done ? <Check size={12} weight="bold" /> : n}
                            </span>
                            <span
                                className={cn(
                                    done && 'text-success-600',
                                    active && 'text-neutral-700',
                                    !done && !active && 'text-neutral-400'
                                )}
                            >
                                {label}
                            </span>
                        </div>
                    );
                }
            )}
        </div>
    );

    const fileBlock = !file ? (
        <FileUploadComponent
            fileInputRef={fileInputRef}
            onFileSubmit={handleFileSubmit}
            control={form.control}
            name="fileUpload"
            className="rounded-lg"
        >
            <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-primary-300 bg-primary-50 p-6 text-center transition-colors hover:border-primary-500">
                <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-white text-primary-500 shadow-sm">
                    <UploadSimple size={24} />
                </span>
                <span className="text-subtitle font-semibold text-neutral-700">
                    {t('upload.dropTitle')}
                </span>
                <span className="text-caption text-primary-500 underline underline-offset-2">
                    {t('upload.dropBrowse')}
                </span>
            </div>
        </FileUploadComponent>
    ) : (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-info-50 text-info-600">
                    <FileIcon size={20} />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="break-all text-body font-semibold text-neutral-700">
                        {file.name}
                    </p>
                    {phase === 'uploading' ? (
                        <div className="mt-1 flex flex-col gap-1">
                            <Progress value={progress} className="h-1.5" />
                            <span className="flex items-center gap-1 text-caption text-neutral-500">
                                {progress >= 99 ? (
                                    <>
                                        <CircleNotch size={14} className="animate-spin" />
                                        {t('upload.processing')}
                                    </>
                                ) : (
                                    t('upload.uploading', { percent: progress })
                                )}
                            </span>
                        </div>
                    ) : (
                        <span className="text-caption text-neutral-500">
                            {t('upload.fileRead', {
                                size: ((file.size || 0) / (1024 * 1024)).toFixed(2),
                            })}
                        </span>
                    )}
                </div>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="icon"
                    aria-label={t('upload.removeFile')}
                    disable={phase === 'uploading'}
                    onClick={resetFile}
                >
                    <X size={14} />
                </MyButton>
            </div>
            {phase === 'done' && parsed.length === 0 && (
                <div className="flex gap-3 rounded-lg border border-danger-200 bg-danger-50 p-3">
                    <WarningCircle size={20} className="shrink-0 text-danger-600" />
                    <div className="flex flex-col gap-1">
                        <p className="text-body font-semibold text-neutral-700">
                            {t('upload.zero.title')}
                        </p>
                        <p className="text-caption text-neutral-600">{t('upload.zero.body')}</p>
                        <ul className="list-disc pl-5 text-caption text-neutral-600">
                            <li>{t('upload.zero.reason1')}</li>
                            <li>{t('upload.zero.reason2')}</li>
                            <li>{t('upload.zero.reason3')}</li>
                        </ul>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                className="h-8 gap-1"
                                onClick={() => setOpenSections(['rules'])}
                            >
                                <Info size={14} />
                                {t('upload.zero.seeFormat')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                className="h-8 gap-1"
                                onClick={resetFile}
                            >
                                <UploadSimple size={14} />
                                {t('upload.zero.chooseAnother')}
                            </MyButton>
                        </div>
                    </div>
                </div>
            )}
            {phase === 'done' && parsed.length > 0 && (
                <div
                    className={cn(
                        'flex gap-3 rounded-lg border p-3',
                        grouped.size
                            ? 'border-warning-200 bg-warning-50'
                            : 'border-success-200 bg-success-50'
                    )}
                >
                    {grouped.size ? (
                        <Warning size={20} className="shrink-0 text-warning-600" />
                    ) : (
                        <CheckCircle size={20} className="shrink-0 text-success-600" />
                    )}
                    <div className="flex flex-col">
                        <p className="text-body font-semibold text-neutral-700">
                            {grouped.size
                                ? t('upload.found.issuesTitle', {
                                      count: parsed.length,
                                      flagged: grouped.size,
                                  })
                                : t('upload.found.cleanTitle', { count: parsed.length })}
                        </p>
                        <p className="text-caption text-neutral-600">
                            {grouped.size
                                ? t('upload.found.issuesBody', {
                                      errors: errorCount,
                                      warnings: warningCount,
                                  })
                                : t('upload.found.cleanBody')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );

    const rules: [string, string][] = [
        [t('upload.rules.question'), t('upload.rules.questionRule')],
        [t('upload.rules.options'), t('upload.rules.optionsRule')],
        [t('upload.rules.answer'), t('upload.rules.answerRule')],
        [t('upload.rules.explanation'), t('upload.rules.explanationRule')],
        [t('upload.rules.tags'), t('upload.rules.tagsRule')],
        [t('upload.rules.passage'), t('upload.rules.passageRule')],
    ];

    const stepOne = (
        <div className="flex flex-col gap-6">
            {steps}
            <BasicFormFields
                form={form}
                YearClassFilterData={YearClassFilterData}
                SubjectFilterData={SubjectFilterData}
            />
            {fileBlock}
            <Accordion
                type="multiple"
                value={openSections}
                onValueChange={setOpenSections}
                className="rounded-lg border border-neutral-200 px-4"
            >
                <AccordionItem value="rules">
                    <AccordionTrigger className="text-body">
                        <span className="flex items-center gap-2">
                            <Info size={16} className="text-neutral-500" />
                            {t('upload.rules.title')}
                            <span className="font-normal text-neutral-500">
                                {t('upload.rules.summary')}
                            </span>
                        </span>
                    </AccordionTrigger>
                    <AccordionContent>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="flex flex-col gap-3">
                                <dl className="flex flex-col divide-y divide-neutral-100 text-caption">
                                    {rules.map(([label, rule]) => (
                                        <div key={label} className="flex gap-3 py-2">
                                            <dt className="w-20 shrink-0 font-semibold text-neutral-500">
                                                {label}
                                            </dt>
                                            <dd className="text-neutral-700">{rule}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <div className="rounded-md border border-warning-200 bg-warning-50 p-3 text-caption text-neutral-700">
                                    <p className="font-semibold text-warning-700">
                                        {t('upload.rules.cantReadTitle')}
                                    </p>
                                    <ul className="list-disc pl-5">
                                        <li>{t('upload.rules.cantRead1')}</li>
                                        <li>{t('upload.rules.cantRead2')}</li>
                                    </ul>
                                </div>
                            </div>
                            <div className="rounded-md border border-neutral-200 bg-white p-4 font-mono text-caption leading-relaxed text-neutral-700 shadow-sm">
                                <p className="mb-2 font-sans font-semibold text-neutral-500">
                                    {t('upload.rules.example')}
                                </p>
                                <p>
                                    (1.) A man walks 5 km north, turns right and walks 3 km. Which
                                    direction is he facing?
                                </p>
                                <p>(a.) North</p>
                                <p>(b.) East</p>
                                <p>(c.) South</p>
                                <p>(d.) West</p>
                                <p>Ans: B</p>
                                <p>Exp: Turning right from north means facing east.</p>
                                <p>Tags: Directions</p>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="trouble" className="border-b-0">
                    <AccordionTrigger className="text-body">
                        <span className="flex items-center gap-2">
                            <Question size={16} className="text-neutral-500" />
                            {t('upload.trouble.title')}
                            <span className="font-normal text-neutral-500">
                                {t('upload.trouble.summary')}
                            </span>
                        </span>
                    </AccordionTrigger>
                    <AccordionContent>
                        <ol className="list-decimal pl-5 text-caption text-neutral-700">
                            <li>
                                <a
                                    href="https://wordtohtml.net/convert/docx-to-html"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary-500 underline underline-offset-2"
                                >
                                    {t('upload.trouble.step1')}
                                </a>
                            </li>
                            <li>{t('upload.trouble.step2')}</li>
                            <li>{t('upload.trouble.step3')}</li>
                        </ol>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );

    const rows = parsed
        .map((question, index) => ({ question, index, group: grouped.get(index) }))
        .filter((row) => reviewFilter === 'all' || row.group);

    const stepTwo = (
        <div className="flex flex-col gap-4">
            {steps}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { label: t('upload.review.found'), value: parsed.length, tone: 'neutral' },
                    {
                        label: t('upload.review.ready'),
                        value: parsed.length - grouped.size,
                        tone: 'success',
                    },
                    { label: t('upload.review.withErrors'), value: errorCount, tone: 'danger' },
                    {
                        label: t('upload.review.withWarnings'),
                        value: warningCount,
                        tone: 'warning',
                    },
                ].map((stat) => (
                    <div
                        key={stat.label}
                        className={cn(
                            'rounded-lg border p-3',
                            stat.tone === 'neutral' && 'border-neutral-200 bg-white',
                            stat.tone === 'success' && 'border-success-200 bg-success-50',
                            stat.tone === 'danger' &&
                                (stat.value
                                    ? 'border-danger-200 bg-danger-50'
                                    : 'border-neutral-200 bg-white'),
                            stat.tone === 'warning' &&
                                (stat.value
                                    ? 'border-warning-200 bg-warning-50'
                                    : 'border-neutral-200 bg-white')
                        )}
                    >
                        <p className="text-h3-semibold text-neutral-700">{stat.value}</p>
                        <p className="text-caption text-neutral-500">{stat.label}</p>
                    </div>
                ))}
            </div>
            {grouped.size > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                    <Tabs
                        value={reviewFilter}
                        onValueChange={(v) => setReviewFilter(v as 'all' | 'flagged')}
                    >
                        <TabsList>
                            <TabsTrigger value="all">
                                {t('upload.review.all', { count: parsed.length })}
                            </TabsTrigger>
                            <TabsTrigger value="flagged">
                                {t('upload.review.needsAttention', { count: grouped.size })}
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <span className="ml-auto text-caption text-neutral-600">
                        {t('upload.review.skipSummary', { skip: skip.size, kept: keptCount })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="default"
                        onClick={() => setSkip(new Set(grouped.keys()))}
                    >
                        {t('upload.review.skipAll')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="default"
                        onClick={() => setSkip(new Set())}
                    >
                        {t('upload.review.skipNone')}
                    </MyButton>
                </div>
            )}
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
                {rows.map(({ question, index, group }) => {
                    const skipped = skip.has(index);
                    return (
                        <li
                            key={index}
                            className={cn('flex gap-3 p-3', skipped ? 'bg-neutral-50' : 'bg-white')}
                        >
                            <span className="w-8 shrink-0 pt-0.5 text-caption font-semibold text-neutral-500">
                                Q{index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="text-2xs">
                                        {getPPTViewTitle(question.questionType as QuestionType)}
                                    </Badge>
                                    {group && (
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                'text-2xs',
                                                group.hasError
                                                    ? 'border-danger-200 bg-danger-50 text-danger-600'
                                                    : 'border-warning-200 bg-warning-50 text-warning-700'
                                            )}
                                        >
                                            {group.hasError
                                                ? t('upload.review.error')
                                                : t('upload.review.warning')}
                                        </Badge>
                                    )}
                                    {skipped && (
                                        <Badge variant="secondary" className="text-2xs">
                                            {t('upload.review.willSkip')}
                                        </Badge>
                                    )}
                                </div>
                                <p
                                    className={cn(
                                        'line-clamp-2 text-body',
                                        skipped
                                            ? 'text-neutral-400 line-through'
                                            : 'text-neutral-700'
                                    )}
                                >
                                    {stripHtml(question.questionName) || '—'}
                                </p>
                                {group?.issues.map((issue, i) => (
                                    <p key={i} className="mt-1 flex gap-2 text-caption">
                                        <WarningCircle
                                            size={14}
                                            className={cn(
                                                'mt-0.5 shrink-0',
                                                issue.severity === 'error'
                                                    ? 'text-danger-500'
                                                    : 'text-warning-500'
                                            )}
                                        />
                                        <span>
                                            <span className="font-semibold text-neutral-700">
                                                {issue.message}
                                            </span>{' '}
                                            <span className="text-neutral-500">{issue.hint}</span>
                                        </span>
                                    </p>
                                ))}
                            </div>
                            {group ? (
                                <label className="flex shrink-0 cursor-pointer items-start gap-2 text-caption font-semibold text-neutral-600">
                                    <Checkbox
                                        checked={skipped}
                                        onCheckedChange={() =>
                                            setSkip((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(index)) next.delete(index);
                                                else next.add(index);
                                                return next;
                                            })
                                        }
                                    />
                                    {t('upload.review.skip')}
                                </label>
                            ) : (
                                <CheckCircle size={18} className="shrink-0 text-success-500" />
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );

    const footerLeft =
        step === 1 ? (
            <MyButton
                type="button"
                buttonType="text"
                scale="medium"
                layoutVariant="default"
                className="gap-1 px-0"
                onClick={onBack}
            >
                <ArrowLeft size={16} />
                {t('form.allOptions')}
            </MyButton>
        ) : (
            <div className="flex items-center gap-2">
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    layoutVariant="default"
                    className="gap-1 px-0"
                    onClick={() => setStep(1)}
                >
                    <ArrowLeft size={16} />
                    {t('upload.review.back')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    layoutVariant="default"
                    className="gap-1"
                    onClick={copyDiagnostics}
                >
                    <Copy size={14} />
                    {t('upload.review.copy')}
                </MyButton>
            </div>
        );

    const footer =
        step === 1 ? (
            <>
                <span className="hidden text-caption text-neutral-500 sm:inline">{nextHint}</span>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    onClick={() => onOpenChange(false)}
                >
                    {t('form.cancel')}
                </MyButton>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    layoutVariant="default"
                    className="gap-1"
                    disable={!canReview}
                    onClick={() => setStep(2)}
                >
                    {t('upload.reviewQuestions')}
                    <ArrowRight size={16} />
                </MyButton>
            </>
        ) : (
            <>
                {grouped.size > 0 && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={keepAllAndFix}
                    >
                        {t('upload.review.keepAll')}
                    </MyButton>
                )}
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    layoutVariant="default"
                    className="gap-1"
                    disable={keptCount === 0 || isSaving}
                    onClick={() =>
                        submit(
                            editedInEditor
                                ? editorQuestions
                                : filterQuestionsBySkipSet(parsed, skip)
                        )
                    }
                >
                    <Check size={16} />
                    {t('upload.review.save', { count: keptCount })}
                </MyButton>
            </>
        );

    return (
        <MyDialog
            heading={t('upload.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-3xl"
            footerLeft={footerLeft}
            footer={footer}
        >
            <FormProvider {...form}>
                <form onSubmit={(e) => e.preventDefault()}>{step === 1 ? stepOne : stepTwo}</form>
                <QuestionPaperTemplate
                    form={form as unknown as QuestionPaperTemplateProps['form']}
                    questionPaperId="1"
                    isViewMode={false}
                    buttonText=""
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    examType="EXAM"
                    open={editorOpen}
                    onOpenChange={setEditorOpen}
                    hideTrigger
                    onValidSave={
                        isSaving
                            ? () => undefined
                            : () => submit(form.getValues('questions') as unknown as MyQuestion[])
                    }
                />
            </FormProvider>
        </MyDialog>
    );
};
