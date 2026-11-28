import { useTranslation } from 'react-i18next';
import { useAudioRecording } from '@/hooks/useAudioRecording';
import { Button } from '@/components/ui/button';
import { Microphone, Stop, Pause, Play, ArrowCounterClockwise } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface AudioRecorderProps {
    onRecordingComplete: (audioBlob: Blob, audioUrl: string) => void;
}

export function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
    const { t } = useTranslation('instructorCopilotAudioRecorder');
    const {
        isRecording,
        isPaused,
        recordingTime,
        audioBlob,
        audioUrl,
        transcripts,
        error,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        resetRecording,
    } = useAudioRecording();

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStop = () => {
        stopRecording();
        // Wait a bit for the audio blob to be ready
        setTimeout(() => {
            if (audioBlob && audioUrl) {
                onRecordingComplete(audioBlob, audioUrl);
            }
        }, 500);
    };

    return (
        <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8">
                <div className="flex flex-col items-center gap-4">
                    {/* Recording Status */}
                    {isRecording && (
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                                <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                            </div>
                            <span className="text-sm font-medium text-gray-700">
                                {isPaused ? t('status.paused') : t('status.recording')}
                            </span>
                        </div>
                    )}

                    {/* Timer */}
                    <div className="text-4xl font-mono font-bold text-gray-900">
                        {formatTime(recordingTime)}
                    </div>

                    {/* Controls */}
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        {!isRecording ? (
                            <Button
                                onClick={startRecording}
                                size="lg"
                                className="bg-red-500 hover:bg-red-600 text-white"
                            >
                                <Microphone size={20} className="mr-2" />
                                {t('startRecording')}
                            </Button>
                        ) : (
                            <>
                                {!isPaused ? (
                                    <Button
                                        onClick={pauseRecording}
                                        size="lg"
                                        variant="outline"
                                    >
                                        <Pause size={20} className="mr-2" />
                                        {t('pause')}
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={resumeRecording}
                                        size="lg"
                                        variant="outline"
                                    >
                                        <Play size={20} className="mr-2" />
                                        {t('resume')}
                                    </Button>
                                )}
                                <Button
                                    onClick={handleStop}
                                    size="lg"
                                    className="bg-gray-900 hover:bg-gray-800"
                                >
                                    <Stop size={20} className="mr-2" />
                                    {t('stop')}
                                </Button>
                            </>
                        )}

                        {(audioBlob || recordingTime > 0) && !isRecording && (
                            <Button
                                onClick={resetRecording}
                                size="lg"
                                variant="ghost"
                            >
                                <ArrowCounterClockwise size={20} className="mr-2" />
                                {t('reset')}
                            </Button>
                        )}
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 w-full">
                            <p className="text-sm text-red-600">{error}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Real-time Transcription */}
            {isRecording && transcripts.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">
                        {t('transcriptionHeading')}
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {transcripts.map((transcript, index) => (
                            <div
                                key={index}
                                className={cn(
                                    'text-sm p-2 rounded',
                                    transcript.isFinal
                                        ? 'bg-white text-gray-900 font-medium'
                                        : 'bg-gray-100 text-gray-600 italic'
                                )}
                            >
                                {transcript.text}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}


