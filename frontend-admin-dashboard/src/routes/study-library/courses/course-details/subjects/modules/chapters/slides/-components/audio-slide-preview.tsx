'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slide } from '../-hooks/use-slides';
import { getPublicUrl } from '@/services/upload_file';
import { toast } from 'sonner';
import { Play, Pause, SpeakerHigh, Trash } from '@phosphor-icons/react';

interface AudioSlidePreviewProps {
    activeItem: Slide;
    isLearnerView?: boolean;
}

const AudioSlidePreview = ({ activeItem, isLearnerView = false }: AudioSlidePreviewProps) => {
    const { t } = useTranslation('studyLibraryAudioSlidePreview');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [audioUrl, setAudioUrl] = useState<string>('');
    const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const audioSlide = activeItem.audio_slide;
    const audioStatus = activeItem.status;

    // Get the appropriate audio file ID based on status
    const audioFileId =
        audioStatus === 'PUBLISHED'
            ? audioSlide?.published_audio_file_id || audioSlide?.audio_file_id
            : audioSlide?.audio_file_id;

    // Reset state when switching slides
    useEffect(() => {
        setAudioUrl('');
        setThumbnailUrl('');
        setIsLoading(true);
        setError(null);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
    }, [activeItem.id]);

    // Fetch audio and thumbnail URLs
    useEffect(() => {
        const fetchUrls = async () => {
            if (!audioSlide) {
                setError(t('audioDataNotFound'));
                setIsLoading(false);
                return;
            }

            try {
                // Fetch audio URL
                if (audioSlide.source_type === 'FILE' && audioFileId) {
                    const url = await getPublicUrl(audioFileId);
                    setAudioUrl(url);
                } else if (audioSlide.source_type === 'URL' && audioSlide.external_url) {
                    setAudioUrl(audioSlide.external_url);
                }

                // Fetch thumbnail URL if available
                if (audioSlide.thumbnail_file_id) {
                    const thumbUrl = await getPublicUrl(audioSlide.thumbnail_file_id);
                    setThumbnailUrl(thumbUrl);
                }
            } catch (err) {
                console.error('Error fetching audio URLs:', err);
                setError(t('failedToLoadAudio'));
            } finally {
                setIsLoading(false);
            }
        };

        fetchUrls();
    }, [audioSlide, audioFileId]);

    // Audio event handlers
    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            const d = audioRef.current.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
        }
    };

    const handleDurationChange = () => {
        if (audioRef.current) {
            const d = audioRef.current.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
        }
    };

    const handlePlayPause = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = parseFloat(e.target.value);
        if (audioRef.current) {
            audioRef.current.currentTime = newTime;
            setCurrentTime(newTime);
        }
    };

    const handleAudioError = () => {
        setError(t('failedToPlayAudio'));
        toast.error(t('playbackError'));
    };

    const handleAudioEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
        }
    };

    // Format time (mm:ss)
    const formatTime = (time: number): string => {
        if (!Number.isFinite(time) || time < 0) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // Prefer the live audio element duration; fall back to the stored length
    // so the timer renders reliably even before metadata loads or when
    // audio.duration reports Infinity (some streamed sources).
    const storedDurationSec =
        audioSlide?.audio_length_in_millis && audioSlide.audio_length_in_millis > 0
            ? audioSlide.audio_length_in_millis / 1000
            : 0;
    const effectiveDuration = duration > 0 ? duration : storedDurationSec;

    // Check if the slide is deleted
    if (activeItem?.status === 'DELETED') {
        return (
            <div className="flex size-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b bg-red-50 px-6 py-4">
                    <h2 className="text-lg font-semibold text-red-700">{t('audioLabel')}</h2>
                    <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-600">
                        {t('deletedTag')}
                    </span>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-12">
                    <div className="text-center">
                        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-red-100">
                            <Trash size={24} className="text-red-500" />
                        </div>
                        <h3 className="mb-2 text-lg font-medium text-slate-600">
                            {t('audioDeletedTitle')}
                        </h3>
                        <p className="text-sm text-slate-400">{t('audioDeletedSubtitle')}</p>
                    </div>
                </div>
            </div>
        );
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center rounded-lg bg-gray-100">
                <div className="flex flex-col items-center gap-3">
                    <div className="size-12 animate-spin rounded-full border-y-2 border-primary-500"></div>
                    <p className="text-sm text-gray-600">{t('loadingAudio')}</p>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex h-64 flex-col items-center justify-center rounded-lg bg-red-50 p-4">
                <p className="mb-2 font-medium text-red-500">{error}</p>
            </div>
        );
    }

    return (
        <div
            key={`audio-${activeItem.id}`}
            className="flex w-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm"
        >
            {/* Audio Player Card */}
            <div className="flex flex-col gap-4 p-6">
                {/* Thumbnail and Info */}
                <div className="flex items-center gap-4">
                    {/* Thumbnail/Album Art */}
                    <div className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 shadow-md">
                        {thumbnailUrl ? (
                            <img
                                src={thumbnailUrl}
                                alt={activeItem.title || t('audioThumbnailAlt')}
                                className="size-full object-cover"
                            />
                        ) : (
                            <SpeakerHigh size={40} className="text-white" weight="fill" />
                        )}
                    </div>

                    {/* Title and Description */}
                    <div className="flex flex-1 flex-col">
                        <h3 className="text-lg font-semibold text-neutral-800">
                            {activeItem.title || t('untitledAudio')}
                        </h3>
                        {activeItem.description && (
                            <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                                {activeItem.description}
                            </p>
                        )}
                        {effectiveDuration > 0 && (
                            <p className="mt-1 text-xs text-neutral-400">
                                {t('durationLabel', {
                                    time: formatTime(effectiveDuration),
                                })}
                            </p>
                        )}
                    </div>
                </div>

                {/* Audio Controls */}
                <div className="flex flex-col gap-3">
                    {/* Progress Bar */}
                    <div className="flex items-center gap-3">
                        <span className="w-12 text-right text-xs text-neutral-500">
                            {formatTime(currentTime)}
                        </span>
                        <input
                            type="range"
                            min="0"
                            max={effectiveDuration || 0}
                            value={currentTime}
                            onChange={handleSeek}
                            disabled={effectiveDuration <= 0}
                            style={{
                                background: `linear-gradient(to right, hsl(var(--primary-500)) 0% ${
                                    effectiveDuration
                                        ? (currentTime / effectiveDuration) * 100
                                        : 0
                                }%, #e5e5e5 ${
                                    effectiveDuration
                                        ? (currentTime / effectiveDuration) * 100
                                        : 0
                                }% 100%)`,
                            }}
                            className="h-2 flex-1 cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary-500 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-500"
                        />
                        <span className="w-12 text-xs text-neutral-500">
                            {formatTime(effectiveDuration)}
                        </span>
                    </div>

                    {/* Play/Pause Button */}
                    <div className="flex justify-center">
                        <button
                            onClick={handlePlayPause}
                            className="flex size-14 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg transition-all hover:scale-105 hover:bg-primary-600 active:scale-95"
                            aria-label={isPlaying ? t('pauseAriaLabel') : t('playAriaLabel')}
                        >
                            {isPlaying ? (
                                <Pause size={28} weight="fill" />
                            ) : (
                                <Play size={28} weight="fill" />
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Transcript Section (if available) */}
            {audioSlide?.transcript && !isLearnerView && (
                <div className="border-t border-neutral-100 bg-neutral-50 p-4">
                    <h4 className="mb-2 text-sm font-medium text-neutral-700">
                        {t('transcriptLabel')}
                    </h4>
                    <div className="max-h-48 overflow-y-auto rounded-lg bg-white p-3 text-sm text-neutral-600 shadow-inner">
                        {audioSlide.transcript}
                    </div>
                </div>
            )}

            {/* Hidden Audio Element */}
            <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={handleDurationChange}
                onError={handleAudioError}
                onEnded={handleAudioEnded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                preload="metadata"
            />
        </div>
    );
};

export default AudioSlidePreview;
