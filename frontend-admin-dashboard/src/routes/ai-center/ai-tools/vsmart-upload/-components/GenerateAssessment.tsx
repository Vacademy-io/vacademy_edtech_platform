import { getInstituteId } from '@/constants/helper';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    handleConvertPDFToHTML,
    handleGenerateAssessmentQuestions,
    handleQueryGetListIndividualTopics,
    handleStartProcessUploadedFile,
} from '@/routes/ai-center/-services/ai-center-service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import GeneratePageWiseAssessment from './GeneratePageWiseAssessment';
import { useAICenter } from '@/routes/ai-center/-contexts/useAICenterContext';
import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { UseFormReturn } from 'react-hook-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { ArrowRight, FilePdf, Sparkle, UploadSimple, X } from '@phosphor-icons/react';
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
import { languageSupport } from '@/constants/dummy-data';
import {
    QuestionConfigPanel,
    buildQuestionPrompt,
} from '@/routes/ai-center/-components/QuestionConfigPanel';
import { useTranslation } from 'react-i18next';

const ACCEPTED_FORMATS = '.pdf,.doc,.docx,.ppt,.pptx,.html';
const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'html'];

type Phase = 'idle' | 'uploading' | 'processing' | 'ready' | 'generating';

const GenerateAIAssessmentComponent = ({
    form,
    currentSectionIndex,
}: {
    form?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
}) => {
    const { t } = useTranslation(['aiCenterGenerateAssessment', 'aiCenterQuestionConfigPanel']);
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const { setLoader, setKey } = useAICenter();
    const { uploadFile } = useFileUpload();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [phase, setPhase] = useState<Phase>('idle');
    const [fileName, setFileName] = useState('');
    const [uploadedFilePDFId, setUploadedFilePDFId] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [enableTasksDialog, setEnableTasksDialog] = useState(false);

    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [readyTask, setReadyTask] = useState<AITaskIndividualListInterface | null>(null);
    const [openPreviewDialog, setOpenPreviewDialog] = useState(false);

    const [numQuestions, setNumQuestions] = useState('10');
    const [questionType, setQuestionType] = useState('MCQ');
    const [difficulty, setDifficulty] = useState('Medium');
    const [language, setLanguage] = useState(languageSupport[0]);

    const [htmlData, setHtmlData] = useState(null);
    const [openPageWiseAssessmentDialog, setOpenPageWiseAssessmentDialog] = useState(false);
    const [pageWiseGenerateQuestionsStatus, setPageWiseGenerateQuestionsStatus] = useState(false);

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('PDF_TO_QUESTIONS'),
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
        return [...list]
            .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
            .slice(0, 3);
    }, [recentTasksData]);

    const resetFile = () => {
        setPhase('idle');
        setFileName('');
        setUploadedFilePDFId('');
        setErrorMessage(null);
    };

    const processFile = async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
            setErrorMessage(t('errors.unsupportedFileType', { ext }));
            return;
        }
        setErrorMessage(null);
        setFileName(file.name);
        setPhase('uploading');
        setKey('assessment');
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
                setErrorMessage(t('errors.fileUnreadable'));
                resetFile();
            }
        } catch (err) {
            console.error(err);
            setErrorMessage(t('errors.genericReadError'));
            resetFile();
        }
    };

    const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            await processFile(file);
        }
        event.target.value = '';
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            await processFile(file);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragActive) setIsDragActive(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);
    };

    const generateAssessmentMutation = useMutation({
        mutationFn: ({
            pdfId,
            userPrompt,
            taskName,
            taskId,
        }: {
            pdfId: string;
            userPrompt: string;
            taskName: string;
            taskId?: string;
        }) => {
            setLoader(true);
            setKey('assessment');
            return handleGenerateAssessmentQuestions(pdfId, userPrompt, taskName, taskId || '');
        },
        onMutate: () => {
            setPhase('generating');
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
        onError: (error: unknown) => {
            console.log(error);
            setPhase('ready');
            setLoader(false);
            setErrorMessage(t('errors.generateFailed'));
        },
    });

    const pollGenerateAssessment = (_prompt?: string, taskId?: string) => {
        generateAssessmentMutation.mutate({
            pdfId: uploadedFilePDFId,
            userPrompt: buildQuestionPrompt(t, numQuestions, questionType, difficulty, language),
            taskName: getRandomTaskName(),
            taskId,
        });
    };

    const convertPollingCountRef = useRef(0);
    const convertPollingTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
    const MAX_CONVERT_ATTEMPTS = 10;
    const convertPendingRef = useRef(false);

    const handleConvertPDFToHTMLMutation = useMutation({
        mutationFn: ({ pdfId, taskName }: { pdfId: string; taskName: string }) =>
            handleConvertPDFToHTML(pdfId, taskName),
        onSuccess: async (response) => {
            if (response?.status === 'pending') {
                setPageWiseGenerateQuestionsStatus(true);
                convertPendingRef.current = true;
                return;
            }
            convertPendingRef.current = false;
            if (response === 'Done' || response?.html) {
                setPageWiseGenerateQuestionsStatus(false);
                stopConvertPolling();
                setHtmlData(response?.html);
                setOpenPageWiseAssessmentDialog(true);
                return;
            }
            scheduleNextConvertPoll();
        },
        onError: (error: unknown) => {
            console.error('Convert error:', error);
            if (convertPendingRef.current) {
                setPageWiseGenerateQuestionsStatus(true);
                convertPendingRef.current = false;
                scheduleNextConvertPoll();
                return;
            }
            convertPollingCountRef.current += 1;
            if (convertPollingCountRef.current >= MAX_CONVERT_ATTEMPTS) {
                setPageWiseGenerateQuestionsStatus(false);
                stopConvertPolling();
                return;
            }
            scheduleNextConvertPoll();
        },
    });

    const stopConvertPolling = () => {
        if (convertPollingTimeoutIdRef.current) {
            clearTimeout(convertPollingTimeoutIdRef.current);
            convertPollingTimeoutIdRef.current = null;
        }
    };

    const scheduleNextConvertPoll = () => {
        stopConvertPolling();
        if (!convertPendingRef.current) {
            convertPollingTimeoutIdRef.current = setTimeout(() => {
                pollConvertPDFToHTML();
            }, 10000);
        }
    };

    const pollConvertPDFToHTML = () => {
        if (convertPendingRef.current) return;
        handleConvertPDFToHTMLMutation.mutate({
            pdfId: uploadedFilePDFId,
            taskName: getRandomTaskName(),
        });
    };

    const handlePickPages = () => {
        if (!uploadedFilePDFId) return;
        stopConvertPolling();
        convertPollingCountRef.current = 0;
        convertPendingRef.current = false;
        setPageWiseGenerateQuestionsStatus(true);
        pollConvertPDFToHTML();
    };

    useEffect(() => {
        return () => stopConvertPolling();
    }, []);

    const fileChosen = phase !== 'idle' && fileName !== '';
    const isWorking =
        phase === 'uploading' || phase === 'processing' || phase === 'generating';
    const workingLabel =
        phase === 'uploading'
            ? t('workingStatus.uploading')
            : phase === 'processing'
              ? t('workingStatus.processing')
              : phase === 'generating'
                ? t('workingStatus.generating')
                : pageWiseGenerateQuestionsStatus
                  ? t('workingStatus.preparingPages')
                  : '';

    return (
        <div className="flex w-full flex-col gap-8 px-4 pb-12 sm:px-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {t('header.title')}
                </h1>
                <p className="text-sm text-gray-500">{t('header.subtitle')}</p>
            </header>

            {!fileChosen ? (
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white p-10 text-center transition-colors sm:p-14 ${
                        isDragActive
                            ? 'border-primary-400 bg-primary-50'
                            : 'border-neutral-200 hover:border-primary-300 hover:bg-neutral-50'
                    }`}
                >
                    <div className="flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                        <UploadSimple size={26} weight="bold" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <p className="text-base font-medium text-gray-900">
                            {t('dropzone.title')}
                        </p>
                        <p className="text-xs text-neutral-500">{t('dropzone.subtitle')}</p>
                    </div>
                </div>
            ) : (
                <div className="flex w-full flex-col gap-4">
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
                                    {phase === 'uploading' && t('fileCard.status.uploading')}
                                    {phase === 'processing' && t('fileCard.status.processing')}
                                    {phase === 'ready' && t('fileCard.status.ready')}
                                    {phase === 'generating' && t('fileCard.status.generating')}
                                </span>
                            </div>
                        </div>
                        {!isWorking && (
                            <button
                                type="button"
                                onClick={resetFile}
                                className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                                aria-label={t('fileCard.removeFile')}
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
                            heading={t('toolName')}
                            pollGenerateAssessment={pollGenerateAssessment}
                            sectionsForm={form}
                            currentSectionIndex={currentSectionIndex}
                            onDraftAnother={() => {
                                setReadyTask(null);
                                setPendingTaskId(null);
                                setErrorMessage(null);
                                setNumQuestions('10');
                                setQuestionType('MCQ');
                                setDifficulty('Medium');
                                setLanguage(languageSupport[0]);
                                resetFile();
                            }}
                        />
                    ) : phase === 'generating' || (pendingTaskId && !readyTask) ? (
                        <GeneratingState
                            title={t('generatingState.draftingTitle')}
                            subtitle={t('generatingState.draftingSubtitle')}
                        />
                    ) : phase === 'uploading' || phase === 'processing' ? (
                        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                            <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            <p className="text-sm text-blue-900">{workingLabel}</p>
                        </div>
                    ) : pageWiseGenerateQuestionsStatus ? (
                        <GeneratingState
                            title={t('generatingState.preparingPagesTitle')}
                            subtitle={t('generatingState.preparingPagesSubtitle')}
                        />
                    ) : (
                        phase === 'ready' && (
                            <QuestionConfigPanel
                                numQuestions={numQuestions}
                                setNumQuestions={setNumQuestions}
                                questionType={questionType}
                                setQuestionType={setQuestionType}
                                difficulty={difficulty}
                                setDifficulty={setDifficulty}
                                language={language}
                                setLanguage={setLanguage}
                                onSubmit={() => pollGenerateAssessment()}
                                ctaLabel={t('questionConfig.ctaLabel')}
                                secondary={{
                                    label: t('questionConfig.pickPagesLabel'),
                                    onClick: handlePickPages,
                                }}
                            />
                        )
                    )}
                </div>
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
                title={t('recentFiles.title')}
                fallbackLabel={t('recentFiles.fallbackLabel')}
                emptyHint={t('recentFiles.emptyHint')}
                onOpenAll={() => setEnableTasksDialog(true)}
            />

            <GeneratePageWiseAssessment
                openPageWiseAssessmentDialog={openPageWiseAssessmentDialog}
                setOpenPageWiseAssessmentDialog={setOpenPageWiseAssessmentDialog}
                htmlData={htmlData}
            />

            <AITasksList
                heading={t('toolName')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
                pollGenerateAssessment={pollGenerateAssessment}
                sectionsForm={form}
                currentSectionIndex={currentSectionIndex}
            />
        </div>
    );
};

export default GenerateAIAssessmentComponent;
