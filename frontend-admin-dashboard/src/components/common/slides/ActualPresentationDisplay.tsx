/* eslint-disable */
// @ts-nocheck
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { SlideRenderer } from './SlideRenderer'; // Assuming SlideRenderer is in the same directory
import { LiveSessionActionBar } from './components/LiveSessionActionBar';
import { useSlideStore } from '@/stores/Slides/useSlideStore'; // For participants count, total slides (optional)
import type { Slide as AppSlide } from './utils/types';
import type { SessionDetails } from './SlideEditorComponent'; // Assuming SessionDetails type is exported or define here
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Maximize, Minimize, X, Tv2 } from 'lucide-react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance'; // For API calls
import { toast } from 'sonner'; // For notifications
import { ParticipantsSidePanel } from '../slides/components/ParticipantsSidePanel'; // Implied import for ParticipantsSidePanel component
import { RecommendationsSidePanel } from './components/RecommendationsSidePanel'; // New import for recommendations
import { QuickQuestionFAB, type InsertionBehavior } from './components/QuickQuestionFAB';
import { ResponseOverlay } from './components/ResponseOverlay';
import { SlideTypeEnum } from './utils/types';
import { SessionExcalidrawOverlay } from './components/SessionExcalidrawOverlay';
import { BASE_URL } from '@/constants/urls';

// Define Participant interface (copied from ParticipantsSidePanel)
interface Participant {
    username: string;
    user_id?: string | null;
    name?: string | null;
    email?: string | null;
    status: string;
    joined_at?: string; // ISO string
    last_active_at?: string; // ISO string, for INACTIVE participants
}

interface MinimalSessionDetails {
    session_id: string;
    invite_code: string;
    // other fields from SlideEditorComponent's sessionDetails state if needed
}

const BACKEND_URL = BASE_URL;
const MOVE_SLIDE_API_URL = `${BACKEND_URL}/community-service/engage/admin/move`;
// Define ADMIN_SSE_URL_BASE (copied from ParticipantsSidePanel)
const ADMIN_SSE_URL_BASE = `${BACKEND_URL}/community-service/engage/admin/`;

interface ActualPresentationDisplayProps {
    slides: AppSlide[];
    initialSlideId?: string;
    liveSessionData: MinimalSessionDetails | null;
    onVoltExit: () => void;
    isAudioRecording?: boolean;
    isAudioPaused?: boolean;
    audioBlobUrl?: string | null;
    onPauseAudio?: () => void;
    onResumeAudio?: () => void;
    onDownloadAudio?: (format?: 'webm' | 'mp3') => void;
    recordingDuration?: number;


    // Props that will be passed to ParticipantsSidePanel if it's rendered as a child
    // and needs to be controlled from here regarding its visibility.
    isParticipantsPanelOpen?: boolean;
    onToggleParticipantsPanel?: () => void;
    onAddQuickQuestion?: (slideData: AppSlide, insertionBehavior: InsertionBehavior) => void;
    onGenerateTranscript?: () => void;
}

export const ActualPresentationDisplay: React.FC<ActualPresentationDisplayProps> = ({
    slides,
    initialSlideId,
    liveSessionData,
    onVoltExit,
    isAudioRecording,
    isAudioPaused,
    audioBlobUrl,
    onPauseAudio,
    onResumeAudio,
    onDownloadAudio,
    recordingDuration,
    // Defaulting these if not provided, though they might be controlled by a parent of ActualPresentationDisplay
    isParticipantsPanelOpen = false,
    onToggleParticipantsPanel,
    onAddQuickQuestion,
    onGenerateTranscript,
}) => {
    const { setCurrentSlideId: setGlobalCurrentSlideId, recommendationBatches } = useSlideStore();
    const [currentSlideId, setCurrentSlideId] = useState<string | undefined>(initialSlideId);
    // const [participantsCount, setParticipantsCount] = useState(0); // Replaced by participantsList.length
    const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
    const [isRecommendationsPanelOpen, setIsRecommendationsPanelOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const presentationContainerRef = useRef<HTMLDivElement>(null);

    // State for SSE managed participants and connection status
    const [participantsList, setParticipantsList] = useState<Participant[]>([]);
    const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const eventSourceRef = useRef<EventSource | null>(null);
    const previousParticipantsRef = useRef<Participant[]>([]); // Ref to store previous participants

    // New useEffect to keep the global state in sync with the presentation view's active slide.
    useEffect(() => {
        if (currentSlideId) {
            setGlobalCurrentSlideId(currentSlideId);
        }
    }, [currentSlideId, setGlobalCurrentSlideId]);

    // Local state to keep track of slideStartTimestamp for timer
    const [localSlideStart, setLocalSlideStart] = useState<number | null>(
        liveSessionData?.slide_start_timestamp || null
    );

    // Update local start time when liveSessionData changes (e.g. initial load)
    useEffect(() => {
        if (liveSessionData?.slide_start_timestamp) {
            setLocalSlideStart(liveSessionData.slide_start_timestamp);
        }
    }, [liveSessionData?.slide_start_timestamp]);

    // SSE Connection useEffect (adapted from ParticipantsSidePanel)
    useEffect(() => {
        if (!liveSessionData?.session_id) {
            if (eventSourceRef.current) {
                console.log('[ActualPresentationDisplay] Closing SSE: No session_id.');
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            setParticipantsList([]);
            setSseStatus('disconnected');
            return;
        }

        const sessionId = liveSessionData.session_id;

        if (eventSourceRef.current) { // Close existing connection if sessionId changes or on re-connect logic
            console.log('[ActualPresentationDisplay] Closing existing SSE before new one.');
            eventSourceRef.current.close();
        }

        setSseStatus('connecting');
        setParticipantsList([]);
        console.log(`[ActualPresentationDisplay] SSE init. Session ID: ${sessionId}`);
        const sseUrl = `${ADMIN_SSE_URL_BASE}${sessionId}`;
        console.log(`[ActualPresentationDisplay] SSE connecting to: ${sseUrl}`);
        const newEventSource = new EventSource(sseUrl, { withCredentials: true });
        eventSourceRef.current = newEventSource;

        newEventSource.onopen = () => {
            console.log('[ActualPresentationDisplay] SSE Connection Established.');
            setSseStatus('connected');
        };

        const directParticipantsListener = (event: MessageEvent) => {
            console.log("[ActualPresentationDisplay] Received 'participants' event data:", event.data);
            try {
                const newParticipants = JSON.parse(event.data) as Participant[];
                if (Array.isArray(newParticipants)) {
                    // Compare with previous participants to detect joins/leaves
                    if (previousParticipantsRef.current && previousParticipantsRef.current.length > 0) {
                        const currentIds = new Set(newParticipants.map(p => p.user_id || p.username));
                        const previousIds = new Set(previousParticipantsRef.current.map(p => p.user_id || p.username));

                        // Detect joins
                        newParticipants.forEach(p => {
                            const participantKey = p.user_id || p.username;
                            if (!previousIds.has(participantKey)) {
                                toast.success(`${p.name || p.username} joined the session.`);
                            }
                        });

                        // Detect leaves
                        previousParticipantsRef.current.forEach(p => {
                            const participantKey = p.user_id || p.username;
                            if (!currentIds.has(participantKey)) {
                                toast.error(`${p.name || p.username} left the session.`);
                            }
                        });
                    }
                    setParticipantsList(newParticipants);
                    previousParticipantsRef.current = newParticipants; // Update ref after processing
                } else {
                    console.warn("[ActualPresentationDisplay] 'participants' data received is not an array:", newParticipants);
                     // Still update refs even if data is not an array to prevent stale comparisons on next valid array
                    previousParticipantsRef.current = Array.isArray(newParticipants) ? newParticipants : [];
                }
            } catch (error) {
                console.error("[ActualPresentationDisplay] Error parsing 'participants' data:", error);
            }
        };
        newEventSource.addEventListener('participants', directParticipantsListener);

        const sessionStateListener = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                console.log("[ActualPresentationDisplay] SSE: 'session_state_presenter' received", data);
                if (data.participants && Array.isArray(data.participants)) {
                    // Similar join/leave detection for session_state_presenter if it can also change participant list
                    const newParticipants = data.participants as Participant[];
                     if (previousParticipantsRef.current && previousParticipantsRef.current.length > 0) {
                        const currentIds = new Set(newParticipants.map(p => p.user_id || p.username));
                        const previousIds = new Set(previousParticipantsRef.current.map(p => p.user_id || p.username));

                        newParticipants.forEach(p => {
                            const participantKey = p.user_id || p.username;
                            if (!previousIds.has(participantKey)) {
                                toast.success(`${p.name || p.username} joined the session.`);
                            }
                        });
                        previousParticipantsRef.current.forEach(p => {
                            const participantKey = p.user_id || p.username;
                            if (!currentIds.has(participantKey)) {
                                toast.error(`${p.name || p.username} left the session.`);
                            }
                        });
                    }
                    setParticipantsList(newParticipants);
                    previousParticipantsRef.current = newParticipants; // Update ref
                }
                // Potentially handle other session state updates here if needed
            } catch (e) {
                console.warn("[ActualPresentationDisplay] SSE: Error parsing 'session_state_presenter' data:", e);
            }
        };
        newEventSource.addEventListener('session_state_presenter', sessionStateListener);

        newEventSource.onerror = (error) => {
            console.error('[ActualPresentationDisplay] SSE Error. Browser will attempt to reconnect.', error);
            setSseStatus('disconnected');
            previousParticipantsRef.current = []; // Clear ref on disconnect
        };

        return () => {
            if (newEventSource) {
                console.log('[ActualPresentationDisplay] Closing SSE Connection and removing listeners.');
                newEventSource.removeEventListener('participants', directParticipantsListener);
                newEventSource.removeEventListener('session_state_presenter', sessionStateListener);
                newEventSource.close();
                eventSourceRef.current = null;
            }
            setSseStatus('disconnected');
        };
    }, [liveSessionData?.session_id]); // Effect reruns if session_id changes

    // Effect to initialize previousParticipantsRef on first load to avoid false join notifications
    useEffect(() => {
        if (participantsList.length > 0 && previousParticipantsRef.current.length === 0) {
            previousParticipantsRef.current = participantsList;
        }
    }, [participantsList]);

    useEffect(() => {
        const isCurrentSlideValid = slides.some(s => s.id === currentSlideId);

        if (!isCurrentSlideValid) {
            // If the current slide ID is no longer in the list (e.g., it was deleted),
            // fall back to the initialSlideId or the first slide.
            if (initialSlideId && slides.some(s => s.id === initialSlideId)) {
                setCurrentSlideId(initialSlideId);
            } else if (slides.length > 0) {
                setCurrentSlideId(slides[0].id);
            } else {
                setCurrentSlideId(undefined);
            }
        }
        // If the current slide is still valid, we do nothing, preserving the user's position.
    }, [slides, initialSlideId, currentSlideId]);

    const currentSlideIndex = slides.findIndex((s) => s.id === currentSlideId);
    const currentSlideData = slides[currentSlideIndex];
    const isQuestionSlideForResponses =
        currentSlideData?.type === SlideTypeEnum.Quiz ||
        currentSlideData?.type === SlideTypeEnum.Feedback;

    // Extract the added_question for the current slide from the live session data.
    // The session API returns options with real DB UUIDs, which we need for matching
    // participant responses in LeaderboardModal and ResponseDistributionModal.
    const currentAddedQuestion = React.useMemo(() => {
        const sessionSlides = (liveSessionData as any)?.slides?.added_slides;
        if (!sessionSlides) return null;
        const sessionSlide = sessionSlides.find((s: any) => s.id === currentSlideId);
        return sessionSlide?.added_question || null;
    }, [liveSessionData, currentSlideId]);

    // Calculate total recommendations count
    const totalRecommendations = recommendationBatches.reduce((sum, batch) => sum + batch.slides.length, 0);

    const goToNextSlide = async () => {
        if (currentSlideIndex < slides.length - 1) {
            const nextSlide = slides[currentSlideIndex + 1];
            if (!nextSlide || typeof nextSlide.slide_order === 'undefined') {
                console.error('[ActualPresentationDisplay] Next slide is invalid or missing slide_order:', nextSlide);
                toast.error("Cannot navigate: Next slide data is invalid.");
                return;
            }
            setCurrentSlideId(nextSlide.id);
            if (liveSessionData?.session_id) {
                try {
                    const res = await authenticatedAxiosInstance.post(MOVE_SLIDE_API_URL, {
                        session_id: liveSessionData.session_id,
                        move_to: nextSlide.slide_order,
                    });
                    if (res.data?.slide_start_timestamp) {
                        setLocalSlideStart(res.data.slide_start_timestamp);
                    }
                    // toast.success(`Moved to slide ${nextSlide.slide_order + 1}`);
                } catch (error) {
                    console.error('Error moving to next slide (API):', error);
                    toast.error('Failed to sync slide change with server.');
                }
            }
        }
    };

    const goToPreviousSlide = async () => {
        if (currentSlideIndex > 0) {
            const prevSlide = slides[currentSlideIndex - 1];
            if (!prevSlide || typeof prevSlide.slide_order === 'undefined') {
                console.error('[ActualPresentationDisplay] Previous slide is invalid or missing slide_order:', prevSlide);
                toast.error("Cannot navigate: Previous slide data is invalid.");
                return;
            }
            setCurrentSlideId(prevSlide.id);
            if (liveSessionData?.session_id) {
                try {
                    const res = await authenticatedAxiosInstance.post(MOVE_SLIDE_API_URL, {
                        session_id: liveSessionData.session_id,
                        move_to: prevSlide.slide_order,
                    });
                    if (res.data?.slide_start_timestamp) {
                        setLocalSlideStart(res.data.slide_start_timestamp);
                    }
                    // toast.success(`Moved to slide ${prevSlide.slide_order + 1}`);
                } catch (error) {
                    console.error('Error moving to previous slide (API):', error);
                    toast.error('Failed to sync slide change with server.');
                }
            }
        }
    };

    const handleDownloadAudio = (format: 'webm' | 'mp3' = 'webm') => {
        if (onDownloadAudio) {
            onDownloadAudio(format); // Pass the format to the function received from props
        } else {
            toast.error("Download function not available.");
        }
    };

    const toggleFullscreen = () => {
        if (!presentationContainerRef.current) return;
        const doc = document as any;
        const container = presentationContainerRef.current as any;

        if (!isFullscreen) {
            const requestFS = container.requestFullscreen || container.webkitRequestFullscreen || container.mozRequestFullScreen || container.msRequestFullscreen;
            if (requestFS) {
                const promise = requestFS.call(container);
                if (promise && promise.then) {
                    promise.catch((err: any) => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                    });
                }
            }
            setIsFullscreen(true);
        } else {
            const exitFS = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
            const isNativeFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

            if (exitFS && isNativeFullscreen) {
                exitFS.call(doc);
            }
            setIsFullscreen(false);
        }
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            const doc = document as any;
            const isNativeFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
            if (!isNativeFullscreen) {
                setIsFullscreen(false);
            } else {
                setIsFullscreen(true);
            }
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
        };
    }, []);


    if (!currentSlideData) {
        return (
            <div className="flex h-screen w-screen flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
                {/* Ambient background effects */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 via-transparent to-purple-900/10 pointer-events-none" />
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />

                <div className="relative z-10 text-center">
                    <div className="mb-6 p-4 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 w-fit mx-auto">
                        <Tv2 size={48} className="text-orange-400" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2 bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                        No Slide Available
                    </h2>
                    <p className="text-white/60 mb-8 max-w-md">
                        No slide to display or slide not found. Please check your presentation content.
                    </p>
                    <Button
                        onClick={onVoltExit}
                        className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 border border-red-400/30 text-white font-semibold backdrop-blur-sm transition-all duration-300 ease-out hover:scale-105 shadow-lg shadow-red-500/25 px-6 py-3 rounded-xl"
                    >
                        <X size={16} className="mr-2" />
                        Exit Session
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div data-assistant-fab="avoid" ref={presentationContainerRef} className="flex h-screen w-screen flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 outline-none relative overflow-hidden">
            {/* Ambient background effects */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-900/10 via-transparent to-purple-900/10 pointer-events-none" />
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />

            <LiveSessionActionBar
                inviteCode={liveSessionData?.invite_code || 'N/A'}
                currentSlideIndex={currentSlideIndex}
                totalSlides={slides.length}
                participantsCount={participantsList.length}
                onToggleParticipantsView={() => onToggleParticipantsPanel && onToggleParticipantsPanel()}
                isParticipantsPanelOpen={isParticipantsPanelOpen}
                onToggleWhiteboard={() => setIsWhiteboardOpen(!isWhiteboardOpen)}
                isWhiteboardOpen={isWhiteboardOpen}
                onEndSession={onVoltExit}
                isAudioRecording={isAudioRecording}
                isAudioPaused={isAudioPaused}
                onPauseAudio={onPauseAudio}
                onResumeAudio={onResumeAudio}
                audioBlobUrl={audioBlobUrl}
                onDownloadAudio={handleDownloadAudio}
                recordingDuration={recordingDuration}
                sseStatus={sseStatus}
                onGenerateTranscript={onGenerateTranscript}
                onToggleRecommendations={() => setIsRecommendationsPanelOpen(!isRecommendationsPanelOpen)}
                isRecommendationsPanelOpen={isRecommendationsPanelOpen}
                recommendationsCount={totalRecommendations}
            />

            {/* Main content area for the slide */}
            <div className="flex-grow overflow-hidden relative transition-all duration-300 ease-in-out" style={{ paddingTop: '4rem' }}>
                <div className="h-full w-full relative">
                    {/* Slide container with modern styling */}
                    <div className="absolute inset-4 md:inset-8 lg:inset-12 xl:inset-16 2xl:inset-20">
                        <div className="h-full w-full bg-white/95 backdrop-blur-sm rounded-2xl lg:rounded-3xl shadow-2xl border border-white/20 overflow-hidden transition-all duration-500 ease-out transform hover:shadow-3xl">
                            {/* Subtle border glow */}
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-transparent to-purple-500/10 rounded-2xl lg:rounded-3xl opacity-50" />

                            {/* Slide content */}
                            <div className="relative h-full w-full p-1">
                 {currentSlideId && (
                                    <div className="h-full w-full transition-opacity duration-300 ease-in-out">
                    <SlideRenderer currentSlideId={currentSlideId} editModeExcalidraw={false} editModeQuiz={false} />
                                    </div>
                )}
                            </div>
                        </div>
                    </div>
                </div>

                {isQuestionSlideForResponses && liveSessionData && currentSlideData && (
                    <div className="absolute inset-0 transition-all duration-300 ease-in-out z-10 pointer-events-none">
                        <ResponseOverlay
                            sessionId={liveSessionData.session_id}
                            slideData={currentSlideData}
                            slideStartTimestamp={localSlideStart}
                            defaultSecondsForQuestion={(liveSessionData as any).default_seconds_for_question || 0}
                            addedQuestion={currentAddedQuestion}
                        />
                    </div>
                )}
            </div>

            {/* Modern Bottom Navigation Controls */}
            <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-[1002] transition-all duration-300 ease-in-out">
                <div className="flex items-center gap-3 bg-black/20 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-2xl">
                    {/* Previous button */}
                <Button
                    onClick={goToPreviousSlide}
                    disabled={currentSlideIndex === 0}
                    variant="ghost"
                    size="icon"
                        className="h-12 w-12 rounded-xl bg-white/10 hover:bg-white/20 disabled:bg-white/5 border border-white/10 text-white hover:text-white disabled:text-white/30 transition-all duration-200 ease-out hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed shadow-lg"
                 >
                        <ChevronLeft size={24} className="transition-transform duration-200 group-hover:-translate-x-0.5" />
                </Button>

                    {/* Slide counter with modern styling */}
                    <div className="px-6 py-2 bg-white/10 backdrop-blur-sm rounded-xl border border-white/10">
                        <span className="text-white font-medium text-sm lg:text-base tracking-wide">
                            <span className="font-mono text-blue-300">{currentSlideIndex + 1}</span>
                            <span className="text-white/60 mx-2">/</span>
                            <span className="font-mono text-white/80">{slides.length}</span>
                        </span>
                    </div>

                    {/* Fullscreen toggle */}
                <Button
                    onClick={toggleFullscreen}
                    variant="ghost"
                    size="icon"
                        className="h-12 w-12 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white hover:text-white transition-all duration-200 ease-out hover:scale-105 shadow-lg"
                    title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                        {isFullscreen ?
                            <Minimize size={20} className="transition-transform duration-200" /> :
                            <Maximize size={20} className="transition-transform duration-200" />
                        }
                </Button>

                    {/* Next button */}
                <Button
                    onClick={goToNextSlide}
                    disabled={currentSlideIndex === slides.length - 1}
                    variant="ghost"
                    size="icon"
                        className="h-12 w-12 rounded-xl bg-white/10 hover:bg-white/20 disabled:bg-white/5 border border-white/10 text-white hover:text-white disabled:text-white/30 transition-all duration-200 ease-out hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed shadow-lg"
                >
                        <ChevronRight size={24} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Button>
                </div>
            </div>

            {/* Enhanced Floating Action Button for Quick Questions */}
            {liveSessionData?.session_id && onAddQuickQuestion && (
                <div className="fixed bottom-20 right-6 z-[1003] transition-all duration-300 ease-in-out">
                <QuickQuestionFAB onAddQuickQuestion={onAddQuickQuestion} />
                </div>
            )}

            {/* Enhanced Participants Side Panel */}
            {liveSessionData?.session_id && (
                <div className={`fixed inset-0 z-[1004] transition-all duration-300 ease-in-out ${isParticipantsPanelOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                    {/* Backdrop */}
                    <div className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isParticipantsPanelOpen ? 'opacity-100' : 'opacity-0'}`} />

                <ParticipantsSidePanel
                    sessionId={liveSessionData.session_id}
                        isOpen={isParticipantsPanelOpen}
                        onClose={() => onToggleParticipantsPanel && onToggleParticipantsPanel()}
                        participants={participantsList}
                        sseStatus={sseStatus}
                        topOffset="4rem" // Height of the enhanced LiveSessionActionBar
                />
                </div>
            )}

            {/* Enhanced Whiteboard Overlay */}
            {isWhiteboardOpen && liveSessionData?.session_id && (
                <div className={`fixed inset-0 z-[1005] transition-all duration-300 ease-in-out ${isWhiteboardOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                    {/* Backdrop */}
                    <div className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300 ${isWhiteboardOpen ? 'opacity-100' : 'opacity-0'}`} />

                <SessionExcalidrawOverlay
                    sessionId={liveSessionData.session_id}
                    isOpen={isWhiteboardOpen}
                    onClose={() => setIsWhiteboardOpen(false)}
                />
                </div>
            )}

            {/* Enhanced Recommendations Side Panel */}
            <div className={`fixed inset-0 z-[1007] transition-all duration-300 ease-in-out ${isRecommendationsPanelOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                {/* Backdrop */}
                <div className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isRecommendationsPanelOpen ? 'opacity-100' : 'opacity-0'}`} />

                <RecommendationsSidePanel
                    isOpen={isRecommendationsPanelOpen}
                    onClose={() => setIsRecommendationsPanelOpen(false)}
                    onAddSlide={onAddQuickQuestion}
                    topOffset="4rem" // Height of the LiveSessionActionBar
                />
            </div>
        </div>
    );
};
