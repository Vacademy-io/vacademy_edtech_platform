import { getInstituteId } from '@/constants/helper';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    handleQueryGetListIndividualTopics,
    handleSortSplitPDF,
    handleStartProcessUploadedFile,
} from '../../../-services/ai-center-service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAICenter } from '../../../-contexts/useAICenterContext';
import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { FilePdf, Sparkle, UploadSimple, X } from '@phosphor-icons/react';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import {
    relativeTime,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '@/routes/ai-center/-utils/format';
import { GeneratingState } from '@/routes/ai-center/-components/GeneratingState';
import { DraftingDonePanel } from '@/routes/ai-center/-components/DraftingDonePanel';
import { RecentFilesPanel } from '@/routes/ai-center/-components/RecentFilesPanel';
import {
    QuestionConfigPanel,
    buildQuestionPrompt,
} from '@/routes/ai-center/-components/QuestionConfigPanel';
import { languageSupport } from '@/constants/dummy-data';

const ACCEPTED_FORMATS = '.pdf,.doc,.docx,.ppt,.pptx,.html';
const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'html'];

type Phase = 'idle' | 'uploading' | 'processing' | 'ready' | 'generating' | 'done';
type FilterMode = 'topic' | 'pages' | 'questionNo';

type FilterOption = {
    value: FilterMode;
    label: string;
    description: string;
    placeholder: string;
};

const buildFilterOptions = (t: TFunction): FilterOption[] => [
    {
        value: 'topic',
        label: t('filterOptions.topic.label'),
        description: t('filterOptions.topic.description'),
        placeholder: t('filterOptions.topic.placeholder'),
    },
    {
        value: 'pages',
        label: t('filterOptions.pages.label'),
        description: t('filterOptions.pages.description'),
        placeholder: t('filterOptions.pages.placeholder'),
    },
    {
        value: 'questionNo',
        label: t('filterOptions.questionNo.label'),
        description: t('filterOptions.questionNo.description'),
        placeholder: t('filterOptions.questionNo.placeholder'),
    },
];

const SortAndSplitTopicQuestions = () => {
    const { t } = useTranslation([
        'aiCenterSortAndSplitTopicQuestions',
        'aiCenterQuestionConfigPanel',
    ]);
    const FILTER_OPTIONS = useMemo(() => buildFilterOptions(t), [t]);
    const [filterMode, setFilterMode] = useState<FilterMode>('topic');
    const [prompt, setPrompt] = useState('');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const { uploadFile } = useFileUpload();
    const { setLoader, setKey } = useAICenter();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [phase, setPhase] = useState<Phase>('idle');
    const [fileName, setFileName] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [enableTasksDialog, setEnableTasksDialog] = useState(false);
    const [uploadedFilePDFId, setUploadedFilePDFId] = useState('');

    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [readyTask, setReadyTask] = useState<AITaskIndividualListInterface | null>(null);
    const [openPreviewDialog, setOpenPreviewDialog] = useState(false);

    const [numQuestions, setNumQuestions] = useState('10');
    const [questionType, setQuestionType] = useState('MCQ');
    const [difficulty, setDifficulty] = useState('Medium');
    const [language, setLanguage] = useState(languageSupport[0]);

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('PDF_TO_QUESTIONS_WITH_TOPIC'),
        staleTime: 30 * 1000,
        refetchInterval:
            pendingTaskId !== null && readyTask === null ? 5000 : false,
    });

    useEffect(() => {
        if (!pendingTaskId || !Array.isArray(recentTasksData)) return;
        const match = recentTasksData.find(
            (task: AITaskIndividualListInterface) => task.id === pendingTaskId
        );
        if (!match) return;
        if (match.status === 'COMPLETED') {
            setReadyTask(match);
        } else if (match.status === 'FAILED') {
            setErrorMessage(t('errors.pullFailed'));
            setPendingTaskId(null);
        }
    }, [recentTasksData, pendingTaskId]);

    const recentTasks = useMemo(() => {
        const list: AITaskIndividualListInterface[] = Array.isArray(recentTasksData)
            ? recentTasksData
            : [];
        return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
    }, [recentTasksData]);

    const sortMutation = useMutation({
        mutationFn: ({
            pdfId,
            userPrompt,
            taskName,
            taskId,
        }: {
            pdfId: string;
            userPrompt: string;
            taskName: string;
            taskId: string;
        }) => {
            setLoader(true);
            setKey('sortSplitPdf');
            return handleSortSplitPDF(pdfId, userPrompt, taskName, taskId);
        },
        onSuccess: (response: unknown) => {
            setLoader(false);
            setKey(null);
            const taskId = (response as { taskId?: string } | null)?.taskId ?? null;
            setPendingTaskId(taskId);
            setReadyTask(null);
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['GET_INDIVIDUAL_AI_LIST_DATA'] });
            }, 100);
        },
        onError: () => {
            setLoader(false);
            setKey(null);
            setPhase('idle');
            setErrorMessage(t('errors.extractFailed'));
        },
    });

    const resetFile = () => {
        setPhase('idle');
        setFileName('');
        setUploadedFilePDFId('');
        setErrorMessage(null);
    };

    const handleGenerate = () => {
        if (!uploadedFilePDFId) return;
        const configPrompt = buildQuestionPrompt(
            t,
            numQuestions,
            questionType,
            difficulty,
            language
        );
        const combinedPrompt = prompt.trim()
            ? `${prompt.trim()}\n${configPrompt}`
            : configPrompt;
        setPhase('generating');
        sortMutation.mutate({
            pdfId: uploadedFilePDFId,
            userPrompt: combinedPrompt,
            taskName: getRandomTaskName(),
            taskId: '',
        });
    };

    const processFile = async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
            setErrorMessage(t('errors.unsupportedFormat', { ext }));
            return;
        }
        if (!prompt.trim()) {
            setErrorMessage(t('errors.missingPrompt'));
            return;
        }
        setErrorMessage(null);
        setFileName(file.name);
        setPhase('uploading');
        setKey('sortSplitPdf');
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: 'your-user-id',
                source: instituteId,
                sourceId: 'STUDENTS',
            });
            if (!fileId) {
                setErrorMessage(t('errors.uploadIncomplete'));
                resetFile();
                return;
            }
            setPhase('processing');
            const response = await handleStartProcessUploadedFile(fileId);
            if (response?.pdf_id) {
                setUploadedFilePDFId(response.pdf_id);
                setPhase('ready');
            } else {
                setErrorMessage(t('errors.readFailed'));
                resetFile();
            }
        } catch (err) {
            console.error(err);
            setErrorMessage(t('errors.genericFailure'));
            resetFile();
        }
    };

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await processFile(file);
        e.target.value = '';
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) await processFile(file);
    };

    const currentOption = FILTER_OPTIONS.find((o) => o.value === filterMode)!;
    const fileChosen = phase !== 'idle' && fileName !== '';
    const isWorking = phase === 'uploading' || phase === 'processing' || phase === 'generating';
    const workingLabel =
        phase === 'uploading'
            ? t('upload.workingUploading')
            : phase === 'processing'
              ? t('upload.workingProcessing')
              : phase === 'generating'
                ? t('upload.workingGenerating')
                : '';

    return (
        <div className="flex w-full flex-col gap-8 px-4 pb-12 sm:px-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {t('header.title')}
                </h1>
                <p className="text-sm text-gray-500">{t('header.subtitle')}</p>
            </header>

            <Section step={1} title={t('sections.step1Title')}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {FILTER_OPTIONS.map((opt) => {
                        const active = opt.value === filterMode;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setFilterMode(opt.value)}
                                disabled={isWorking}
                                className={`flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all disabled:opacity-50 ${
                                    active
                                        ? 'border-primary-300 bg-primary-50 ring-2 ring-primary-100'
                                        : 'border-neutral-200 bg-white hover:border-primary-200'
                                }`}
                            >
                                <span
                                    className={`text-sm font-medium ${
                                        active ? 'text-primary-600' : 'text-gray-900'
                                    }`}
                                >
                                    {opt.label}
                                </span>
                                <span className="text-xs text-neutral-500">
                                    {opt.description}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </Section>

            <Section step={2} title={t('sections.step2Title')}>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    placeholder={currentOption.placeholder}
                    disabled={isWorking}
                    className="w-full resize-y rounded-xl border border-neutral-200 bg-white p-3 text-sm text-gray-900 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                />
            </Section>

            <Section step={3} title={t('sections.step3Title')}>
                {!fileChosen ? (
                    <div
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (!isDragActive) setIsDragActive(true);
                        }}
                        onDragLeave={() => setIsDragActive(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white p-10 text-center transition-colors ${
                            isDragActive
                                ? 'border-primary-400 bg-primary-50'
                                : 'border-neutral-200 hover:border-primary-300 hover:bg-neutral-50'
                        }`}
                    >
                        <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                            <UploadSimple size={22} weight="bold" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <p className="text-sm font-medium text-gray-900">
                                {t('upload.dropTitle')}
                            </p>
                            <p className="text-xs text-neutral-500">{t('upload.dropSubtitle')}</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                    <FilePdf size={20} weight="fill" />
                                </div>
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium text-gray-900">
                                        {fileName}
                                    </span>
                                    <span className="text-xs text-neutral-500">
                                        {phase === 'uploading' && t('upload.statusUploading')}
                                        {phase === 'processing' && t('upload.statusProcessing')}
                                        {phase === 'ready' && t('upload.statusReady')}
                                        {phase === 'generating' && t('upload.statusGenerating')}
                                        {phase === 'done' && t('upload.statusDone')}
                                    </span>
                                </div>
                            </div>
                            {!isWorking && (
                                <button
                                    type="button"
                                    onClick={resetFile}
                                    className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                                    aria-label={t('upload.removeAriaLabel')}
                                >
                                    <X size={18} />
                                </button>
                            )}
                        </div>

                        {readyTask ? (
                            <DraftingDonePanel
                                readyTask={readyTask}
                                openPreview={openPreviewDialog}
                                setOpenPreview={setOpenPreviewDialog}
                                heading={t('generate.doneHeading')}
                                onDraftAnother={() => {
                                    setReadyTask(null);
                                    setPendingTaskId(null);
                                    setErrorMessage(null);
                                    setFilterMode('topic');
                                    setPrompt('');
                                    setNumQuestions('10');
                                    setQuestionType('MCQ');
                                    setDifficulty('Medium');
                                    setLanguage(languageSupport[0]);
                                    resetFile();
                                }}
                            />
                        ) : phase === 'generating' || (pendingTaskId && !readyTask) ? (
                            <GeneratingState
                                title={t('generate.generatingTitle')}
                                subtitle={t('generate.generatingSubtitle')}
                            />
                        ) : isWorking ? (
                            <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                                <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                                <p className="text-sm text-blue-900">{workingLabel}</p>
                            </div>
                        ) : phase === 'ready' ? (
                            <QuestionConfigPanel
                                numQuestions={numQuestions}
                                setNumQuestions={setNumQuestions}
                                questionType={questionType}
                                setQuestionType={setQuestionType}
                                difficulty={difficulty}
                                setDifficulty={setDifficulty}
                                language={language}
                                setLanguage={setLanguage}
                                onSubmit={handleGenerate}
                                ctaLabel={t('generate.ctaLabel')}
                            />
                        ) : null}
                    </div>
                )}
            </Section>

            {errorMessage && (
                <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                    {errorMessage}
                </div>
            )}

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInputChange}
                className="hidden"
                accept={ACCEPTED_FORMATS}
            />

            <RecentFilesPanel
                tasks={recentTasks}
                title={t('recentFiles.title')}
                fallbackLabel={t('recentFiles.fallbackLabel')}
                emptyHint={t('recentFiles.emptyHint')}
                onOpenAll={() => setEnableTasksDialog(true)}
            />

            <AITasksList
                heading={t('tasksList.heading')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
            />
        </div>
    );
};

const Section = ({
    step,
    title,
    children,
}: {
    step: number;
    title: string;
    children: React.ReactNode;
}) => (
    <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-600">
                {step}
            </span>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        </div>
        <div className="pl-9">{children}</div>
    </section>
);

export default SortAndSplitTopicQuestions;
