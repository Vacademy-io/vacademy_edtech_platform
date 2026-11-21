import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getInstituteId } from '@/constants/helper';
import {
    handleGetQuestionsFromAudio,
    handleQueryGetListIndividualTopics,
} from '../../../-services/ai-center-service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAICenter } from '../../../-contexts/useAICenterContext';
import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { UseFormReturn } from 'react-hook-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';
import { languageSupport } from '@/constants/dummy-data';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { ArrowRight, FileAudio, Sparkle, UploadSimple, X } from '@phosphor-icons/react';
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

const ACCEPTED_FORMATS = '.mp3,.wav,.flac,.aac,.m4a';
const ACCEPTED_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'm4a'];
const DIFFICULTY_OPTIONS = ['Easy', 'Medium', 'Hard'];

// DIFFICULTY_OPTIONS holds the literal values submitted to the API (and
// compared against the current selection); map each one to its translation
// key so the *displayed* label can be localized without touching the value.
const DIFFICULTY_LABEL_KEYS: Record<string, string> = {
    Easy: 'easy',
    Medium: 'medium',
    Hard: 'hard',
};

// languageSupport (shared constant) holds raw enum values like 'ENGLISH' /
// 'HINDI'; map them to translation keys for display only.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    ENGLISH: 'english',
    HINDI: 'hindi',
};

type Phase = 'idle' | 'uploading' | 'processing' | 'configuring' | 'generating' | 'done';

export const GenerateQuestionsFromAudio = ({
    form,
    currentSectionIndex,
}: {
    form?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
}) => {
    const { t } = useTranslation('aiCenterGenerateQuestionsFromAudio');
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const { uploadFile } = useFileUpload();
    const { setLoader, setKey } = useAICenter();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [phase, setPhase] = useState<Phase>('idle');
    const [fileName, setFileName] = useState('');
    const [audioId, setAudioId] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [enableTasksDialog, setEnableTasksDialog] = useState(false);

    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [readyTask, setReadyTask] = useState<AITaskIndividualListInterface | null>(null);
    const [openPreviewDialog, setOpenPreviewDialog] = useState(false);

    const [prompt, setPrompt] = useState('');
    const [numQuestions, setNumQuestions] = useState('10');
    const [difficulty, setDifficulty] = useState('Medium');
    const [language, setLanguage] = useState(languageSupport[0]);

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('AUDIO_TO_QUESTIONS'),
        staleTime: 30 * 1000,
        refetchInterval:
            pendingTaskId !== null && readyTask === null ? 5000 : false,
    });

    useEffect(() => {
        if (!pendingTaskId || !Array.isArray(recentTasksData)) return;
        const match = recentTasksData.find(
            (t: AITaskIndividualListInterface) => t.id === pendingTaskId
        );
        if (!match) return;
        if (match.status === 'COMPLETED') {
            setReadyTask(match);
        } else if (match.status === 'FAILED') {
            setErrorMessage(t('errors.taskFailed'));
            setPendingTaskId(null);
        }
    }, [recentTasksData, pendingTaskId]);

    const recentTasks = useMemo(() => {
        const list: AITaskIndividualListInterface[] = Array.isArray(recentTasksData)
            ? recentTasksData
            : [];
        return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
    }, [recentTasksData]);

    const generateMutation = useMutation({
        mutationFn: ({
            audioId,
            numQuestions,
            prompt,
            difficulty,
            language,
            taskName,
        }: {
            audioId: string;
            numQuestions: string;
            prompt: string;
            difficulty: string;
            language: string;
            taskName: string;
        }) => {
            setLoader(true);
            setKey('audio');
            return handleGetQuestionsFromAudio(
                audioId,
                numQuestions,
                prompt,
                difficulty,
                language,
                taskName,
                ''
            );
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
            setPhase('configuring');
            setErrorMessage(t('errors.generateFailed'));
        },
    });

    const resetAll = () => {
        setPhase('idle');
        setFileName('');
        setAudioId('');
        setErrorMessage(null);
    };

    const processFile = async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
            setErrorMessage(t('errors.unsupportedFormat', { ext }));
            return;
        }
        setErrorMessage(null);
        setFileName(file.name);
        setPhase('uploading');
        setKey('audio');
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
                resetAll();
                return;
            }
            // Single-step (migrated): hold the uploaded fileId; ai_service
            // transcribes it in-house during generation. No separate
            // transcription-submit step.
            setAudioId(fileId);
            setPhase('configuring');
        } catch (err) {
            console.error(err);
            setErrorMessage(t('errors.readError'));
            resetAll();
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

    const onGenerate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!audioId) return;
        if (!prompt.trim()) {
            setErrorMessage(t('errors.missingFocus'));
            return;
        }
        if (!numQuestions || Number(numQuestions) < 1) {
            setErrorMessage(t('errors.missingCount'));
            return;
        }
        setErrorMessage(null);
        setPhase('generating');
        generateMutation.mutate({
            audioId,
            numQuestions,
            prompt,
            difficulty,
            language,
            taskName: getRandomTaskName(),
        });
    };

    const fileChosen = phase !== 'idle' && fileName !== '';
    const isUploadWorking = phase === 'uploading' || phase === 'processing';
    const uploadLabel =
        phase === 'uploading'
            ? t('upload.uploading')
            : phase === 'processing'
              ? t('upload.transcribing')
              : '';

    return (
        <div className="flex w-full flex-col gap-8 px-4 pb-12 sm:px-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {t('header.title')}
                </h1>
                <p className="text-sm text-gray-500">{t('header.subtitle')}</p>
            </header>

            <Section step={1} title={t('sections.dropRecording')}>
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
                                {t('upload.dropzoneTitle')}
                            </p>
                            <p className="text-xs text-neutral-500">{t('upload.dropzoneHint')}</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                    <FileAudio size={20} weight="fill" />
                                </div>
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium text-gray-900">
                                        {fileName}
                                    </span>
                                    <span className="text-xs text-neutral-500">
                                        {phase === 'uploading' && t('fileStatus.uploading')}
                                        {phase === 'processing' && t('fileStatus.transcribing')}
                                        {phase === 'configuring' &&
                                            t('fileStatus.readyToConfigure')}
                                        {phase === 'generating' && t('fileStatus.drafting')}
                                        {phase === 'done' && t('fileStatus.done')}
                                    </span>
                                </div>
                            </div>
                            {phase !== 'uploading' &&
                                phase !== 'processing' &&
                                phase !== 'generating' && (
                                    <button
                                        type="button"
                                        onClick={resetAll}
                                        className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                                        aria-label={t('upload.removeFile')}
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                        </div>

                        {isUploadWorking && (
                            <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                                <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                                <p className="text-sm text-blue-900">{uploadLabel}</p>
                            </div>
                        )}
                    </div>
                )}
            </Section>

            {phase !== 'idle' &&
                phase !== 'uploading' &&
                phase !== 'processing' && (
                    <>
                        <Section step={2} title={t('sections.questionKind')}>
                            <form onSubmit={onGenerate} className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-neutral-600">
                                        {t('fields.focusAreas.label')}
                                    </label>
                                    <textarea
                                        value={prompt}
                                        onChange={(e) => setPrompt(e.target.value)}
                                        rows={3}
                                        placeholder={t('fields.focusAreas.placeholder')}
                                        disabled={phase === 'generating'}
                                        className="w-full resize-y rounded-xl border border-neutral-200 bg-white p-3 text-sm placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                    />
                                </div>

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-neutral-600">
                                            {t('fields.numQuestions.label')}
                                        </label>
                                        <input
                                            value={numQuestions}
                                            onChange={(e) =>
                                                setNumQuestions(
                                                    e.target.value.replace(/\D/g, '')
                                                )
                                            }
                                            inputMode="numeric"
                                            placeholder={t('fields.numQuestions.placeholder')}
                                            disabled={phase === 'generating'}
                                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-neutral-600">
                                            {t('fields.difficulty.label')}
                                        </label>
                                        <div className="flex gap-1.5">
                                            {DIFFICULTY_OPTIONS.map((d) => (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    onClick={() => setDifficulty(d)}
                                                    disabled={phase === 'generating'}
                                                    className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                                                        difficulty === d
                                                            ? 'border-primary-300 bg-primary-50 text-primary-600'
                                                            : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
                                                    } disabled:opacity-50`}
                                                >
                                                    {t(`difficulties.${DIFFICULTY_LABEL_KEYS[d]}`)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-medium text-neutral-600">
                                            {t('fields.language.label')}
                                        </label>
                                        <select
                                            value={language}
                                            onChange={(e) => setLanguage(e.target.value)}
                                            disabled={phase === 'generating'}
                                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
                                        >
                                            {languageSupport.map((lang) => (
                                                <option key={lang} value={lang}>
                                                    {LANGUAGE_LABEL_KEYS[lang]
                                                        ? t(
                                                              `languages.${LANGUAGE_LABEL_KEYS[lang]}`
                                                          )
                                                        : lang.charAt(0) +
                                                          lang.slice(1).toLowerCase()}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {readyTask ? (
                                    <DraftingDonePanel
                                        readyTask={readyTask}
                                        openPreview={openPreviewDialog}
                                        setOpenPreview={setOpenPreviewDialog}
                                        heading={t('taskListHeading')}
                                        sectionsForm={form}
                                        currentSectionIndex={currentSectionIndex}
                                        onDraftAnother={() => {
                                            setReadyTask(null);
                                            setPendingTaskId(null);
                                            setErrorMessage(null);
                                            setPrompt('');
                                            setNumQuestions('10');
                                            setDifficulty('Medium');
                                            setLanguage(languageSupport[0]);
                                            resetAll();
                                        }}
                                    />
                                ) : phase === 'generating' || (pendingTaskId && !readyTask) ? (
                                    <GeneratingState
                                        title={t('progress.title')}
                                        subtitle={t('progress.subtitle')}
                                    />
                                ) : (
                                    <button
                                        type="submit"
                                        className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                                    >
                                        {t('actions.draftQuestions')}
                                        <ArrowRight size={16} weight="bold" />
                                    </button>
                                )}
                            </form>
                        </Section>
                    </>
                )}

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
                title={t('recentDrafts.title')}
                fallbackLabel={t('recentDrafts.fallbackLabel')}
                emptyHint={t('recentDrafts.emptyHint')}
                onOpenAll={() => setEnableTasksDialog(true)}
            />

            <AITasksList
                heading={t('taskListHeading')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
                sectionsForm={form}
                currentSectionIndex={currentSectionIndex}
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

export default GenerateQuestionsFromAudio;
