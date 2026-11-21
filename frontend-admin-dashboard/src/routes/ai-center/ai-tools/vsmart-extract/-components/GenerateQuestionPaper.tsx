import { getInstituteId } from '@/constants/helper';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    handleGenerateAssessmentQuestions,
    handleQueryGetListIndividualTopics,
    handleStartProcessUploadedFile,
} from '../../../-services/ai-center-service';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAICenter } from '../../../-contexts/useAICenterContext';
import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { UseFormReturn } from 'react-hook-form';
import { SectionFormType } from '@/types/assessments/assessment-steps';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { FilePdf, UploadSimple, X } from '@phosphor-icons/react';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { GeneratingState } from '@/routes/ai-center/-components/GeneratingState';
import { DraftingDonePanel } from '@/routes/ai-center/-components/DraftingDonePanel';
import { RecentFilesPanel } from '@/routes/ai-center/-components/RecentFilesPanel';
import {
    ExtractOptionsPanel,
    type PaperInfo,
} from '@/routes/ai-center/-components/ExtractOptionsPanel';
import type { SectionMode } from '@/routes/ai-center/-services/ai-center-service';

const ACCEPTED_FORMATS = '.pdf,.doc,.docx,.ppt,.pptx,.html';
const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'html'];

type Phase = 'idle' | 'uploading' | 'processing' | 'ready' | 'generating' | 'done';

const GenerateAiQuestionPaperComponent = ({
    form,
    currentSectionIndex,
    sectionSplit = false,
}: {
    form?: UseFormReturn<SectionFormType>;
    currentSectionIndex?: number;
    /**
     * The target can hold several sections (assessment / homework wizards):
     * a paper with sections may become one section each, and the teacher is
     * asked which they want next to the credit line. A quiz cannot, so it is
     * never asked and always gets a single section.
     */
    sectionSplit?: boolean;
}) => {
    const { t } = useTranslation([
        'aiCenterVsmartExtractGenerateQuestionPaper',
        'aiCenterExtractOptionsPanel',
    ]);
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const { setLoader, setKey } = useAICenter();
    const { uploadFile } = useFileUpload();
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

    // The paper decides what and how much; the teacher may only leave notes.
    const [notes, setNotes] = useState('');
    // What the server found on upload: question count and the exact credits.
    const [paperInfo, setPaperInfo] = useState<PaperInfo | null>(null);
    // A paper with sections: one assessment section each (the default) or all in one.
    const [sectionMode, setSectionMode] = useState<SectionMode>('split');

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('PDF_TO_QUESTIONS'),
        staleTime: 30 * 1000,
        refetchInterval: pendingTaskId !== null && readyTask === null ? 5000 : false,
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
            setErrorMessage(t('errors.extractionFailed'));
            setPendingTaskId(null);
        }
    }, [recentTasksData, pendingTaskId]);

    const recentTasks = useMemo(() => {
        const list: AITaskIndividualListInterface[] = Array.isArray(recentTasksData)
            ? recentTasksData
            : [];
        return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
    }, [recentTasksData]);

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
            setKey('question');
            // The teacher's answer only when they were asked (the paper's
            // sections were known at upload); otherwise say nothing and the
            // backend splits by what it reads — a scanned paper's sections
            // are only known after extraction. A quiz never splits.
            const askedSectionMode =
                sectionSplit && (paperInfo?.sections?.length ?? 0) >= 2 ? sectionMode : undefined;
            return handleGenerateAssessmentQuestions(
                pdfId,
                userPrompt,
                taskName,
                taskId || '',
                'extract',
                sectionSplit ? askedSectionMode : 'single'
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
        onError: (error: unknown) => {
            console.log(error);
            setLoader(false);
            setPhase('idle');
            setErrorMessage(t('errors.generateFailed'));
        },
    });

    const pollGenerateAssessment = (pdfId?: string, prompt?: string, taskId?: string) => {
        generateAssessmentMutation.mutate({
            pdfId: pdfId || '',
            userPrompt: prompt || '',
            taskName: getRandomTaskName(),
            taskId,
        });
    };

    const resetFile = () => {
        setPhase('idle');
        setFileName('');
        setUploadedFilePDFId('');
        setPaperInfo(null);
        setErrorMessage(null);
    };

    const handleGenerate = () => {
        if (!uploadedFilePDFId) return;
        setPhase('generating');
        pollGenerateAssessment(uploadedFilePDFId, notes.trim(), '');
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
        setKey('question');
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: 'your-user-id',
                source: instituteId,
                sourceId: 'STUDENTS',
            });
            if (!fileId) {
                setErrorMessage(t('errors.uploadFailed'));
                resetFile();
                return;
            }
            setPhase('processing');
            const response = await handleStartProcessUploadedFile(fileId, 'extract', {
                fileName: file.name,
            });
            if (response?.pdf_id) {
                setUploadedFilePDFId(response.pdf_id);
                setPaperInfo({
                    questionCount: response.question_count ?? null,
                    estimatedCredits: response.estimated_credits ?? null,
                    pages: response.pages ?? null,
                    ocrPages: response.ocr_pages ?? 0,
                    sections: response.sections ?? [],
                    marking: response.marking ?? null,
                    durationMinutes: response.duration_minutes ?? null,
                });
                setSectionMode('split');
                setPhase('ready');
            } else {
                setErrorMessage(t('errors.processFailed'));
                resetFile();
            }
        } catch (err) {
            console.error(err);
            setErrorMessage(t('errors.readFailed'));
            resetFile();
        }
    };

    const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) await processFile(file);
        event.target.value = '';
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) await processFile(file);
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

    const fileChosen = phase !== 'idle' && fileName !== '';
    const isWorking = phase === 'uploading' || phase === 'processing' || phase === 'generating';
    const workingLabel =
        phase === 'uploading'
            ? t('workingLabel.uploading')
            : phase === 'processing'
              ? t('workingLabel.processing')
              : phase === 'generating'
                ? t('workingLabel.generating')
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
                            {t('dropzone.instruction')}
                        </p>
                        <p className="text-xs text-neutral-500">{t('dropzone.hint')}</p>
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
                                    {phase === 'done' && t('fileCard.status.done')}
                                </span>
                            </div>
                        </div>
                        {!isWorking && (
                            <button
                                type="button"
                                onClick={resetFile}
                                className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                                aria-label={t('fileCard.removeAriaLabel')}
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
                            heading={t('productName')}
                            sectionsForm={form}
                            currentSectionIndex={currentSectionIndex}
                            allowSectionSplit={sectionSplit}
                            onDraftAnother={() => {
                                setReadyTask(null);
                                setPendingTaskId(null);
                                setErrorMessage(null);
                                setNotes('');
                                resetFile();
                            }}
                        />
                    ) : phase === 'generating' || (pendingTaskId && !readyTask) ? (
                        <GeneratingState
                            title={t('generatingState.title')}
                            subtitle={t('generatingState.subtitle')}
                        />
                    ) : isWorking ? (
                        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                            <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            <p className="text-sm text-blue-900">{workingLabel}</p>
                        </div>
                    ) : phase === 'ready' ? (
                        <ExtractOptionsPanel
                            notes={notes}
                            setNotes={setNotes}
                            onSubmit={handleGenerate}
                            paperInfo={paperInfo}
                            sectionMode={sectionSplit ? sectionMode : undefined}
                            setSectionMode={sectionSplit ? setSectionMode : undefined}
                        />
                    ) : null}
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

            <AITasksList
                heading={t('productName')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
                sectionsForm={form}
                currentSectionIndex={currentSectionIndex}
                allowSectionSplit={sectionSplit}
            />
        </div>
    );
};

export default GenerateAiQuestionPaperComponent;
