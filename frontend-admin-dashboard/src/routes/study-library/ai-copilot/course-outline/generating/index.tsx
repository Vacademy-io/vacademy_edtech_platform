import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createFileRoute, useNavigate, useBlocker } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { MyButton } from '@/components/design-system/button';
import { BASE_URL, AI_SERVICE_BASE_URL } from '@/constants/urls';
import {
    useToolPricingQuery,
    useAiCreditsQuery,
    computeToolCredits,
} from '@/services/ai-credits/get-ai-credits';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { getInstituteId } from '@/constants/helper';
import {
    CircularProgress,
    SortableSessionItem,
    SortableSlideItem,
    OutlineGeneratingLoader,
    SplitViewLayout,
} from './components';
import { useCourseGeneration } from './hooks/useCourseGeneration';
import { useSlideHandlers } from './hooks/useSlideHandlers';
import { useSessionHandlers } from './hooks/useSessionHandlers';
import { useMetadataHandlers } from './hooks/useMetadataHandlers';
import { useContentGeneration } from './hooks/useContentGeneration';
import { useCourseCreation } from './hooks/useCourseCreation';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import { getSessionsWithProgress } from './utils/sessionUtils';
import { generateSlideContent } from './utils/mockSlideContent';
import { extractSlideTitlesFromSlides } from '../../shared/utils/slides';
import { isYouTubeUrl, getYouTubeEmbedUrl } from '../../shared/utils/youtube';
import { SlideGeneration, SlideType, QuizQuestion, SessionProgress } from '../../shared/types';
import {
    buildDefaultQuizQuestions,
    buildDefaultSelectedAnswers,
    DEFAULT_SOLUTION_CODE,
} from '../../shared/constants';
import {
    RegenerateSlideDialog,
    RegenerateSessionDialog,
    AddSlideDialog,
    AddSessionDialog,
    GenerateCourseAssetsDialog,
    BackToLibraryDialog,
    LeaveDuringGenerationDialog,
} from './dialogs/CourseGenerationDialogs';
import {
    ArrowLeft,
    RefreshCw,
    Eye,
    Trash2,
    FileText,
    Video,
    Code,
    FileQuestion,
    ClipboardList,
    FileCode,
    CheckCircle,
    Loader2,
    ChevronDown,
    ChevronUp,
    ChevronsUp,
    ChevronsDown,
    Layers,
    BookOpen,
    File,
    Image as ImageIcon,
    Notebook,
    Terminal,
    Puzzle,
    GripVertical,
    Edit2,
    X,
    Play,
    Settings,
    Sun,
    Copy,
    Download,
    Pencil,
    Check,
    ChevronLeft,
    ChevronRight,
    Plus,
    AlertTriangle,
    Tag,
    Upload,
    Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { HtmlDocField } from '@/components/html-slide/html-doc-field';
import Editor from '@monaco-editor/react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { TagInput } from '@/components/ui/tag-input';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

// YouTube and utility functions are now imported from shared/utils

/** Safely extract plain text from HTML without creating orphaned DOM nodes */
const extractTextFromHtml = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
};

/** Extract first N sentences from HTML content */
const extractSentences = (html: string, count: number): string => {
    const text = extractTextFromHtml(html);
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    return sentences.slice(0, count).join(' ');
};

/** Static slide icon map — avoids re-creating JSX on every render */
const SLIDE_ICON_MAP: Record<string, React.ReactNode> = {
    objectives: <FileText className="size-4 text-blue-600" />,
    topic: (
        <div className="flex items-center gap-1">
            <Video className="size-4 text-red-600" />
            <Code className="size-4 text-green-600" />
        </div>
    ),
    quiz: <FileQuestion className="size-4 text-purple-600" />,
    assessment: <FileQuestion className="size-4 text-purple-600" />,
    homework: <ClipboardList className="size-4 text-orange-600" />,
    assignment: <ClipboardList className="size-4 text-orange-600" />,
    solution: <FileCode className="size-4 text-indigo-600" />,
    doc: <FileText className="size-4 text-blue-600" />,
    pdf: <File className="size-4 text-red-600" />,
    video: <Video className="size-4 text-red-600" />,
    'ai-video': <Video className="size-4 text-purple-600" />,
    'ai-slides': <Layers className="size-4 text-teal-600" />,
    'ai-storybook': <BookOpen className="size-4 text-rose-600" />,
    'video-code': (
        <div className="flex items-center gap-1">
            <Video className="size-4 text-red-600" />
            <Code className="size-4 text-green-600" />
        </div>
    ),
    'ai-video-code': (
        <div className="flex items-center gap-1">
            <Video className="size-4 text-blue-600" />
            <Code className="size-4 text-green-600" />
        </div>
    ),
    jupyter: <Notebook className="size-4 text-orange-600" />,
    'code-editor': <Code className="size-4 text-green-600" />,
    scratch: <Puzzle className="size-4 text-purple-600" />,
    'video-jupyter': (
        <div className="flex items-center gap-1">
            <Video className="size-4 text-red-600" />
            <Notebook className="size-4 text-orange-600" />
        </div>
    ),
    'video-code-editor': (
        <div className="flex items-center gap-1">
            <Video className="size-4 text-red-600" />
            <Code className="size-4 text-green-600" />
        </div>
    ),
    'video-scratch': (
        <div className="flex items-center gap-1">
            <Video className="size-4 text-red-600" />
            <Puzzle className="size-4 text-purple-600" />
        </div>
    ),
};

// Route definition only - component is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/study-library/ai-copilot/course-outline/generating/')({
    component: RouteComponent,
});

// Types, interfaces, and constants are now imported from shared modules

// SortableSessionItem and SortableSlideItem are now imported from ./components

export function RouteComponent() {
    const { t } = useTranslation('studyLibraryGenerating');
    const navigate = useNavigate();
    const { setOpen } = useSidebar();
    const [slides, setSlides] = useState<SlideGeneration[]>([]);
    // Guard against double-execution in React Strict Mode / HMR
    const hasStartedGeneration = useRef(false);

    // Get institute levels
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const instituteLevels = instituteDetails?.levels || [];

    // Collapse sidebar on mount
    useEffect(() => {
        setOpen(false);
    }, [setOpen]);
    const [isGenerating, setIsGenerating] = useState(true);
    const [generationProgress, setGenerationProgress] = useState<string>('Initializing...');
    const [courseMetadata, setCourseMetadata] = useState<any>(null);
    const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(30); // Default 30 seconds
    const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
    const [viewingSlide, setViewingSlide] = useState<SlideGeneration | null>(null);
    const [documentContent, setDocumentContent] = useState<string>('');
    const [codeContent, setCodeContent] = useState<string>('');
    const [homeworkQuestion, setHomeworkQuestion] = useState<string>('');
    const [homeworkAnswer, setHomeworkAnswer] = useState<string>('');
    const [homeworkAnswerType, setHomeworkAnswerType] = useState<'text' | 'code'>('text');
    const [regenerateSlideDialogOpen, setRegenerateSlideDialogOpen] = useState(false);
    const [regeneratingSlideId, setRegeneratingSlideId] = useState<string | null>(null);
    const [regeneratingSection, setRegeneratingSection] = useState<'video' | 'code' | undefined>(
        undefined
    );
    const [regenerateSlidePrompt, setRegenerateSlidePrompt] = useState('');
    const regenerateSlidePromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [regenerateSessionDialogOpen, setRegenerateSessionDialogOpen] = useState(false);
    const [regeneratingSessionId, setRegeneratingSessionId] = useState<string | null>(null);
    const [regenerateSessionPrompt, setRegenerateSessionPrompt] = useState('');
    const regenerateSessionPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [addSlideDialogOpen, setAddSlideDialogOpen] = useState(false);
    const [addingSlideToSessionId, setAddingSlideToSessionId] = useState<string | null>(null);
    const [addSlidePrompt, setAddSlidePrompt] = useState('');
    const [selectedAddSlideType, setSelectedAddSlideType] = useState<SlideType | null>(null);
    const addSlidePromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [addSessionDialogOpen, setAddSessionDialogOpen] = useState(false);
    const [addSessionName, setAddSessionName] = useState('');
    const [regenerateSessionLength, setRegenerateSessionLength] = useState<string>('60');
    const [regenerateCustomSessionLength, setRegenerateCustomSessionLength] = useState<string>('');
    const [regenerateIncludeDiagrams, setRegenerateIncludeDiagrams] = useState(false);
    const [regenerateIncludeCodeSnippets, setRegenerateIncludeCodeSnippets] = useState(false);
    const [regenerateIncludePracticeProblems, setRegenerateIncludePracticeProblems] =
        useState(false);
    const [regenerateIncludeQuizzes, setRegenerateIncludeQuizzes] = useState(false);
    const [regenerateIncludeHomework, setRegenerateIncludeHomework] = useState(false);
    const [regenerateIncludeSolutions, setRegenerateIncludeSolutions] = useState(false);
    const [regenerateSessionTopics, setRegenerateSessionTopics] = useState<string[]>([]);
    const [regenerateSessionNumberOfTopics, setRegenerateSessionNumberOfTopics] =
        useState<string>('');
    const [codeEditorWidth, setCodeEditorWidth] = useState(50); // Percentage width for code editor
    const [generateCourseAssetsDialogOpen, setGenerateCourseAssetsDialogOpen] = useState(false);
    const [backToLibraryDialogOpen, setBackToLibraryDialogOpen] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const resizeContainerRef = useRef<HTMLDivElement>(null);
    const [isEditMode, setIsEditMode] = useState(true); // View/Edit mode toggle
    const [isDarkTheme, setIsDarkTheme] = useState(false); // Theme toggle
    const defaultQuizQuestions = useMemo(() => buildDefaultQuizQuestions(t), [t]);
    const defaultSelectedAnswers = useMemo(
        () => buildDefaultSelectedAnswers(defaultQuizQuestions),
        [defaultQuizQuestions]
    );
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>(defaultQuizQuestions);
    const [currentQuizQuestionIndex, setCurrentQuizQuestionIndex] = useState(0);
    const [selectedQuizAnswers, setSelectedQuizAnswers] = useState<Record<number, string>>(() => ({
        ...defaultSelectedAnswers,
    }));
    const currentQuizQuestion = quizQuestions[currentQuizQuestionIndex];
    const [outlineTodos, setOutlineTodos] = useState<any[]>([]); // Store todos from outline generation
    // Parametric cost preview for content generation (rates are DB-tunable via
    // ai_tool_pricing). AI_VIDEO-family slides are billed by actual usage.
    const { data: toolPricing, isLoading: toolPricingLoading } = useToolPricingQuery(
        generateCourseAssetsDialogOpen
    );
    const { data: aiCredits } = useAiCreditsQuery(generateCourseAssetsDialogOpen);
    const contentCostPreview = useMemo(() => {
        // Count from the LIVE slides (the user may have deleted some since the
        // outline arrived) — this is the population the generation request
        // converges to, unlike the immutable outlineTodos snapshot.
        const counts = { document: 0, assessment: 0, video: 0, usageBilled: 0 };
        slides.forEach((slide) => {
            const type = slide?.slideType;
            if (type === 'doc') counts.document += 1;
            else if (type === 'quiz' || type === 'assessment') counts.assessment += 1;
            else if (type === 'video' || type === 'video-code') counts.video += 1;
            else if (['ai-video', 'ai-video-code', 'ai-slides', 'ai-storybook'].includes(type))
                counts.usageBilled += 1;
        });
        const perSlide = (key: string) =>
            computeToolCredits(
                toolPricing?.tools.find((t) => t.tool_key === key),
                {}
            );
        const doc = perSlide('course_slide_document');
        const assessment = perSlide('course_slide_assessment');
        const video = perSlide('course_slide_video');
        const credits =
            doc !== null && assessment !== null && video !== null
                ? counts.document * doc + counts.assessment * assessment + counts.video * video
                : null;
        const balance = aiCredits ? parseFloat(aiCredits.current_balance || '0') : null;
        return {
            credits,
            usageBilledSlides: counts.usageBilled,
            sufficient: credits !== null && balance !== null ? balance >= credits : null,
            loading: toolPricingLoading,
        };
    }, [slides, toolPricing, aiCredits, toolPricingLoading]);
    const [isGeneratingContent, setIsGeneratingContent] = useState(false);
    const [isContentGenerated, setIsContentGenerated] = useState(false);
    const [contentGenerationProgress, setContentGenerationProgress] = useState<string>('');
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [roles, setRoles] = useState<string[]>([]);

    // Detect roles on mount
    useEffect(() => {
        // Current institute only — an ADMIN elsewhere is still a TEACHER here.
        setRoles(getRolesForCurrentInstitute());
    }, []);

    const isTeacher = roles.includes('TEACHER') && !roles.includes('ADMIN');
    const isAdmin = roles.includes('ADMIN');

    // Drag and drop sensors
    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

    // getSessionProgress and getSessionsWithProgress are now imported from ./utils/sessionUtils

    // Memoize sessions with progress - ensure it's always an array
    const sessionsWithProgress = useMemo(() => {
        try {
            return getSessionsWithProgress(slides, t);
        } catch (error) {
            console.error('Error getting sessions with progress:', error);
            return [];
        }
    }, [slides, t]);

    // Custom hooks for handlers
    const slideHandlers = useSlideHandlers(slides, setSlides);
    const sessionHandlers = useSessionHandlers(slides, setSlides, sessionsWithProgress);
    const metadataHandlers = useMetadataHandlers(courseMetadata, setCourseMetadata);
    const contentGenerationHandlers = useContentGeneration(
        outlineTodos,
        slides,
        setSlides,
        setIsGeneratingContent,
        setIsContentGenerated,
        setContentGenerationProgress,
        setAbortController
    );

    // Destructure handlers for easier access
    const { handleSlideEdit, handleSlideContentEdit, handleDelete } = slideHandlers;
    const {
        editingSessionId,
        editSessionTitle,
        setEditSessionTitle,
        handleSessionDragEnd,
        handleSessionEdit,
        handleSessionDelete,
        handleStartEdit,
        handleCancelEdit,
        handleSaveEdit,
        handleSlideDragEnd,
    } = sessionHandlers;
    const {
        editingMetadataField,
        metadataEditValues,
        setMetadataEditValues,
        mediaEditMode,
        setMediaEditMode,
        handleEditMetadataField,
        handleCancelMetadataEdit,
        handleSaveMetadataEdit,
    } = metadataHandlers;
    const { handleConfirmGenerateCourseAssets } = contentGenerationHandlers;

    // Course creation hook
    const courseCreationHandlers = useCourseCreation(
        courseMetadata,
        sessionsWithProgress,
        outlineTodos
    );
    const { handleCreateCourse, isCreatingCourse, creationProgress } = courseCreationHandlers;

    // Keep all sessions always expanded - only run once when slides are first loaded
    useEffect(() => {
        if (slides.length > 0 && !isGenerating) {
            const allSessionIds = new Set(slides.map((slide) => slide.sessionId));
            setExpandedSessions((prev) => {
                // Only update if the set actually changed
                const prevArray = Array.from(prev).sort();
                const newArray = Array.from(allSessionIds).sort();
                if (
                    prevArray.length !== newArray.length ||
                    prevArray.some((id, idx) => id !== newArray[idx])
                ) {
                    return allSessionIds;
                }
                return prev; // Return previous value to prevent re-render
            });
        }
    }, [slides.length, isGenerating]); // Only depend on length and generating status

    // Set cursor to end of textarea when regenerate slide dialog opens
    useEffect(() => {
        if (regenerateSlideDialogOpen && regenerateSlidePromptTextareaRef.current) {
            const textarea = regenerateSlidePromptTextareaRef.current;
            setTimeout(() => {
                textarea.focus();
                const length = textarea.value.length;
                textarea.setSelectionRange(length, length);
            }, 0);
        }
    }, [regenerateSlideDialogOpen]);

    // Set cursor to end of textarea when regenerate session dialog opens
    useEffect(() => {
        if (regenerateSessionDialogOpen && regenerateSessionPromptTextareaRef.current) {
            const textarea = regenerateSessionPromptTextareaRef.current;
            setTimeout(() => {
                textarea.focus();
                const length = textarea.value.length;
                textarea.setSelectionRange(length, length);
            }, 0);
        }
    }, [regenerateSessionDialogOpen]);

    // Set cursor to end of textarea when add slide dialog opens
    useEffect(() => {
        if (addSlideDialogOpen && addSlidePromptTextareaRef.current) {
            const textarea = addSlidePromptTextareaRef.current;
            setTimeout(() => {
                textarea.focus();
                const length = textarea.value.length;
                textarea.setSelectionRange(length, length);
            }, 0);
        }
    }, [addSlideDialogOpen]);

    // Check if all sessions are 100% completed
    const allSessionsCompleted = useMemo(() => {
        if (sessionsWithProgress.length === 0) return false;
        return sessionsWithProgress.every((session) => session.progress === 100);
    }, [sessionsWithProgress]);

    // Check if there are slides that need content generation (pending or not completed)
    const hasSlidesToGenerate = useMemo(() => {
        return slides.some((slide) => {
            // Check if slide needs content generation
            const needsGeneration =
                (slide.slideType === 'doc' ||
                    slide.slideType === 'quiz' ||
                    slide.slideType === 'assessment' ||
                    slide.slideType === 'video' ||
                    slide.slideType === 'ai-video' ||
                    slide.slideType === 'video-code' ||
                    slide.slideType === 'ai-video-code') &&
                (slide.status === 'pending' || slide.status === 'generating' || !slide.content);
            return needsGeneration;
        });
    }, [slides]);

    // Check if all sessions are expanded
    const isAllExpanded = useMemo(() => {
        if (sessionsWithProgress.length === 0) return false;
        return sessionsWithProgress.every((session) => expandedSessions.has(session.sessionId));
    }, [sessionsWithProgress, expandedSessions]);

    // Toggle all sessions expand/collapse
    const handleToggleAllSessions = () => {
        if (isAllExpanded) {
            // Collapse all
            setExpandedSessions(new Set());
        } else {
            // Expand all
            const allSessionIds = new Set(sessionsWithProgress.map((s) => s.sessionId));
            setExpandedSessions(allSessionIds);
        }
    };

    const generateSlidesFromSession = (
        sessionId: string,
        sessionTitle: string,
        learningObjectives: string[],
        topics: Array<{ title: string; duration: string }>,
        hasQuiz: boolean,
        hasHomework: boolean
    ): SlideGeneration[] => {
        const slides: SlideGeneration[] = [];

        // Learning Objectives
        if (learningObjectives.length > 0) {
            slides.push({
                id: `${sessionId}-objectives`,
                sessionId,
                sessionTitle,
                slideTitle: 'Learning objective',
                slideType: 'objectives',
                status: 'pending',
                progress: 0,
            });
        }

        // Topics
        topics.forEach((topic, index) => {
            slides.push({
                id: `${sessionId}-topic-${index}`,
                sessionId,
                sessionTitle,
                slideTitle: `Topic ${index + 1}: ${topic.title}`,
                slideType: 'topic',
                status: 'pending',
                progress: 0,
            });
        });

        // Quiz
        if (hasQuiz) {
            slides.push({
                id: `${sessionId}-quiz`,
                sessionId,
                sessionTitle,
                slideTitle: 'Wrap-Up Quiz',
                slideType: 'quiz',
                status: 'pending',
                progress: 0,
            });
        }

        // Assignment
        if (hasHomework) {
            slides.push({
                id: `${sessionId}-homework`,
                sessionId,
                sessionTitle,
                slideTitle: 'Assignment',
                slideType: 'homework',
                status: 'pending',
                progress: 0,
            });
        }

        // Assignment solution
        if (hasHomework) {
            slides.push({
                id: `${sessionId}-solution`,
                sessionId,
                sessionTitle,
                slideTitle: 'Assignment Solution',
                slideType: 'solution',
                content: DEFAULT_SOLUTION_CODE,
                status: 'pending',
                progress: 0,
            });
        }

        return slides;
    };

    // Initialize slides from course outline (in real app, this would come from route params or state)
    useEffect(() => {
        // Prevent double-execution (React Strict Mode, HMR)
        if (hasStartedGeneration.current) return;
        hasStartedGeneration.current = true;

        const generateCourseOutline = async () => {
            try {
                // Check if we're resuming from a saved draft
                const resumeDraft = sessionStorage.getItem('resumeAiCourseDraft');
                if (resumeDraft) {
                    sessionStorage.removeItem('resumeAiCourseDraft');
                    // A previous course's AI-video settings / reference docs must
                    // not silently apply to a resumed draft (drafts don't carry them).
                    sessionStorage.removeItem('courseVideoSettings');
                    sessionStorage.removeItem('courseReferenceDocIds');
                    try {
                        const draft = JSON.parse(resumeDraft);
                        if (draft.slides?.length > 0) {
                            setSlides(draft.slides);
                            if (draft.courseMetadata) setCourseMetadata(draft.courseMetadata);
                            if (draft.isContentGenerated) setIsContentGenerated(true);
                            setIsGenerating(false);
                            setGenerationProgress('');
                            toast.success(t('toast.draftRestored'));
                            return;
                        }
                    } catch {
                        // Fall through to normal generation
                    }
                }

                // Get courseConfig from sessionStorage (do NOT remove yet — only after success)
                const courseConfigStr = sessionStorage.getItem('courseConfig');
                if (!courseConfigStr) {
                    toast.error(t('toast.courseConfigMissing'));
                    navigate({ to: '/study-library/ai-copilot' });
                    return;
                }

                const courseConfig = JSON.parse(courseConfigStr);

                const instituteId = getInstituteId();
                if (!instituteId) {
                    toast.error(t('toast.instituteIdMissing'));
                    return;
                }

                setGenerationProgress(t('progress.buildingPrompt'));

                // Debug: Log courseConfig structure
                console.log('Course Config:', courseConfig);
                console.log('Course Depth Options:', courseConfig.courseDepthOptions);
                console.log('Course Depth:', courseConfig.courseDepth);

                // Build user prompt from courseConfig - simple comma-separated format
                let userPrompt = courseConfig.prompt || courseConfig.courseGoal || '';

                // Build array of additional requirements to append
                const requirements: string[] = [];

                // Add learning outcome if provided
                if (courseConfig.learningOutcome) {
                    requirements.push(courseConfig.learningOutcome);
                }

                // Add learner profile info
                if (courseConfig.learnerProfile?.ageRange) {
                    requirements.push(`target age range ${courseConfig.learnerProfile.ageRange}`);
                }
                if (courseConfig.learnerProfile?.skillLevel) {
                    requirements.push(`skill level ${courseConfig.learnerProfile.skillLevel}`);
                }

                // Add course depth options (check both courseDepthOptions and courseDepth for compatibility)
                const depthOptions =
                    courseConfig.courseDepthOptions || courseConfig.courseDepth || {};

                if (depthOptions.includeDiagrams) {
                    requirements.push('include diagrams');
                }
                if (depthOptions.includeCodeSnippets) {
                    requirements.push('include code snippets');
                    if (depthOptions.programmingLanguage) {
                        requirements.push(
                            `programming language ${depthOptions.programmingLanguage}`
                        );
                    }
                }
                if (depthOptions.includePracticeProblems) {
                    requirements.push('include practice problems');
                }
                if (depthOptions.includeYouTubeVideo) {
                    requirements.push('include videos');
                }
                if (depthOptions.includeAIGeneratedVideo) {
                    requirements.push('include AI generated videos');
                }
                if (depthOptions.includeAISlides) {
                    requirements.push('include AI slides');
                }
                if (depthOptions.includeAIStorybook) {
                    requirements.push('include AI storybook');
                }

                // Add language requirement
                if (courseConfig.language && courseConfig.language !== 'English') {
                    requirements.push(`generate all content in ${courseConfig.language} language`);
                }

                // Add duration and format info
                if (courseConfig.durationFormatStructure?.includeQuizzes) {
                    requirements.push('include assessment');
                }
                if (courseConfig.durationFormatStructure?.includeHomework) {
                    requirements.push('include homework');
                }
                if (courseConfig.durationFormatStructure?.includeSolutions) {
                    requirements.push('include solutions');
                }

                // Append all requirements as comma-separated list
                if (requirements.length > 0) {
                    userPrompt += ', ' + requirements.join(', ');
                }

                // Append reference URLs so the AI can use them as context
                const refUrls = courseConfig.references?.urls?.filter((u: string) => u);
                if (refUrls && refUrls.length > 0) {
                    userPrompt +=
                        '\n\nYou can use the following reference URLs for context:\n' +
                        refUrls.map((u: string) => `- ${u}`).join('\n');
                }

                // Debug: Log final user prompt
                console.log('Final user_prompt:', userPrompt);

                // Build API payload
                const numChapters = courseConfig.durationFormatStructure?.numberOfSessions;
                const topicsPerSession = courseConfig.durationFormatStructure?.topicsPerSession;
                const courseLength = courseConfig.durationFormatStructure?.sessionLength;
                // Calculate total slides: slides per chapter * number of chapters
                const totalSlides =
                    numChapters && topicsPerSession
                        ? parseInt(numChapters) * parseInt(topicsPerSession)
                        : null;

                // Calculate estimated time: number of chapters * number of slides * 10 seconds
                const estimatedSeconds =
                    numChapters && topicsPerSession
                        ? parseInt(numChapters) * parseInt(topicsPerSession) * 10
                        : 30;
                // Set estimated time before starting generation
                if (estimatedSeconds > 0) {
                    setEstimatedTimeRemaining(estimatedSeconds);
                }

                const courseLanguage = courseConfig.language || 'English';

                const payload: any = {
                    user_prompt: userPrompt,
                    course_tree: null,
                    course_depth: 3, // Course -> Chapter -> Slide (as per user's requirement: sessions = chapters, topics = slides)
                    generation_options: {
                        generate_images: true,
                        image_style: 'professional',
                        language: courseLanguage,
                    },
                };

                // Store language for content generation step
                sessionStorage.setItem('courseLanguage', courseLanguage);

                // Store AI-video settings for the content generation step —
                // courseConfig itself is removed from sessionStorage once the
                // outline succeeds, so these must survive separately (same
                // pattern as courseLanguage above). ALWAYS write-or-remove so a
                // previous course's settings can never leak into this run.
                if (courseConfig.aiVideoSettings) {
                    sessionStorage.setItem(
                        'courseVideoSettings',
                        JSON.stringify(courseConfig.aiVideoSettings)
                    );
                } else {
                    sessionStorage.removeItem('courseVideoSettings');
                }

                // Course-structure options (quiz placement, chapter deliverables,
                // figures policy) chosen in the wizard.
                const courseStructure = courseConfig.courseStructure || {};
                if (courseStructure.quizPlacement) {
                    payload.generation_options.quiz_placement = courseStructure.quizPlacement;
                }
                if (typeof courseStructure.includeChapterAssignment === 'boolean') {
                    payload.generation_options.include_assignment =
                        courseStructure.includeChapterAssignment;
                }
                if (courseStructure.includeChapterVideo) {
                    payload.generation_options.include_chapter_video = true;
                }
                // Figures policy must survive to the content step.
                if (courseStructure.figuresPolicy) {
                    sessionStorage.setItem('courseFiguresPolicy', courseStructure.figuresPolicy);
                } else {
                    sessionStorage.removeItem('courseFiguresPolicy');
                }
                // Repetition-dedupe second pass (content step) — write-or-remove.
                if (courseStructure.dedupeRepetition) {
                    sessionStorage.setItem('courseDedupeRepetition', '1');
                } else {
                    sessionStorage.removeItem('courseDedupeRepetition');
                }

                // Course-wide document content-type enrichments — must survive
                // to the content step (same write-or-remove discipline).
                // When quizzes are consolidated per chapter (or disabled), strip
                // the per-slide 'quiz' enrichment so it can't double up.
                let effectiveContentTypes: string[] = Array.isArray(
                    courseConfig.documentContentTypes
                )
                    ? courseConfig.documentContentTypes
                    : [];
                if (
                    courseStructure.quizPlacement === 'CHAPTER' ||
                    courseStructure.quizPlacement === 'NONE'
                ) {
                    effectiveContentTypes = effectiveContentTypes.filter((t) => t !== 'quiz');
                } else if (
                    courseStructure.quizPlacement === 'BOTH' &&
                    !effectiveContentTypes.includes('quiz')
                ) {
                    // BOTH explicitly asks for per-topic quizzes too — make sure
                    // the per-slide quiz enrichment is actually on. (PER_TOPIC is
                    // the default placement; there the 'quiz' chip stays
                    // authoritative so untouched wizards keep legacy behaviour.)
                    effectiveContentTypes = [...effectiveContentTypes, 'quiz'];
                }
                if (effectiveContentTypes.length > 0) {
                    sessionStorage.setItem(
                        'courseDocumentContentTypes',
                        JSON.stringify(effectiveContentTypes)
                    );
                } else {
                    sessionStorage.removeItem('courseDocumentContentTypes');
                }

                // The model chosen in course creation must reach DOCUMENT content
                // generation too (not just the outline). 'auto' → absent → the
                // server picks the strong HTML default (claude-sonnet-5).
                if (courseConfig.model && courseConfig.model !== 'auto') {
                    sessionStorage.setItem('courseSelectedModel', courseConfig.model);
                } else {
                    sessionStorage.removeItem('courseSelectedModel');
                }

                // Reference-PDF fileIds must survive to the content step too
                // (figure embedding). Same write-or-remove discipline.
                if (
                    Array.isArray(courseConfig.referenceDocumentFileIds) &&
                    courseConfig.referenceDocumentFileIds.length > 0
                ) {
                    payload.reference_document_file_ids = courseConfig.referenceDocumentFileIds;
                    sessionStorage.setItem(
                        'courseReferenceDocIds',
                        JSON.stringify(courseConfig.referenceDocumentFileIds)
                    );
                } else {
                    sessionStorage.removeItem('courseReferenceDocIds');
                }

                // Knowledge-base grounding must reach BOTH passes: the outline
                // uses the topic tree, the content pass retrieves per slide.
                if (courseConfig.kbGrounding?.knowledge_base_id) {
                    payload.kb_grounding = courseConfig.kbGrounding;
                    sessionStorage.setItem(
                        'courseKbGrounding',
                        JSON.stringify(courseConfig.kbGrounding)
                    );
                } else {
                    sessionStorage.removeItem('courseKbGrounding');
                }

                // A knowledge base decides the course's shape: never send
                // chapter / slide counts for a KB-grounded course (the server
                // ignores them as well). Prompt-only courses keep the controls.
                const kbBound = !!courseConfig.kbGrounding?.knowledge_base_id;
                if (!kbBound && numChapters) {
                    payload.generation_options.num_chapters = parseInt(numChapters);
                }
                if (!kbBound && totalSlides) {
                    payload.generation_options.num_slides = totalSlides;
                }
                if (courseLength) {
                    // Convert course length to number (it can be a string like '45', '60', '90' or custom value)
                    const courseTiming = parseInt(courseLength);
                    if (!isNaN(courseTiming)) {
                        payload.generation_options.course_timing = courseTiming;
                    }
                }

                console.log('=== API Request ===');
                const queryParams = new URLSearchParams({
                    institute_id: instituteId!,
                    user_id: courseConfig.userId ?? '',
                    model: courseConfig.model || 'auto',
                });
                const apiUrl = `${AI_SERVICE_BASE_URL}/course/ai/v1/generate?${queryParams.toString()}`;

                console.log('URL:', apiUrl);
                console.log('Payload:', JSON.stringify(payload, null, 2));

                setGenerationProgress(t('progress.connecting'));

                // Make SSE API call
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });

                console.log('Response Status:', response.status, response.statusText);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('=== API Error ===');
                    console.error('Status:', response.status);
                    console.error('Status Text:', response.statusText);
                    console.error('Error Body:', errorText);
                    // 402 = institute AI credits insufficient — surface the
                    // backend detail as a clean message, not a raw HTTP dump
                    if (response.status === 402) {
                        let detail = '';
                        try {
                            detail = JSON.parse(errorText)?.detail || '';
                        } catch {
                            /* non-JSON body */
                        }
                        throw new Error(detail || t('toast.insufficientCredits'));
                    }
                    throw new Error(
                        `HTTP ${response.status}: ${response.statusText}. ${errorText}`
                    );
                }

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();

                if (!reader) {
                    throw new Error('No response body');
                }

                setGenerationProgress(t('progress.generatingOutline'));

                // Read SSE stream
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    buffer += chunk;
                    const lines = buffer.split('\n');

                    // Keep the last incomplete line in the buffer
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        // Handle both "data: " and "data:" formats
                        let data = '';
                        if (line.startsWith('data: ')) {
                            data = line.slice(6);
                        } else if (line.startsWith('data:')) {
                            data = line.slice(5);
                        } else {
                            continue;
                        }
                        data = data.trim();

                        // Check if it's a progress message
                        if (data.startsWith('[Generating...]')) {
                            const progressMsg = data.replace('[Generating...]', '').trim();
                            setGenerationProgress(progressMsg);
                        }
                        // Check if it's JSON (final response or error)
                        else if (data.startsWith('{')) {
                            try {
                                const jsonData = JSON.parse(data);

                                // Check for error events from SSE stream
                                if (jsonData.type === 'ERROR') {
                                    throw new Error(
                                        jsonData.message ||
                                            `Server error (code: ${jsonData.code || 'unknown'})`
                                    );
                                }

                                console.log('=== API Response Received ===');
                                console.log('Full Response:', jsonData);
                                console.log('Course Metadata:', jsonData.courseMetadata);
                                console.log('Tree:', jsonData.tree);

                                // Validate response structure
                                if (!jsonData.tree || !Array.isArray(jsonData.tree)) {
                                    console.error('Invalid API response structure:', jsonData);
                                    throw new Error(
                                        'Invalid response structure: missing or invalid tree'
                                    );
                                }

                                // Store course metadata (with fallback for missing fields)
                                const metadata = {
                                    ...jsonData.courseMetadata,
                                    // Fallback for mediaImageUrl if not provided by API
                                    mediaImageUrl:
                                        jsonData.courseMetadata?.mediaImageUrl ||
                                        jsonData.courseMetadata?.bannerImageUrl ||
                                        jsonData.courseMetadata?.previewImageUrl,
                                    // Include level from courseConfig (skillLevel is the levelId)
                                    level: courseConfig.learnerProfile?.skillLevel || '',
                                };
                                setCourseMetadata(metadata);
                                console.log('Course Metadata Set:', metadata);

                                // Store todos for later use in content generation
                                if (jsonData.todos && Array.isArray(jsonData.todos)) {
                                    setOutlineTodos(jsonData.todos);
                                    console.log(
                                        'Stored todos for content generation:',
                                        jsonData.todos.length
                                    );
                                }

                                // Transform API response to slides format
                                const generatedSlides = transformApiResponseToSlides(
                                    jsonData,
                                    courseConfig
                                );
                                console.log('Generated Slides Count:', generatedSlides.length);

                                if (generatedSlides.length === 0) {
                                    console.warn('No slides generated from API response');
                                }

                                setSlides(generatedSlides);

                                // Pre-expand all sessions
                                const allSessionIds = new Set(
                                    generatedSlides.map((slide: SlideGeneration) => slide.sessionId)
                                );
                                setExpandedSessions(allSessionIds);

                                // Stop countdown and hide loader immediately when data arrives
                                setIsGenerating(false);
                                setEstimatedTimeRemaining(0);
                                setGenerationProgress(t('progress.complete'));

                                // Only clear sessionStorage after successful load
                                sessionStorage.removeItem('courseConfig');
                            } catch (e) {
                                console.error('=== Error Processing Response ===');
                                console.error('Error:', e);
                                console.error('Raw data:', data);
                                setIsGenerating(false);
                                toast.error(
                                    `${e instanceof Error ? e.message : t('common.unknownError')}`,
                                    {
                                        duration: 8000,
                                    }
                                );
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('=== Error Generating Course Outline ===');
                console.error('Error:', error);
                if (error instanceof Error) {
                    console.error('Error Message:', error.message);
                    console.error('Error Stack:', error.stack);
                }
                // Preserve any partial data that may have already been set
                setIsGenerating(false);
                toast.error(
                    t('toast.generateOutlineFailed', {
                        message:
                            error instanceof Error ? error.message : t('common.unknownError'),
                    }),
                    { duration: 8000 }
                );
            }
        };

        generateCourseOutline();
    }, []); // Empty dependency array ensures this only runs once on mount

    // Transform API response to slides format using tree for hierarchy and todos for content
    const transformApiResponseToSlides = (
        apiResponse: any,
        courseConfig: any
    ): SlideGeneration[] => {
        const slides: SlideGeneration[] = [];
        const tree = apiResponse.tree;
        const todos = apiResponse.todos;

        if (!tree || tree.length === 0) {
            console.warn('No tree found in API response');
            return slides;
        }

        if (!todos || todos.length === 0) {
            console.warn('No todos found in API response');
            return slides;
        }

        console.log('Processing tree and todos');
        console.log('Tree:', tree);
        console.log('Todos:', todos);

        const courseNode = tree[0]; // Root course node
        const courseDepth = apiResponse.courseMetadata?.course_depth || 3;

        console.log('Course depth:', courseDepth);

        // Extract chapters based on depth
        let chapters: any[] = [];

        if (courseDepth === 5) {
            // Course → Subject → Module → Chapter → Slide
            const subjects = courseNode.children || [];
            subjects.forEach((subject: any) => {
                const modules = subject.children || [];
                modules.forEach((module: any) => {
                    const moduleChapters = module.children || [];
                    chapters.push(...moduleChapters);
                });
            });
        } else if (courseDepth === 4) {
            // Course → Module → Chapter → Slide
            const modules = courseNode.children || [];
            modules.forEach((module: any) => {
                const moduleChapters = module.children || [];
                chapters.push(...moduleChapters);
            });
        } else {
            // Course → Chapter → Slide (depth 3 or less)
            chapters = courseNode.children || [];
        }

        console.log('Extracted chapters:', chapters);

        // Group todos by chapter_name for mapping
        const todosByChapter = new Map<string, any[]>();
        todos.forEach((todo: any) => {
            const chapterName = todo.chapter_name || 'Uncategorized';
            if (!todosByChapter.has(chapterName)) {
                todosByChapter.set(chapterName, []);
            }
            todosByChapter.get(chapterName)!.push(todo);
        });

        console.log('Todos grouped by chapter:', Array.from(todosByChapter.entries()));

        // Create slides from chapters and their todos
        chapters.forEach((chapter: any, chapterIndex: number) => {
            const sessionId = `session-${chapterIndex + 1}`;
            const sessionTitle = chapter.title;

            // Get todos for this chapter
            const chapterTodos = todosByChapter.get(sessionTitle) || [];

            // Sort todos by order
            chapterTodos.sort((a, b) => (a.order || 0) - (b.order || 0));

            console.log(`Chapter "${sessionTitle}" has ${chapterTodos.length} todos`);

            // Create slides from todos
            chapterTodos.forEach((todo: any, todoIndex: number) => {
                // Map todo type to slide type
                let slideType: SlideType = 'doc';
                if (todo.type === 'DOCUMENT') {
                    slideType = 'doc';
                } else if (todo.type === 'VIDEO') {
                    slideType = 'video';
                } else if (todo.type === 'AI_VIDEO') {
                    slideType = 'ai-video';
                } else if (todo.type === 'AI_SLIDES') {
                    slideType = 'ai-slides';
                } else if (todo.type === 'AI_STORYBOOK') {
                    slideType = 'ai-storybook';
                } else if (todo.type === 'VIDEO_CODE') {
                    slideType = 'video-code';
                } else if (todo.type === 'AI_VIDEO_CODE') {
                    slideType = 'ai-video-code';
                } else if (todo.type === 'QUIZ' || todo.type === 'ASSESSMENT') {
                    slideType = 'quiz';
                }

                console.log(
                    `Creating slide for todo: ${todo.title}, type: ${todo.type}, slideType: ${slideType}`
                );

                slides.push({
                    id: `${sessionId}-slide-${todoIndex + 1}`,
                    sessionId,
                    sessionTitle,
                    slideTitle: todo.title || todo.name,
                    slideType,
                    status: 'pending', // Set to pending initially for content generation
                    progress: 0,
                    content:
                        todo.prompt ||
                        `<h2>${todo.title || todo.name}</h2><p>${t('defaultContent.noPromptAvailable')}</p>`, // Show the prompt in content
                    topicIndex: todoIndex,
                    prompt:
                        todo.prompt ||
                        t('defaultContent.contentFor', { title: todo.title || todo.name }), // Keep prompt in prompt field too
                });
            });
        });

        console.log('Generated slides:', slides.length);
        return slides;
    };

    // Helper function to check if a document slide has an image
    const documentHasImage = (content?: string): boolean => {
        if (!content) return false;
        // Check for img tags or mermaid diagrams (which are converted to images)
        return (
            content.includes('<img') ||
            content.includes('mermaid.ink') ||
            content.includes('graph') ||
            content.includes('flowchart') ||
            content.includes('sequenceDiagram') ||
            content.includes('classDiagram')
        );
    };

    const handleRegenerate = (slideId: string, section?: 'video' | 'code') => {
        const slide = slides.find((s) => s.id === slideId);
        if (!slide) return;

        // Store which section is being regenerated
        setRegeneratingSection(section);

        // Check if this is a document with image or video type
        // Proceed directly to regenerate dialog - no limitations on generating page
        setRegeneratingSlideId(slideId);
        setRegenerateSlideDialogOpen(true);
    };

    const handleConfirmRegenerateSlide = () => {
        if (!regenerateSlidePrompt.trim() || !regeneratingSlideId) {
            return;
        }
        setRegenerateSlideDialogOpen(false);

        // Update slide to generating status and increment regeneration count
        setSlides((prev) =>
            prev.map((slide) => {
                if (slide.id === regeneratingSlideId) {
                    const currentCount = slide.regenerationCount || 0;
                    return {
                        ...slide,
                        status: 'generating',
                        progress: 0,
                        regenerationCount: currentCount + 1,
                    };
                }
                return slide;
            })
        );

        // TODO: Call API to regenerate slide based on the prompt
        // For now, simulate regeneration
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 20;
            if (progress >= 100) {
                progress = 100;
                clearInterval(progressInterval);
                setSlides((prev) =>
                    prev.map((slide) =>
                        slide.id === regeneratingSlideId
                            ? { ...slide, status: 'completed', progress: 100 }
                            : slide
                    )
                );
                setRegenerateSlidePrompt('');
                setRegeneratingSlideId(null);
            } else {
                setSlides((prev) =>
                    prev.map((slide) =>
                        slide.id === regeneratingSlideId
                            ? { ...slide, progress: Math.round(progress) }
                            : slide
                    )
                );
            }
        }, 150);
    };

    const handleRegenerateSession = (sessionId: string) => {
        const session = sessionsWithProgress.find((s) => s.sessionId === sessionId);
        if (!session) return;

        setRegeneratingSessionId(sessionId);

        // Extract slide titles from slides (slides with type 'topic' or titles starting with 'Topic')
        const slideTitles = extractSlideTitlesFromSlides(session.slides);

        // Pre-fill prompt with a default based on chapter data
        const defaultPrompt = `${t('regeneratePrompt.base', { chapter: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase(), title: session.sessionTitle })}${slideTitles.length > 0 ? t('regeneratePrompt.withSlides', { slides: getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides).toLowerCase(), titles: slideTitles.join(', ') }) : t('regeneratePrompt.noSlides')}`;
        setRegenerateSessionPrompt(defaultPrompt);

        // Default chapter length (we don't have duration info in SessionProgress)
        setRegenerateSessionLength('60');
        setRegenerateCustomSessionLength('');

        // Pre-fill session components based on slide types
        const hasQuiz = session.slides.some((s) => s.slideType === 'quiz');
        const hasHomework = session.slides.some((s) => s.slideType === 'homework');
        const hasSolution = session.slides.some((s) => s.slideType === 'solution');

        // Check for code-related slides
        const hasCodeSlides = session.slides.some(
            (s) =>
                s.slideType === 'code-editor' ||
                s.slideType === 'video-code-editor' ||
                s.slideType === 'jupyter' ||
                s.slideType === 'video-jupyter'
        );

        setRegenerateIncludeDiagrams(false); // Not directly detectable from slides
        setRegenerateIncludeCodeSnippets(hasCodeSlides);
        setRegenerateIncludePracticeProblems(false); // Not directly detectable
        setRegenerateIncludeQuizzes(hasQuiz);
        setRegenerateIncludeHomework(hasHomework);
        setRegenerateIncludeSolutions(hasSolution || hasHomework);

        // Pre-fill slides from session slides
        setRegenerateSessionTopics(slideTitles);

        // Pre-fill number of slides
        setRegenerateSessionNumberOfTopics(slideTitles.length.toString());

        setRegenerateSessionDialogOpen(true);
    };

    const handleConfirmRegenerateSession = () => {
        if (!regenerateSessionPrompt.trim() || !regeneratingSessionId) {
            return;
        }
        setRegenerateSessionDialogOpen(false);

        // Update all slides in the session to generating status
        setSlides((prev) =>
            prev.map((slide) =>
                slide.sessionId === regeneratingSessionId
                    ? { ...slide, status: 'generating', progress: 0 }
                    : slide
            )
        );

        // TODO: Call API to regenerate session based on the prompt
        // For now, simulate regeneration
        const sessionSlides = slides.filter((s) => s.sessionId === regeneratingSessionId);
        let completedCount = 0;
        const totalSlides = sessionSlides.length;

        const progressInterval = setInterval(() => {
            completedCount += Math.random() * 2;
            if (completedCount >= totalSlides) {
                completedCount = totalSlides;
                clearInterval(progressInterval);
                setSlides((prev) =>
                    prev.map((slide) =>
                        slide.sessionId === regeneratingSessionId
                            ? { ...slide, status: 'completed', progress: 100 }
                            : slide
                    )
                );
                setRegenerateSessionPrompt('');
                setRegeneratingSessionId(null);
                setRegenerateSessionTopics([]);
                setRegenerateSessionNumberOfTopics('');
            } else {
                const progress = Math.round((completedCount / totalSlides) * 100);
                setSlides((prev) =>
                    prev.map((slide) => {
                        if (slide.sessionId === regeneratingSessionId) {
                            if (
                                completedCount >=
                                prev
                                    .filter((s) => s.sessionId === regeneratingSessionId)
                                    .indexOf(slide) +
                                    1
                            ) {
                                return { ...slide, status: 'completed', progress: 100 };
                            } else {
                                return { ...slide, status: 'generating', progress };
                            }
                        }
                        return slide;
                    })
                );
            }
        }, 200);
    };

    const handleRegenerateSessionLengthChange = (value: string) => {
        setRegenerateSessionLength(value);
        if (value !== 'custom') {
            setRegenerateCustomSessionLength('');
        }
    };

    const handleAddSlide = (sessionId: string) => {
        setAddingSlideToSessionId(sessionId);
        setSelectedAddSlideType(null);
        setAddSlidePrompt('');
        setAddSlideDialogOpen(true);
    };

    const handleSelectAddSlideType = (slideType: SlideType) => {
        setSelectedAddSlideType(slideType);
        // Set cursor to end of textarea when slide type is selected
        setTimeout(() => {
            if (addSlidePromptTextareaRef.current) {
                addSlidePromptTextareaRef.current.focus();
                const length = addSlidePromptTextareaRef.current.value.length;
                addSlidePromptTextareaRef.current.setSelectionRange(length, length);
            }
        }, 0);
    };

    const handleConfirmAddSlide = () => {
        if (!addSlidePrompt.trim() || !addingSlideToSessionId || !selectedAddSlideType) {
            return;
        }
        setAddSlideDialogOpen(false);

        const session = sessionsWithProgress.find((s) => s.sessionId === addingSlideToSessionId);
        if (!session) return;

        // Create new slide
        const newSlideId = `slide-${Date.now()}`;
        const newSlide: SlideGeneration = {
            id: newSlideId,
            sessionId: addingSlideToSessionId,
            sessionTitle: session.sessionTitle,
            slideTitle: 'New Page',
            slideType: selectedAddSlideType,
            status: 'generating',
            progress: 0,
        };

        setSlides((prev) => {
            // Remove placeholder slides from this session when adding a real slide
            const withoutPlaceholders = prev.filter(
                (s) => !(s.sessionId === addingSlideToSessionId && s.slideTitle === '_placeholder_')
            );
            return [...withoutPlaceholders, newSlide];
        });

        // TODO: Call API to generate slide based on the prompt
        // For now, simulate generation
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 20;
            if (progress >= 100) {
                progress = 100;
                clearInterval(progressInterval);
                setSlides((prev) =>
                    prev.map((slide) =>
                        slide.id === newSlideId
                            ? { ...slide, status: 'completed', progress: 100 }
                            : slide
                    )
                );
                setAddSlidePrompt('');
                setAddingSlideToSessionId(null);
                setSelectedAddSlideType(null);
            } else {
                setSlides((prev) =>
                    prev.map((slide) =>
                        slide.id === newSlideId
                            ? { ...slide, progress: Math.round(progress) }
                            : slide
                    )
                );
            }
        }, 150);
    };

    const handleAddSession = () => {
        // Reset form fields
        setAddSessionName('');
        setAddSessionDialogOpen(true);
    };

    const handleConfirmAddSession = () => {
        if (!addSessionName.trim()) {
            return;
        }
        setAddSessionDialogOpen(false);

        // Create new chapter with the provided name
        const newSessionId = `session-${Date.now()}`;
        const newSessionTitle = addSessionName.trim();

        // Create a placeholder slide so the chapter appears in the list
        // This slide acts as a marker for the session
        const placeholderSlide: SlideGeneration = {
            id: `${newSessionId}-placeholder-${Date.now()}`,
            sessionId: newSessionId,
            sessionTitle: newSessionTitle,
            slideTitle: '_placeholder_',
            slideType: 'doc',
            status: 'completed',
            progress: 100,
            content: '',
            prompt: '',
        };

        // Add the placeholder slide
        setSlides((prev) => [...prev, placeholderSlide]);

        // Reset the form
        setAddSessionName('');

        // Expand the new session so user can add pages
        setExpandedSessions((prev) => new Set([...prev, newSessionId]));
    };

    const handleView = (slideId: string) => {
        const slide = slides.find((s) => s.id === slideId);
        if (slide) {
            setViewingSlide(slide);
            // Initialize content based on slide type
            // Use stored content if available, otherwise use default/sample content
            if (slide.slideType === 'objectives' || slide.slideType === 'doc') {
                // For learning objectives, use stored content or show sample generated content
                if (slide.content) {
                    setDocumentContent(slide.content);
                } else {
                    // Sample generated content - in real app, this would come from AI generation
                    setDocumentContent(`<h2>${t('defaultContent.learningObjectivesTitle')}</h2>
<ul>
<li>${t('defaultContent.learningObjectiveItem1')}</li>
<li>${t('defaultContent.learningObjectiveItem2')}</li>
<li>${t('defaultContent.learningObjectiveItem3')}</li>
</ul>
<p>${t('defaultContent.learningObjectivesFooter')}</p>`);
                }
            } else if (
                slide.slideType === 'topic' ||
                slide.slideType === 'video-code-editor' ||
                slide.slideType === 'video-jupyter' ||
                slide.slideType === 'video-scratch'
            ) {
                setCodeContent(slide.content || '// Start writing your code here');
            } else if (
                slide.slideType === 'code-editor' ||
                slide.slideType === 'jupyter' ||
                slide.slideType === 'scratch' ||
                slide.slideType === 'solution'
            ) {
                if (slide.slideType === 'solution') {
                    setCodeContent(slide.content || DEFAULT_SOLUTION_CODE);
                } else {
                    setCodeContent(slide.content || '// Start writing your code here');
                }
            } else if (slide.slideType === 'homework' || slide.slideType === 'assignment') {
                setHomeworkQuestion(t('defaultContent.homeworkQuestion'));
                setHomeworkAnswer(slide.content || '');
                setHomeworkAnswerType('text');
            } else if (slide.slideType === 'quiz') {
                if (slide.content) {
                    try {
                        const parsed = JSON.parse(slide.content);
                        if (Array.isArray(parsed.questions)) {
                            setQuizQuestions(parsed.questions);
                            setSelectedQuizAnswers(
                                parsed.answers && Object.keys(parsed.answers).length > 0
                                    ? parsed.answers
                                    : { ...defaultSelectedAnswers }
                            );
                        } else if (Array.isArray(parsed)) {
                            setQuizQuestions(parsed);
                            setSelectedQuizAnswers({ ...defaultSelectedAnswers });
                        } else {
                            setQuizQuestions(defaultQuizQuestions);
                            setSelectedQuizAnswers(defaultSelectedAnswers);
                        }
                    } catch (error) {
                        console.error('Failed to parse quiz content:', error);
                        setQuizQuestions(defaultQuizQuestions);
                        setSelectedQuizAnswers({ ...defaultSelectedAnswers });
                    }
                } else {
                    setQuizQuestions(defaultQuizQuestions);
                    setSelectedQuizAnswers({ ...defaultSelectedAnswers });
                }
                setCurrentQuizQuestionIndex(0);
            }
        }
    };

    const handleSaveSlideContent = () => {
        if (!viewingSlide) return;

        // Save content based on slide type
        setSlides((prev) =>
            prev.map((slide) => {
                if (slide.id === viewingSlide.id) {
                    let contentToSave = '';
                    if (slide.slideType === 'objectives' || slide.slideType === 'doc') {
                        contentToSave = documentContent;
                    } else if (
                        slide.slideType === 'topic' ||
                        slide.slideType === 'video-code-editor' ||
                        slide.slideType === 'video-jupyter' ||
                        slide.slideType === 'video-scratch'
                    ) {
                        contentToSave = codeContent;
                    } else if (
                        slide.slideType === 'code-editor' ||
                        slide.slideType === 'jupyter' ||
                        slide.slideType === 'scratch' ||
                        slide.slideType === 'solution'
                    ) {
                        contentToSave = codeContent;
                    } else if (slide.slideType === 'homework' || slide.slideType === 'assignment') {
                        contentToSave = homeworkAnswer;
                    } else if (slide.slideType === 'quiz') {
                        contentToSave = JSON.stringify({
                            questions: quizQuestions,
                            answers: selectedQuizAnswers,
                        });
                    }
                    return { ...slide, content: contentToSave };
                }
                return slide;
            })
        );
        // TODO: Call API to save the content
    };

    const handleQuizAnswerChange = (value: string) => {
        setSelectedQuizAnswers((prev) => ({
            ...prev,
            [currentQuizQuestionIndex]: value,
        }));
    };

    const handleQuizNavigation = (direction: 'prev' | 'next') => {
        if (direction === 'prev' && currentQuizQuestionIndex > 0) {
            setCurrentQuizQuestionIndex((prev) => prev - 1);
        } else if (direction === 'next' && currentQuizQuestionIndex < quizQuestions.length - 1) {
            setCurrentQuizQuestionIndex((prev) => prev + 1);
        }
    };

    // Handle resize start
    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    };

    // Handle resize move
    useEffect(() => {
        const handleResizeMove = (e: MouseEvent) => {
            if (!isResizing || !resizeContainerRef.current) return;

            const container = resizeContainerRef.current;
            const containerRect = container.getBoundingClientRect();
            const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

            // Constrain between 20% and 80%
            const constrainedWidth = Math.max(20, Math.min(80, newWidth));
            setCodeEditorWidth(constrainedWidth);
        };

        const handleResizeEnd = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleResizeMove);
            document.addEventListener('mouseup', handleResizeEnd);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleResizeMove);
            document.removeEventListener('mouseup', handleResizeEnd);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    // Handle Run button click
    const handleRunCode = () => {
        // TODO: Implement code execution
        console.log('Running code:', codeContent);
    };

    // Handle Copy Code
    const handleCopyCode = async () => {
        try {
            await navigator.clipboard.writeText(codeContent);
            // TODO: Show toast notification
            console.log('Code copied to clipboard');
        } catch (err) {
            console.error('Failed to copy code:', err);
        }
    };

    // Handle Download Code
    const handleDownloadCode = () => {
        const blob = new Blob([codeContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'code.js';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const getSlideIcon = (type: SlideType) => SLIDE_ICON_MAP[type] ?? null;

    // ---- Leave-during-generation guard -------------------------------------
    // Generation is driven entirely from this page (the outline call and the
    // per-page content stream both live in this component), so any navigation
    // away kills it and the pages produced so far are unrecoverable. Guard
    // every exit route: the in-page Back button, in-app navigation, browser
    // back/forward, and refresh/tab-close.
    const isBusyGenerating = (isGenerating && slides.length === 0) || isGeneratingContent;

    // Set just before an intentional leave so the blocker lets that one
    // navigation through instead of re-prompting.
    const bypassLeaveGuardRef = useRef(false);
    const [leaveWarningOpen, setLeaveWarningOpen] = useState(false);

    const leaveBlocker = useBlocker({
        withResolver: true,
        disabled: !isBusyGenerating,
        shouldBlockFn: ({ current, next }) =>
            !bypassLeaveGuardRef.current && current.pathname !== next.pathname,
        enableBeforeUnload: isBusyGenerating,
    });

    const leaveGuardOpen = leaveBlocker.status === 'blocked' || leaveWarningOpen;

    const handleStayOnPage = () => {
        setLeaveWarningOpen(false);
        leaveBlocker.reset?.();
    };

    const handleLeaveWhileGenerating = () => {
        bypassLeaveGuardRef.current = true;
        abortController?.abort();
        setAbortController(null);
        setIsGeneratingContent(false);
        setLeaveWarningOpen(false);
        if (leaveBlocker.status === 'blocked') {
            leaveBlocker.proceed?.();
        } else {
            navigate({ to: '/study-library/ai-copilot' });
        }
    };

    const generationProgressLabel = useMemo(() => {
        if (!isGeneratingContent) return undefined;
        const real = slides.filter((s: SlideGeneration) => s.slideTitle !== '_placeholder_');
        if (real.length === 0) return undefined;
        return t('progress.completedOfTotal', {
            completed: real.filter((s: SlideGeneration) => s.status === 'completed').length,
            total: real.length,
        });
    }, [isGeneratingContent, slides, t]);

    const handleBack = () => {
        if (isBusyGenerating) {
            setLeaveWarningOpen(true);
            return;
        }
        setBackToLibraryDialogOpen(true);
    };

    const handleDiscardCourse = () => {
        setBackToLibraryDialogOpen(false);
        navigate({ to: '/study-library/ai-copilot' });
    };

    const handleSaveToDrafts = () => {
        // Save current course state so it can be resumed in the same view
        const parsedConfig = JSON.parse(sessionStorage.getItem('courseConfig') || 'null');
        const draftTitle =
            courseMetadata?.courseTitle ||
            parsedConfig?.courseGoal?.substring(0, 60) ||
            sessionsWithProgress?.[0]?.sessionTitle ||
            '';
        const draftData = {
            slides,
            courseMetadata,
            isContentGenerated,
            draftTitle,
            courseConfig: parsedConfig,
            timestamp: new Date().toISOString(),
        };
        localStorage.setItem('aiCourseDraft', JSON.stringify(draftData));
        toast.success(t('toast.courseDraftSaved'));
        setBackToLibraryDialogOpen(false);
        navigate({ to: '/study-library/ai-copilot' });
    };

    // Countdown timer for estimated time
    useEffect(() => {
        if (!isGenerating || slides.length > 0 || estimatedTimeRemaining <= 0) {
            return;
        }

        const timer = setInterval(() => {
            setEstimatedTimeRemaining((prev) => {
                if (prev <= 1) {
                    // Don't go to 0 — keep at -1 to signal "still working"
                    return -1;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [isGenerating, slides.length, estimatedTimeRemaining]);

    // Loading state - show AI generating loader
    if (isGenerating && slides.length === 0) {
        return (
            <LayoutContainer>
                <Helmet>
                    <title>
                        {t('page.generatingOutlineTitle', {
                            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                        })}
                    </title>
                </Helmet>
                <OutlineGeneratingLoader estimatedTimeRemaining={estimatedTimeRemaining} />
                <LeaveDuringGenerationDialog
                    open={leaveGuardOpen}
                    onOpenChange={(open) => !open && handleStayOnPage()}
                    onStay={handleStayOnPage}
                    onLeave={handleLeaveWhileGenerating}
                />
            </LayoutContainer>
        );
    }

    // Split view - show when generating content or content is generated
    if (isGeneratingContent || isContentGenerated) {
        return (
            <LayoutContainer>
                <Helmet>
                    <title>
                        {isGeneratingContent
                            ? t('page.generatingContentTitle')
                            : t('page.editCourseContentTitle')}
                    </title>
                    <meta name="description" content={t('page.editContentMeta')} />
                </Helmet>
                <SplitViewLayout
                    sessionsWithProgress={sessionsWithProgress}
                    slides={slides}
                    courseMetadata={courseMetadata}
                    isGeneratingContent={isGeneratingContent}
                    isContentGenerated={isContentGenerated}
                    contentGenerationProgress={contentGenerationProgress}
                    isCreatingCourse={isCreatingCourse}
                    isTeacher={isTeacher}
                    isAdmin={isAdmin}
                    onBack={handleBack}
                    onSlideContentChange={handleSlideContentEdit}
                    onSlideSave={(slideId) => {
                        // Content is auto-saved via onSlideContentChange
                        console.log('Slide saved:', slideId);
                    }}
                    onMetadataSave={(metadata) => {
                        setCourseMetadata((prev: any) => ({ ...prev, ...metadata }));
                    }}
                    onCreateCourse={handleCreateCourse}
                    onGenerateContent={() => setGenerateCourseAssetsDialogOpen(true)}
                />
                {/* Keep dialogs available */}
                <GenerateCourseAssetsDialog
                    open={generateCourseAssetsDialogOpen}
                    onOpenChange={setGenerateCourseAssetsDialogOpen}
                    onConfirm={
                        isContentGenerated
                            ? () => handleCreateCourse('ACTIVE')
                            : handleConfirmGenerateCourseAssets
                    }
                    costPreview={isContentGenerated ? undefined : contentCostPreview}
                />
                <BackToLibraryDialog
                    open={backToLibraryDialogOpen}
                    onOpenChange={setBackToLibraryDialogOpen}
                    onDiscard={handleDiscardCourse}
                    onSaveToDrafts={handleSaveToDrafts}
                />
                <LeaveDuringGenerationDialog
                    open={leaveGuardOpen}
                    onOpenChange={(open) => !open && handleStayOnPage()}
                    onStay={handleStayOnPage}
                    onLeave={handleLeaveWhileGenerating}
                    progressLabel={generationProgressLabel}
                />
            </LayoutContainer>
        );
    }

    return (
        <LayoutContainer>
            <Helmet>
                <title>
                    {t('page.reviewOutlineTitle', {
                        course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                    })}
                </title>
                <meta name="description" content={t('page.reviewOutlineMeta')} />
            </Helmet>
            <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50">
                <div className="mx-auto max-w-[1600px] px-3 py-4 sm:p-6 lg:px-8">
                    {/* Header */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="mb-6"
                    >
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <button
                                onClick={handleBack}
                                className="flex items-center gap-2 self-start text-sm font-medium text-neutral-600 transition-colors hover:text-indigo-600"
                            >
                                <ArrowLeft className="size-4" />
                                <span className="hidden sm:inline">
                                    {t('page.backToCreate', {
                                        course: getTerminology(
                                            ContentTerms.Course,
                                            SystemTerms.Course
                                        ),
                                    })}
                                </span>
                                <span className="sm:hidden">{t('page.back')}</span>
                            </button>

                            {/* Action Buttons - Top Right */}
                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                {isGeneratingContent ? (
                                    <MyButton
                                        buttonType="primary"
                                        disabled
                                        className="min-w-[140px]"
                                    >
                                        <Loader2 className="mr-1 size-4 animate-spin" />
                                        {t('page.generatingButton')}
                                    </MyButton>
                                ) : isContentGenerated ? (
                                    <MyButton
                                        buttonType="primary"
                                        onClick={() =>
                                            isAdmin
                                                ? setGenerateCourseAssetsDialogOpen(true)
                                                : handleCreateCourse('DRAFT')
                                        }
                                        disabled={isCreatingCourse}
                                        className="min-w-[180px]"
                                    >
                                        {isCreatingCourse ? (
                                            <Loader2 className="mr-1 size-4 animate-spin" />
                                        ) : (
                                            <CheckCircle className="mr-1 size-4" />
                                        )}
                                        {isAdmin
                                            ? t('page.createCourse', {
                                                  course: getTerminology(
                                                      ContentTerms.Course,
                                                      SystemTerms.Course
                                                  ),
                                              })
                                            : t('page.createDraftCourse', {
                                                  course: getTerminology(
                                                      ContentTerms.Course,
                                                      SystemTerms.Course
                                                  ),
                                              })}
                                    </MyButton>
                                ) : (
                                    <MyButton
                                        buttonType="primary"
                                        onClick={() => {
                                            setGenerateCourseAssetsDialogOpen(true);
                                        }}
                                        disabled={
                                            isGeneratingContent ||
                                            isCreatingCourse ||
                                            (!hasSlidesToGenerate && !allSessionsCompleted)
                                        }
                                        className="min-w-[180px]"
                                    >
                                        <Sparkles className="mr-1 size-4" />
                                        {t('page.generatePageContent')}
                                    </MyButton>
                                )}
                            </div>
                        </div>

                        <div>
                            <h1 className="mb-2 text-xl font-semibold text-neutral-900 sm:text-2xl lg:text-3xl">
                                {t('page.stepReviewHeading', {
                                    course: getTerminology(
                                        ContentTerms.Course,
                                        SystemTerms.Course
                                    ),
                                })}
                            </h1>
                            <p className="text-sm text-gray-600 sm:text-base">
                                {t('page.stepReviewSubtitle')}
                            </p>
                        </div>
                    </motion.div>

                    {/* Two Column Layout - Sessions List & Metadata */}
                    <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1fr_400px]">
                        {/* Left Column - Sessions List */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="min-w-0 overflow-hidden rounded-xl bg-white p-3 shadow-md sm:p-6"
                        >
                            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 sm:text-2xl">
                                    <Layers className="size-5 text-indigo-600 sm:size-6" />
                                    {isContentGenerated
                                        ? t('page.contentHeading', {
                                              course: getTerminology(
                                                  ContentTerms.Course,
                                                  SystemTerms.Course
                                              ),
                                          })
                                        : t('page.outlineHeading', {
                                              course: getTerminology(
                                                  ContentTerms.Course,
                                                  SystemTerms.Course
                                              ),
                                          })}
                                </h2>
                                <div className="flex gap-2">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={handleToggleAllSessions}
                                    >
                                        {isAllExpanded ? (
                                            <>
                                                <ChevronsUp className="size-3" />
                                                {t('page.collapseAll')}
                                            </>
                                        ) : (
                                            <>
                                                <ChevronsDown className="size-3" />
                                                {t('page.expandAll')}
                                            </>
                                        )}
                                    </MyButton>
                                </div>
                            </div>

                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleSessionDragEnd}
                            >
                                <SortableContext
                                    items={
                                        Array.isArray(sessionsWithProgress) &&
                                        sessionsWithProgress.length > 0
                                            ? sessionsWithProgress.map((s) => s.sessionId)
                                            : []
                                    }
                                    strategy={verticalListSortingStrategy}
                                >
                                    {!Array.isArray(sessionsWithProgress) ||
                                    sessionsWithProgress.length === 0 ? (
                                        <div className="py-8 text-center text-neutral-500">
                                            <span>{t('page.noSessions')}</span>
                                        </div>
                                    ) : (
                                        <Accordion
                                            type="multiple"
                                            value={Array.from(expandedSessions)}
                                            onValueChange={(value) =>
                                                setExpandedSessions(new Set(value))
                                            }
                                            className="w-full"
                                        >
                                            {sessionsWithProgress.map((session, sessionIndex) => (
                                                <SortableSessionItem
                                                    key={session.sessionId}
                                                    session={session}
                                                    sessionIndex={sessionIndex}
                                                    onEdit={handleSessionEdit}
                                                    onDelete={handleSessionDelete}
                                                    onRegenerate={handleRegenerateSession}
                                                    editingSessionId={editingSessionId}
                                                    editSessionTitle={editSessionTitle}
                                                    onStartEdit={handleStartEdit}
                                                    onCancelEdit={handleCancelEdit}
                                                    onSaveEdit={handleSaveEdit}
                                                    setEditSessionTitle={setEditSessionTitle}
                                                >
                                                    <AccordionContent className="pb-4 pt-0">
                                                        <div className="ml-4 sm:ml-11">
                                                            <DndContext
                                                                sensors={sensors}
                                                                collisionDetection={closestCenter}
                                                                onDragEnd={(event) =>
                                                                    handleSlideDragEnd(
                                                                        event,
                                                                        session.sessionId
                                                                    )
                                                                }
                                                            >
                                                                <SortableContext
                                                                    items={session.slides
                                                                        .filter(
                                                                            (s) =>
                                                                                s.slideTitle !==
                                                                                '_placeholder_'
                                                                        )
                                                                        .map((s) => s.id)}
                                                                    strategy={
                                                                        verticalListSortingStrategy
                                                                    }
                                                                >
                                                                    <div className="space-y-2">
                                                                        {session.slides
                                                                            .filter(
                                                                                (slide) =>
                                                                                    slide.slideTitle !==
                                                                                    '_placeholder_'
                                                                            )
                                                                            .map((slide) => (
                                                                                <SortableSlideItem
                                                                                    key={slide.id}
                                                                                    slide={slide}
                                                                                    onEdit={
                                                                                        handleSlideEdit
                                                                                    }
                                                                                    onDelete={
                                                                                        handleDelete
                                                                                    }
                                                                                    getSlideIcon={
                                                                                        getSlideIcon
                                                                                    }
                                                                                    onRegenerate={
                                                                                        handleRegenerate
                                                                                    }
                                                                                    onContentEdit={
                                                                                        handleSlideContentEdit
                                                                                    }
                                                                                    isOutlineMode={
                                                                                        !isContentGenerated
                                                                                    }
                                                                                />
                                                                            ))}
                                                                        {/* Add Page Button */}
                                                                        <button
                                                                            className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                                                                            onClick={() => {
                                                                                setAddingSlideToSessionId(
                                                                                    session.sessionId
                                                                                );
                                                                                setAddSlideDialogOpen(
                                                                                    true
                                                                                );
                                                                            }}
                                                                        >
                                                                            <Plus className="size-4" />
                                                                            {t('page.addPage')}
                                                                        </button>
                                                                    </div>
                                                                </SortableContext>
                                                            </DndContext>
                                                        </div>
                                                    </AccordionContent>
                                                </SortableSessionItem>
                                            ))}
                                        </Accordion>
                                    )}
                                </SortableContext>
                            </DndContext>

                            {/* Add Chapter Button */}
                            <button
                                onClick={handleAddSession}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <Plus className="size-4" />
                                {t('page.addChapter', {
                                    chapter: getTerminology(
                                        ContentTerms.Chapters,
                                        SystemTerms.Chapters
                                    ),
                                })}
                            </button>
                        </motion.div>

                        {/* Right Column - Course Metadata */}
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className="space-y-4"
                        >
                            {/* Course Name - only show after API response */}
                            {courseMetadata?.course_name && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.courseName')}
                                        </label>
                                        <div className="flex gap-2">
                                            {editingMetadataField !== 'course_name' && (
                                                <button
                                                    onClick={() =>
                                                        handleEditMetadataField(
                                                            'course_name',
                                                            courseMetadata.course_name
                                                        )
                                                    }
                                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                    title={t('common.edit')}
                                                >
                                                    <Pencil className="size-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {editingMetadataField === 'course_name' ? (
                                        <div className="space-y-2">
                                            <Input
                                                value={metadataEditValues.course_name || ''}
                                                onChange={(e) =>
                                                    setMetadataEditValues({
                                                        course_name: e.target.value,
                                                    })
                                                }
                                                className="text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="small"
                                                    onClick={() =>
                                                        handleSaveMetadataEdit('course_name')
                                                    }
                                                >
                                                    {t('common.save')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={handleCancelMetadataEdit}
                                                >
                                                    {t('common.cancel')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-neutral-900">
                                            {courseMetadata.course_name}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Description - only show after API response */}
                            {courseMetadata?.about_the_course_html && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.description')}
                                        </label>
                                        <div className="flex gap-2">
                                            {editingMetadataField !== 'description' && (
                                                <button
                                                    onClick={() => {
                                                        const shortDescription = extractSentences(
                                                            courseMetadata.about_the_course_html,
                                                            3
                                                        );
                                                        handleEditMetadataField(
                                                            'description',
                                                            courseMetadata.description ||
                                                                shortDescription
                                                        );
                                                    }}
                                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                    title={t('common.edit')}
                                                >
                                                    <Pencil className="size-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {editingMetadataField === 'description' ? (
                                        <div className="space-y-2">
                                            <Textarea
                                                value={metadataEditValues.description || ''}
                                                onChange={(e) =>
                                                    setMetadataEditValues({
                                                        description: e.target.value,
                                                    })
                                                }
                                                className="min-h-[80px] text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="small"
                                                    onClick={() =>
                                                        handleSaveMetadataEdit('description')
                                                    }
                                                >
                                                    {t('common.save')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={handleCancelMetadataEdit}
                                                >
                                                    {t('common.cancel')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-neutral-700">
                                            {courseMetadata.description ||
                                                extractSentences(
                                                    courseMetadata.about_the_course_html,
                                                    3
                                                )}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Level */}
                            {courseMetadata && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.level')}
                                        </label>
                                    </div>
                                    <Select
                                        value={courseMetadata.level || ''}
                                        onValueChange={(value) => {
                                            setCourseMetadata((prev: any) => ({
                                                ...prev,
                                                level: value,
                                            }));
                                        }}
                                    >
                                        <SelectTrigger className="w-full text-sm">
                                            <SelectValue placeholder={t('metadata.selectLevel')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {instituteLevels.length > 0 ? (
                                                instituteLevels.map((level: any) => (
                                                    <SelectItem key={level.id} value={level.id}>
                                                        {level.level_name}
                                                    </SelectItem>
                                                ))
                                            ) : (
                                                <>
                                                    <SelectItem value="Beginner">
                                                        {t('metadata.levelBeginner')}
                                                    </SelectItem>
                                                    <SelectItem value="Basic">
                                                        {t('metadata.levelBasic')}
                                                    </SelectItem>
                                                    <SelectItem value="Intermediate">
                                                        {t('metadata.levelIntermediate')}
                                                    </SelectItem>
                                                    <SelectItem value="Advanced">
                                                        {t('metadata.levelAdvanced')}
                                                    </SelectItem>
                                                </>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Course Tags */}
                            {courseMetadata?.tags && courseMetadata.tags.length > 0 && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.courseTags')}
                                        </label>
                                        <div className="flex gap-2">
                                            {editingMetadataField !== 'tags' && (
                                                <button
                                                    onClick={() =>
                                                        handleEditMetadataField(
                                                            'tags',
                                                            courseMetadata.tags.join(', ')
                                                        )
                                                    }
                                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                    title={t('common.edit')}
                                                >
                                                    <Pencil className="size-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {editingMetadataField === 'tags' ? (
                                        <div className="space-y-2">
                                            <Textarea
                                                value={metadataEditValues.tags || ''}
                                                onChange={(e) =>
                                                    setMetadataEditValues({ tags: e.target.value })
                                                }
                                                placeholder={t('metadata.tagsPlaceholder')}
                                                className="min-h-[60px] text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="small"
                                                    onClick={() => {
                                                        const tags = metadataEditValues.tags
                                                            .split(',')
                                                            .map((tag: string) => tag.trim())
                                                            .filter((tag: string) => tag);
                                                        setCourseMetadata((prev: any) => ({
                                                            ...prev,
                                                            tags,
                                                        }));
                                                        handleSaveMetadataEdit('tags');
                                                    }}
                                                >
                                                    {t('common.save')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={handleCancelMetadataEdit}
                                                >
                                                    {t('common.cancel')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {courseMetadata.tags.map(
                                                (tag: string, index: number) => (
                                                    <span
                                                        key={index}
                                                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                                                    >
                                                        <Tag className="size-3" />
                                                        {tag}
                                                    </span>
                                                )
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Course Preview Image */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.coursePreviewImage')}
                                        </label>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            {t('metadata.coursePreviewImageHint')}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {courseMetadata?.previewImageUrl ? (
                                        <div className="relative">
                                            <div className="aspect-[16/9] w-full overflow-hidden rounded-lg">
                                                <img
                                                    src={courseMetadata.previewImageUrl}
                                                    alt={t('metadata.coursePreviewAlt')}
                                                    className="size-full object-cover"
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setCourseMetadata((prev: any) => ({
                                                        ...prev,
                                                        previewImageUrl: null,
                                                    }));
                                                }}
                                                className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                                                title={t('metadata.removeImage')}
                                            >
                                                <X className="size-3" />
                                            </button>
                                            <div className="mt-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                    <Upload className="size-3" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url =
                                                                    URL.createObjectURL(file);
                                                                setCourseMetadata((prev: any) => ({
                                                                    ...prev,
                                                                    previewImageUrl: url,
                                                                }));
                                                            }
                                                        }}
                                                    />
                                                    {t('common.upload')}
                                                </label>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50">
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        const url = URL.createObjectURL(file);
                                                        setCourseMetadata((prev: any) => ({
                                                            ...prev,
                                                            previewImageUrl: url,
                                                        }));
                                                    }
                                                }}
                                            />
                                            <ImageIcon className="mb-2 size-8 text-neutral-400" />
                                            <span className="text-sm font-medium text-neutral-600">
                                                {t('metadata.clickToUploadPreview')}
                                            </span>
                                            <span className="mt-1 text-xs text-neutral-500">
                                                {t('metadata.thumbnailForCard')}
                                            </span>
                                        </label>
                                    )}
                                </div>
                            </div>

                            {/* Course Banner Image */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.courseBannerImage')}
                                        </label>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            {t('metadata.courseBannerHint')}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {courseMetadata?.bannerImageUrl ? (
                                        <div className="relative">
                                            <div className="aspect-[16/9] w-full overflow-hidden rounded-lg">
                                                <img
                                                    src={courseMetadata.bannerImageUrl}
                                                    alt={t('metadata.courseBannerAlt')}
                                                    className="size-full object-cover"
                                                />
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setCourseMetadata((prev: any) => ({
                                                        ...prev,
                                                        bannerImageUrl: null,
                                                    }));
                                                }}
                                                className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                                                title={t('metadata.removeImage')}
                                            >
                                                <X className="size-3" />
                                            </button>
                                            <div className="mt-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                    <Upload className="size-3" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url =
                                                                    URL.createObjectURL(file);
                                                                setCourseMetadata((prev: any) => ({
                                                                    ...prev,
                                                                    bannerImageUrl: url,
                                                                }));
                                                            }
                                                        }}
                                                    />
                                                    {t('common.upload')}
                                                </label>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50">
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) {
                                                        const url = URL.createObjectURL(file);
                                                        setCourseMetadata((prev: any) => ({
                                                            ...prev,
                                                            bannerImageUrl: url,
                                                        }));
                                                    }
                                                }}
                                            />
                                            <ImageIcon className="mb-2 size-8 text-neutral-400" />
                                            <span className="text-sm font-medium text-neutral-600">
                                                {t('metadata.clickToUploadBanner')}
                                            </span>
                                            <span className="mt-1 text-xs text-neutral-500">
                                                {t('metadata.wideHeaderHint')}
                                            </span>
                                        </label>
                                    )}
                                </div>
                            </div>

                            {/* Course Media */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.courseMedia')}
                                        </label>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            {t('metadata.courseMediaHint')}
                                            {!courseMetadata?.courseMedia &&
                                                (courseMetadata?.mediaImageUrl ||
                                                    courseMetadata?.bannerImageUrl ||
                                                    courseMetadata?.previewImageUrl) &&
                                                t('metadata.usingFallbackImage')}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {courseMetadata?.courseMedia ||
                                    courseMetadata?.mediaImageUrl ||
                                    courseMetadata?.bannerImageUrl ||
                                    courseMetadata?.previewImageUrl ? (
                                        <div className="relative">
                                            {courseMetadata?.courseMedia &&
                                            courseMetadata.courseMediaType === 'youtube' ? (
                                                <div className="aspect-[16/9] w-full overflow-hidden rounded-lg">
                                                    <iframe
                                                        src={courseMetadata.courseMedia}
                                                        className="size-full rounded-lg"
                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                        allowFullScreen
                                                    />
                                                </div>
                                            ) : courseMetadata?.courseMedia &&
                                              courseMetadata.courseMediaType === 'video' ? (
                                                <div className="aspect-[16/9] w-full overflow-hidden rounded-lg">
                                                    <video
                                                        src={courseMetadata.courseMedia}
                                                        className="size-full object-cover"
                                                        controls
                                                    />
                                                </div>
                                            ) : (
                                                <div className="aspect-[16/9] w-full overflow-hidden rounded-lg">
                                                    <img
                                                        src={
                                                            courseMetadata?.courseMedia ||
                                                            courseMetadata?.mediaImageUrl ||
                                                            courseMetadata?.bannerImageUrl ||
                                                            courseMetadata?.previewImageUrl
                                                        }
                                                        alt={t('metadata.courseMediaAlt')}
                                                        className="size-full object-cover"
                                                    />
                                                </div>
                                            )}
                                            <button
                                                onClick={() =>
                                                    setCourseMetadata((prev: any) => ({
                                                        ...prev,
                                                        courseMedia: undefined,
                                                        courseMediaType: undefined,
                                                    }))
                                                }
                                                className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                                                title={t('metadata.removeMedia')}
                                            >
                                                <X className="size-3" />
                                            </button>
                                            <div className="mt-2 flex gap-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                    <Upload className="size-3" />
                                                    <input
                                                        type="file"
                                                        accept="image/*,video/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url =
                                                                    URL.createObjectURL(file);
                                                                const type = file.type.startsWith(
                                                                    'video/'
                                                                )
                                                                    ? 'video'
                                                                    : 'image';
                                                                setCourseMetadata((prev: any) => ({
                                                                    ...prev,
                                                                    courseMedia: url,
                                                                    courseMediaType: type,
                                                                }));
                                                            }
                                                        }}
                                                    />
                                                    {t('common.upload')}
                                                </label>
                                                <button
                                                    onClick={() => setMediaEditMode('youtube')}
                                                    className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                                                >
                                                    <Video className="size-3" />
                                                    {t('metadata.youtubeLink')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {mediaEditMode === 'youtube' ? (
                                                <div className="space-y-2">
                                                    <Input
                                                        placeholder={t('metadata.pasteYoutubeUrl')}
                                                        className="text-sm"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const url = (
                                                                    e.target as HTMLInputElement
                                                                ).value;
                                                                if (isYouTubeUrl(url)) {
                                                                    const embedUrl =
                                                                        getYouTubeEmbedUrl(url);
                                                                    if (embedUrl) {
                                                                        setCourseMetadata(
                                                                            (prev: any) => ({
                                                                                ...prev,
                                                                                courseMedia:
                                                                                    embedUrl,
                                                                                courseMediaType:
                                                                                    'youtube',
                                                                            })
                                                                        );
                                                                        setMediaEditMode(null);
                                                                    }
                                                                }
                                                            }
                                                        }}
                                                        autoFocus
                                                    />
                                                    <div className="flex gap-2">
                                                        <MyButton
                                                            buttonType="primary"
                                                            scale="small"
                                                            onClick={(e) => {
                                                                const input = (
                                                                    e.target as HTMLElement
                                                                )
                                                                    .closest('div')
                                                                    ?.querySelector(
                                                                        'input'
                                                                    ) as HTMLInputElement;
                                                                if (input) {
                                                                    const url = input.value;
                                                                    if (isYouTubeUrl(url)) {
                                                                        const embedUrl =
                                                                            getYouTubeEmbedUrl(url);
                                                                        if (embedUrl) {
                                                                            setCourseMetadata(
                                                                                (prev: any) => ({
                                                                                    ...prev,
                                                                                    courseMedia:
                                                                                        embedUrl,
                                                                                    courseMediaType:
                                                                                        'youtube',
                                                                                })
                                                                            );
                                                                            setMediaEditMode(null);
                                                                        }
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {t('common.save')}
                                                        </MyButton>
                                                        <MyButton
                                                            buttonType="secondary"
                                                            scale="small"
                                                            onClick={() => setMediaEditMode(null)}
                                                        >
                                                            {t('common.cancel')}
                                                        </MyButton>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                        <input
                                                            type="file"
                                                            accept="image/*,video/*"
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                const file = e.target.files?.[0];
                                                                if (file) {
                                                                    const url =
                                                                        URL.createObjectURL(file);
                                                                    const type =
                                                                        file.type.startsWith(
                                                                            'video/'
                                                                        )
                                                                            ? 'video'
                                                                            : 'image';
                                                                    setCourseMetadata(
                                                                        (prev: any) => ({
                                                                            ...prev,
                                                                            courseMedia: url,
                                                                            courseMediaType: type,
                                                                        })
                                                                    );
                                                                }
                                                            }}
                                                        />
                                                        <ImageIcon className="size-4" />
                                                        {t('metadata.uploadImageOrVideo')}
                                                    </label>
                                                    <button
                                                        onClick={() => setMediaEditMode('youtube')}
                                                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                                                    >
                                                        <Video className="size-4" />
                                                        {t('metadata.addYoutubeLink')}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* What learners will gain Section */}
                            {courseMetadata?.why_learn_html && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.whatLearnersGain')}
                                        </label>
                                        <div className="flex gap-2">
                                            {editingMetadataField !== 'why_learn_html' && (
                                                <button
                                                    onClick={() =>
                                                        handleEditMetadataField(
                                                            'why_learn_html',
                                                            courseMetadata.why_learn_html
                                                        )
                                                    }
                                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                    title={t('common.edit')}
                                                >
                                                    <Pencil className="size-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {editingMetadataField === 'why_learn_html' ? (
                                        <div className="space-y-2">
                                            <Textarea
                                                value={metadataEditValues.why_learn_html || ''}
                                                onChange={(e) =>
                                                    setMetadataEditValues({
                                                        why_learn_html: e.target.value,
                                                    })
                                                }
                                                className="min-h-[80px] text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="small"
                                                    onClick={() =>
                                                        handleSaveMetadataEdit('why_learn_html')
                                                    }
                                                >
                                                    {t('common.save')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={handleCancelMetadataEdit}
                                                >
                                                    {t('common.cancel')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            className="prose prose-sm max-w-none text-sm text-neutral-700"
                                            dangerouslySetInnerHTML={{
                                                __html: DOMPurify.sanitize(
                                                    courseMetadata.why_learn_html
                                                ),
                                            }}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Who Should Join Section */}
                            {courseMetadata?.who_should_learn_html && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.whoShouldJoin')}
                                        </label>
                                        <div className="flex gap-2">
                                            {editingMetadataField !== 'who_should_learn_html' && (
                                                <button
                                                    onClick={() =>
                                                        handleEditMetadataField(
                                                            'who_should_learn_html',
                                                            courseMetadata.who_should_learn_html
                                                        )
                                                    }
                                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                    title={t('common.edit')}
                                                >
                                                    <Pencil className="size-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {editingMetadataField === 'who_should_learn_html' ? (
                                        <div className="space-y-2">
                                            <Textarea
                                                value={
                                                    metadataEditValues.who_should_learn_html || ''
                                                }
                                                onChange={(e) =>
                                                    setMetadataEditValues({
                                                        who_should_learn_html: e.target.value,
                                                    })
                                                }
                                                className="min-h-[80px] text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="small"
                                                    onClick={() =>
                                                        handleSaveMetadataEdit(
                                                            'who_should_learn_html'
                                                        )
                                                    }
                                                >
                                                    {t('common.save')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={handleCancelMetadataEdit}
                                                >
                                                    {t('common.cancel')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            className="prose prose-sm max-w-none text-sm text-neutral-700"
                                            dangerouslySetInnerHTML={{
                                                __html: DOMPurify.sanitize(
                                                    courseMetadata.who_should_learn_html
                                                ),
                                            }}
                                        />
                                    )}
                                </div>
                            )}

                            {/* About the Course Section */}
                            {courseMetadata?.about_the_course_html && (
                                <div className="rounded-xl bg-white p-4 shadow-md">
                                    <div className="mb-3 flex items-center justify-between">
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('metadata.aboutCourse')}
                                        </label>
                                        <div className="flex gap-2">
                                            {editingMetadataField !== 'about_the_course_html' && (
                                                <button
                                                    onClick={() =>
                                                        handleEditMetadataField(
                                                            'about_the_course_html',
                                                            courseMetadata.about_the_course_html
                                                        )
                                                    }
                                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                    title={t('common.edit')}
                                                >
                                                    <Pencil className="size-3" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {editingMetadataField === 'about_the_course_html' ? (
                                        <div className="space-y-2">
                                            <Textarea
                                                value={
                                                    metadataEditValues.about_the_course_html || ''
                                                }
                                                onChange={(e) =>
                                                    setMetadataEditValues({
                                                        about_the_course_html: e.target.value,
                                                    })
                                                }
                                                className="min-h-[80px] text-sm"
                                            />
                                            <div className="flex gap-2">
                                                <MyButton
                                                    buttonType="primary"
                                                    scale="small"
                                                    onClick={() =>
                                                        handleSaveMetadataEdit(
                                                            'about_the_course_html'
                                                        )
                                                    }
                                                >
                                                    {t('common.save')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={handleCancelMetadataEdit}
                                                >
                                                    {t('common.cancel')}
                                                </MyButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            className="prose prose-sm max-w-none text-sm text-neutral-700"
                                            dangerouslySetInnerHTML={{
                                                __html: DOMPurify.sanitize(
                                                    courseMetadata.about_the_course_html
                                                ),
                                            }}
                                        />
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </div>

                    {/* View Slide Dialog */}
                    <Dialog
                        open={viewingSlide !== null}
                        onOpenChange={(open) => {
                            if (!open) {
                                setViewingSlide(null);
                                setQuizQuestions(defaultQuizQuestions);
                                setSelectedQuizAnswers({ ...defaultSelectedAnswers });
                                setCurrentQuizQuestionIndex(0);
                            }
                        }}
                    >
                        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[95vw] flex-col p-0 sm:w-[80vw] sm:max-w-[80vw]">
                            {viewingSlide && (
                                <>
                                    <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
                                        <DialogTitle>{viewingSlide.slideTitle}</DialogTitle>
                                    </DialogHeader>

                                    <div className="flex-1 overflow-y-auto px-6 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                        {/* Document Slide */}
                                        {(viewingSlide.slideType === 'objectives' ||
                                            viewingSlide.slideType === 'doc') && (
                                            <div>
                                                <HtmlDocField
                                                    value={documentContent}
                                                    onChange={setDocumentContent}
                                                    placeholder={t(
                                                        'slideDialog.enterDocumentContent'
                                                    )}
                                                    minHeight={500}
                                                />
                                            </div>
                                        )}

                                        {/* Video + Code Slide */}
                                        {(viewingSlide.slideType === 'topic' ||
                                            viewingSlide.slideType === 'video-code-editor' ||
                                            viewingSlide.slideType === 'video-jupyter' ||
                                            viewingSlide.slideType === 'video-scratch') && (
                                            <div
                                                ref={resizeContainerRef}
                                                className="relative flex h-[600px] gap-0"
                                            >
                                                {/* Code Editor Section */}
                                                <div
                                                    className="flex shrink-0 flex-col overflow-hidden rounded-l-lg border"
                                                    style={{ width: `${codeEditorWidth}%` }}
                                                >
                                                    {/* Code Editor Header */}
                                                    <div className="flex items-center justify-between gap-4 border-b bg-white px-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                                                                <Code className="size-4" />
                                                                <span>{t('slideDialog.codeEditor')}</span>
                                                            </div>
                                                            <span
                                                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                                                    isEditMode
                                                                        ? 'bg-emerald-100 text-emerald-700'
                                                                        : 'bg-neutral-200 text-neutral-600'
                                                                }`}
                                                            >
                                                                {isEditMode
                                                                    ? t('slideDialog.editMode')
                                                                    : t('slideDialog.viewMode')}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={handleRunCode}
                                                                className="flex items-center gap-2 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
                                                            >
                                                                <Play className="size-4" />
                                                                {t('slideDialog.run')}
                                                            </button>
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <button className="flex items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-neutral-50">
                                                                        <Settings className="size-4" />
                                                                        {t('slideDialog.settings')}
                                                                        <ChevronDown className="size-3" />
                                                                    </button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent
                                                                    className="w-56 bg-white"
                                                                    align="end"
                                                                >
                                                                    {/* View/Edit Mode */}
                                                                    <DropdownMenuCheckboxItem
                                                                        checked={isEditMode}
                                                                        onCheckedChange={(
                                                                            checked
                                                                        ) =>
                                                                            setIsEditMode(!!checked)
                                                                        }
                                                                        className="flex items-center justify-between"
                                                                    >
                                                                        <div className="flex items-center gap-2">
                                                                            <Eye className="size-4" />
                                                                            <span>
                                                                                {t(
                                                                                    'slideDialog.viewEditMode'
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        {isEditMode && (
                                                                            <div className="flex items-center gap-1">
                                                                                <div className="flex h-5 w-9 items-center rounded-full bg-emerald-500 px-1">
                                                                                    <div className="size-3.5 rounded-full bg-white shadow-sm" />
                                                                                </div>
                                                                                <Pencil className="size-3 text-neutral-600" />
                                                                            </div>
                                                                        )}
                                                                    </DropdownMenuCheckboxItem>

                                                                    <DropdownMenuSeparator />

                                                                    {/* Switch Theme */}
                                                                    <DropdownMenuItem
                                                                        onClick={() =>
                                                                            setIsDarkTheme(
                                                                                (prev) => !prev
                                                                            )
                                                                        }
                                                                        className="flex items-center gap-2"
                                                                    >
                                                                        <Sun className="size-4" />
                                                                        <span>
                                                                            {isDarkTheme
                                                                                ? t(
                                                                                      'slideDialog.switchToLightTheme'
                                                                                  )
                                                                                : t(
                                                                                      'slideDialog.switchToDarkTheme'
                                                                                  )}
                                                                        </span>
                                                                    </DropdownMenuItem>

                                                                    <DropdownMenuSeparator />

                                                                    {/* Copy Code */}
                                                                    <DropdownMenuItem
                                                                        onClick={handleCopyCode}
                                                                        className="flex items-center gap-2"
                                                                    >
                                                                        <Copy className="size-4" />
                                                                        <span>
                                                                            {t(
                                                                                'slideDialog.copyCode'
                                                                            )}
                                                                        </span>
                                                                    </DropdownMenuItem>

                                                                    {/* Download Code */}
                                                                    <DropdownMenuItem
                                                                        onClick={handleDownloadCode}
                                                                        className="flex items-center gap-2"
                                                                    >
                                                                        <Download className="size-4" />
                                                                        <span>
                                                                            {t(
                                                                                'slideDialog.downloadCode'
                                                                            )}
                                                                        </span>
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                    </div>
                                                    <Editor
                                                        height="calc(100% - 60px)"
                                                        language="javascript"
                                                        value={codeContent}
                                                        onChange={(value) =>
                                                            setCodeContent(value || '')
                                                        }
                                                        theme={isDarkTheme ? 'vs-dark' : 'light'}
                                                        options={{
                                                            minimap: { enabled: false },
                                                            fontSize: 14,
                                                            lineNumbers: 'on',
                                                            scrollBeyondLastLine: false,
                                                            automaticLayout: true,
                                                            readOnly: !isEditMode,
                                                        }}
                                                    />
                                                </div>

                                                {/* Resize Divider */}
                                                <div
                                                    className="group relative w-1 shrink-0 cursor-col-resize bg-neutral-300 transition-colors hover:bg-indigo-500"
                                                    onMouseDown={handleResizeStart}
                                                    style={{
                                                        cursor: isResizing
                                                            ? 'col-resize'
                                                            : 'col-resize',
                                                    }}
                                                >
                                                    <div className="absolute inset-y-0 left-1/2 flex w-8 -translate-x-1/2 items-center justify-center">
                                                        <div className="h-12 w-1 rounded-full bg-neutral-400 transition-colors group-hover:bg-indigo-500" />
                                                    </div>
                                                </div>

                                                {/* Video Section */}
                                                <div
                                                    className="flex shrink-0 items-center justify-center overflow-hidden rounded-r-lg border bg-black"
                                                    style={{ width: `${100 - codeEditorWidth}%` }}
                                                >
                                                    <div className="flex size-full items-center justify-center bg-black">
                                                        <div className="px-6 text-center text-white">
                                                            <Video className="mx-auto mb-2 size-16 opacity-50" />
                                                            <p className="text-sm opacity-75">
                                                                {t('slideDialog.videoPlayer')}
                                                            </p>
                                                            <p className="mt-2 text-xs opacity-50">
                                                                {t('slideDialog.videoWillDisplay')}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Quiz Slide */}
                                        {viewingSlide.slideType === 'quiz' && (
                                            <div className="space-y-6">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="flex-1">
                                                        <Label className="text-base font-semibold">
                                                            {t('slideDialog.question')}
                                                        </Label>
                                                        <p className="mt-2 text-neutral-700">
                                                            {currentQuizQuestion?.question ??
                                                                t(
                                                                    'slideDialog.noQuestionAvailable'
                                                                )}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() =>
                                                                handleQuizNavigation('prev')
                                                            }
                                                            disabled={
                                                                currentQuizQuestionIndex === 0
                                                            }
                                                            className="flex size-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-600 transition-colors hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                            aria-label={t(
                                                                'slideDialog.previousQuestion'
                                                            )}
                                                        >
                                                            <ChevronLeft className="size-4" />
                                                        </button>
                                                        <span className="text-sm font-medium text-neutral-600">
                                                            {currentQuizQuestionIndex + 1}/
                                                            {quizQuestions.length}
                                                        </span>
                                                        <button
                                                            onClick={() =>
                                                                handleQuizNavigation('next')
                                                            }
                                                            disabled={
                                                                quizQuestions.length === 0 ||
                                                                currentQuizQuestionIndex ===
                                                                    quizQuestions.length - 1
                                                            }
                                                            className="flex size-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-600 transition-colors hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                            aria-label={t(
                                                                'slideDialog.nextQuestion'
                                                            )}
                                                        >
                                                            <ChevronRight className="size-4" />
                                                        </button>
                                                    </div>
                                                </div>

                                                {quizQuestions.length > 0 && currentQuizQuestion ? (
                                                    <RadioGroup
                                                        value={
                                                            selectedQuizAnswers[
                                                                currentQuizQuestionIndex
                                                            ] ?? ''
                                                        }
                                                        onValueChange={handleQuizAnswerChange}
                                                        className="space-y-3"
                                                    >
                                                        {currentQuizQuestion.options.map(
                                                            (option, optionIndex) => {
                                                                const value =
                                                                    optionIndex.toString();
                                                                const selected =
                                                                    selectedQuizAnswers[
                                                                        currentQuizQuestionIndex
                                                                    ] === value;
                                                                const isCorrect =
                                                                    currentQuizQuestion.correctAnswerIndex?.toString() ===
                                                                    value;
                                                                const highlightClass = selected
                                                                    ? isCorrect
                                                                        ? 'border-emerald-300 bg-emerald-50'
                                                                        : 'border-indigo-300 bg-indigo-50'
                                                                    : 'border-neutral-200 hover:border-emerald-200 hover:bg-emerald-50/40';

                                                                return (
                                                                    <div
                                                                        key={value}
                                                                        className={`flex items-center space-x-2 rounded-lg border p-3 transition-colors ${highlightClass}`}
                                                                    >
                                                                        <RadioGroupItem
                                                                            value={value}
                                                                            id={`quiz-${currentQuizQuestionIndex}-${optionIndex}`}
                                                                        />
                                                                        <Label
                                                                            htmlFor={`quiz-${currentQuizQuestionIndex}-${optionIndex}`}
                                                                            className="flex-1 cursor-pointer"
                                                                        >
                                                                            {option}
                                                                        </Label>
                                                                        {selected && isCorrect && (
                                                                            <CheckCircle className="size-5 text-emerald-500" />
                                                                        )}
                                                                    </div>
                                                                );
                                                            }
                                                        )}
                                                    </RadioGroup>
                                                ) : (
                                                    <p className="text-sm text-neutral-500">
                                                        {t('slideDialog.noQuestionsYet')}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* Homework/Assignment Slide */}
                                        {(viewingSlide.slideType === 'homework' ||
                                            viewingSlide.slideType === 'assignment') && (
                                            <div className="space-y-4">
                                                <div>
                                                    <Label className="text-base font-semibold">
                                                        {t('slideDialog.question')}
                                                    </Label>
                                                    <Textarea
                                                        value={homeworkQuestion}
                                                        onChange={(e) =>
                                                            setHomeworkQuestion(e.target.value)
                                                        }
                                                        placeholder={t(
                                                            'slideDialog.enterAssignmentQuestion'
                                                        )}
                                                        className="mt-2 min-h-[100px]"
                                                    />
                                                </div>
                                                <div>
                                                    <div className="mb-2 flex items-center gap-4">
                                                        <Label className="text-base font-semibold">
                                                            {t('slideDialog.answer')}
                                                        </Label>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() =>
                                                                    setHomeworkAnswerType('text')
                                                                }
                                                                className={`rounded px-3 py-1 text-sm ${
                                                                    homeworkAnswerType === 'text'
                                                                        ? 'bg-indigo-600 text-white'
                                                                        : 'bg-neutral-100 text-neutral-700'
                                                                }`}
                                                            >
                                                                {t('slideDialog.text')}
                                                            </button>
                                                            <button
                                                                onClick={() =>
                                                                    setHomeworkAnswerType('code')
                                                                }
                                                                className={`rounded px-3 py-1 text-sm ${
                                                                    homeworkAnswerType === 'code'
                                                                        ? 'bg-indigo-600 text-white'
                                                                        : 'bg-neutral-100 text-neutral-700'
                                                                }`}
                                                            >
                                                                {t('slideDialog.codeEditor')}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {homeworkAnswerType === 'text' ? (
                                                        <Textarea
                                                            value={homeworkAnswer}
                                                            onChange={(e) =>
                                                                setHomeworkAnswer(e.target.value)
                                                            }
                                                            className="resize-y font-mono text-caption"
                                                            style={{ minHeight: 300 }}
                                                        />
                                                    ) : (
                                                        <div className="overflow-hidden rounded-lg border">
                                                            <Editor
                                                                height="300px"
                                                                language="javascript"
                                                                value={homeworkAnswer}
                                                                onChange={(value) =>
                                                                    setHomeworkAnswer(value || '')
                                                                }
                                                                theme="light"
                                                                options={{
                                                                    minimap: { enabled: false },
                                                                    fontSize: 14,
                                                                    lineNumbers: 'on',
                                                                    scrollBeyondLastLine: false,
                                                                    automaticLayout: true,
                                                                }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Code Editor Slide */}
                                        {(viewingSlide.slideType === 'code-editor' ||
                                            viewingSlide.slideType === 'jupyter' ||
                                            viewingSlide.slideType === 'scratch' ||
                                            viewingSlide.slideType === 'solution') && (
                                            <div className="overflow-hidden rounded-lg border">
                                                <div className="border-b bg-neutral-100 px-4 py-2">
                                                    <span className="text-sm font-medium">
                                                        {viewingSlide.slideType === 'solution'
                                                            ? t('slideDialog.solutionCode')
                                                            : t('slideDialog.codeEditor')}
                                                    </span>
                                                </div>
                                                <Editor
                                                    height="500px"
                                                    language="javascript"
                                                    value={codeContent}
                                                    onChange={(value) =>
                                                        setCodeContent(value || '')
                                                    }
                                                    theme="light"
                                                    options={{
                                                        minimap: { enabled: false },
                                                        fontSize: 14,
                                                        lineNumbers: 'on',
                                                        scrollBeyondLastLine: false,
                                                        automaticLayout: true,
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Fixed Footer */}
                                    <div className="flex shrink-0 justify-end border-t px-6 py-4">
                                        <MyButton
                                            buttonType="primary"
                                            onClick={() => {
                                                handleSaveSlideContent();
                                                setViewingSlide(null);
                                            }}
                                        >
                                            {t('common.save')}
                                        </MyButton>
                                    </div>
                                </>
                            )}
                        </DialogContent>
                    </Dialog>

                    {/* Dialogs */}
                    <RegenerateSlideDialog
                        open={regenerateSlideDialogOpen}
                        onOpenChange={(open) => {
                            setRegenerateSlideDialogOpen(open);
                            if (!open) {
                                setRegenerateSlidePrompt('');
                                setRegeneratingSlideId(null);
                                setRegeneratingSection(undefined);
                            }
                        }}
                        prompt={regenerateSlidePrompt}
                        onPromptChange={setRegenerateSlidePrompt}
                        onConfirm={handleConfirmRegenerateSlide}
                        promptRef={regenerateSlidePromptTextareaRef}
                    />

                    <RegenerateSessionDialog
                        open={regenerateSessionDialogOpen}
                        onOpenChange={(open) => {
                            setRegenerateSessionDialogOpen(open);
                            if (!open) {
                                setRegeneratingSessionId(null);
                            } else if (regeneratingSessionId) {
                                const session = sessionsWithProgress.find(
                                    (s) => s.sessionId === regeneratingSessionId
                                );
                                if (session) {
                                    const slideTitles = extractSlideTitlesFromSlides(
                                        session.slides
                                    );
                                    const defaultPrompt = `${t('regeneratePrompt.base', { chapter: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase(), title: session.sessionTitle })}${slideTitles.length > 0 ? t('regeneratePrompt.withSlides', { slides: getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides).toLowerCase(), titles: slideTitles.join(', ') }) : t('regeneratePrompt.noSlides')}`;
                                    setRegenerateSessionPrompt(defaultPrompt);
                                    setRegenerateSessionTopics(slideTitles);
                                    setRegenerateSessionNumberOfTopics(
                                        slideTitles.length.toString()
                                    );
                                    const hasQuiz = session.slides.some(
                                        (s) => s.slideType === 'quiz'
                                    );
                                    const hasHomework = session.slides.some(
                                        (s) => s.slideType === 'homework'
                                    );
                                    const hasSolution = session.slides.some(
                                        (s) => s.slideType === 'solution'
                                    );
                                    const hasCodeSlides = session.slides.some(
                                        (s) =>
                                            s.slideType === 'code-editor' ||
                                            s.slideType === 'video-code-editor' ||
                                            s.slideType === 'jupyter' ||
                                            s.slideType === 'video-jupyter'
                                    );
                                    setRegenerateIncludeCodeSnippets(hasCodeSlides);
                                    setRegenerateIncludeQuizzes(hasQuiz);
                                    setRegenerateIncludeHomework(hasHomework);
                                    setRegenerateIncludeSolutions(hasSolution || hasHomework);
                                }
                            }
                        }}
                        sessionId={regeneratingSessionId}
                        sessions={sessionsWithProgress}
                        prompt={regenerateSessionPrompt}
                        onPromptChange={setRegenerateSessionPrompt}
                        sessionLength={regenerateSessionLength}
                        onSessionLengthChange={handleRegenerateSessionLengthChange}
                        customSessionLength={regenerateCustomSessionLength}
                        onCustomSessionLengthChange={setRegenerateCustomSessionLength}
                        includeDiagrams={regenerateIncludeDiagrams}
                        onIncludeDiagramsChange={setRegenerateIncludeDiagrams}
                        includeCodeSnippets={regenerateIncludeCodeSnippets}
                        onIncludeCodeSnippetsChange={setRegenerateIncludeCodeSnippets}
                        includePracticeProblems={regenerateIncludePracticeProblems}
                        onIncludePracticeProblemsChange={setRegenerateIncludePracticeProblems}
                        includeQuizzes={regenerateIncludeQuizzes}
                        onIncludeQuizzesChange={setRegenerateIncludeQuizzes}
                        includeHomework={regenerateIncludeHomework}
                        onIncludeHomeworkChange={setRegenerateIncludeHomework}
                        includeSolutions={regenerateIncludeSolutions}
                        onIncludeSolutionsChange={setRegenerateIncludeSolutions}
                        numberOfTopics={regenerateSessionNumberOfTopics}
                        onNumberOfTopicsChange={setRegenerateSessionNumberOfTopics}
                        topics={regenerateSessionTopics}
                        onTopicsChange={setRegenerateSessionTopics}
                        onConfirm={handleConfirmRegenerateSession}
                        promptRef={regenerateSessionPromptTextareaRef}
                    />

                    <AddSlideDialog
                        open={addSlideDialogOpen}
                        onOpenChange={(open) => {
                            setAddSlideDialogOpen(open);
                            if (!open) {
                                setAddSlidePrompt('');
                                setAddingSlideToSessionId(null);
                                setSelectedAddSlideType(null);
                            }
                        }}
                        selectedType={selectedAddSlideType}
                        onSelectType={handleSelectAddSlideType}
                        prompt={addSlidePrompt}
                        onPromptChange={setAddSlidePrompt}
                        onConfirm={handleConfirmAddSlide}
                        onBack={() => {
                            setSelectedAddSlideType(null);
                            setAddSlidePrompt('');
                        }}
                        promptRef={addSlidePromptTextareaRef}
                    />

                    <AddSessionDialog
                        open={addSessionDialogOpen}
                        onOpenChange={(open) => {
                            setAddSessionDialogOpen(open);
                            if (!open) {
                                setAddSessionName('');
                            }
                        }}
                        sessionName={addSessionName}
                        onSessionNameChange={setAddSessionName}
                        onConfirm={handleConfirmAddSession}
                    />

                    <GenerateCourseAssetsDialog
                        open={generateCourseAssetsDialogOpen}
                        onOpenChange={setGenerateCourseAssetsDialogOpen}
                        onConfirm={
                            isContentGenerated
                                ? () => handleCreateCourse('ACTIVE')
                                : handleConfirmGenerateCourseAssets
                        }
                        costPreview={isContentGenerated ? undefined : contentCostPreview}
                    />

                    <BackToLibraryDialog
                        open={backToLibraryDialogOpen}
                        onOpenChange={setBackToLibraryDialogOpen}
                        onDiscard={handleDiscardCourse}
                        onSaveToDrafts={handleSaveToDrafts}
                    />

                    <LeaveDuringGenerationDialog
                        open={leaveGuardOpen}
                        onOpenChange={(open) => !open && handleStayOnPage()}
                        onStay={handleStayOnPage}
                        onLeave={handleLeaveWhileGenerating}
                        progressLabel={generationProgressLabel}
                    />
                </div>
            </div>
        </LayoutContainer>
    );
}
