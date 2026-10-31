import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState } from 'react';
import {
    ChalkboardTeacher,
    Microphone,
    UploadSimple,
    Plus,
    Trash,
    FileText,
    CheckCircle,
    Clock,
    ArrowLeft,
} from '@phosphor-icons/react';
import { Helmet } from 'react-helmet';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LectureDashboard } from './-components/LectureDashboard';
import { BeforeLectureView } from './-components/BeforeLectureView';
import { InLectureView } from './-components/InLectureView';
import { AfterLectureView } from './-components/AfterLectureView';
import { FileUploader } from './-components/FileUploader';
import { AudioRecorder } from './-components/AudioRecorder';
import { AudioPlayer } from './-components/AudioPlayer';
import { ContentTabs } from './-components/ContentTabs';
import { uploadAudioFile, createTranscription, waitForTranscription } from '@/services/assemblyai';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import {
    createInstructorCopilotLog,
    listInstructorCopilotLogs,
    deleteInstructorCopilotLog,
    retryInstructorCopilotLog,
    type InstructorCopilotLog,
} from '@/services/instructor-copilot';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/instructor-copilot/')({
    component: InstructorCopilotPage,
});

type AudioSource = 'upload' | 'record' | null;

function InstructorCopilotPage() {
    const { t } = useTranslation('instructorCopilotIndex');
    const { setNavHeading } = useNavHeadingStore();

    // Navigation State
    const [activeTab, setActiveTab] = useState<'lecture' | 'assessment'>('lecture');
    const [viewMode, setViewMode] = useState<'dashboard' | 'before' | 'in' | 'after'>('dashboard');

    // In Lecture State
    const [inLectureMode, setInLectureMode] = useState<'menu' | 'record' | 'upload'>('menu');

    // After Lecture State
    const [afterLectureMode, setAfterLectureMode] = useState<'menu' | 'logs'>('menu');

    // Existing State for Session/Audio
    const [audioSource, setAudioSource] = useState<AudioSource>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [transcription, setTranscription] = useState<string>('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedLog, setSelectedLog] = useState<InstructorCopilotLog | null>(null);
    const [lastRegenerationTime, setLastRegenerationTime] = useState<number | null>(null);
    const [canRegenerate, setCanRegenerate] = useState(true);
    const [cooldownSeconds, setCooldownSeconds] = useState(0);

    const { data: instituteDetails } = useQuery(useInstituteQuery());
    const queryClient = useQueryClient();

    const { data: logs, isLoading: isLoadingLogs } = useQuery({
        queryKey: ['instructor-copilot-logs', instituteDetails?.id],
        queryFn: () =>
            listInstructorCopilotLogs({
                instituteId: instituteDetails?.id!,
                status: 'ACTIVE',
                startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
                endDate: format(new Date(), 'yyyy-MM-dd'),
            }),
        enabled: !!instituteDetails?.id,
    });

    const createLogMutation = useMutation({
        mutationFn: createInstructorCopilotLog,
        onSuccess: (newLog) => {
            toast.success(t('toast.generationStarted'));
            queryClient.invalidateQueries({ queryKey: ['instructor-copilot-logs'] });
            setSelectedLog(newLog);
            // Don't carry over audioUrl to log view as per previous logic
        },
        onError: (error) => {
            console.error('Error creating log:', error);
            toast.error(t('toast.generationStartFailed'));
        },
    });

    const deleteLogMutation = useMutation({
        mutationFn: deleteInstructorCopilotLog,
        onSuccess: () => {
            toast.success(t('toast.logDeleted'));
            queryClient.invalidateQueries({ queryKey: ['instructor-copilot-logs'] });
            if (selectedLog) {
                // If we delete the currently viewed log, go back to logs list
                setSelectedLog(null);
            }
        },
        onError: () => {
            toast.error(t('toast.logDeleteFailed'));
        },
    });

    const retryLogMutation = useMutation({
        mutationFn: retryInstructorCopilotLog,
        onSuccess: () => {
            toast.success(t('toast.regenerationStarted'));
            setLastRegenerationTime(Date.now());
            setCanRegenerate(false);
            setTimeout(
                () => {
                    setCanRegenerate(true);
                },
                2 * 60 * 1000
            ); // 2 minutes
            queryClient.invalidateQueries({ queryKey: ['instructor-copilot-logs'] });
        },
        onError: () => {
            toast.error(t('toast.regenerationFailed'));
        },
    });

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-2">
                <ChalkboardTeacher size={24} className="text-primary-500" />
                <h1 className="text-lg font-semibold">{t('navHeading')}</h1>
            </div>
        );
    }, [setNavHeading, t]);

    // Cooldown countdown effect
    useEffect(() => {
        if (!canRegenerate && lastRegenerationTime) {
            const interval = setInterval(() => {
                const twoMinutes = 2 * 60 * 1000;
                const elapsed = Date.now() - lastRegenerationTime;
                const remaining = Math.max(0, Math.ceil((twoMinutes - elapsed) / 1000));
                setCooldownSeconds(remaining);

                if (remaining === 0) {
                    clearInterval(interval);
                }
            }, 1000);

            return () => clearInterval(interval);
        }

        setCooldownSeconds(0);
        return undefined;
    }, [canRegenerate, lastRegenerationTime]);

    const handleFileSelected = async (file: File) => {
        try {
            setIsProcessing(true);
            setProcessingStatus(t('status.uploadingAudio'));
            toast.info(t('toast.uploadingAudio'));

            // Upload file
            const uploadUrl = await uploadAudioFile(file);

            setProcessingStatus(t('status.creatingTranscriptionJob'));
            toast.info(t('toast.processingTranscription'));

            // Create transcription
            const transcriptId = await createTranscription(uploadUrl);

            setProcessingStatus(t('status.transcribingAudio'));

            // Wait for transcription
            const result = await waitForTranscription(transcriptId, (status) => {
                setProcessingStatus(t('status.transcriptionStatus', { status }));
            });

            if (result.status === 'completed' && result.text) {
                setTranscription(result.text);
                const fileUrl = URL.createObjectURL(file);
                setAudioUrl(fileUrl);
                toast.success(t('toast.transcriptionCompleted'));

                // Auto-start content generation after transcription
                await autoGenerateContent(result.text);
            } else if (result.status === 'error') {
                throw new Error(result.error || 'Transcription failed');
            }
        } catch (error) {
            console.error('Error processing audio:', error);
            toast.error(t('toast.audioProcessFailed'));
        } finally {
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };

    const autoGenerateContent = async (transcriptText: string) => {
        if (!transcriptText || !instituteDetails?.id) return;
        setIsGenerating(true);
        try {
            const newLog = await createLogMutation.mutateAsync({
                transcript_json: transcriptText,
                instituteId: instituteDetails.id,
            });
            setLastRegenerationTime(Date.now());
            setCanRegenerate(false);
            setTimeout(
                () => {
                    setCanRegenerate(true);
                },
                2 * 60 * 1000
            ); // 2 minutes
        } catch (error) {
            console.error('Auto-generation error:', error);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFileUploadComplete = (url: string) => {
        setAudioUrl(url);
    };

    const handleRecordingComplete = (audioBlob: Blob, url: string) => {
        setAudioUrl(url);
    };

    const handleResetSession = () => {
        setAudioSource(null);
        setAudioUrl(null);
        setTranscription('');
        setIsProcessing(false);
        setProcessingStatus('');
        setIsGenerating(false);
        setSelectedLog(null);

        // Return to In Lecture Menu
        setInLectureMode('menu');
    };

    const handleCloseLogDetail = () => {
        setSelectedLog(null);
        if (audioUrl) {
            setViewMode('dashboard');
            setAudioUrl(null);
            setTranscription('');
            setInLectureMode('menu');
        }
    };

    const handleDeleteLog = async (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (confirm(t('confirmDeleteLog'))) {
            await deleteLogMutation.mutateAsync(id);
        }
    };

    const handleViewDetails = (log: InstructorCopilotLog) => {
        setSelectedLog(log);
        setAudioUrl(null);
        setTranscription('');

        const logCreatedTime = new Date(log.created_at).getTime();
        const timeSinceCreation = Date.now() - logCreatedTime;
        const twoMinutes = 2 * 60 * 1000;

        if (timeSinceCreation < twoMinutes) {
            setCanRegenerate(false);
            setLastRegenerationTime(logCreatedTime);
            setTimeout(() => {
                setCanRegenerate(true);
            }, twoMinutes - timeSinceCreation);
        } else {
            setCanRegenerate(true);
        }
    };

    const handleRegenerateContent = async () => {
        if (!selectedLog || !canRegenerate) return;
        await retryLogMutation.mutateAsync(selectedLog.id);
    };

    // --- Render Helpers ---

    const renderLogDetail = () => (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={handleCloseLogDetail} className="gap-2">
                    <ArrowLeft size={16} />
                    {t('back')}
                </Button>
                <div>
                    <h1 className="text-xl font-bold sm:text-2xl">
                        {selectedLog?.title || t('untitledSession')}
                    </h1>
                    <p className="text-sm text-gray-500">
                        {selectedLog?.created_at &&
                            t('generatedOn', {
                                date: format(new Date(selectedLog.created_at), 'PPP p'),
                            })}
                    </p>
                </div>
                {!selectedLog?.summary && (
                    <Button
                        variant="outline"
                        onClick={handleRegenerateContent}
                        disabled={!canRegenerate || retryLogMutation.isPending}
                        className="gap-2"
                    >
                        {retryLogMutation.isPending
                            ? t('regenerating')
                            : !canRegenerate
                              ? t('waitCountdown', {
                                    minutes: Math.floor(cooldownSeconds / 60),
                                    seconds: String(cooldownSeconds % 60).padStart(2, '0'),
                                })
                              : t('regenerateContent')}
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-3">
                    <ContentTabs
                        log={selectedLog}
                        onLogUpdate={async () => {
                            await queryClient.invalidateQueries({
                                queryKey: ['instructor-copilot-logs'],
                            });
                            const updatedLogs = await listInstructorCopilotLogs({
                                instituteId: instituteDetails?.id!,
                                status: 'ACTIVE',
                                startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
                                endDate: format(new Date(), 'yyyy-MM-dd'),
                            });
                            const freshLog = updatedLogs.find((log) => log.id === selectedLog?.id);
                            if (freshLog) setSelectedLog(freshLog);
                        }}
                    />
                </div>
            </div>
        </div>
    );

    const renderSessionCreation = () => (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={handleResetSession} size="sm" className="gap-2">
                    <ArrowLeft size={16} />
                    {t('backToSelection')}
                </Button>
            </div>

            {!audioUrl ? (
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {inLectureMode === 'record' ? t('recordAudio') : t('uploadAudio')}
                        </CardTitle>
                        <CardDescription>
                            {inLectureMode === 'record'
                                ? t('recordLectureDescription')
                                : t('uploadLectureDescription')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {inLectureMode === 'record' ? (
                            <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                        ) : (
                            <FileUploader
                                onFileSelected={handleFileSelected}
                                onUploadComplete={handleFileUploadComplete}
                            />
                        )}

                        {isProcessing && (
                            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                                <div className="flex items-center gap-3">
                                    <div className="size-5 animate-spin rounded-full border-b-2 border-blue-600" />
                                    <p className="text-sm font-medium text-blue-800">
                                        {processingStatus}
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    <Card>
                        <CardContent className="p-6">
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                                <div className="lg:col-span-1">
                                    <div className="space-y-4">
                                        <AudioPlayer audioUrl={audioUrl} />
                                        {isGenerating && (
                                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="size-5 animate-spin rounded-full border-b-2 border-blue-600" />
                                                    <p className="text-sm font-medium text-blue-800">
                                                        {t('generatingContent')}
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                        <Button
                                            variant="outline"
                                            onClick={handleResetSession}
                                            className="w-full"
                                        >
                                            {t('cancel')}
                                        </Button>
                                    </div>
                                </div>
                                <div className="lg:col-span-2">
                                    <ContentTabs transcription={transcription} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );

    const renderLogsList = () => (
        <div className="space-y-4">
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAfterLectureMode('menu')}
                    className="gap-2"
                >
                    <ArrowLeft size={16} />
                    {t('backToMenu')}
                </Button>
                <h2 className="text-xl font-semibold">{t('previousLectureLogs')}</h2>
            </div>

            {isLoadingLogs ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Skeleton className="h-48 rounded-xl" />
                    <Skeleton className="h-48 rounded-xl" />
                    <Skeleton className="h-48 rounded-xl" />
                </div>
            ) : logs && logs.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {logs.map((log) => (
                        <Card
                            key={log.id}
                            className="flex cursor-pointer flex-col transition-shadow hover:shadow-md"
                            onClick={() => handleViewDetails(log)}
                        >
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <CardTitle className="line-clamp-1 text-base">
                                            {log.title || t('untitledSession')}
                                        </CardTitle>
                                        <CardDescription className="text-xs">
                                            {format(new Date(log.created_at), 'PPP p')}
                                        </CardDescription>
                                    </div>
                                    <Badge variant={log.summary ? 'default' : 'secondary'}>
                                        {log.summary
                                            ? t('logStatus.ready')
                                            : t('logStatus.processing')}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="grow">
                                <p className="line-clamp-3 text-sm text-gray-500">
                                    {log.summary || t('contentGenerationInProgress')}
                                </p>
                            </CardContent>
                            <CardFooter className="flex justify-between border-t p-4">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-500 hover:bg-red-50 hover:text-red-700"
                                    onClick={(e) => handleDeleteLog(log.id, e)}
                                >
                                    <Trash size={16} />
                                </Button>
                                <Button size="sm" variant="outline">
                                    {t('viewDetails')}
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center text-gray-500">
                    <FileText size={48} className="mb-4 text-gray-300" />
                    <p className="text-lg font-medium">{t('noSessionsYet')}</p>
                    <p className="text-sm">{t('startSessionToSeeLogs')}</p>
                </div>
            )}
        </div>
    );

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>

            <div className="space-y-8 px-4 py-0 lg:px-0">
                {/* Main Tabs */}
                <div className="flex items-center justify-center">
                    <Tabs
                        value={activeTab}
                        onValueChange={(v) => setActiveTab(v as any)}
                        className="w-full"
                    >
                        <TabsList className="grid w-full grid-cols-2 lg:mx-auto lg:w-[400px]">
                            <TabsTrigger value="lecture">{t('tabs.lecture')}</TabsTrigger>
                            <TabsTrigger value="assessment">{t('tabs.assessment')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="assessment" className="mt-8 text-center">
                            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center text-gray-500">
                                <FileText size={48} className="mb-4 text-gray-300" />
                                <p className="text-lg font-medium">{t('assessmentTools')}</p>
                                <p className="text-sm">{t('comingSoon')}</p>
                            </div>
                        </TabsContent>

                        <TabsContent value="lecture" className="mt-8">
                            {/* If viewing a selected log (from history or just created), show detail view irrespective of current dashboard state,
                                 UNLESS we are in the 'creation' flow which handles its own view */}
                            {selectedLog ? (
                                renderLogDetail()
                            ) : (
                                <>
                                    {viewMode === 'dashboard' && (
                                        <LectureDashboard onSelectStep={setViewMode} />
                                    )}

                                    {viewMode === 'before' && (
                                        <BeforeLectureView
                                            onBack={() => setViewMode('dashboard')}
                                        />
                                    )}

                                    {viewMode === 'in' && (
                                        <>
                                            {inLectureMode === 'menu' && (
                                                <InLectureView
                                                    onBack={() => setViewMode('dashboard')}
                                                    onRecord={() => setInLectureMode('record')}
                                                    onUpload={() => setInLectureMode('upload')}
                                                />
                                            )}
                                            {(inLectureMode === 'record' ||
                                                inLectureMode === 'upload') &&
                                                renderSessionCreation()}
                                        </>
                                    )}

                                    {viewMode === 'after' && (
                                        <>
                                            {afterLectureMode === 'menu' && (
                                                <AfterLectureView
                                                    onBack={() => setViewMode('dashboard')}
                                                    onViewLogs={() => setAfterLectureMode('logs')}
                                                />
                                            )}
                                            {afterLectureMode === 'logs' && renderLogsList()}
                                        </>
                                    )}
                                </>
                            )}
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </LayoutContainer>
    );
}
