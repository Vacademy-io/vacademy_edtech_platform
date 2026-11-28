import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, SpeakerHigh, SpeakerLow, SpeakerSlash } from '@phosphor-icons/react';

interface AudioPlayerProps {
    audioUrl: string;
    title?: string;
}

export function AudioPlayer({ audioUrl, title }: AudioPlayerProps) {
    const { t } = useTranslation('instructorCopilotAudioPlayer');
    const displayTitle = title ?? t('defaultTitle');
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
        };

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [audioUrl]);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleSeek = (value: number[]) => {
        const audio = audioRef.current;
        if (!audio) return;

        const newTime = value[0];
        if (newTime !== undefined) {
            audio.currentTime = newTime;
            setCurrentTime(newTime);
        }
    };

    const handleVolumeChange = (value: number[]) => {
        const audio = audioRef.current;
        if (!audio) return;

        const newVolume = value[0];
        if (newVolume !== undefined) {
            audio.volume = newVolume;
            setVolume(newVolume);
            setIsMuted(newVolume === 0);
        }
    };

    const toggleMute = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (isMuted) {
            audio.volume = volume || 0.5;
            setIsMuted(false);
        } else {
            audio.volume = 0;
            setIsMuted(true);
        }
    };

    const formatTime = (seconds: number) => {
        if (isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const getVolumeIcon = () => {
        if (isMuted || volume === 0) return <SpeakerSlash size={20} />;
        if (volume < 0.5) return <SpeakerLow size={20} />;
        return <SpeakerHigh size={20} />;
    };

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <audio ref={audioRef} src={audioUrl} preload="metadata" />

            <div className="space-y-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">{displayTitle}</h3>
                    <p className="text-sm text-gray-500">
                        {t('duration', { time: formatTime(duration) })}
                    </p>
                </div>

                {/* Seek Bar */}
                <div className="space-y-2">
                    <Slider
                        value={[currentTime]}
                        max={duration || 100}
                        step={0.1}
                        onValueChange={handleSeek}
                        className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-between">
                    <Button
                        onClick={togglePlay}
                        size="lg"
                        className="bg-primary-500 hover:bg-primary-600"
                    >
                        {isPlaying ? (
                            <Pause size={24} weight="fill" />
                        ) : (
                            <Play size={24} weight="fill" />
                        )}
                    </Button>

                    {/* Volume Control */}
                    <div className="flex w-32 items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={toggleMute}>
                            {getVolumeIcon()}
                        </Button>
                        <Slider
                            value={[isMuted ? 0 : volume]}
                            max={1}
                            step={0.01}
                            onValueChange={handleVolumeChange}
                            className="flex-1"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
