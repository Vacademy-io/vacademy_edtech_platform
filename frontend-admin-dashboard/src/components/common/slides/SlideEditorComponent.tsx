/* eslint-disable */
// @ts-nocheck
'use client';
import debounce from 'lodash.debounce'; // Import debounce
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { SlideEditor } from './SlideEditor';
import { getPublicUrl, UploadFileInS3V2 } from '@/services/upload_file';
import { filterSlidesByIdType } from './utils/util';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { Button } from '@/components/ui/button';
import { ListStart, Save, Loader2, PlaySquare, Tv2, PlusCircle, Share2, ChevronDown, Check, Edit2, UploadCloud } from 'lucide-react';
import { getInstituteId } from '@/constants/helper';
import SlideList from './SlideList';
import { QuizSlide } from './slidesTypes/QuizSlides'; // Ensure path is correct
import { useSlideStore } from '@/stores/Slides/useSlideStore'; // Assumed path
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useRouter } from '@tanstack/react-router'; // Or your router import
import { useGetSinglePresentation } from './hooks/useGetSinglePresntation'; // Assumed path
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { TokenKey } from '@/constants/auth/tokens';
import { ActualPresentationDisplay } from './ActualPresentationDisplay'; // Import the new component
import { SessionOptionsModal, type SessionOptions } from './components/SessionOptionModel'; // Assumed path
import { SessionLeaderboardModal } from './components/SessionLeaderboardModal';
import { WaitingRoom } from './components/SessionWaitingRoom'; // Assumed path
import { ADD_PRESENTATION, AI_SERVICE_BASE_URL, BASE_URL, EDIT_PRESENTATION, CREATE_SESSION_API_URL, FINISH_SESSION_API_URL } from '@/constants/urls';
import { SlideRenderer } from './SlideRenderer'; // Import the extracted SlideRenderer
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"; // Import Dropdown components
import { Input } from "@/components/ui/input"; // Import Input
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';

import type {
    Slide as AppSlide,
    ExcalidrawSlideData,
    QuizSlideData,
    FeedbackSlideData,
    AppState as ExcalidrawAppState,
    ExcalidrawElement,
    ExcalidrawBinaryFiles,
    QuestionFormData,
} from './types';
import { SlideTypeEnum } from '././utils/types';
import type { InsertionBehavior } from './components/QuickQuestionFAB';

import { AssemblyAI } from 'assemblyai';
import { ASSEMBLYAI_API_KEY } from '@/config/assemblyai';
import { TranscriptModal } from './components/TranscriptModal';
import { createNewSlide } from './utils/util';
import { AiGeneratingLoader, aiSteps, pptSteps, finishSessionSteps } from './AiGeneratingLoader';
import { SlideRegenerateModal } from './components/SlideRegenerateModal';
import { RecommendationOverlay, RecommendationToast } from './components/RecommendationUI';
import { PRODUCT_NAME } from '@/config/branding';

const BACKEND_URL = BASE_URL;
const START_SESSION_API_URL = `${BACKEND_URL}/community-service/engage/admin/start`;
const ADD_SLIDE_IN_SESSION_API_URL = `${BACKEND_URL}/community-service/engage/admin/add-slide-in-session`;
const IMPORT_PPT_API_URL = `${BACKEND_URL}/media-service/convert-presentations/import-ppt`;
// Migrated to ai_service (was media-service/ai/presentation).
const REGENERATE_SLIDE_API_URL = `${AI_SERVICE_BASE_URL}/ai/presentation/regenerateASlide`;
const GENERATE_SLIDES_FROM_TEXT_API_URL = `${AI_SERVICE_BASE_URL}/ai/presentation/generateFromData`;

interface SlideRendererProps {
    currentSlideId: string;
    editMode: boolean; // In editor, this will be true. In PresentationView, SlideEditor gets editMode=false
}

const SlidesEditorComponent = ({
    metaData,
    presentationId,
    isEdit,
    autoStartLive,
}: {
    metaData: { title: string; description: string };
    presentationId: string;
    isEdit: boolean;
    autoStartLive?: string;
}) => {
    // Removed verbose prop logging for better performance
    const {
        slides,
        currentSlideId,
        editMode,
        dirtySlideIds,
        setCurrentSlideId,
        setEditMode,
        addSlide,
        deleteSlide,
        getSlide,
        setSlides,
        updateSlide,
        initializeNewPresentationState,
        updateSlideIds,
        clearRecommendations,
        markAllDirty,
        clearDirtySlides,
    } = useSlideStore();

    const router = useRouter();
    const searchParams = router.state.location.search;
    const [justExitedSession, setJustExitedSession] = useState(false);

    useEffect(() => {
        // On mount, ensure we are in edit mode unless auto-starting a live session.
        if (!autoStartLive) {
            setEditMode(true);
        }
    }, [setEditMode, autoStartLive]);

    const {
        isLoading: isLoadingPresentation,
        isRefetching: isRefetchingPresentation,
    } = useGetSinglePresentation({
        presentationId,
        setSlides,
        setCurrentSlideId,
        isEdit: isEdit && !justExitedSession,
    });

    useEffect(() => {
        console.log(`[Debug] Render | isEdit: ${isEdit} | editMode from store: ${editMode} | slides: ${slides.length} | isLoading: ${isLoadingPresentation} | isRefetching: ${isRefetchingPresentation}`);
    }, [isEdit, slides, isLoadingPresentation, isRefetchingPresentation, editMode]);

    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [isExitDialogOpen, setIsExitDialogOpen] = useState<boolean>(false);

    // ... after isParticipantsPanelOpen state
    const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState<boolean>(false);
    const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
    const [transcriptResult, setTranscriptResult] = useState<string>('');

    const [showSessionOptionsModal, setShowSessionOptionsModal] = useState<boolean>(false);
    const [isCreatingSession, setIsCreatingSession] = useState<boolean>(false);
    const [isStartingSessionInProgress, setIsStartingSessionInProgress] = useState<boolean>(false);
    const [sessionDetails, setSessionDetails] = useState<{
        session_id: string;
        invite_code: string;
        [key: string]: any;
    } | null>(null);
    const [isWaitingForParticipants, setIsWaitingForParticipants] = useState<boolean>(false);

    // State to store the IDs of slides initially loaded for an existing presentation
    const [originalSlideIds, setOriginalSlideIds] = useState(new Set<string>());

    // A deletion is pending if any originally-loaded slide ID is no longer in the slides array
    const hasPendingDeletions = isEdit && [...originalSlideIds].some(id => !slides.find(s => s.id === id));
    const hasUnsavedChanges = dirtySlideIds.size > 0 || hasPendingDeletions;

    const handleBackNavigation = () => {
        if (hasUnsavedChanges) {
            setIsExitDialogOpen(true);
        } else {
            router.navigate({ to: '/study-library/volt' });
        }
    };

    // States for Audio Recording
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [isRecordingPaused, setIsRecordingPaused] = useState<boolean>(false);
    const [shouldRecordAudio, setShouldRecordAudio] = useState<boolean>(false);
    const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null); // For playback/final download
    const [recordingDuration, setRecordingDuration] = useState<number>(0);
    const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const ffmpegRef = useRef<FFmpeg>(new FFmpeg()); // Ref to store initialized ffmpeg instance
    const [isFFmpegLoaded, setIsFFmpegLoaded] = useState<boolean>(false);

    // State for inline title editing
    const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
    const [currentTitle, setCurrentTitle] = useState<string>(metaData.title || '');

    // State for Participants Panel in Live Session
    const [isParticipantsPanelOpen, setIsParticipantsPanelOpen] = useState<boolean>(false);

    // State for AI Generation Modal
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [aiTopic, setAiTopic] = useState('');
    const [aiLanguage, setAiLanguage] = useState('English');
    const [isGenerating, setIsGenerating] = useState(false);

    // State for PPT Import Modal
    const [isPptModalOpen, setIsPptModalOpen] = useState(false);
    const [pptFile, setPptFile] = useState<File | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // State for AI Slide Regeneration
    const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [regenerateSlideId, setRegenerateSlideId] = useState<string | null>(null);

    // State for session finish modal
    const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
    const [isTranscribingOnFinish, setIsTranscribingOnFinish] = useState(false);

    // State for session leaderboard modal
    const [isLeaderboardModalOpen, setIsLeaderboardModalOpen] = useState(false);
    const [finishedSessionId, setFinishedSessionId] = useState<string | null>(null);

    // --- State for AI Slide Recommendations ---
    const recommendationIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const recommendationMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recommendationAudioChunksRef = useRef<Blob[]>([]);
    const [recommendationBatchCounter, setRecommendationBatchCounter] = useState(0);
    const [isGeneratingRecommendation, setIsGeneratingRecommendation] = useState(false);
    const [isRecommendationOverlayOpen, setIsRecommendationOverlayOpen] = useState(false);
    // -----------------------------------------

    useEffect(() => {
        // Populate originalSlideIds when editing an existing presentation and slides are loaded
        if (isEdit && !justExitedSession && slides && slides.length > 0 && originalSlideIds.size === 0 && !isLoadingPresentation && !isRefetchingPresentation) {
            const ids = new Set(slides.map(s => s.id).filter(id => !!id)); // Ensure only valid IDs are stored
            setOriginalSlideIds(ids);
            console.log("Original slide IDs captured:", ids);
        }
        // Do not run this if originalSlideIds is already populated, to avoid resetting on re-renders where slides might change
    }, [isEdit, slides, isLoadingPresentation, isRefetchingPresentation, originalSlideIds.size, justExitedSession]);

    useEffect(() => {
        const source = searchParams?.source;
        // This effect should ONLY run to initialize a brand new, "from-scratch" presentation.
        // A "from-scratch" presentation is defined by having no presentationId.
        // Presentations from AI/PPT or existing ones being edited will have an ID or a source.
        if (!presentationId && !source) {
            initializeNewPresentationState();
        }
    }, [presentationId, searchParams, initializeNewPresentationState]);

    useEffect(() => {
        console.log("SlideEditorComponent useEffect fired");
        const loadFFmpeg = async () => {
            console.log("loadFFmpeg called");
            if (isFFmpegLoaded) {
                console.log("FFmpeg already considered loaded, skipping load attempt.");
                return;
            }
            try {
                console.log("Attempting to call ffmpegRef.current.load()");
                await ffmpegRef.current.load()
                    .then(() => {
                        console.log("ffmpegRef.current.load() promise resolved.");
                        setIsFFmpegLoaded(true);
                        console.log("FFmpeg loaded successfully.");
                    })
                    .catch(loadError => {
                        console.error("ffmpegRef.current.load() promise rejected:", loadError);
                        toast.error("MP3 converter failed to initialize during load. Details in console.");
                        setIsFFmpegLoaded(false);
                    });
                console.log("After ffmpegRef.current.load() attempt");
            } catch (error) {
                console.error("Outer catch: Failed to load FFmpeg:", error);
                toast.error("Failed to initialize MP3 converter. MP3 download may not be available.");
                setIsFFmpegLoaded(false);
            }
        };
        loadFFmpeg();
    }, []); // Empty dependency array ensures this runs once on mount

    useEffect(() => {
        // Update currentTitle if metaData.title changes from props (e.g., after initial load or URL update)
        if (metaData.title !== currentTitle && !isEditingTitle) {
            setCurrentTitle(metaData.title || '');
        }
    }, [metaData.title, isEditingTitle]);

    // Effect to auto-open session options modal if autoStartLive is true
    useEffect(() => {
        if (searchParams && typeof searchParams.autoStartLive === 'string' && searchParams.autoStartLive === 'true') {
            // Ensure slides are loaded before opening the modal
            // This check might need to be more robust based on your slide loading logic
            if (slides && slides.length > 0) {
                setShowSessionOptionsModal(true);
                // Optional: Clean up the query parameter from URL if desired, though this can be complex
                // router.history.replace({ search: '...' });
            } else if (!isLoadingPresentation && !isRefetchingPresentation && slides && slides.length === 0) {
                toast.error(`Cannot start a live session for an empty ${PRODUCT_NAME.toLowerCase()}. Please add slides.`);
            }
            // If slides are still loading, the modal will open once they are loaded by other effects or user action.
        }
    }, [searchParams, slides, isLoadingPresentation, isRefetchingPresentation]);

    const showTranscript = () => {
        if (transcriptResult) {
            setIsTranscriptModalOpen(true);
        } else {
            toast.error("Transcript is not ready or available yet.");
        }
    };

    const startTranscription = async () => {
        if (isTranscribing) {
            toast.info("A transcription is already in progress.");
            return;
        }

        if (!audioChunksRef.current || audioChunksRef.current.length === 0) {
            toast.error("No recorded audio available to transcribe.");
            return;
        }

        setIsTranscribing(true);
        setTranscriptResult(''); // Reset previous results
        toast.info("Transcription has started in the background. You will be notified when it's ready.");


        try {
            const currentAudioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

            const client = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });

            // Pass the Blob directly to the SDK
            const transcript = await client.transcripts.transcribe({
                audio: currentAudioBlob,
            });

            if (transcript.status === 'completed') {
                const receivedText = transcript.text || 'No text was transcribed.';
                setTranscriptResult(receivedText);
                toast.success("Transcription finished! Click 'View Transcript' to see it.");
            } else {
                throw new Error(`Transcription failed with status: ${transcript.status}`);
            }

        } catch (error: any) {
            console.error("Error generating transcript:", error);
            toast.error(error.message || "Failed to generate transcript.");
            setTranscriptResult("");
        } finally {
            setIsTranscribing(false);
        }
    };

    const handleTranscriptAction = () => {
        if (transcriptResult) {
            showTranscript();
        } else {
            startTranscription();
        }
    };

    const downloadCurrentAudioSnapshot = async (format: 'webm' | 'mp3' = 'webm') => {
        if (audioChunksRef.current && audioChunksRef.current.length > 0) {
            const currentWebMBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            let processedBlob = currentWebMBlob;
            let fileExtension = 'webm';

            try {
                if (format === 'mp3') {
                    toast.info('Preparing MP3 converter...');
                    if (!isFFmpegLoaded) {
                        toast.error("MP3 converter is not ready. Please try again shortly or ensure FFmpeg is loaded.");
                        return;
                    }
                    const ffmpeg = ffmpegRef.current; // Directly use the initialized ref
                    toast.info('Converting to MP3... This may take a moment.');

                    const inputName = 'input.webm';
                    const outputName = 'output.mp3';

                    await ffmpeg.writeFile(inputName, await fetchFile(currentWebMBlob));

                    // Run FFmpeg command. Options can be added e.g. -b:a 128k for bitrate
                    await ffmpeg.exec(['-i', inputName, outputName]);

                    const outputData = await ffmpeg.readFile(outputName);
                    await ffmpeg.deleteFile(inputName); // Clean up input file
                    await ffmpeg.deleteFile(outputName); // Clean up output file

                    processedBlob = new Blob([outputData.buffer], { type: 'audio/mpeg' });
                    fileExtension = 'mp3';
                    toast.success('Conversion to MP3 successful!');
                }

                const tempUrl = URL.createObjectURL(processedBlob);
                const anchor = document.createElement('a');
                anchor.href = tempUrl;
                anchor.download = `volt_audio_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.${fileExtension}`;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                URL.revokeObjectURL(tempUrl);
                if (format === 'webm') {
                    toast.success("Current audio snapshot download started.");
                }
            } catch (error) {
                console.error(`Error during audio processing or download for ${format}:`, error);
                toast.error(`Failed to process audio as ${format.toUpperCase()}. Downloading as WebM instead.`);
                if (format !== 'webm') { // Fallback for failed MP3 conversion
                    const fallbackUrl = URL.createObjectURL(currentWebMBlob);
                    const fallbackAnchor = document.createElement('a');
                    fallbackAnchor.href = fallbackUrl;
                    fallbackAnchor.download = `volt_audio_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
                    document.body.appendChild(fallbackAnchor);
                    fallbackAnchor.click();
                    document.body.removeChild(fallbackAnchor);
                    URL.revokeObjectURL(fallbackUrl);
                }
            }
        } else {
            toast.error("No audio has been recorded yet to download.");
        }
    };

    const startDurationTracker = () => {
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        setRecordingDuration(0); // Reset on start
        recordingIntervalRef.current = setInterval(() => {
            setRecordingDuration(prevDuration => prevDuration + 1);
        }, 1000);
    };

    const stopDurationTracker = (reset: boolean = true) => {
        if (recordingIntervalRef.current) {
            clearInterval(recordingIntervalRef.current);
            recordingIntervalRef.current = null;
        }
        if (reset) setRecordingDuration(0);
    };

    useEffect(() => {
        if (
            !isLoadingPresentation &&
            !isRefetchingPresentation &&
            editMode &&
            slides &&
            slides.length > 0 &&
            !currentSlideId
        ) {
            const firstValidSlide = slides.find((s) => s && s.id);
            if (firstValidSlide) {
                setCurrentSlideId(firstValidSlide.id);
            } else if (slides.length > 0) {
                setCurrentSlideId(slides[0].id);
            }
        }
    }, [
        isLoadingPresentation,
        isRefetchingPresentation,
        editMode,
        slides,
        currentSlideId,
        setCurrentSlideId,
    ]);

    const changeCurrentSlide = (id: string) => {
        setCurrentSlideId(id);
    };

    const handleAddSlide = (type: SlideTypeEnum) => {
        addSlide(type);
    };

    const handleDeleteCurrentSlide = () => {
        if (currentSlideId) {
            deleteSlide(currentSlideId);
        }
    };

    const handleOpenSessionOptions = () => {
        if (slides && slides.length > 0) {
            setShowSessionOptionsModal(true);
        } else {
            toast.error('Add slides before starting a live session.');
        }
    };

    const handleCreateSession = async (options: SessionOptions) => {
        clearRecommendations(); // Clear out any old recommendations before creating a new session
        setIsCreatingSession(true);
        setShouldRecordAudio(options.is_session_recorded); // Store if audio recording is requested

        if (options.is_session_recorded) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // Setup for main recording
                mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunksRef.current = [];

                mediaRecorderRef.current.ondataavailable = (event) => {
                    if (event.data.size > 0) audioChunksRef.current.push(event.data);
                };
                mediaRecorderRef.current.onstop = () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    const url = URL.createObjectURL(audioBlob);
                    setAudioBlobUrl(url);
                    toast.success('Audio recording finished. Ready for playback/download.');
                    setIsRecording(false);
                    setIsRecordingPaused(false);
                    stream.getTracks().forEach(track => track.stop());
                };

                // Setup for recommendation interval recording (using a clone of the stream)
                const recommendationStream = stream.clone();
                recommendationMediaRecorderRef.current = new MediaRecorder(recommendationStream, { mimeType: 'audio/webm' });
                recommendationAudioChunksRef.current = [];

                recommendationMediaRecorderRef.current.ondataavailable = (event) => {
                    if (event.data.size > 0) recommendationAudioChunksRef.current.push(event.data);
                };

                toast.success("Microphone access granted for recording.")
            } catch (err) {
                console.error('Error accessing microphone or setting up recorder:', err);
                toast.error('Failed to access microphone. Audio will not be recorded.');
                setShouldRecordAudio(false); // Disable recording if permission failed
                if (mediaRecorderRef.current) {
                    mediaRecorderRef.current = null;
                }
            }
        }

        try {
            const payload = {
                source: 'PRESENTATION',
                source_id: presentationId,
                ...options,
                default_seconds_for_question: Number(options.default_seconds_for_question),
                student_attempts: Number(options.student_attempts),
            };
            const response = await authenticatedAxiosInstance.post(CREATE_SESSION_API_URL, payload);
            if (response.data && response.data.session_id && response.data.invite_code) {
                setSessionDetails(response.data);
                setShowSessionOptionsModal(false);
                setIsWaitingForParticipants(true);
                toast.success('Session created! Waiting for participants.');
            } else {
                toast.error(
                    response.data?.message ||
                    'Failed to create session. Invalid response from server.'
                );
            }
        } catch (error: any) {
            console.error('Error creating session:', error);
            toast.error(
                error.response?.data?.message ||
                'An unexpected error occurred while creating the session.'
            );
        } finally {
            setIsCreatingSession(false);
        }
    };

    const handleStartActualPresentation = async () => {
        if (!sessionDetails || !slides || slides.length === 0) {
            toast.error(`Session details or slides are missing. Cannot start ${PRODUCT_NAME.toLowerCase()}.`);
            return;
        }
        setIsStartingSessionInProgress(true);
        try {
            const firstSlide = slides[0];
            const initialSlideOrder =
                typeof firstSlide?.slide_order === 'number' ? firstSlide.slide_order : 0;

            await authenticatedAxiosInstance.post(START_SESSION_API_URL, {
                session_id: sessionDetails.session_id,
                move_to: initialSlideOrder,
            });

            // Start recording if permission was granted and it's a recording session
            if (shouldRecordAudio && mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
                mediaRecorderRef.current.start(1000); // Start main recording

                // Start the recommendation recorder and the 5-minute interval
                if (recommendationMediaRecorderRef.current && recommendationMediaRecorderRef.current.state === 'inactive') {
                    recommendationMediaRecorderRef.current.start();
                    startRecommendationInterval();
                }

                setIsRecording(true);
                setIsRecordingPaused(false);
                startDurationTracker(); // Start duration tracker
                toast.info("Audio recording started.");
            }

            setIsWaitingForParticipants(false);
            setEditMode(false);
            if (slides.length > 0) setCurrentSlideId(slides[0].id);
            toast.success(`${PRODUCT_NAME} started!`);
        } catch (error: any) {
            console.error(`Error starting ${PRODUCT_NAME.toLowerCase()}:`, error);
            toast.error(error.response?.data?.message || `Failed to start the ${PRODUCT_NAME.toLowerCase()}.`);
        } finally {
            setIsStartingSessionInProgress(false);
        }
    };

    const handleProcessRecommendationChunk = async () => {
        console.log('[Rec AI] Processing 5-minute audio chunk.');
        if (!recommendationMediaRecorderRef.current || recommendationAudioChunksRef.current.length === 0) {
            console.log('[Rec AI] No audio in chunk to process. Skipping.');
            return;
        }

        setIsGeneratingRecommendation(true);
        const audioBlob = new Blob(recommendationAudioChunksRef.current, { type: 'audio/webm' });
        recommendationAudioChunksRef.current = []; // Clear chunks for the next interval

        try {
            // 1. Transcribe audio
            const client = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });
            toast.info(`Generating recommendations from audio (${recommendationBatchCounter * 2}-${(recommendationBatchCounter + 1) * 2} mins)...`);
            const transcript = await client.transcripts.transcribe({ audio: audioBlob });

            if (transcript.status !== 'completed' || !transcript.text) {
                throw new Error(`Transcription failed or returned no text. Status: ${transcript.status}`);
            }
            console.log('[Rec AI] Transcript received:', transcript.text);

            const promptText = transcript.text + " When Generating Slides, Make one or two Excalidraw slides for Key Points Discussed Summary in an engaging way, one question for taking the feedback for learning";
            // 2. Generate slides from transcript
            const slideGenResponse = await authenticatedAxiosInstance.post(
                GENERATE_SLIDES_FROM_TEXT_API_URL,
                { language: 'English', text: promptText, institute_id: getInstituteId() },
                { headers: { 'Content-Type': 'application/json' } }
            );

            const data = slideGenResponse.data;
            if (!data.slides || !data.assessment) {
                throw new Error('Invalid response from slide generation service.');
            }
            console.log('[Rec AI] Received generated slide data:', data);

            // 3. Process slides into frontend format
            const recommendedSlides = [];
            data.slides.forEach((slideData) => {
                const newSlide = createNewSlide(SlideTypeEnum.Excalidraw);
                recommendedSlides.push({
                    ...newSlide,
                    elements: slideData.elements,
                    appState: { ...newSlide.appState, ...slideData.appState },
                    name: slideData.name,
                });
            });
            data.assessment.questions.forEach((q) => {
                const type = q.question_type === 'MCQS' ? SlideTypeEnum.Quiz : SlideTypeEnum.Feedback;
                const newSlide = createNewSlide(type);
                (newSlide as QuizSlideData).elements = {
                    questionName: q.question.content,
                    singleChoiceOptions: (q.options || []).map(opt => ({ id: `rec-opt-${Math.random()}`, name: opt.content, isSelected: false })),
                };
                recommendedSlides.push(newSlide);
            });

            const feedbackQuestionSlide = createNewSlide(SlideTypeEnum.Quiz);
            (feedbackQuestionSlide as QuizSlideData).elements = {
                questionName: "Are you able to understand the lecture",
                singleChoiceOptions: [
                    { id: `rec-opt-${Math.random()}`, name: 'Yes', isSelected: false },
                    { id: `rec-opt-${Math.random()}`, name: 'No', isSelected: false },
                    { id: `rec-opt-${Math.random()}`, name: 'Facing issues in few parts', isSelected: false },
                ],
            };
            (feedbackQuestionSlide as ExcalidrawSlideData).name = "Quick Poll";

            recommendedSlides.unshift(feedbackQuestionSlide);

            if (recommendedSlides.length > 0) {
                // 4. Add to store
                const batchTimestamp = `${recommendationBatchCounter * 2}-${(recommendationBatchCounter + 1) * 2} mins`;
                useSlideStore.getState().addRecommendationBatch({
                    timestamp: batchTimestamp,
                    slides: recommendedSlides,
                });

                toast.success(`New recommendations are ready!`);
            } else {
                toast.info("AI finished processing, but no new recommendations were generated in this interval.");
            }

        } catch (error) {
            console.error('[Rec AI] Error processing recommendation chunk:', error);
            toast.error('Could not generate slide recommendations from audio.');
        } finally {
            setIsGeneratingRecommendation(false);
        }
    };

    const startRecommendationInterval = () => {
        if (recommendationIntervalRef.current) clearInterval(recommendationIntervalRef.current);

        setRecommendationBatchCounter(0);

        recommendationIntervalRef.current = setInterval(() => {
            console.log('[Rec AI] 2-minute interval reached.');
            // Stop the current recording to process the chunk
            recommendationMediaRecorderRef.current?.stop();
            // The ondataavailable handles pushing the blob, then we process it
            // A short delay to ensure the blob is processed before starting the next recording
            setTimeout(() => {
                handleProcessRecommendationChunk();
                // Restart recorder for the next chunk
                if (recommendationMediaRecorderRef.current?.state === 'inactive') {
                    recommendationMediaRecorderRef.current.start();
                }
            }, 500);

            setRecommendationBatchCounter(prev => prev + 1);
        }, 120000); // 120000 ms = 2 minutes
    };

    const stopRecommendationInterval = () => {
        if (recommendationIntervalRef.current) {
            clearInterval(recommendationIntervalRef.current);
            recommendationIntervalRef.current = null;
        }
        if (recommendationMediaRecorderRef.current && recommendationMediaRecorderRef.current.state !== 'inactive') {
            recommendationMediaRecorderRef.current.stop();
        }
        recommendationAudioChunksRef.current = [];
        setRecommendationBatchCounter(0);
        console.log('[Rec AI] Recommendation interval stopped and cleared.');
    };

    const cleanupAndExitSession = async (callFinishApi: boolean = false) => {
        const currentSessionId = sessionDetails?.session_id;
        const showLeaderboard = sessionDetails?.show_results_at_last_slide === true;

        if (callFinishApi && currentSessionId) {
            try {
                await authenticatedAxiosInstance.post(FINISH_SESSION_API_URL, {
                    session_id: currentSessionId,
                    move_to: null, // move_to can be null for this API
                });
                toast.success("Session has been successfully ended on the server.");
            } catch (error) {
                console.error('Error ending session via API:', error);
                toast.error("Failed to notify the server about the session ending. It may still be active.");
            }
        }

        // Save session ID for leaderboard before clearing
        if (currentSessionId && showLeaderboard) {
            setFinishedSessionId(currentSessionId);
        }

        // UI state resets
        setJustExitedSession(true);
        setEditMode(true);
        setShowSessionOptionsModal(false);
        setIsWaitingForParticipants(false);
        setSessionDetails(null);
        setIsCreatingSession(false);
        setIsStartingSessionInProgress(false);
        clearRecommendations();
        // Clear audio data
        audioChunksRef.current = [];
        setShouldRecordAudio(false);
        setAudioBlobUrl(null);
        toast.info('Exited live session flow.');

        // Show leaderboard only if it was a scored session
        if (currentSessionId && showLeaderboard) {
            setIsLeaderboardModalOpen(true);
        }
    };

    const processAndFinishSession = async (inBackground: boolean) => {
        if (!sessionDetails?.session_id) return;

        const localSessionId = sessionDetails.session_id;
        const audioChunksToProcess = [...audioChunksRef.current];

        if (inBackground) {
            setIsFinishModalOpen(false);
            // We call cleanupAndExitSession with callFinishApi: false because the API is called inside this function.
            // This will reset the UI and let the user continue.
            cleanupAndExitSession(false);
            toast.info("Generating session summary in the background. You'll be notified.", { duration: 5000 });
        } else {
            setIsTranscribingOnFinish(true);
        }

        try {
            // Step 1: Call the main finish API to end the session
            await authenticatedAxiosInstance.post(FINISH_SESSION_API_URL, {
                session_id: localSessionId,
                move_to: null,
            });

            if (!inBackground) {
                toast.success("Session ended. Now generating transcript...");
            } else {
                // For background tasks, a simple console log is better to avoid spamming toasts
                console.log(`[Background] Session ${localSessionId} ended. Starting transcript generation.`);
            }

            // Step 2: Transcribe audio
            const audioBlob = new Blob(audioChunksToProcess, { type: 'audio/webm' });
            if (audioBlob.size === 0) throw new Error("Audio recording is empty.");

            const client = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });
            const transcript = await client.transcripts.transcribe({ audio: audioBlob });

            if (transcript.status !== 'completed' || !transcript.text) {
                throw new Error(`Transcription failed or returned no text. Status: ${transcript.status}`);
            }

            // Step 3: Send the transcript to the notifications API
            await authenticatedAxiosInstance.post(
                `${BACKEND_URL}/community-service/engage/admin/finish-send-notifications`,
                { transcript: transcript.text, session_id: localSessionId }
            );

            toast.success("Session summary sent successfully!");

        } catch (error: any) {
            console.error("Error during session finalization:", error);
            toast.error(error.response?.data?.message || "Failed to finalize session and send summary.");
        } finally {
            if (!inBackground) {
                setIsTranscribingOnFinish(false);
                setIsFinishModalOpen(false);
                // Final cleanup after foreground processing is complete
                cleanupAndExitSession(false);
            }
            // In background mode, UI cleanup is already done. This async task just finishes.
        }
    };

    const handleExitSessionFlow = async () => {
        // Stop recording to finalize audio blob.
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        stopDurationTracker();
        stopRecommendationInterval();

        // If audio was recorded, open the modal to decide on transcription.
        if (shouldRecordAudio && audioChunksRef.current.length > 0 && sessionDetails?.session_id) {
            setIsFinishModalOpen(true);
        } else {
            // No audio, or no session ID, so just exit cleanly.
            await cleanupAndExitSession(true);
        }
    };

    const toggleDirectPresentationPreview = () => {
        if (slides && slides.length > 0) {
            if (sessionDetails) setSessionDetails(null);
            setEditMode(!editMode);
            if (!editMode && slides.length > 0) {
                setCurrentSlideId(slides[0].id);
            }
        } else {
            toast.info(`Add some slides to preview the ${PRODUCT_NAME.toLowerCase()}.`);
        }
    };

    const savePresentation = async (isAutoSave: boolean = false) => {
        setIsSaving(true);
        let autoCreateNavigated = false; // Flag to track if auto-create navigation happened

        try {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            if (!accessToken) {
                toast.error(`Please login to save ${PRODUCT_NAME.toLowerCase()}s`);
                setIsSaving(false); // Reset saving state
                return;
            }

            const tokenData = getTokenDecodedData(accessToken);
            const INSTITUTE_ID = tokenData?.authorities && Object.keys(tokenData.authorities)[0];
            if (!INSTITUTE_ID) {
                toast.error('Organization information missing');
                setIsSaving(false); // Reset saving state
                return;
            }

            // Renamed from addedSlides to avoid confusion, this holds all slides processed in this save operation.
            const allProcessedSlidesInCurrentSave = [];
            for (let index = 0; index < slides.length; index++) {
                const slide = slides[index];
                let fileId: string;

                const isDirty = dirtySlideIds.has(slide.id);
                const hasExistingSourceId = !!slide.source_id;

                if (!isDirty && hasExistingSourceId) {
                    // Content unchanged — reuse the existing S3 file ID to skip the upload
                    fileId = slide.source_id;
                } else {
                    try {
                        fileId = await UploadFileInS3V2(
                            slide,
                            () => { }, // Progress callback (noop)
                            tokenData.sub,
                            'SLIDES',
                            tokenData.sub,
                            true
                        );
                    } catch (uploadError) {
                        console.error('Upload failed for slide:', slide.id, uploadError);
                        toast.error(`Failed to upload content for slide ${index + 1}.`);
                        setIsSaving(false);
                        return;
                    }
                }

                const isQuestionSlide = [SlideTypeEnum.Quiz, SlideTypeEnum.Feedback].includes(
                    slide.type
                );

                // Determine if the slide is new from the backend's perspective
                const isNewSlideForBackend = !isEdit || !originalSlideIds.has(slide.id);

                const baseSlideObject = {
                    id: isNewSlideForBackend ? null : slide.id, // Use null for new slides for the backend
                    presentation_id: '', // Backend will associate with the main presentationId
                    title: slide?.elements?.questionName?.substring(0, 255) || `Slide ${index + 1}`,
                    source_id: fileId, // ID of the content in S3
                    source: isQuestionSlide ? 'question' : 'excalidraw',
                    status: 'PUBLISHED', // Assuming all saved slides are published
                    interaction_status: '',
                    slide_order: index,
                    default_time: 0,
                    content: fileId, // Repeating source_id as content, as per original structure
                    added_question: null,
                };

                if (isQuestionSlide) {
                    const questionData = slide as QuizSlideData | FeedbackSlideData;

                    // Find the correct option to populate auto_evaluation_json correctly
                    const singleChoiceOptions = (questionData?.elements as QuestionFormData)?.singleChoiceOptions || [];
                    const correctOptionIndex = singleChoiceOptions.findIndex(opt => opt.isSelected);
                    const correctOptionIds = correctOptionIndex !== -1 ? [`${correctOptionIndex + 1}`] : [];
                    const correctOptionPreviewIdAsNumber = correctOptionIndex !== -1 ? (correctOptionIndex + 1) : null;

                    baseSlideObject.added_question = {
                        preview_id: '1',
                        section_id: null,
                        question_order_in_section: 1,
                        text: {
                            id: null,
                            type: 'HTML',
                            content: questionData?.elements?.questionName || 'Question text',
                        },
                        media_id: '',
                        question_response_type: slide.type === SlideTypeEnum.Quiz ? 'AUTO' : 'MANUAL',
                        question_type: slide.type === SlideTypeEnum.Quiz ? 'MCQS' : 'LONG_ANSWER',
                        access_level: 'public',
                        auto_evaluation_json: slide.type === SlideTypeEnum.Quiz ? JSON.stringify({ type: 'MCQS', data: { correctOptionIds: correctOptionIds }, }) : null,
                        options_json: null,
                        parsed_evaluation_object: slide.type === SlideTypeEnum.Quiz ? { correct_option: correctOptionPreviewIdAsNumber, } : null,
                        evaluation_type: slide.type === SlideTypeEnum.Quiz ? 'auto' : 'manual',
                        explanation_text: {
                            id: null,
                            type: 'HTML',
                            content: '',
                        },
                        parent_rich_text_id: 'prt_001',
                        parent_rich_text: {
                            id: null,
                            type: 'HTML',
                            content: '',
                        },
                        default_question_time_mins: (questionData?.elements as QuestionFormData)?.timeLimit || 1,
                        options: ((questionData?.elements as QuestionFormData)?.singleChoiceOptions || []).map(
                            (option, optIndex) => ({
                                id: isNewSlideForBackend || !option.id ? null : option.id, // null for new options or if option.id is falsy
                                preview_id: `${optIndex + 1}`,
                                question_id: isNewSlideForBackend || !questionData.questionId ? null : questionData.questionId, // null for new questions
                                text: {
                                    id: null,
                                    type: 'HTML',
                                    content: option.name || `Option ${optIndex + 1}`,
                                },
                                media_id: '',
                                option_order: optIndex,
                                explanation_text: {
                                    id: null,
                                    type: 'HTML',
                                    content: '',
                                },
                            })
                        ),
                        errors: [],
                        warnings: [],
                    };
                }
                allProcessedSlidesInCurrentSave.push(baseSlideObject);
            }

            if (slides.length === 0 && isEdit) { // Handle case where all slides are deleted from an existing presentation
                const payload = {
                    id: presentationId,
                    title: metaData?.title || `New ${PRODUCT_NAME}`,
                    description: metaData?.description || '',
                    cover_file_id: '',
                    added_slides: [],
                    updated_slides: [],
                    deleted_slides: Array.from(originalSlideIds).map(id => ({ id })), // All original slides are deleted
                    status: 'PUBLISHED',
                };
                await authenticatedAxiosInstance.post(
                    EDIT_PRESENTATION,
                    payload,
                    { /* headers and params */ }
                );
                toast.success(`${PRODUCT_NAME} updated: All slides deleted.`);
                if (!isAutoSave) router.navigate({ to: '/study-library/volt' });
                setIsSaving(false);
                return;
            }


            if (slides.length === 0 && !isEdit) {
                toast.error(`Cannot create an empty ${PRODUCT_NAME.toLowerCase()}. Please add slides.`);
                setIsSaving(false);
                return;
            }


            const finalPayload = {
                id: isEdit ? presentationId : null, // Use null for new presentation ID
                title: metaData?.title || `New ${PRODUCT_NAME}`,
                description: metaData?.description || '',
                cover_file_id: '',
                status: 'PUBLISHED',
                added_slides: [],
                updated_slides: [],
                deleted_slides: [],
            };

            if (isEdit) {
                const newSlidesForPayload = [];
                const updatedSlidesForPayload = [];

                allProcessedSlidesInCurrentSave.forEach(processedSlide => {
                    if (originalSlideIds.has(processedSlide.id)) {
                        updatedSlidesForPayload.push(processedSlide);
                    } else {
                        newSlidesForPayload.push(processedSlide);
                    }
                });

                finalPayload.added_slides = newSlidesForPayload;
                finalPayload.updated_slides = updatedSlidesForPayload;

                const currentSlideIdSet = new Set(allProcessedSlidesInCurrentSave.map(s => s.id));
                const deletedBackendSlideObjects = Array.from(originalSlideIds)
                    .filter(id => !currentSlideIdSet.has(id))
                    .map(id => ({ id: id })); // Ensure it's an object with an id property
                finalPayload.deleted_slides = deletedBackendSlideObjects;
            } else {
                // For a new presentation, all slides are "added"
                finalPayload.added_slides = allProcessedSlidesInCurrentSave;
                // updated_slides and deleted_slides remain empty as initialized
            }

            // Store the response from the API call
            const response = await authenticatedAxiosInstance.post(
                isEdit ? EDIT_PRESENTATION : ADD_PRESENTATION,
                finalPayload,
                {
                    params: { instituteId: INSTITUTE_ID },
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                    },
                }
            );

            // After a successful save, update the frontend state to match the backend.
            if (response.data) {
                let backendSlides = [];

                if (isEdit) {
                    // For EDIT, the response data is the array of slides itself.
                    backendSlides = Array.isArray(response.data) ? response.data : [];
                } else {
                    // For ADD, the response is a presentation object containing the slides.
                    const presentationData = response.data;
                    if (presentationData && Array.isArray(presentationData.added_slides)) {
                        backendSlides = presentationData.added_slides;
                    }
                }

                if (backendSlides.length > 0) {
                    // The backend response is the source of truth for IDs and order.
                    // We create a new local slides array by merging local content with backend metadata.
                    const syncedSlides = backendSlides.map(backendSlide => {
                        // The slide_order from the backend corresponds to the index of the slide
                        // in the local `slides` array at the time of the save request.
                        const localSlide = slides[backendSlide.slide_order];

                        if (!localSlide) {
                            console.error(`State Sync Error: Could not find local slide for backend slide_order: ${backendSlide.slide_order}`);
                            return null; // This slide will be filtered out.
                        }

                        // Start with the rich content from the local slide
                        const newSlideData = { ...localSlide };

                        // Update with authoritative data from the backend
                        newSlideData.id = backendSlide.id;
                        newSlideData.slide_order = backendSlide.slide_order;

                        // Special handling for question slides to sync question/option IDs
                        if (backendSlide.added_question &&
                            (localSlide.type === SlideTypeEnum.Quiz || localSlide.type === SlideTypeEnum.Feedback)) {

                            newSlideData.questionId = backendSlide.added_question.id;

                            const localOptions = newSlideData.elements.singleChoiceOptions || [];
                            const backendOptions = backendSlide.added_question.options || [];

                            newSlideData.elements.singleChoiceOptions = localOptions.map((localOpt, optIndex) => {
                                // Assuming backend options are also in order.
                                const backendOpt = backendOptions[optIndex];
                                return backendOpt ? { ...localOpt, id: backendOpt.id } : localOpt;
                            });
                        }

                        return newSlideData;
                    }).filter(Boolean); // Remove any nulls from sync errors

                    if (syncedSlides.length > 0) {
                        // Sort one last time to be certain, then update the global state.
                        syncedSlides.sort((a, b) => a.slide_order - b.slide_order);
                        setSlides(syncedSlides);
                        // After successfully syncing, update the originalSlideIds to reflect the new state.
                        // This prevents re-adding slides that were just saved.
                        setOriginalSlideIds(new Set(syncedSlides.map(s => s.id)));
                        // All saved slides are now clean — future saves will only upload changed ones.
                        clearDirtySlides();
                    }
                } else if (!isEdit && response.data.id) {
                    // This is the case for auto-create where the slide array might be empty in the response,
                    // but we got a new presentation ID. We should trigger a navigation or refetch.
                    const newPresentationId = response.data.id;
                    console.log(`Auto-create successful. New ${PRODUCT_NAME} ID: ${newPresentationId}. Navigating.`);

                    router.navigate({
                        to: '/study-library/volt/add',
                        search: { id: newPresentationId, isEdit: 'true', title: metaData.title, description: metaData.description },
                        replace: true,
                    });
                    autoCreateNavigated = true;
                }
            }

            if (isAutoSave) {
                toast.info(`${PRODUCT_NAME} auto-saved.`, { duration: 2000 });
            } else {
                toast.success(`${PRODUCT_NAME} ${isEdit ? 'updated' : 'created'} successfully`);
            }
            if (!isAutoSave && !isEdit) { // Only navigate for explicit create action
                router.navigate({ to: '/study-library/volt' });
            }
            // If we reach here and didn't auto-create-navigate, it's safe to set isSaving to false.
            if (!autoCreateNavigated) {
                setIsSaving(false);
            }
        } catch (error: any) {
            console.error('Save error:', error);
            toast.error(error.response?.data?.message || `Failed to save ${PRODUCT_NAME.toLowerCase()}.`);
            setIsSaving(false); // Ensure isSaving is reset on error
        }
    };

    const exportPresentationToFile = () => {
        try {
            // Serialize slides — convert Map-based collaborators to plain arrays so JSON.stringify works
            const exportableSlides = slides.map((slide) => {
                if (slide.type === SlideTypeEnum.Quiz || slide.type === SlideTypeEnum.Feedback) {
                    return slide;
                }
                const excalidrawSlide = slide as ExcalidrawSlideData;
                const collaborators = excalidrawSlide.appState?.collaborators;
                return {
                    ...excalidrawSlide,
                    appState: {
                        ...excalidrawSlide.appState,
                        collaborators: collaborators instanceof Map
                            ? Array.from(collaborators.entries())
                            : [],
                    },
                };
            });

            const payload = {
                version: 1,
                title: metaData.title || 'Untitled',
                exported_at: new Date().toISOString(),
                slides: exportableSlides,
            };

            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${(metaData.title || 'presentation').replace(/\s+/g, '_')}.volt.json`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            toast.success('Presentation exported successfully.');
        } catch (err) {
            console.error('Export failed:', err);
            toast.error('Failed to export presentation.');
        }
    };

    const importPresentationFromFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset the input so the same file can be re-imported if needed
        event.target.value = '';

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target?.result as string);

                // Accept either a .volt.json export or a raw array of slides
                const rawSlides: AppSlide[] = Array.isArray(parsed)
                    ? parsed
                    : Array.isArray(parsed.slides)
                        ? parsed.slides
                        : null;

                if (!rawSlides) {
                    toast.error('Invalid file format. Expected a Volt export or a slides array.');
                    return;
                }

                // Re-hydrate collaborators Maps and assign fresh temp IDs so there are no ID collisions
                const importedSlides: AppSlide[] = rawSlides.map((slide, index) => {
                    const freshId = `temp-import-${Date.now()}-${index}`;
                    if (slide.type === SlideTypeEnum.Quiz || slide.type === SlideTypeEnum.Feedback) {
                        return { ...slide, id: freshId, slide_order: slides.length + index, source_id: undefined };
                    }
                    const excalidrawSlide = slide as ExcalidrawSlideData;
                    const rawCollaborators = excalidrawSlide.appState?.collaborators;
                    const collaboratorsMap = Array.isArray(rawCollaborators)
                        ? new Map(rawCollaborators)
                        : new Map();
                    return {
                        ...excalidrawSlide,
                        id: freshId,
                        slide_order: slides.length + index,
                        source_id: undefined, // force re-upload on next save
                        appState: { ...excalidrawSlide.appState, collaborators: collaboratorsMap },
                    };
                });

                const combined = [...slides, ...importedSlides].map((s, i) => ({ ...s, slide_order: i }));
                setSlides(combined);
                // Mark all imported slides dirty so they get uploaded on next save
                importedSlides.forEach(s => {
                    const newDirty = new Set(useSlideStore.getState().dirtySlideIds);
                    newDirty.add(s.id);
                    useSlideStore.setState({ dirtySlideIds: newDirty });
                });
                toast.success(`${importedSlides.length} slide(s) imported successfully.`);
            } catch (err) {
                console.error('Import failed:', err);
                toast.error('Failed to parse the file. Make sure it is a valid Volt export.');
            }
        };
        reader.readAsText(file);
    };

    const handleSharePresentation = () => {
        if (presentationId) {
            const shareUrl = `https://${import.meta.env.VITE_ENGAGE_DOMAIN || 'engage.vacademy.io'}/presentation/public/${presentationId}`;
            window.open(shareUrl, '_blank');
            toast.success(`Public ${PRODUCT_NAME.toLowerCase()} link opened!`);
        } else {
            toast.error(`${PRODUCT_NAME} ID is not available. Save the ${PRODUCT_NAME.toLowerCase()} first to enable sharing.`);
        }
    };

    const handleUpdateTitle = async () => {
        if (!isEdit || !presentationId) {
            toast.error(`Cannot update title: ${PRODUCT_NAME} ID is missing or not in edit mode.`);
            setIsEditingTitle(false);
            setCurrentTitle(metaData.title || ''); // Reset to original
            return;
        }

        const newTitle = currentTitle.trim();
        if (!newTitle) {
            toast.error("Title cannot be empty.");
            setCurrentTitle(metaData.title || ''); // Reset to original
            // setIsEditingTitle(false); // Keep editing open for user to correct
            return;
        }

        if (newTitle === metaData.title) {
            setIsEditingTitle(false); // No change, just close input
            return;
        }

        // Optimistically update UI, but prepare to revert or confirm
        // setCurrentTitle(newTitle); // Already set by input's onChange

        try {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            if (!accessToken) {
                toast.error(`Please login to update the ${PRODUCT_NAME.toLowerCase()} title.`);
                setCurrentTitle(metaData.title); // Revert
                setIsEditingTitle(false);
                return;
            }
            const tokenData = getTokenDecodedData(accessToken);
            const INSTITUTE_ID = tokenData?.authorities && Object.keys(tokenData.authorities)[0];
            if (!INSTITUTE_ID) {
                toast.error('Organization information missing.');
                setCurrentTitle(metaData.title); // Revert
                setIsEditingTitle(false);
                return;
            }

            const payload = {
                id: presentationId,
                title: newTitle,
                description: metaData.description || '', // Preserve existing description
                cover_file_id: '', // Assuming this should be preserved or is not editable here
                status: 'PUBLISHED', // Assuming status remains published
                added_slides: [], // Crucial: empty arrays for metadata-only update
                updated_slides: [],
                deleted_slides: [],
            };

            await authenticatedAxiosInstance.post(EDIT_PRESENTATION, payload, {
                params: { instituteId: INSTITUTE_ID },
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            toast.success(`${PRODUCT_NAME} title updated successfully!`);
            setIsEditingTitle(false);

            // Update router search params to reflect the new title
            const search = router.state.location.search;
            const newSearchParams = {
                ...search, // Preserve other existing search params
                id: presentationId,
                isEdit: 'true',
                title: newTitle,
                description: metaData.description, // keep current description
            };
            router.navigate({
                to: '/study-library/volt/add',
                search: newSearchParams,
                replace: true,
            });
            // The metaData.title prop will update on re-render due to router state change

        } catch (error: any) {
            console.error(`Error updating ${PRODUCT_NAME.toLowerCase()} title:`, error);
            toast.error(error.response?.data?.message || `Failed to update ${PRODUCT_NAME.toLowerCase()} title.`);
            setCurrentTitle(metaData.title); // Revert optimistic update on error
            setIsEditingTitle(false);
        }
    };

    // Auto-save has been removed to prevent data loss and duplicate presentations.
    // Changes are tracked via dirtySlideIds. User must manually save or will be prompted on exit.

    // Warn the user if they try to close/refresh the tab with unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    // New useEffect to reset the justExitedSession flag after render.
    useEffect(() => {
        if (justExitedSession) {
            // We reset the flag after a short delay to allow the render cycle to complete.
            // This ensures that subsequent actions (like a page refresh) will trigger a fetch.
            const timer = setTimeout(() => setJustExitedSession(false), 100);
            return () => clearTimeout(timer);
        }
    }, [justExitedSession]);

    // New useEffect to reset isSaving after successful auto-create and navigation
    useEffect(() => {
        if (isEdit && presentationId && isSaving) {
            // This condition means we were saving (likely an auto-create that just finished)
            // and the component has now re-rendered with isEdit=true and a presentationId.
            console.log("Auto-create navigation complete. Resetting isSaving state.");
            setIsSaving(false);
        }
    }, [isEdit, presentationId, isSaving]);

    // Function to toggle the participants panel visibility
    const handleToggleParticipantsPanel = () => {
        setIsParticipantsPanelOpen(prev => !prev);
    };

    const handleAddQuickQuestion = async (newSlideData: AppSlide, insertionBehavior: InsertionBehavior) => {
        console.log('--- handleAddQuickQuestion Initiated ---');
        console.log('Received insertion behavior:', insertionBehavior);
        console.log('Current slide ID at start:', currentSlideId);

        if (!sessionDetails?.session_id) {
            toast.error("No active session found to add a question to.");
            return;
        }

        toast.info("Preparing your quick question...");
        const tempId = newSlideData.id;

        // 1. Determine insertion order
        const currentSlide = getSlide(currentSlideId);

        let afterSlideOrder = -1; // Default to adding at the beginning if no slides/current slide.
        if (insertionBehavior === 'next' && currentSlide) {
            // Based on logs, the API seems to expect the desired *index* for the new slide,
            // not the order of the slide to place it after.
            afterSlideOrder = currentSlide.slide_order;
        } else { // 'end', or fallback if current slide isn't found.
            // To add at the very end, the new slide's index is the current total number of slides.
            afterSlideOrder = slides.length - 1;
        }

        console.log('[Add Quick Question] Calculated target index to send as afterSlideOrder:', afterSlideOrder);

        try {
            // 2. Construct the payload
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            if (!accessToken) throw new Error("Authentication token not found.");
            const tokenData = getTokenDecodedData(accessToken);
            if (!tokenData) throw new Error("Invalid token data.");

            // Upload content to S3 to get a source_id
            const fileId = await UploadFileInS3V2(newSlideData, () => { }, tokenData.sub, 'SLIDES', tokenData.sub, true);

            const isQuestionSlide = [SlideTypeEnum.Quiz, SlideTypeEnum.Feedback].includes(newSlideData.type);

            const payload = {
                id: null,
                presentation_id: presentationId,
                title: (newSlideData as QuizSlideData).elements?.questionName || 'Quick Question',
                source_id: fileId,
                source: isQuestionSlide ? 'question' : 'excalidraw',
                status: 'PUBLISHED',
                interaction_status: '',
                slide_order: 0, // Backend will recalculate
                default_time: 0,
                content: fileId,
                added_question: null,
            };

            if (isQuestionSlide) {
                const questionData = newSlideData as QuizSlideData;
                const questionElements = questionData.elements;
                payload.added_question = {
                    preview_id: '1',
                    text: { id: null, type: 'HTML', content: questionElements.questionName || '' },
                    question_response_type: newSlideData.type === SlideTypeEnum.Quiz ? 'AUTO' : 'MANUAL',
                    question_type: newSlideData.type === SlideTypeEnum.Quiz ? 'MCQS' : 'LONG_ANSWER',
                    access_level: 'public',
                    auto_evaluation_json: newSlideData.type === SlideTypeEnum.Quiz ? JSON.stringify({ type: 'MCQS', data: { correctOptionIds: [] } }) : null,
                    parsed_evaluation_object: {},
                    evaluation_type: 'auto',
                    explanation_text: { id: null, type: 'HTML', content: '' },
                    parent_rich_text_id: 'prt_001',
                    parent_rich_text: { id: null, type: 'HTML', content: '' },
                    default_question_time_mins: 1,
                    options: (questionElements.singleChoiceOptions || []).map((option, optIndex) => ({
                        id: null,
                        preview_id: `${optIndex + 1}`,
                        question_id: null,
                        text: { id: null, type: 'HTML', content: option.name || '' },
                        media_id: '',
                        option_order: optIndex,
                        explanation_text: { id: null, type: 'HTML', content: '' },
                    })),
                    errors: [],
                    warnings: [],
                };
            }

            const url = `${ADD_SLIDE_IN_SESSION_API_URL}?sessionId=${sessionDetails.session_id}&afterSlideOrder=${afterSlideOrder}`;
            console.log('Making POST request to URL:', url);

            // 3. Make API call
            const response = await authenticatedAxiosInstance.post(url, payload);
            console.log('Received API response:', response);

            if (response.data?.slides?.added_slides) {
                const backendSlideList = response.data.slides.added_slides;
                console.log('Full slide list from backend:', JSON.stringify(backendSlideList, null, 2));

                // The backend provides the full, correct list of slides for the session.
                // We will re-format this entire list for our frontend state.
                const newFrontendSlidesPromises = backendSlideList.map(async (backendSlide: any) => {
                    if (backendSlide.source === 'question') {
                        const questionData = backendSlide.added_question;
                        const slideType = questionData.question_type === 'MCQS' ? SlideTypeEnum.Quiz : SlideTypeEnum.Feedback;

                        const questionElements: any = {
                            questionName: questionData.text?.content || '',
                            feedbackAnswer: '',
                        };

                        if (slideType === SlideTypeEnum.Quiz) {
                            questionElements.singleChoiceOptions = (questionData.options || []).map((opt: any) => ({
                                id: opt.id,
                                name: opt.text?.content || '',
                                isSelected: false,
                            }));
                        }

                        return {
                            id: backendSlide.id,
                            type: slideType,
                            slide_order: backendSlide.slide_order,
                            questionId: questionData.id,
                            elements: questionElements,
                        };
                    } else { // Handle excalidraw-based slides
                        let excalidrawContent = { elements: [], appState: {}, files: {} };
                        try {
                            if (backendSlide.source_id) {
                                const s3PublicUrl = await getPublicUrl(backendSlide.source_id);
                                const res = await fetch(s3PublicUrl);
                                if (res.ok) excalidrawContent = await res.json();
                            }
                        } catch (error) {
                            console.error(`Error fetching Excalidraw content for slide ${backendSlide.id}:`, error);
                        }

                        const oldSlide = slides.find(s => s.id === backendSlide.id);

                        return {
                            id: backendSlide.id,
                            type: oldSlide?.type || SlideTypeEnum.Excalidraw,
                            slide_order: backendSlide.slide_order,
                            elements: excalidrawContent.elements || [],
                            appState: excalidrawContent.appState || {},
                            files: excalidrawContent.files || {},
                        };
                    }
                });

                const newFrontendSlides = (await Promise.all(newFrontendSlidesPromises)).filter(Boolean);

                newFrontendSlides.sort((a: AppSlide, b: AppSlide) => a.slide_order - b.slide_order);

                console.log('Newly constructed frontend slides (sorted):', JSON.stringify(newFrontendSlides, null, 2));
                setSlides(newFrontendSlides as AppSlide[]);

                // After syncing state, find the newly added slide by its temporary ID's order
                const newlyAddedBackendSlide = backendSlideList.find(
                    (s: any) => s.added_question?.text?.content === (newSlideData as QuizSlideData).elements.questionName
                );

                console.log('Identified newly added slide from backend response:', newlyAddedBackendSlide);

                if (newlyAddedBackendSlide) {
                    // As per user request, do not navigate to the newly added slide.
                    // setCurrentSlideId(newlyAddedBackendSlide.id);
                    console.log(`A new slide was added (ID: ${newlyAddedBackendSlide.id}). Staying on the current slide as per user request.`);
                }

                toast.success("Your question has been added!");
            } else {
                toast.error("Slide added, but the slide list could not be updated automatically.");
            }

        } catch (error: any) {
            console.error("Failed to add quick question:", error);
            toast.error(error.response?.data?.message || "An error occurred while adding the question.");
        }
    };

    const handleAiGenerateInEditor = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!aiTopic.trim()) {
            toast.error('Topic is required for AI generation.');
            return;
        }
        setIsGenerating(true);
        console.log(`[AI Gen Editor] Starting generation for topic: "${aiTopic}"`);

        try {
            const response = await authenticatedAxiosInstance.post(
                GENERATE_SLIDES_FROM_TEXT_API_URL,
                {
                    language: aiLanguage,
                    text: aiTopic,
                    institute_id: getInstituteId(),
                },
                { headers: { 'Content-Type': 'application/json' } }
            );

            const data = response.data;
            console.log('[AI Gen Editor] Received data:', data);

            if (!data.slides || !data.assessment) {
                throw new Error('Invalid response structure from AI service.');
            }

            const { slides: currentSlides, setSlides: setStoreSlides } = useSlideStore.getState();

            const newSlidesFromAi = [];

            // Process Excalidraw slides
            data.slides.forEach((slideData) => {
                const newSlide = createNewSlide(SlideTypeEnum.Excalidraw);
                const excalidrawSlide = {
                    ...newSlide,
                    elements: slideData.elements,
                    appState: {
                        ...newSlide.appState,
                        ...slideData.appState,
                    },
                };
                newSlidesFromAi.push(excalidrawSlide);
            });

            // Process Questions
            data.assessment.questions.forEach((questionData) => {
                const isMcq = questionData.question_type === 'MCQS';
                const type = isMcq ? SlideTypeEnum.Quiz : SlideTypeEnum.Feedback;
                const newSlide = createNewSlide(type);

                const questionElements: any = {
                    questionName: questionData.question.content,
                };

                if (isMcq) {
                    questionElements.singleChoiceOptions = questionData.options.map((opt) => ({
                        id: `option_${Math.random()}`, // temp id
                        name: opt.content,
                        isSelected: (questionData.correct_options || []).includes(opt.preview_id),
                    }));
                } else {
                    questionElements.feedbackAnswer = '';
                }

                const questionSlide = {
                    ...newSlide,
                    elements: questionElements,
                };
                newSlidesFromAi.push(questionSlide);
            });

            const combinedSlides = [...currentSlides, ...newSlidesFromAi];
            const finalSlides = combinedSlides.map((slide, index) => ({
                ...slide,
                slide_order: index,
            }));

            console.log('[AI Gen Editor] Appending new slides. Final list:', finalSlides);
            setStoreSlides(finalSlides);

            toast.success(`${newSlidesFromAi.length} new slides added by AI!`);
            setAiTopic('');
            setIsAiModalOpen(false);
        } catch (error: any) {
            console.error('[AI Gen Editor] Error:', error);
            toast.error(
                error.response?.data?.message || 'Failed to generate slides from AI.'
            );
        } finally {
            setIsGenerating(false);
        }
    };

    const handlePptImportInEditor = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pptFile) {
            toast.error('Please select a PPT/PPTX file to import.');
            return;
        }
        setIsImporting(true);
        console.log(`[PPT Import Editor] Starting import for file: "${pptFile.name}"`);

        const formData = new FormData();
        formData.append('file', pptFile);

        try {
            const response = await authenticatedAxiosInstance.post(IMPORT_PPT_API_URL, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const newSlidesFromPpt = response.data;
            console.log('[PPT Import Editor] Received slides:', newSlidesFromPpt);

            if (!Array.isArray(newSlidesFromPpt) || newSlidesFromPpt.length === 0) {
                throw new Error('No slides were generated from the PPT file.');
            }

            const { slides: currentSlides, setSlides: setStoreSlides } = useSlideStore.getState();

            const combinedSlides = [...currentSlides, ...newSlidesFromPpt];
            const finalSlides = combinedSlides.map((slide, index) => ({
                ...slide,
                slide_order: index,
            }));

            console.log('[PPT Import Editor] Appending new slides. Final list:', finalSlides);
            setStoreSlides(finalSlides);

            toast.success(`${newSlidesFromPpt.length} new slides imported from PPT!`);
            setPptFile(null);
            setIsPptModalOpen(false);
        } catch (error: any) {
            console.error('[PPT Import Editor] Error:', error);
            toast.error(
                error.response?.data?.message || 'Failed to import slides from PPT.'
            );
        } finally {
            setIsImporting(false);
        }
    };

    const handleOpenRegenerateModal = (slideId: string) => {
        setRegenerateSlideId(slideId);
        setIsRegenerateModalOpen(true);
    };

    const handleRegenerateSlide = async (prompt: string) => {
        if (!regenerateSlideId) {
            toast.error('No slide selected for regeneration.');
            return;
        }

        const { getSlide, updateSlide } = useSlideStore.getState();

        const slideToRegenerate = getSlide(regenerateSlideId);
        console.log(
            '[Regen] Slide from store before regeneration:',
            JSON.parse(JSON.stringify(slideToRegenerate))
        );

        if (!slideToRegenerate) {
            toast.error('Could not find the slide to regenerate.');
            return;
        }

        const isQuestionSlide = [SlideTypeEnum.Quiz, SlideTypeEnum.Feedback].includes(
            slideToRegenerate.type
        );

        if (isQuestionSlide) {
            toast.error('This slide type cannot be regenerated with AI.');
            return;
        }

        const excalidrawSlideToRegenerate = slideToRegenerate as ExcalidrawSlideData;

        setIsRegenerating(true);
        try {
            const payload = {
                language: 'English',
                text: prompt,
                institute_id: getInstituteId(),
                initial_data: JSON.stringify({
                    type: 'excalidraw',
                    version: 2,
                    source: 'https://excalidraw.com',
                    elements: excalidrawSlideToRegenerate.elements || [],
                    appState: excalidrawSlideToRegenerate.appState || {},
                    files: excalidrawSlideToRegenerate.files || {},
                }),
            };

            const response = await authenticatedAxiosInstance.post(REGENERATE_SLIDE_API_URL, payload);
            const regeneratedData = response.data;
            console.log('[Regen] API response received:', JSON.parse(JSON.stringify(regeneratedData)));


            if (!regeneratedData.elements || !regeneratedData.appState) {
                throw new Error('Invalid response from AI regeneration service.');
            }

            const newElements = regeneratedData.elements;
            const newAppState = {
                ...(excalidrawSlideToRegenerate.appState || {}),
                ...regeneratedData.appState,
            };

            // CRITICAL FIX: The `collaborators` property, after JSON serialization/deserialization,
            // becomes a plain object. The store expects it to be a Map.
            if (newAppState.collaborators) {
                newAppState.collaborators = new Map(Object.entries(newAppState.collaborators));
            } else {
                newAppState.collaborators = new Map();
            }

            const existingFilesMap = new Map(Object.entries(excalidrawSlideToRegenerate.files || {}));

            updateSlide(
                regenerateSlideId,
                newElements,
                newAppState,
                existingFilesMap
            );

            toast.success('Slide has been regenerated!');

            setIsRegenerateModalOpen(false);
            setRegenerateSlideId(null);
        } catch (error: any) {
            console.error('Error regenerating slide:', error);
            toast.error(error.response?.data?.message || 'Failed to regenerate slide.');
        } finally {
            setIsRegenerating(false);
        }
    };

    if (isLoadingPresentation || isRefetchingPresentation) {
        return (
            <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                <Loader2 className="size-12 animate-spin text-orange-500" />
                <p className="mt-3 text-lg text-slate-600">Loading {PRODUCT_NAME}...</p>
            </div>
        );
    }

    if (showSessionOptionsModal) {
        return (
            <SessionOptionsModal
                isOpen={showSessionOptionsModal}
                onClose={() => {
                    setShowSessionOptionsModal(false);
                    if (isCreatingSession) setIsCreatingSession(false);
                }}
                onSubmit={handleCreateSession}
                isCreatingSession={isCreatingSession}
            />
        );
    }

    if (isWaitingForParticipants && sessionDetails) {
        return (
            <WaitingRoom
                sessionDetails={{ ...sessionDetails, title: metaData.title }}
                onStartVolt={handleStartActualPresentation}
                onCancelSession={handleExitSessionFlow}
                isStarting={isStartingSessionInProgress}
            />
        );
    }

    if (!editMode) {
        const onVoltExit = sessionDetails
            ? handleExitSessionFlow
            : () => {
                setEditMode(true);
                if (slides.length > 0 && !slides.find((s) => s.id === currentSlideId)) {
                    setCurrentSlideId(slides[0].id);
                }
                if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                    mediaRecorderRef.current.stop();
                }
                stopDurationTracker(); // Stop and reset duration tracker
                audioChunksRef.current = []; // Clear chunks on exiting direct preview too
                setIsParticipantsPanelOpen(false); // Close panel on exit
            };
        return (
            <>
                <ActualPresentationDisplay
                    slides={slides}
                    initialSlideId={currentSlideId || (slides.length > 0 ? slides[0].id : undefined)}
                    liveSessionData={sessionDetails}
                    onVoltExit={onVoltExit}
                    isAudioRecording={isRecording}
                    isAudioPaused={isRecordingPaused}
                    audioBlobUrl={audioBlobUrl}
                    recordingDuration={recordingDuration}
                    onPauseAudio={() => {
                        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                            mediaRecorderRef.current.pause();
                            recommendationMediaRecorderRef.current?.pause(); // Pause recommendation recorder too
                            setIsRecordingPaused(true);
                            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
                            toast.info('Recording paused.');
                        }
                    }}
                    onResumeAudio={() => {
                        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
                            mediaRecorderRef.current.resume();
                            recommendationMediaRecorderRef.current?.resume(); // Resume recommendation recorder too
                            setIsRecordingPaused(false);
                            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
                            recordingIntervalRef.current = setInterval(() => {
                                setRecordingDuration(prevDuration => prevDuration + 1);
                            }, 1000);
                            toast.info('Recording resumed.');
                        }
                    }}
                    onDownloadAudio={downloadCurrentAudioSnapshot}
                    isParticipantsPanelOpen={isParticipantsPanelOpen} // Pass state
                    onToggleParticipantsPanel={handleToggleParticipantsPanel} // Pass handler
                    onAddQuickQuestion={handleAddQuickQuestion} // Pass handler for FAB
                    onGenerateTranscript={handleTranscriptAction}
                    isTranscribing={isTranscribing}
                    hasTranscript={!!transcriptResult}
                />
                <RecommendationToast onShowRecommendations={() => setIsRecommendationOverlayOpen(true)} />
                <RecommendationOverlay
                    isOpen={isRecommendationOverlayOpen}
                    onClose={() => setIsRecommendationOverlayOpen(false)}
                    onAddSlide={(slide) => handleAddQuickQuestion(slide, 'next')}
                />
                <TranscriptModal
                    isOpen={isTranscriptModalOpen}
                    onClose={() => {
                        setIsTranscriptModalOpen(false);
                        setTranscriptResult(''); // Clear transcript when modal is closed
                    }}
                    transcriptText={transcriptResult}
                    onGenerateNew={() => {
                        setIsTranscriptModalOpen(false);
                        setTranscriptResult(''); // Clear transcript before generating new one
                        setTimeout(() => {
                            startTranscription();
                        }, 100);
                    }}
                />
                <Dialog open={isFinishModalOpen} onOpenChange={(isOpen) => !isTranscribingOnFinish && setIsFinishModalOpen(isOpen)}>
                    <DialogContent className="!w-[600px] !max-w-[95vw] !p-0" style={{ width: '600px', maxWidth: '95vw', padding: '0' }}>
                        {isTranscribingOnFinish ? (
                            <AiGeneratingLoader
                                title="Finalizing Session..."
                                description="Generating full session transcript. This may take up to a minute, please don't close this window."
                                steps={finishSessionSteps}
                            />
                        ) : (
                            <>
                                <DialogHeader className="!border-b !border-slate-200/50 !p-6 !bg-white/80 !backdrop-blur-sm" style={{ padding: '1.5rem', borderBottom: '1px solid rgb(226 232 240 / 0.5)' }}>
                                    <DialogTitle className="!flex !items-start !gap-3 !text-lg !font-bold !text-slate-800 !leading-tight" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '1.125rem', fontWeight: '700' }}>
                                        <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl shadow-lg flex-shrink-0">
                                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <span className="bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent leading-tight">
                                            Finish Session & Generate Summary
                                        </span>
                                    </DialogTitle>
                                    <DialogDescription className="mt-3 text-slate-600 leading-relaxed">
                                        This session has an audio recording. Would you like to generate a transcript and send a summary report to participants?
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogFooter className="!flex !flex-col !gap-3 sm:!flex-row sm:!justify-end !p-6 !border-t !border-slate-200/50 !bg-white/80 !backdrop-blur-sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1.5rem', borderTop: '1px solid rgb(226 232 240 / 0.5)' }}>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        onClick={() => cleanupAndExitSession(true)}
                                        className="w-full sm:w-auto text-sm px-4 py-2"
                                    >
                                        Exit Without Summary
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        onClick={() => processAndFinishSession(true)}
                                        className="w-full sm:w-auto text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700"
                                    >
                                        Finish in Background
                                    </MyButton>
                                    <MyButton
                                        type="submit"
                                        onClick={() => processAndFinishSession(false)}
                                        className="w-full sm:w-auto text-sm px-4 py-2"
                                    >
                                        Finish and Generate
                                    </MyButton>
                                </DialogFooter>
                            </>
                        )}
                    </DialogContent>
                </Dialog>
            </>
        );
    }

    if ((!slides || slides.length === 0) && editMode) {
        return (
            <div className="flex h-screen flex-col">
                <div className="sticky top-0 z-40 flex items-center border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleBackNavigation}
                        className="text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                    >
                        <ArrowLeft size={22} />
                    </Button>
                    <span className="ml-3 text-lg font-semibold text-slate-700">
                        {metaData.title || `New ${PRODUCT_NAME}`}
                    </span>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 p-6 text-center">
                    <img
                        src="/placeholder-empty-slides.svg"
                        alt={`Empty ${PRODUCT_NAME}`}
                        className="mx-auto mb-8 h-52 w-52 opacity-70"
                    />
                    <h2 className="mb-3 text-2xl font-semibold text-slate-700">
                        Your {PRODUCT_NAME} is Empty
                    </h2>
                    <p className="mb-8 max-w-md text-base text-slate-500">
                        Let's bring your ideas to life. Add your first slide to get started!
                    </p>
                    <Button
                        onClick={() => handleAddSlide(SlideTypeEnum.Title)}
                        className="group rounded-lg bg-orange-500 px-8 py-3 text-base font-medium text-white shadow-md transition-all duration-150 ease-in-out hover:bg-orange-600 hover:shadow-lg"
                    >
                        <PlusCircle className="mr-2.5 size-5 group-hover:animate-pulse" />
                        Add First Slide
                    </Button>
                </div>
            </div>
        );
    }

    const currentSlideData = getSlide(currentSlideId || '');
    const needsEditorPadding =
        currentSlideData &&
        (currentSlideData.type === SlideTypeEnum.Title ||
            currentSlideData.type === SlideTypeEnum.Text ||
            currentSlideData.type === SlideTypeEnum.Blank ||
            currentSlideData.type === SlideTypeEnum.Excalidraw);

    return (
        <div className="flex h-screen w-full flex-col bg-slate-100">
            <div className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:px-4">
                <div className="flex items-center gap-1 sm:gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleBackNavigation}
                        className="rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                    >
                        <ArrowLeft size={20} />
                    </Button>

                    {isEditingTitle && isEdit ? (
                        <div className="flex items-center gap-1">
                            <Input
                                type="text"
                                value={currentTitle}
                                onChange={(e) => setCurrentTitle(e.target.value)}
                                onBlur={handleUpdateTitle} // Save on blur
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleUpdateTitle();
                                    if (e.key === 'Escape') {
                                        setIsEditingTitle(false);
                                        setCurrentTitle(metaData.title || ''); // Revert
                                    }
                                }}
                                className="h-8 text-md sm:text-lg font-semibold text-slate-800 focus-visible:ring-orange-400"
                                autoFocus
                                maxLength={100}
                            />
                            <Button variant="ghost" size="icon" onClick={handleUpdateTitle} className="h-8 w-8 text-green-600 hover:bg-green-100">
                                <Check size={18} />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 group">
                            <span
                                className="text-md max-w-[150px] truncate font-semibold text-slate-800 sm:max-w-xs sm:text-lg md:max-w-sm group-hover:text-orange-600"
                                title={currentTitle}
                                onClick={() => { if (isEdit) setIsEditingTitle(true); }} // Allow click to edit only if isEdit is true
                            >
                                {currentTitle || `Untitled ${PRODUCT_NAME}`}
                            </span>
                            {isEdit && ( // Only show edit icon if isEdit is true
                                <Button variant="ghost" size="icon" onClick={() => setIsEditingTitle(true)} className="h-7 w-7 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-orange-500">
                                    <Edit2 size={16} />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 sm:gap-2.5">
                    {/* Unsaved changes indicator */}
                    {hasUnsavedChanges && !isSaving && (
                        <span className="hidden items-center gap-1 text-xs font-medium text-amber-600 sm:flex">
                            <span className="size-1.5 rounded-full bg-amber-500" />
                            Unsaved changes
                        </span>
                    )}
                    {isEdit ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    disabled={isSaving}
                                    size="sm"
                                    variant="default"
                                    className="gap-1.5 bg-orange-500 px-3 text-white hover:bg-orange-600 focus-visible:ring-orange-400 sm:gap-2 sm:px-4"
                                >
                                    <Save className="size-4" />
                                    {isSaving ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
                                    <ChevronDown className="size-4 opacity-80" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                    onClick={() => savePresentation()}
                                    disabled={isSaving}
                                >
                                    <Save className="mr-2 size-4" /> Just Save
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={async () => {
                                        await savePresentation();
                                        router.navigate({ to: '/study-library/volt' });
                                    }}
                                    disabled={isSaving}
                                >
                                    <Save className="mr-2 size-4" /> Save and Exit
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <Button
                            onClick={() => savePresentation()}
                            disabled={isSaving}
                            size="sm"
                            className="gap-1.5 bg-orange-500 px-3 text-white hover:bg-orange-600 focus-visible:ring-orange-400 sm:gap-2 sm:px-4"
                        >
                            <Save className="size-4" />
                            {isSaving ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                'Create'
                            )}
                        </Button>
                    )}
                    <Button
                        onClick={toggleDirectPresentationPreview}
                        disabled={!slides || slides.length === 0}
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-blue-500 px-3 text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus-visible:ring-blue-400 sm:px-4"
                    >
                        <PlaySquare className="size-4" />
                        Preview
                    </Button>
                    <Button
                        onClick={handleOpenSessionOptions}
                        disabled={!slides || slides.length === 0}
                        size="sm"
                        className="gap-1.5 bg-green-500 px-3 text-white hover:bg-green-600 focus-visible:ring-green-400 sm:px-4 relative overflow-hidden transition-all duration-300 ease-in-out hover:scale-105 focus-visible:scale-105 hover:shadow-lg group"
                    >
                        <span className="absolute inset-0 w-full h-full bg-emerald-400/25 rounded-md animate-pulse"></span>
                        <span className="relative z-10 flex items-center">
                            <Tv2 className="size-4 mr-1.5" />
                            Start Live
                        </span>
                    </Button>
                    <Button
                        onClick={handleSharePresentation}
                        disabled={!isEdit || !presentationId} // Can only share an existing, saved presentation
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-purple-500 px-3 text-purple-600 hover:bg-purple-50 hover:text-purple-700 focus-visible:ring-purple-400 sm:px-4"
                        title={!isEdit || !presentationId ? `Save the ${PRODUCT_NAME.toLowerCase()} to enable sharing` : `Share ${PRODUCT_NAME}`}
                    >
                        <Share2 className="size-4" />
                        Share
                    </Button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                <SlideList
                    slides={slides}
                    currentSlideId={currentSlideId}
                    onSlideChange={changeCurrentSlide}
                    onAddSlide={handleAddSlide}
                    onDeleteSlide={handleDeleteCurrentSlide}
                    onExport={exportPresentationToFile}
                    onImport={importPresentationFromFile}
                    onReorderSlides={(reorderedSlides) => setSlides(reorderedSlides)}
                    onAiGenerateClick={() => setIsAiModalOpen(true)}
                    onPptImportClick={() => setIsPptModalOpen(true)}
                />

                <main className={`flex flex-1 flex-col bg-slate-200 p-2 sm:p-3`}>
                    <div
                        className="relative z-0 flex-1 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner"
                    >
                        {currentSlideId && currentSlideData ? (
                            <SlideRenderer
                                currentSlideId={currentSlideId}
                                editModeExcalidraw={true}
                                editModeQuiz={true}
                                onRegenerate={handleOpenRegenerateModal}
                            />
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center p-5 text-slate-500">
                                <ListStart size={48} className="mb-4 text-slate-400" />
                                <p className="text-lg font-medium">
                                    {slides && slides.length > 0
                                        ? 'Select a slide to edit'
                                        : `Your ${PRODUCT_NAME.toLowerCase()} is empty.`}
                                </p>
                                {slides && slides.length === 0 && (
                                    <p className="mt-1 text-sm">
                                        Click "Add Slide" in the left panel to begin.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>
            <SlideRegenerateModal
                isOpen={isRegenerateModalOpen}
                onClose={() => {
                    setIsRegenerateModalOpen(false);
                    setRegenerateSlideId(null);
                }}
                onSubmit={handleRegenerateSlide}
                isRegenerating={isRegenerating}
            />
            <Dialog open={isAiModalOpen} onOpenChange={setIsAiModalOpen}>
                <DialogContent className="p-6 sm:max-w-lg">
                    {isGenerating ? (
                        <AiGeneratingLoader
                            title={`Generating your ${PRODUCT_NAME.toLowerCase()}`}
                            description="Our AI is crafting your content. This may take a moment."
                            steps={aiSteps}
                        />
                    ) : (
                        <>
                            <DialogHeader className="mb-4">
                                <DialogTitle className="text-xl font-semibold">
                                    Generate Slides with AI
                                </DialogTitle>
                                <DialogDescription className="text-sm text-neutral-500">
                                    Provide a topic and language. New slides will be added to the end
                                    of your {PRODUCT_NAME.toLowerCase()}.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleAiGenerateInEditor} className="space-y-5">
                                <div>
                                    <Label
                                        htmlFor="ai-topic-editor"
                                        className="text-sm font-medium"
                                    >
                                        Topic
                                    </Label>
                                    <Textarea
                                        id="ai-topic-editor"
                                        value={aiTopic}
                                        onChange={(e) => setAiTopic(e.target.value)}
                                        className="mt-1.5 min-h-[100px] w-full"
                                        placeholder="e.g., An overview of the thermite reaction, its chemical properties, applications, and safety precautions."
                                        required
                                        rows={4}
                                    />
                                </div>
                                <div>
                                    <Label
                                        htmlFor="ai-language-editor"
                                        className="text-sm font-medium"
                                    >
                                        Language
                                    </Label>
                                    <Input
                                        id="ai-language-editor"
                                        value={aiLanguage}
                                        onChange={(e) => setAiLanguage(e.target.value)}
                                        className="mt-1.5 w-full"
                                        placeholder="e.g., English"
                                        required
                                    />
                                </div>
                                <DialogFooter className="mt-6 !justify-stretch space-y-2 sm:flex sm:flex-row sm:space-x-3 sm:space-y-0">
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        onClick={() => setIsAiModalOpen(false)}
                                        className="w-full sm:w-auto"
                                    >
                                        Cancel
                                    </MyButton>
                                    <MyButton type="submit" className="w-full sm:w-auto">
                                        Generate & Add Slides
                                    </MyButton>
                                </DialogFooter>
                            </form>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={isPptModalOpen} onOpenChange={setIsPptModalOpen}>
                <DialogContent className="p-6 sm:max-w-lg">
                    {isImporting ? (
                        <AiGeneratingLoader
                            title={`Importing ${PRODUCT_NAME}`}
                            description={`We're converting your file and adding slides to your ${PRODUCT_NAME.toLowerCase()}.`}
                            steps={pptSteps}
                        />
                    ) : (
                        <>
                            <DialogHeader className="mb-4">
                                <DialogTitle className="text-xl font-semibold">
                                    Import from PPT/PPTX
                                </DialogTitle>
                                <DialogDescription className="text-sm text-neutral-500">
                                    New slides will be added to the end of your {PRODUCT_NAME.toLowerCase()}.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handlePptImportInEditor} className="space-y-5">
                                <div>
                                    <Label htmlFor="ppt-file-editor" className="text-sm font-medium">
                                        {PRODUCT_NAME} File
                                    </Label>
                                    <div
                                        className="mt-1.5 flex justify-center w-full px-6 pt-5 pb-6 border-2 border-neutral-300 border-dashed rounded-md cursor-pointer hover:border-orange-400"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <div className="space-y-1 text-center">
                                            <UploadCloud className="mx-auto h-12 w-12 text-neutral-400" />
                                            <div className="flex text-sm text-neutral-600">
                                                <span className="relative font-medium text-orange-600 hover:text-orange-500">
                                                    {pptFile ? 'Replace file' : 'Upload a file'}
                                                </span>
                                                <input
                                                    ref={fileInputRef}
                                                    id="ppt-file-editor-input"
                                                    name="ppt-file"
                                                    type="file"
                                                    className="sr-only"
                                                    accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                                                    onChange={(e) => setPptFile(e.target.files?.[0] || null)}
                                                />
                                                {!pptFile && <p className="pl-1">or drag and drop</p>}
                                            </div>
                                            <p className="text-xs text-neutral-500">
                                                {pptFile ? pptFile.name : 'PPT, PPTX up to 50MB'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter className="mt-6 !justify-stretch space-y-2 sm:flex sm:flex-row sm:space-x-3 sm:space-y-0">
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        onClick={() => {
                                            setIsPptModalOpen(false);
                                            setPptFile(null);
                                        }}
                                        className="w-full sm:w-auto"
                                    >
                                        Cancel
                                    </MyButton>
                                    <MyButton
                                        type="submit"
                                        className="w-full sm:w-auto"
                                        disabled={!pptFile}
                                    >
                                        Import & Add Slides
                                    </MyButton>
                                </DialogFooter>
                            </form>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            {/* Session Leaderboard Modal */}
            {finishedSessionId && (
                <SessionLeaderboardModal
                    isOpen={isLeaderboardModalOpen}
                    onClose={() => {
                        setIsLeaderboardModalOpen(false);
                        setFinishedSessionId(null);
                    }}
                    sessionId={finishedSessionId}
                    slides={slides}
                />
            )}

            {/* Unsaved Changes Exit Dialog */}
            <Dialog open={isExitDialogOpen} onOpenChange={setIsExitDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Unsaved changes</DialogTitle>
                        <DialogDescription>
                            You have unsaved changes. Do you want to save before leaving?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex-col gap-2 sm:flex-row">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setIsExitDialogOpen(false);
                                router.navigate({ to: '/study-library/volt' });
                            }}
                        >
                            Exit without saving
                        </Button>
                        <Button
                            className="bg-orange-500 text-white hover:bg-orange-600"
                            disabled={isSaving}
                            onClick={async () => {
                                await savePresentation();
                                setIsExitDialogOpen(false);
                                router.navigate({ to: '/study-library/volt' });
                            }}
                        >
                            {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                            Save and exit
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// Memoize the main component for better performance
export default React.memo(SlidesEditorComponent, (prevProps, nextProps) => {
    return (
        prevProps.presentationId === nextProps.presentationId &&
        prevProps.isEdit === nextProps.isEdit &&
        prevProps.autoStartLive === nextProps.autoStartLive &&
        prevProps.metaData.title === nextProps.metaData.title &&
        prevProps.metaData.description === nextProps.metaData.description
    );
});
