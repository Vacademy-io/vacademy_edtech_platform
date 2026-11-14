import { Dialog, DialogContent } from '@/components/ui/dialog';
import { getInstituteId } from '@/constants/helper';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useAICenter } from '@/routes/ai-center/-contexts/useAICenterContext';
import {
    handleChatWithPDF,
    handleQueryGetListIndividualTopics,
    handleStartProcessUploadedFile,
} from '@/routes/ai-center/-services/ai-center-service';
import { getRandomTaskName } from '@/routes/ai-center/-utils/helper';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import AITasksList from '@/routes/ai-center/-components/AITasksList';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import {
    ArrowRight,
    ChatCircleDots,
    FilePdf,
    Sparkle,
    UploadSimple,
    X,
} from '@phosphor-icons/react';
import {
    relativeTime,
    statusLabel,
    statusStyles,
    taskDisplayName,
} from '@/routes/ai-center/-utils/format';
import { RecentFilesPanel } from '@/routes/ai-center/-components/RecentFilesPanel';

export interface QuestionWithAnswerChatInterface {
    id: string;
    question: string;
    response: string;
}

const ACCEPTED_FORMATS = '.pdf,.doc,.docx,.ppt,.pptx,.html';
const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'html'];

const buildSuggestedPrompts = (t: TFunction): string[] => [
    t('chat.suggestions.mainIdea'),
    t('chat.suggestions.summarize'),
    t('chat.suggestions.generateQuestions'),
];

type Phase = 'idle' | 'uploading' | 'processing' | 'ready';

const PlayWithPDF = ({
    isListMode = false,
    chatResponse,
    input_id,
    parent_id,
}: {
    isListMode?: boolean;
    chatResponse?: QuestionWithAnswerChatInterface[];
    input_id?: string;
    parent_id?: string;
}) => {
    const { t } = useTranslation('aiCenterPlayWithPDF');
    const instituteId = getInstituteId();
    const { setLoader, setKey } = useAICenter();
    const { uploadFile } = useFileUpload();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const suggestedPrompts = useMemo(() => buildSuggestedPrompts(t), [t]);

    const [phase, setPhase] = useState<Phase>(input_id ? 'ready' : 'idle');
    const [fileName, setFileName] = useState('');
    const [uploadedFilePDFId, setUploadedFilePDFId] = useState(input_id ?? '');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const [enableTasksDialog, setEnableTasksDialog] = useState(false);

    const [question, setQuestion] = useState('');
    const [questionsWithAnswers, setQuestionsWithAnswers] = useState<
        QuestionWithAnswerChatInterface[]
    >(chatResponse ?? []);
    const [parentId, setParentId] = useState(parent_id ?? '');
    const [pendingResponse, setPendingResponse] = useState(false);
    const [listDialogOpen, setListDialogOpen] = useState(isListMode);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    const { data: recentTasksData } = useQuery({
        ...handleQueryGetListIndividualTopics('CHAT_WITH_PDF'),
        staleTime: 30 * 1000,
        enabled: !isListMode,
    });

    const recentTasks = useMemo(() => {
        const list: AITaskIndividualListInterface[] = Array.isArray(recentTasksData)
            ? recentTasksData
            : [];
        return [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
    }, [recentTasksData]);

    const resetFile = () => {
        setPhase('idle');
        setFileName('');
        setUploadedFilePDFId('');
        setQuestionsWithAnswers([]);
        setQuestion('');
        setParentId('');
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
        setKey('chat');
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
                setLoader(false);
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

    const MAX_POLL_ATTEMPTS = 10;
    const pollingCountRef = useRef(0);
    const pollingTimeoutIdRef = useRef<NodeJS.Timeout | null>(null);
    const pendingRef = useRef(false);

    const clearPolling = () => {
        if (pollingTimeoutIdRef.current) {
            setLoader(false);
            setKey(null);
            clearTimeout(pollingTimeoutIdRef.current);
            pollingTimeoutIdRef.current = null;
        }
    };

    const askMutation = useMutation({
        mutationFn: async ({
            pdfId,
            userPrompt,
            taskName,
            parentId,
        }: {
            pdfId: string;
            userPrompt: string;
            taskName: string;
            parentId: string;
        }) => {
            return handleChatWithPDF(pdfId, userPrompt, taskName, parentId);
        },
        onSuccess: (response) => {
            if (response?.status === 'pending') {
                pendingRef.current = true;
                return;
            }
            pendingRef.current = false;
            if (response) {
                setQuestionsWithAnswers(response);
                if (parentId === '' && response[0]?.id) setParentId(response[0].id);
                setQuestion('');
                setPendingResponse(false);
                return;
            }
            scheduleNextPoll();
        },
        onError: () => {
            if (pendingRef.current) {
                pendingRef.current = false;
                scheduleNextPoll();
                setPendingResponse(true);
                return;
            }
            pollingCountRef.current += 1;
            if (pollingCountRef.current >= MAX_POLL_ATTEMPTS) {
                setLoader(false);
                setKey(null);
                clearPolling();
                setPendingResponse(false);
                setErrorMessage(t('errors.noResponse'));
                return;
            }
            scheduleNextPoll();
        },
    });

    const scheduleNextPoll = () => {
        setLoader(false);
        setKey(null);
        clearPolling();
        if (!pendingRef.current) {
            setLoader(true);
            setKey('chat');
            pollingTimeoutIdRef.current = setTimeout(() => {
                pollAsk();
            }, 10000);
        }
    };

    const pollAsk = () => {
        if (pendingRef.current) return;
        askMutation.mutate({
            pdfId: uploadedFilePDFId,
            userPrompt: question,
            taskName: getRandomTaskName(),
            parentId,
        });
    };

    const submitQuestion = () => {
        if (!uploadedFilePDFId || !question.trim() || pendingResponse) return;
        setErrorMessage(null);
        setPendingResponse(true);
        clearPolling();
        pollingCountRef.current = 0;
        pendingRef.current = false;
        pollAsk();
    };

    useEffect(() => {
        return () => clearPolling();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [questionsWithAnswers]);

    const renderChatBody = (fullHeight: boolean) => (
        <>
            <div
                className={`flex flex-col items-center overflow-y-auto bg-neutral-50 px-4 py-6 ${
                    fullHeight ? 'flex-1' : 'min-h-72 max-h-[55vh]' // design-lint-ignore: viewport-relative chat body height, no token exists
                }`}
            >
                <div className="flex w-full max-w-3xl flex-col gap-5">
                    {questionsWithAnswers.length === 0 ? (
                        <div className="flex flex-col items-center gap-4 py-8 text-center">
                            <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                                <ChatCircleDots size={22} weight="fill" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <p className="text-sm font-medium text-gray-900">
                                    {t('chat.emptyTitle')}
                                </p>
                                <p className="text-xs text-neutral-500">
                                    {t('chat.emptySubtitle')}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                {suggestedPrompts.map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setQuestion(p)}
                                        disabled={pendingResponse}
                                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 transition-colors hover:border-primary-200 hover:bg-primary-50 disabled:opacity-50"
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        questionsWithAnswers.map((qa) => (
                            <div key={qa.id} className="flex flex-col gap-2">
                                <div className="flex justify-end">
                                    <p className="max-w-[80%] rounded-2xl bg-primary-500 px-4 py-2 text-sm text-white"> {/* design-lint-ignore: percentage bubble width has no spacing token */}
                                        {qa.question}
                                    </p>
                                </div>
                                <div className="flex justify-start">
                                    <div
                                        className="max-w-[85%] rounded-2xl bg-white px-4 py-2 text-sm text-gray-900 ring-1 ring-neutral-200" // design-lint-ignore: percentage bubble width has no spacing token
                                        dangerouslySetInnerHTML={{ __html: qa.response || '' }}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                    {pendingResponse && (
                        <div className="flex justify-start">
                            <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm text-neutral-500 ring-1 ring-neutral-200">
                                <div className="size-2 animate-pulse rounded-full bg-primary-400" />
                                <div className="size-2 animate-pulse rounded-full bg-primary-400 [animation-delay:150ms]" />
                                <div className="size-2 animate-pulse rounded-full bg-primary-400 [animation-delay:300ms]" />
                                <span className="ms-1 text-xs">{t('chat.pending')}</span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <div className="border-t border-neutral-200 bg-white px-4 py-4">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitQuestion();
                    }}
                    className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-1.5 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100"
                >
                    <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={t('chat.inputPlaceholder')}
                        disabled={pendingResponse}
                        className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-neutral-400 disabled:bg-transparent"
                    />
                    <button
                        type="submit"
                        disabled={pendingResponse || !question.trim()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
                    >
                        {t('chat.send')}
                        <ArrowRight size={14} weight="bold" />
                    </button>
                </form>
            </div>
        </>
    );

    if (isListMode) {
        return (
            <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
                <DialogContent className="!m-0 flex !h-full !w-full !max-w-full flex-col !rounded-none !p-0">
                    <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-3">
                        <h2 className="text-sm font-semibold text-gray-900">
                            {t('chat.historyTitle')}
                        </h2>
                    </div>
                    {renderChatBody(true)}
                </DialogContent>
            </Dialog>
        );
    }

    const fileChosen = phase !== 'idle' && fileName !== '';
    const isUploadWorking = phase === 'uploading' || phase === 'processing';

    return (
        <div className="flex w-full flex-col gap-8 px-4 pb-12 sm:px-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
                    {t('header.title')}
                </h1>
                <p className="text-sm text-gray-500">{t('header.subtitle')}</p>
            </header>

            {!fileChosen && !uploadedFilePDFId ? (
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        if (!isDragActive) setIsDragActive(true);
                    }}
                    onDragLeave={() => setIsDragActive(false)}
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
                            {t('upload.dropTitle')}
                        </p>
                        <p className="text-xs text-neutral-500">{t('upload.dropSubtitle')}</p>
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
                                    {fileName || t('upload.fallbackFileName')}
                                </span>
                                <span className="text-xs text-neutral-500">
                                    {phase === 'uploading' && t('upload.statusUploading')}
                                    {phase === 'processing' && t('upload.statusProcessing')}
                                    {phase === 'ready' && t('upload.statusReady')}
                                </span>
                            </div>
                        </div>
                        {!isUploadWorking && (
                            <button
                                type="button"
                                onClick={resetFile}
                                className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                                aria-label={t('upload.resetAriaLabel')}
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>

                    {isUploadWorking ? (
                        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                            <div className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            <p className="text-sm text-blue-900">
                                {phase === 'uploading'
                                    ? t('upload.workingUploading')
                                    : t('upload.workingProcessing')}
                            </p>
                        </div>
                    ) : (
                        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-neutral-200">
                            {renderChatBody(false)}
                        </div>
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
                overrideIcon={
                    <ChatCircleDots size={18} weight="fill" className="text-primary-500" />
                }
            />

            <AITasksList
                heading={t('tasksList.heading')}
                enableDialog={enableTasksDialog}
                setEnableDialog={setEnableTasksDialog}
            />
        </div>
    );
};

export default PlayWithPDF;
