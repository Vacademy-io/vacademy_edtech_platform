"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import { useAudioTrackingStore } from "@/stores/study-library/audio-tracking-store";
import { useAudioSync } from "@/hooks/study-library/useAudioSync";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { getPublicUrl } from "@/services/upload_file";
import { Network } from "@/utils/network-plugin";
import { resolveSlideSource } from "@/lib/offline/resolve";
import { getUserId } from "@/constants/getUserId";
import { safePlay } from "./utils";
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    SpeakerHigh,
    SpeakerSlash,
    FileText,
    SpinnerGap,
    MusicNotes,
    CaretDown,
    CaretUp,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { SlideDownloadTypeKey } from "@/constants/slide-download-permission";
import { SlideDownloadButton } from "./slide-download-button";

interface AudioPlayerProps {
    audioSlide: {
        id: string;
        source_type: "FILE" | "URL";
        published_audio_file_id: string;
        published_audio_length_in_millis: number;
        thumbnail_file_id?: string;
        transcript?: string;
        external_url?: string | null;
    };
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioSlide }) => {
    const { t } = useTranslation("libraryCommonA");
    const { activeItem } = useContentStore();
    const addActivity = useAudioTrackingStore((state) => state.addActivity);
    const { syncAudioTrackingData } = useAudioSync();
    
    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);
    const activityId = useRef(uuidv4());
    const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const lastSyncTimeRef = useRef<number>(0);
    const isSyncingRef = useRef<boolean>(false);
    // Latest-callback refs so interval/unmount closures (declared before the
    // callbacks) can close the open segment and sync without TDZ issues.
    const saveSegmentRef = useRef<((endTime: number) => void) | null>(null);
    const syncOnUnmountRef = useRef<(() => Promise<void>) | null>(null);
    // Offline-blob URL revoker (plan §B4) for whichever decrypted audio Blob
    // is currently assigned to audioUrl, if any — revoked whenever a new
    // source loads or this player unmounts.
    const revokeAudioBlobRef = useRef<(() => void) | null>(null);
    
    // State
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState("1");
    const [isLoading, setIsLoading] = useState(true);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showTranscript, setShowTranscript] = useState(false);

    // Tracking State
    const currentSegmentStart = useRef<number>(0);
    const accumulatedTimestamps = useRef<Array<{
        id: string;
        start: number;
        end: number;
        speed: number;
    }>>([]);

    // Load Resources
    useEffect(() => {
        const loadResources = async () => {
            setIsLoading(true);
            setError(null);
            // A previous slide's decrypted Blob (if any) is no longer needed.
            revokeAudioBlobRef.current?.();
            revokeAudioBlobRef.current = null;
            try {
                let url = audioSlide.external_url;
                if (audioSlide.source_type === "FILE" || !url) {
                    // Offline-aware resolution (plan §B4): only take the
                    // resolver path while offline, mirroring slide-material's
                    // resolvePlaybackUrl — online always keeps today's
                    // getPublicUrl behavior unchanged.
                    const { connected } = await Network.getStatus();
                    const userId = connected ? null : await getUserId();
                    if (userId && activeItem?.id) {
                        const result = await resolveSlideSource({
                            userId,
                            fileId: audioSlide.published_audio_file_id,
                            slideId: activeItem.id,
                            mimeType: "audio/mpeg",
                            resolveRemoteUrl: () =>
                                getPublicUrl(audioSlide.published_audio_file_id),
                        });
                        url = result.url;
                        if (result.kind === "offline-blob" && result.revoke) {
                            revokeAudioBlobRef.current = result.revoke;
                        }
                    } else {
                        url = await getPublicUrl(audioSlide.published_audio_file_id);
                    }
                }

                if (!url) throw new Error("Could not load audio source.");
                setAudioUrl(url);

                if (audioSlide.thumbnail_file_id) {
                    const img = await getPublicUrl(audioSlide.thumbnail_file_id);
                    setImageUrl(img);
                }
            } catch (err) {
                console.error("Failed to load audio resources:", err);
                setError(t("audioPlayer.failedToLoad"));
            } finally {
                setIsLoading(false);
            }
        };

        loadResources();

        return () => {
            if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
            revokeAudioBlobRef.current?.();
            revokeAudioBlobRef.current = null;
        };
    }, [audioSlide, activeItem?.id]);

    // Debounced sync function
    const debouncedSync = useCallback(async () => {
        const now = Date.now();
        if (now - lastSyncTimeRef.current < 10000) return;
        if (isSyncingRef.current) return;
        if (accumulatedTimestamps.current.length === 0) return;
        
        isSyncingRef.current = true;
        lastSyncTimeRef.current = now;
        
        try {
            await syncAudioTrackingData();
        } finally {
            isSyncingRef.current = false;
        }
    }, [syncAudioTrackingData]);

    // Initialize Interval Sync — cadence = min(audio duration, 60s) so short
    // audios sync at their own length and the worst-case unsynced window is
    // bounded by audio length, not by a fixed 15s.
    useEffect(() => {
        const periodMs = Math.max(
            1000,
            Math.min(
                Number.isFinite(duration) && duration > 0
                    ? Math.round(duration * 1000)
                    : 60000,
                60000
            )
        );
        syncIntervalRef.current = setInterval(() => {
            if (isPlaying) {
                // Close the currently-open segment first: segments were only
                // created on pause/seek/skip/end, so an uninterrupted listen
                // accumulated nothing and the periodic sync was a no-op — a
                // learner who played a lecture straight through and closed the
                // tab was credited 0%. (Via ref: saveCurrentSegment is defined
                // later in the component.)
                if (audioRef.current) {
                    saveSegmentRef.current?.(audioRef.current.currentTime);
                }
                debouncedSync();
            }
        }, periodMs);

        return () => {
            if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
        };
    }, [debouncedSync, isPlaying, duration]);

    // Sync on unmount — close the open segment first, or the time since the
    // last pause/seek is silently discarded. Refs keep the latest callbacks
    // reachable from the empty-dep cleanup.
    useEffect(() => {
        return () => {
            try {
                if (audioRef.current) {
                    saveSegmentRef.current?.(audioRef.current.currentTime);
                }
            } catch {
                /* never block unmount */
            }
            if (accumulatedTimestamps.current.length > 0) {
                syncOnUnmountRef.current?.().catch(console.error);
            }
        };
    }, []);

    // Save current segment
    const saveCurrentSegment = useCallback((endTime: number) => {
        if (!activeItem) return;
        
        const start = currentSegmentStart.current * 1000;
        const end = endTime * 1000;
        
        if (end - start < 500) return;
        
        const newTimestamp = {
            id: uuidv4(),
            start: start,
            end: end,
            speed: parseFloat(playbackRate)
        };
        
        accumulatedTimestamps.current.push(newTimestamp);
        
        addActivity({
            id: activeItem.id,
            activity_id: activityId.current,
            source: "AUDIO",
            source_id: audioSlide.published_audio_file_id,
            start_time: Date.now(),
            end_time: Date.now(),
            percentage_watched: (end / (audioSlide.published_audio_length_in_millis || (duration * 1000))) * 100,
            timestamps: accumulatedTimestamps.current,
            sync_status: 'STALE',
            new_activity: accumulatedTimestamps.current.length === 1,
            current_start_time_in_epoch: Date.now()
        }, true);
        
        currentSegmentStart.current = endTime;
    }, [activeItem, audioSlide, duration, playbackRate, addActivity]);

    // Keep the unmount cleanup pointed at the latest callbacks.
    saveSegmentRef.current = saveCurrentSegment;
    syncOnUnmountRef.current = syncAudioTrackingData;

    const handleTimeUpdate = () => {
        if (!audioRef.current) return;
        const now = audioRef.current.currentTime;
        setCurrentTime(now);
        setDuration(audioRef.current.duration || 0);
    };

    const togglePlay = () => {
        if (!audioRef.current) return;
        
        if (isPlaying) {
            saveCurrentSegment(audioRef.current.currentTime);
            audioRef.current.pause();
            debouncedSync();
        } else {
            currentSegmentStart.current = audioRef.current.currentTime;
            safePlay(audioRef.current);
        }
        setIsPlaying(!isPlaying);
    };

    const handleSeek = (value: number[]) => {
        if (!audioRef.current) return;
        const time = value[0];
        
        if (isPlaying && audioRef.current.currentTime !== time) {
            saveCurrentSegment(audioRef.current.currentTime);
        }
        
        audioRef.current.currentTime = time;
        setCurrentTime(time);
        currentSegmentStart.current = time;
    };

    const handleSkip = (seconds: number) => {
        if (!audioRef.current) return;
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        
        if (isPlaying) {
            saveCurrentSegment(audioRef.current.currentTime);
        }
        
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
        currentSegmentStart.current = newTime;
    };

    const handleSpeedChange = (speed: string) => {
        if (!audioRef.current) return;
        
        if (isPlaying) {
            saveCurrentSegment(audioRef.current.currentTime);
        }
        
        audioRef.current.playbackRate = parseFloat(speed);
        setPlaybackRate(speed);
        currentSegmentStart.current = audioRef.current.currentTime;
    };

    const handleVolumeChange = (value: number[]) => {
        const vol = value[0];
        setVolume(vol);
        if (audioRef.current) audioRef.current.volume = vol;
    };

    const toggleMute = () => {
        const newVol = volume === 0 ? 1 : 0;
        setVolume(newVol);
        if (audioRef.current) audioRef.current.volume = newVol;
    };

    const handleAudioEnded = () => {
        if (audioRef.current) {
            saveCurrentSegment(audioRef.current.currentTime);
        }
        setIsPlaying(false);
        // Bypass the 10s debounce on natural end so the learner sees 100%
        // immediately — debouncedSync() can drop this call if a periodic
        // sync just fired moments before, leaving the final segment unsynced.
        syncAudioTrackingData().catch(console.error);
    };

    const formatTime = (time: number) => {
        if (isNaN(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-12 h-full">
                <Card className="w-full max-w-2xl">
                    <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                        <SpinnerGap className="h-10 w-10 animate-spin text-primary" />
                        <p className="text-muted-foreground font-medium">{t("audioPlayer.loading")}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (error || !audioUrl) {
        return (
            <div className="flex flex-col items-center justify-center p-12 h-full">
                <Card className="w-full max-w-2xl">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                            <SpeakerSlash className="h-7 w-7 text-destructive" />
                        </div>
                        <p className="text-destructive font-medium">{error || t("audioPlayer.sourceUnavailable")}</p>
                        <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => window.location.reload()}
                        >
                            {t("common.tryAgain")}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full max-w-3xl mx-auto p-4 sm:p-6 gap-4">
            {/* Main Player Card */}
            <Card className="overflow-hidden shadow-lg border-0 bg-gradient-to-br from-background to-muted/30">
                <CardContent className="p-0">
                    <div className="flex flex-col">
                        {/* Cover Art & Info */}
                        <div className="relative">
                            <div className="aspect-video sm:aspect-[21/9] w-full bg-gradient-to-br from-primary/20 via-primary/10 to-background relative overflow-hidden">
                                {imageUrl ? (
                                    <img 
                                        src={imageUrl} 
                                        alt={t("audioPlayer.coverAlt")}
                                        className="w-full h-full object-cover opacity-80"
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                                            <MusicNotes className="h-12 w-12 text-primary/60" />
                                        </div>
                                    </div>
                                )}
                                {/* Gradient Overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
                                
                                {/* Title Overlay */}
                                <div className="absolute bottom-0 start-0 end-0 p-6">
                                    <h2 className="text-xl sm:text-2xl font-bold text-foreground line-clamp-2">
                                        {activeItem?.title || t("audioPlayer.titleFallback")}
                                    </h2>
                                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                                        {activeItem?.description || t("audioPlayer.descriptionFallback")}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Controls Section */}
                        <div className="p-6 space-y-6">
                            {/* Progress Slider */}
                            <div className="space-y-2">
                                <Slider
                                    value={[currentTime]}
                                    max={duration || 100}
                                    step={0.1}
                                    onValueChange={handleSeek}
                                    className="cursor-pointer"
                                />
                                <div className="flex justify-between text-xs text-muted-foreground font-medium">
                                    <span>{formatTime(currentTime)}</span>
                                    <span>{formatTime(duration)}</span>
                                </div>
                            </div>

                            {/* Main Controls */}
                            <div className="flex items-center justify-center gap-4">
                                {/* Skip Back */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-12 w-12 rounded-full hover:bg-primary/10"
                                    onClick={() => handleSkip(-10)}
                                >
                                    <SkipBack className="h-5 w-5" />
                                </Button>

                                {/* Play/Pause - Main Button */}
                                <Button
                                    variant="default"
                                    size="icon"
                                    className={cn(
                                        "h-16 w-16 rounded-full shadow-lg transition-all duration-200",
                                        "hover:scale-105 hover:shadow-xl",
                                        "bg-primary hover:bg-primary/90"
                                    )}
                                    onClick={togglePlay}
                                >
                                    {isPlaying ? (
                                        <Pause className="h-7 w-7 fill-current" />
                                    ) : (
                                        <Play className="h-7 w-7 fill-current ms-1" />
                                    )}
                                </Button>

                                {/* Skip Forward */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-12 w-12 rounded-full hover:bg-primary/10"
                                    onClick={() => handleSkip(10)}
                                >
                                    <SkipForward className="h-5 w-5" />
                                </Button>
                            </div>

                            {/* Secondary Controls */}
                            <div className="flex items-center justify-between gap-4">
                                {/* Speed Control */}
                                <Select value={playbackRate} onValueChange={handleSpeedChange}>
                                    <SelectTrigger className="w-20 h-9">
                                        <SelectValue placeholder={t("audioPlayer.speedPlaceholder")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {["0.5", "0.75", "1", "1.25", "1.5", "1.75", "2"].map((rate) => (
                                            <SelectItem key={rate} value={rate}>
                                                {rate}x
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* Volume Control */}
                                <div className="flex items-center gap-2 flex-1 max-w-reg-180">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 shrink-0"
                                        onClick={toggleMute}
                                    >
                                        {volume === 0 ? (
                                            <SpeakerSlash className="h-4 w-4" />
                                        ) : (
                                            <SpeakerHigh className="h-4 w-4" />
                                        )}
                                    </Button>
                                    <Slider
                                        value={[volume]}
                                        max={1}
                                        step={0.1}
                                        onValueChange={handleVolumeChange}
                                        className="cursor-pointer"
                                    />
                                </div>

                                {/* Transcript Toggle */}
                                {audioSlide.transcript && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        onClick={() => setShowTranscript(!showTranscript)}
                                    >
                                        <FileText className="h-4 w-4" />
                                        <span className="hidden sm:inline">{t("audioPlayer.transcriptLabel")}</span>
                                        {showTranscript ? (
                                            <CaretUp className="h-3 w-3" />
                                        ) : (
                                            <CaretDown className="h-3 w-3" />
                                        )}
                                    </Button>
                                )}

                                {/* Content Protection → Audio: off for learners unless switched on.
                                    Never offered for an offline (decrypted, blob:) copy — same as video. */}
                                <SlideDownloadButton
                                    typeKey={SlideDownloadTypeKey.AUDIO}
                                    title={activeItem?.title}
                                    url={audioUrl.startsWith("blob:") ? null : audioUrl}
                                    mimeType="audio/mpeg"
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Transcript Section */}
            {audioSlide.transcript && showTranscript && (
                <Card className="border shadow-sm">
                    <CardContent className="p-0">
                        <div className="p-4 border-b bg-muted/30">
                            <h3 className="font-semibold flex items-center gap-2">
                                <FileText className="h-4 w-4 text-primary" />
                                {t("audioPlayer.transcriptLabel")}
                            </h3>
                        </div>
                        <ScrollArea className="h-64">
                            <div className="p-4 text-sm text-muted-foreground leading-relaxed">
                                {audioSlide.transcript.split('\n').map((para, i) => (
                                    <p key={i} className="mb-3 last:mb-0">{para}</p>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            )}

            {/* Hidden Audio Element */}
            <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleAudioEnded}
                onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
                onError={(e) => {
                    console.error("Audio error", e); 
                    setError("Playback error");
                }}
            />
        </div>
    );
};

export default AudioPlayer;
