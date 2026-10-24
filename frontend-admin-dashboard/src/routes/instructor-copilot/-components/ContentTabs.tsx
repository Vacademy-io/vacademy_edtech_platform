import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    FileText,
    Notepad,
    Exam,
    Presentation,
    VideoCamera,
    Cards,
    BookOpen,
    PencilSimple,
    CheckCircle,
    Hash,
    ArrowsLeftRight,
    CaretLeft,
    CaretRight,
    MagicWand,
} from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    InstructorCopilotLog,
    generateQuiz,
    getQuizTaskStatus,
    updateInstructorCopilotLog,
    type QuizGenerationResponse
} from '@/services/instructor-copilot';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { QuizView } from './QuizView';
import { QuizGenerationForm } from './QuizGenerationForm';
import { QuizDownloadDialog } from './QuizDownloadDialog';
import { DownloadButton } from './DownloadButton';
import { useQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { generateNotesPDF, generateSummaryPDF, generateClassworkPDF, generateHomeworkPDF } from '../-utils/pdf';


interface ContentTabsProps {
    transcription?: string;
    log?: InstructorCopilotLog | null;
    onLogUpdate?: () => void;
}

interface SummaryData {
    overview: string;
    key_points: string[];
}

interface NoteData {
    topic: string;
    content: string;
}

interface FlashcardData {
    front: string;
    back: string;
}

const SummaryView = ({ content }: { content: string }) => {
    const { t } = useTranslation('instructorCopilotContentTabs');
    let data: SummaryData | null = null;

    try {
        data = JSON.parse(content);
    } catch (e) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="space-y-6">
            {/* Overview Section */}
            {data.overview && (
                <div className="rounded-lg bg-slate-50 p-6 dark:bg-slate-900/50">
                    <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-200">
                        <BookOpen size={20} className="text-primary-500" />
                        {t('summaryView.overview')}
                    </h3>
                    <div className="prose prose-sm max-w-none dark:prose-invert text-slate-600 dark:text-slate-400">
                        <ReactMarkdown>{data.overview}</ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Key Points Section */}
            {data.key_points && data.key_points.length > 0 && (
                <div>
                    <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-200">
                        <CheckCircle size={20} className="text-green-500" />
                        {t('summaryView.keyTakeaways')}
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-1">
                        {data.key_points.map((point, index) => (
                            <div
                                key={index}
                                className="group relative flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-primary-200 hover:bg-primary-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-800"
                            >
                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                                    {index + 1}
                                </span>
                                <div className="prose prose-sm max-w-none dark:prose-invert text-slate-700 dark:text-slate-300">
                                    <ReactMarkdown>{point}</ReactMarkdown>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const NotesView = ({ content }: { content: string }) => {
    let data: NoteData[] | null = null;

    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
            data = null;
        }
    } catch (e) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    if (!data) return (
        <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap">{content}</p>
        </div>
    );

    return (
        <div className="space-y-4">
            {data.map((note, index) => (
                <div key={index} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                            <Hash size={18} className="text-primary-500" />
                            {note.topic}
                        </h3>
                    </div>
                    <div className="px-5 py-3">
                        <div className="prose prose-sm max-w-none dark:prose-invert text-slate-600 dark:text-slate-400">
                            <ReactMarkdown>{note.content}</ReactMarkdown>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

const FlashcardsView = ({ content }: { content: string }) => {
    const { t } = useTranslation('instructorCopilotContentTabs');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    let data: FlashcardData[] | null = null;
    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) data = null;
    } catch (e) {
        // Fallback
    }

    if (!data || data.length === 0) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    const currentCard = data[currentIndex];

    if (!currentCard) return null;

    const handleNext = () => {
        setIsFlipped(false);
        const length = data!.length;
        setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % length);
        }, 300); // Wait for potential flip reset visual
    };

    const handlePrev = () => {
        setIsFlipped(false);
        const length = data!.length;
        setTimeout(() => {
            setCurrentIndex((prev) => (prev - 1 + length) % length);
        }, 300);
    };

    const handleFlip = () => {
        setIsFlipped(!isFlipped);
    };

    return (
        <div className="mx-auto max-w-2xl py-2">
            <div
                className="relative h-64 w-full cursor-pointer"
                style={{ perspective: '1000px' }}
                onClick={handleFlip}
            >
                <div
                    className={cn(
                        "relative h-full w-full transition-all duration-500",
                        isFlipped ? "" : ""
                    )}
                    style={{
                        transformStyle: 'preserve-3d',
                        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
                    }}
                >
                    {/* Front */}
                    <div
                        className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg dark:border-slate-700 dark:bg-slate-800"
                        style={{ backfaceVisibility: 'hidden' }}
                    >
                        <span className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">{t('flashcardsView.questionLabel')}</span>
                        <h3 className="max-h-[70%] w-full overflow-y-auto px-2 text-xl font-medium text-slate-900 dark:text-slate-100">
                            {currentCard.front}
                        </h3>
                        <div className="absolute bottom-6 text-slate-400">
                            <ArrowsLeftRight size={20} className="animate-pulse" />
                            <span className="mt-1 block text-[10px]">{t('flashcardsView.clickToFlip')}</span>
                        </div>
                    </div>

                    {/* Back */}
                    <div
                        className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-primary-100 bg-primary-50 p-6 text-center shadow-lg dark:border-primary-900 dark:bg-primary-900/20"
                        style={{
                            backfaceVisibility: 'hidden',
                            transform: 'rotateY(180deg)'
                        }}
                    >
                        <span className="mb-4 text-xs font-bold uppercase tracking-wider text-primary-500">{t('flashcardsView.answerLabel')}</span>
                        <div className="prose prose-lg w-full overflow-y-auto px-2 dark:prose-invert">
                            <p className="text-lg text-slate-800 dark:text-slate-200">{currentCard.back}</p>
                        </div>
                        <div className="absolute bottom-6 text-primary-400">
                            <ArrowsLeftRight size={20} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="mt-4 flex items-center justify-between">
                <Button
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                    disabled={data.length <= 1}
                    className="gap-2"
                >
                    <CaretLeft size={16} />
                    {t('flashcardsView.previous')}
                </Button>

                <span className="text-sm font-medium text-slate-500">
                    {t('flashcardsView.cardCounter', { current: currentIndex + 1, total: data.length })}
                </span>

                <Button
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); handleNext(); }}
                    disabled={data.length <= 1}
                    className="gap-2"
                >
                    {t('flashcardsView.next')}
                    <CaretRight size={16} />
                </Button>
            </div>
        </div>
    );
};

const ClassworkView = ({ content }: { content: string }) => {
    const { t } = useTranslation('instructorCopilotContentTabs');
    let data: string[] | null = null;

    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
            data = null;
        }
    } catch (e) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    // Check if it's the fallback message
    const isEmpty = data.length === 1 && data[0] === "No classwork given";

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <div className="rounded-full bg-slate-100 p-4 dark:bg-slate-800">
                    <BookOpen size={32} className="text-slate-400" />
                </div>
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('classworkView.emptyState')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {data.map((task, index) => (
                <div
                    key={index}
                    className="group relative flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-primary-200 hover:bg-primary-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-800"
                >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        {index + 1}
                    </span>
                    <div className="prose prose-sm max-w-none flex-1 dark:prose-invert text-slate-700 dark:text-slate-300">
                        <ReactMarkdown>{task}</ReactMarkdown>
                    </div>
                    <CheckCircle
                        size={20}
                        className="shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600"
                    />
                </div>
            ))}
        </div>
    );
};

const HomeworkView = ({ content }: { content: string }) => {
    const { t } = useTranslation('instructorCopilotContentTabs');
    let data: string[] | null = null;

    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
            data = null;
        }
    } catch (e) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-wrap">{content}</p>
            </div>
        );
    }

    // Check if it's the fallback message
    const isEmpty = data.length === 1 && data[0] === "No homework given";

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center justify-center py-12">
                <div className="rounded-full bg-slate-100 p-4 dark:bg-slate-800">
                    <PencilSimple size={32} className="text-slate-400" />
                </div>
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('homeworkView.emptyState')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {data.map((assignment, index) => (
                <div
                    key={index}
                    className="group relative flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-orange-200 hover:bg-orange-50/30 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-800"
                >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                        {index + 1}
                    </span>
                    <div className="prose prose-sm max-w-none flex-1 dark:prose-invert text-slate-700 dark:text-slate-300">
                        <ReactMarkdown>{assignment}</ReactMarkdown>
                    </div>
                    <PencilSimple
                        size={20}
                        className="shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600"
                    />
                </div>
            ))}
        </div>
    );
};


export function ContentTabs({ transcription, log, onLogUpdate }: ContentTabsProps) {
    const { t } = useTranslation('instructorCopilotContentTabs');
    const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
    const [quizTaskId, setQuizTaskId] = useState<string | null>(null);
    const [pollingInterval, setPollingInterval] = useState<number | null>(null);
    const [isQuizDownloadDialogOpen, setIsQuizDownloadDialogOpen] = useState(false);
    const { data: instituteDetails } = useQuery(useInstituteQuery());

    // Poll for quiz task completion
    const handleGenerateQuiz = async (formData: {
        text: string;
        num: number;
        class_level: string;
        question_type: string;
        question_language: string;
        taskName: string;
    }) => {
        if (!instituteDetails?.id) {
            toast.error(t('toasts.instituteDetailsUnavailable'));
            return;
        }

        setIsGeneratingQuiz(true);
        try {
            const response = await generateQuiz(
                {
                    ...formData,
                    topics: '',
                },
                instituteDetails.id
            );

            const taskId = response.taskId;
            setQuizTaskId(taskId);
            toast.success(t('toasts.quizGenerationStarted'));

            // Start polling
            let attempts = 0;
            const maxAttempts = 60; // 60 * 5s = 5 minutes max
            const pollInterval = setInterval(async () => {
                attempts++;
                try {
                    const result = await getQuizTaskStatus(taskId);

                    if (result && result.questions && result.questions.length > 0) {
                        // Successfully got quiz data
                        clearInterval(pollInterval);
                        setPollingInterval(null);
                        setIsGeneratingQuiz(false);
                        toast.success(t('toasts.quizGeneratedSuccess'));

                        // Update the log with quiz data
                        if (log?.id) {
                            try {
                                const updatedLog = await updateInstructorCopilotLog(log.id, {
                                    question_json: JSON.stringify(result),
                                });

                                // Trigger parent to refetch and update selectedLog
                                onLogUpdate?.();

                                // Also update the log prop directly to show immediately
                                if (log) {
                                    log.question_json = JSON.stringify(result);
                                }
                            } catch (error) {
                                console.error('Failed to update log:', error);
                                toast.error(t('toasts.quizSavedFailed'));
                            }
                        }
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        setPollingInterval(null);
                        setIsGeneratingQuiz(false);
                        toast.error(t('toasts.quizTimedOut'));
                    }
                } catch (error) {
                    if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        setPollingInterval(null);
                        setIsGeneratingQuiz(false);
                        toast.error(t('toasts.quizGenerationFailedPoll'));
                    }
                    // Continue polling on error unless max attempts reached
                }
            }, 5000); // Poll every 5 seconds

            setPollingInterval(pollInterval as unknown as number);
        } catch (error) {
            console.error('Quiz generation error:', error);
            toast.error(t('toasts.quizGenerationFailedStart'));
            setIsGeneratingQuiz(false);
        }
    };

    // PDF Download Handlers
    const handleNotesDownload = () => {
        if (!log?.flashnotes_json) {
            toast.error(t('toasts.noNotesAvailable'));
            return;
        }
        try {
            generateNotesPDF(log.flashnotes_json);
            toast.success(t('toasts.notesDownloadSuccess'));
        } catch (error) {
            console.error('Error generating notes PDF:', error);
            toast.error(t('toasts.notesDownloadFailed'));
        }
    };

    const handleSummaryDownload = () => {
        if (!log?.summary) {
            toast.error(t('toasts.noSummaryAvailable'));
            return;
        }
        try {
            generateSummaryPDF(log.summary, t);
            toast.success(t('toasts.summaryDownloadSuccess'));
        } catch (error) {
            console.error('Error generating summary PDF:', error);
            toast.error(t('toasts.summaryDownloadFailed'));
        }
    };

    const handleQuizDownload = () => {
        if (!log?.question_json) {
            toast.error(t('toasts.noQuizAvailable'));
            return;
        }
        setIsQuizDownloadDialogOpen(true);
    };

    const handleClassworkDownload = () => {
        if (!log?.classwork_json) {
            toast.error(t('toasts.noClassworkAvailable'));
            return;
        }
        try {
            generateClassworkPDF(log.classwork_json, t);
            toast.success(t('toasts.classworkDownloadSuccess'));
        } catch (error) {
            console.error('Error generating classwork PDF:', error);
            toast.error(t('toasts.classworkDownloadFailed'));
        }
    };

    const handleHomeworkDownload = () => {
        if (!log?.homework_json) {
            toast.error(t('toasts.noHomeworkAvailable'));
            return;
        }
        try {
            generateHomeworkPDF(log.homework_json, t);
            toast.success(t('toasts.homeworkDownloadSuccess'));
        } catch (error) {
            console.error('Error generating homework PDF:', error);
            toast.error(t('toasts.homeworkDownloadFailed'));
        }
    };


    const tabs = [
        {
            id: 'transcription',
            label: t('tabs.transcription.label'),
            icon: FileText,
            description: t('tabs.transcription.description'),
            content: log?.transcript_json || transcription,
        },
        {
            id: 'notes',
            label: t('tabs.notes.label'),
            icon: BookOpen,
            description: t('tabs.notes.description'),
            content: log?.flashnotes_json,
        },
        {
            id: 'summary',
            label: t('tabs.summary.label'),
            icon: Notepad,
            description: t('tabs.summary.description'),
            content: log?.summary,
        },
        {
            id: 'flashcards',
            label: t('tabs.flashcards.label'),
            icon: Cards,
            description: t('tabs.flashcards.description'),
            content: log?.flashcard_json,
        },
        {
            id: 'quiz',
            label: t('tabs.quiz.label'),
            icon: Exam,
            description: t('tabs.quiz.description'),
            content: log?.question_json,
        },
        {
            id: 'slides',
            label: t('tabs.slides.label'),
            icon: Presentation,
            description: t('tabs.slides.description'),
            content: log?.slides_json,
        },
        {
            id: 'videos',
            label: t('tabs.videos.label'),
            icon: VideoCamera,
            description: t('tabs.videos.description'),
            content: log?.video_json,
        },
        {
            id: 'homework',
            label: t('tabs.homework.label'),
            icon: PencilSimple,
            description: t('tabs.homework.description'),
            content: log?.homework_json,
        },
        {
            id: 'classwork',
            label: t('tabs.classwork.label'),
            icon: BookOpen,
            description: t('tabs.classwork.description'),
            content: log?.classwork_json,
        },
    ];

    const renderContent = (content: string | null | undefined, id: string, label: string) => {
        if (!content) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="mb-6 rounded-full bg-slate-100 p-4 dark:bg-slate-800">
                        {/* Render generic icon or specific if available */}
                        <MagicWand size={32} className="text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                        {t('emptyState.title', { label })}
                    </h3>
                    <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                        {t('emptyState.hint', { label })}
                    </p>
                    {id === 'quiz' ? (
                        <QuizGenerationForm
                            transcript={log?.transcript_json || transcription || ''}
                            onGenerate={handleGenerateQuiz}
                            isGenerating={isGeneratingQuiz}
                        />
                    ) : (
                        <Button
                            onClick={() => {
                                toast.info(t('toasts.generatingPlaceholder', { label }));
                                console.log('Generate ' + label);
                            }}
                            className="mt-6 gap-2"
                            variant="default"
                        >
                            <MagicWand size={16} />
                            {t('emptyState.generateButton', { label })}
                        </Button>
                    )}
                </div>
            );
        }

        if (id === 'summary') {
            return <SummaryView content={content} />;
        }

        if (id === 'notes') {
            return <NotesView content={content} />;
        }

        if (id === 'flashcards') {
            return <FlashcardsView content={content} />;
        }

        if (id === 'classwork') {
            return <ClassworkView content={content} />;
        }

        if (id === 'homework') {
            return <HomeworkView content={content} />;
        }

        if (id === 'quiz') {
            try {
                const quizData: QuizGenerationResponse = JSON.parse(content);
                return <QuizView data={quizData} />;
            } catch (e) {
                // Fallback to default rendering if parsing fails
            }
        }


        // Simple check if it looks like JSON and try to pretty print
        let displayContent = content;
        if ((content.startsWith('{') || content.startsWith('[')) && (content.endsWith('}') || content.endsWith(']'))) {
            try {
                const parsed = JSON.parse(content);
                displayContent = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // ignore, keep as string
            }
        }

        return (
            <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans">{displayContent}</pre>
            </div>
        );
    };

    return (
        <Tabs defaultValue="transcription" className="w-full">
            <ScrollArea className="w-full">
                <TabsList className="w-full justify-start">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
                                <Icon size={16} />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
            </ScrollArea>

            {tabs.map((tab) => {
                // Determine if this tab should show a download button
                const showDownloadButton =
                    (tab.id === 'notes' && tab.content) ||
                    (tab.id === 'summary' && tab.content) ||
                    (tab.id === 'quiz' && tab.content) ||
                    (tab.id === 'classwork' && tab.content) ||
                    (tab.id === 'homework' && tab.content);

                const getDownloadHandler = () => {
                    switch (tab.id) {
                        case 'notes':
                            return handleNotesDownload;
                        case 'summary':
                            return handleSummaryDownload;
                        case 'quiz':
                            return handleQuizDownload;
                        case 'classwork':
                            return handleClassworkDownload;
                        case 'homework':
                            return handleHomeworkDownload;
                        default:
                            return undefined;
                    }
                };


                return (
                    <TabsContent key={tab.id} value={tab.id} className="mt-4">
                        <Card>
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <CardTitle className="flex items-center gap-2">
                                            <tab.icon size={20} />
                                            {tab.label}
                                        </CardTitle>
                                        <CardDescription>{tab.description}</CardDescription>
                                    </div>
                                    {showDownloadButton && (
                                        <DownloadButton
                                            onClick={getDownloadHandler()!}
                                            label={t('downloadButton')}
                                        />
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                {renderContent(tab.content, tab.id, tab.label)}
                            </CardContent>
                        </Card>
                    </TabsContent>
                );
            })}

            {/* Quiz Download Dialog */}
            <QuizDownloadDialog
                open={isQuizDownloadDialogOpen}
                onOpenChange={setIsQuizDownloadDialogOpen}
                quizContent={log?.question_json || ''}
            />
        </Tabs>
    );
}


