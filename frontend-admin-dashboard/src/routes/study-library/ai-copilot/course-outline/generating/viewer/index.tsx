import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { MyButton } from '@/components/design-system/button';
import {
    ArrowLeft,
    RefreshCw,
    Trash2,
    FileText,
    Video,
    Code,
    FileQuestion,
    ClipboardList,
    FileCode,
    CheckCircle,
    Loader2,
    Layers,
    BookOpen,
    File,
    Notebook,
    Puzzle,
    GripVertical,
    Edit2,
    X,
    Link,
    Upload,
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
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import Editor from '@monaco-editor/react';
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
import {
    processDocumentContent,
    parseCodeContent,
    cleanQuizContent,
    parseVideoContent,
    parseQuizContent
} from './utils/contentParsers';
import { SortableViewerSlideItem } from './components/SortableViewerSlideItem';
import type {
    SlideType,
    QuizQuestion,
    SlideGeneration,
    SessionProgress,
    SortableSessionItemProps,
    CircularProgressProps
} from '../../../shared/types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Route definition only - component is lazy loaded from index.lazy.tsx
export const Route = createFileRoute('/study-library/ai-copilot/course-outline/generating/viewer/')({
    // Component is defined in index.lazy.tsx
});

// Circular Progress Component
const CircularProgress = ({ value, size = 24, strokeWidth = 3, className = '' }: CircularProgressProps) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (value / 100) * circumference;

    return (
        <div className={`relative ${className}`} style={{ width: size, height: size }}>
            <svg className="transform -rotate-90" width={size} height={size}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    fill="none"
                    className="text-neutral-200"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="text-indigo-600 transition-all duration-300"
                    strokeLinecap="round"
                />
            </svg>
            {value < 100 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-neutral-600">
                    {Math.round(value)}%
                </span>
            )}
        </div>
    );
};

const SortableSessionItem = ({
    session,
    sessionIndex,
    onEdit,
    onDelete,
    onRegenerate,
    editingSessionId,
    editSessionTitle,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    setEditSessionTitle,
    children,
}: SortableSessionItemProps) => {
    const { t } = useTranslation('studyLibraryViewer');
    const isEditing = editingSessionId === session.sessionId;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: session.sessionId });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const handleSaveEdit = () => {
        if (editSessionTitle.trim()) {
            onSaveEdit(session.sessionId);
        }
    };

    const completedCount = session.slides.filter((s) => s.status === 'completed').length;

    return (
        <div ref={setNodeRef} style={style}>
            <AccordionItem
                value={session.sessionId}
                className="border-b border-neutral-200 last:border-b-0"
            >
                <AccordionTrigger className="group py-4 text-left hover:no-underline [&>svg]:hidden">
                    <div className="flex items-center justify-between w-full pr-4">
                        <div className="flex items-center gap-2 flex-1">
                            <button
                                {...attributes}
                                {...listeners}
                                className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <GripVertical className="h-4 w-4" />
                            </button>
                            {isEditing ? (
                                <Input
                                    value={editSessionTitle}
                                    onChange={(e) => setEditSessionTitle(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveEdit();
                                        if (e.key === 'Escape') onCancelEdit();
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-7 text-sm flex-1"
                                    autoFocus
                                />
                            ) : (
                                <h3 className="text-base font-semibold text-neutral-900">
                                    {getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)} {sessionIndex + 1}: {session.sessionTitle}
                                </h3>
                            )}
                        </div>
                        <div className="flex items-center gap-4">
                            {!isEditing && (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onStartEdit(session.sessionId, session.sessionTitle);
                                        }}
                                        className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('actions.edit')}
                                    >
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(session.sessionId);
                                        }}
                                        className="rounded p-1 text-xs text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('actions.delete')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                            {isEditing && (
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleSaveEdit();
                                        }}
                                        className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                        title={t('actions.save')}
                                    >
                                        <CheckCircle className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCancelEdit();
                                        }}
                                        className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                        title={t('actions.cancel')}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                            <div className="text-xs text-neutral-500">
                                {t('pagesProgress', {
                                    completed: completedCount,
                                    total: session.slides.length,
                                    count: session.slides.length,
                                })}
                            </div>
                            {session.progress < 100 && (
                                <CircularProgress value={session.progress} size={32} strokeWidth={3} />
                            )}
                            {session.progress === 100 && (
                                <CheckCircle className="h-6 w-6 text-green-600" />
                            )}
                        </div>
                    </div>
                </AccordionTrigger>
                {children}
            </AccordionItem>
        </div>
    );
};

// Use extracted SortableViewerSlideItem component (see ./components/SortableViewerSlideItem.tsx)

function RouteComponent() {
    const { t } = useTranslation('studyLibraryViewer');
    const navigate = useNavigate();
    const { setOpen } = useSidebar();

    // Collapse sidebar on mount
    useEffect(() => {
        setOpen(false);
    }, [setOpen]);

    const [slides, setSlides] = useState<SlideGeneration[]>([]);
    const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editSessionTitle, setEditSessionTitle] = useState<string>('');
    const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
    const [regeneratingSlideId, setRegeneratingSlideId] = useState<string | null>(null);
    const [regeneratingSection, setRegeneratingSection] = useState<'video' | 'code' | undefined>(undefined);
    const [regenerationPrompt, setRegenerationPrompt] = useState<string>('');
    const regenerationPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [regenerateWarningDialogOpen, setRegenerateWarningDialogOpen] = useState(false);
    const [pendingRegenerateSlideId, setPendingRegenerateSlideId] = useState<string | null>(null);
    const [backToLibraryDialogOpen, setBackToLibraryDialogOpen] = useState(false);

    const handleDiscardCourse = () => {
        setBackToLibraryDialogOpen(false);
        navigate({ to: '/study-library/ai-copilot' });
    };

    const handleSaveToDrafts = () => {
        // Save current course data to drafts
        const courseData = {
            sessions: sessionsWithProgress,
            slides: slides,
            timestamp: new Date().toISOString()
        };
        // Get existing drafts or initialize empty array
        const existingDrafts = JSON.parse(localStorage.getItem('courseDrafts') || '[]');
        existingDrafts.push(courseData);
        localStorage.setItem('courseDrafts', JSON.stringify(existingDrafts));
        setBackToLibraryDialogOpen(false);
        navigate({ to: '/study-library' });
    };

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor)
    );

    // Load slides from localStorage and poll for updates while generating
    useEffect(() => {
        const loadSlides = () => {
            try {
                const storedSlides = localStorage.getItem('generatedSlides');
                const isGenerating = localStorage.getItem('isGeneratingContent') === 'true';

                if (storedSlides) {
                    let parsedSlides = JSON.parse(storedSlides);
                    if (Array.isArray(parsedSlides) && parsedSlides.length > 0) {
                        console.log('📥 Viewer: Loaded slides from localStorage:', parsedSlides.length, 'slides');
                        console.log('📥 Viewer: Slide statuses:', parsedSlides.map(s => `${s.id}: ${s.status}`));

                        // Check if any slides have content but wrong status
                        const slidesWithContent = parsedSlides.filter(s => s.content && s.content.trim().length > 0);
                        console.log('📥 Viewer: Slides with content:', slidesWithContent.map(s => `${s.id}: ${s.status} (${s.content.length} chars)`));

                        // Auto-fix slides that have content but are still marked as generating
                        let hasChanges = false;
                        parsedSlides = parsedSlides.map(slide => {
                            if (slide.content && slide.content.trim().length > 0 && slide.status === 'generating') {
                                console.log('🔧 Viewer: Auto-fixing slide status from generating to completed:', slide.id);
                                hasChanges = true;
                                return { ...slide, status: 'completed', progress: 100 };
                            }
                            return slide;
                        });

                        if (hasChanges) {
                            try { localStorage.setItem('generatedSlides', JSON.stringify(parsedSlides)); } catch (e) { console.warn('localStorage quota exceeded for generatedSlides'); }
                            console.log('💾 Viewer: Updated localStorage with corrected slide statuses');
                        }

                        setSlides(parsedSlides);

                        const allSessionIds = new Set<string>(
                            parsedSlides
                                .filter((slide: SlideGeneration) => slide && slide.sessionId)
                                .map((slide: SlideGeneration) => slide.sessionId as string)
                        );
                        setExpandedSessions(allSessionIds);
                    }
                }

                console.log('📥 Viewer: isGeneratingContent flag:', isGenerating);
            } catch (e) {
                console.error('Error loading stored slides:', e);
            }
        };

        // Load initial slides
        loadSlides();

        // Poll for updates while content is generating
        let isGenerating = localStorage.getItem('isGeneratingContent') === 'true';
        console.log('📥 Viewer: Initial isGeneratingContent:', isGenerating);

        let pollInterval: NodeJS.Timeout | null = null;

        if (isGenerating) {
            console.log('📥 Viewer: Starting polling for slide updates...');
            pollInterval = setInterval(() => {
                const currentGenerating = localStorage.getItem('isGeneratingContent') === 'true';
                console.log('📥 Viewer: Poll check - isGeneratingContent:', currentGenerating);

                loadSlides();

                // Stop polling when generation is complete
                if (!currentGenerating) {
                    console.log('📥 Viewer: Stopping polling - generation complete');
                    if (pollInterval) clearInterval(pollInterval);
                }
            }, 500); // Poll every 500ms for real-time updates
        }

        return () => {
            console.log('📥 Viewer: Clearing poll interval');
            if (pollInterval) clearInterval(pollInterval);
        };
    }, []);

    // Save slides to localStorage whenever they change
    useEffect(() => {
        if (slides.length > 0) {
            localStorage.setItem('generatedSlides', JSON.stringify(slides));
        }
    }, [slides]);

    // Organize slides by sessions
    const sessionsWithProgress = useMemo(() => {
        if (!Array.isArray(slides) || slides.length === 0) {
            return [];
        }

        const sessionMap = new Map<string, SlideGeneration[]>();
        slides.forEach((slide) => {
            if (slide && slide.sessionId) {
                if (!sessionMap.has(slide.sessionId)) {
                    sessionMap.set(slide.sessionId, []);
                }
                sessionMap.get(slide.sessionId)!.push(slide);
            }
        });

        return Array.from(sessionMap.entries()).map(([sessionId, sessionSlides]) => {
            const firstSlide = sessionSlides[0];
            const completedSlides = sessionSlides.filter(s => s && s.status === 'completed').length;
            const progress = sessionSlides.length > 0 ? (completedSlides / sessionSlides.length) * 100 : 0;

            return {
                sessionId,
                sessionTitle: firstSlide?.sessionTitle || t('untitledSession'),
                slides: sessionSlides,
                progress,
            };
        });
    }, [slides, t]);

    const getSlideIcon = (slideType: SlideType): React.ReactNode => {
        switch (slideType) {
            case 'objectives':
                return <FileText className="h-4 w-4 text-blue-600" />;
            case 'topic':
                return (
                    <div className="flex items-center gap-1">
                        <Video className="h-4 w-4 text-red-600" />
                        <Code className="h-4 w-4 text-green-600" />
                    </div>
                );
            case 'quiz':
            case 'assessment':
            case 'ASSESSMENT':
                return <FileQuestion className="h-4 w-4 text-purple-600" />;
            case 'homework':
            case 'assignment':
                return <ClipboardList className="h-4 w-4 text-orange-600" />;
            case 'solution':
                return <FileCode className="h-4 w-4 text-indigo-600" />;
            case 'doc':
                return <FileText className="h-4 w-4 text-blue-600" />;
            case 'pdf':
                return <File className="h-4 w-4 text-red-600" />;
            case 'video':
                return <Video className="h-4 w-4 text-red-600" />;
            case 'ai-video':
                return <Video className="h-4 w-4 text-purple-600" />;
            case 'ai-slides':
                return <Layers className="h-4 w-4 text-teal-600" />;
            case 'ai-storybook':
                return <BookOpen className="h-4 w-4 text-rose-600" />;
            case 'video-code':
            case 'ai-video-code':
                return (
                    <div className="flex items-center gap-1">
                        <Video className="h-4 w-4 text-red-600" />
                        <Code className="h-4 w-4 text-green-600" />
                    </div>
                );
            case 'jupyter':
                return <Notebook className="h-4 w-4 text-orange-600" />;
            case 'code-editor':
                return <Code className="h-4 w-4 text-green-600" />;
            case 'scratch':
                return <Puzzle className="h-4 w-4 text-purple-600" />;
            case 'video-jupyter':
                return (
                    <div className="flex items-center gap-1">
                        <Video className="h-4 w-4 text-red-600" />
                        <Notebook className="h-4 w-4 text-orange-600" />
                    </div>
                );
            case 'video-code-editor':
                return (
                    <div className="flex items-center gap-1">
                        <Video className="h-4 w-4 text-red-600" />
                        <Code className="h-4 w-4 text-green-600" />
                    </div>
                );
            case 'video-scratch':
                return (
                    <div className="flex items-center gap-1">
                        <Video className="h-4 w-4 text-red-600" />
                        <Puzzle className="h-4 w-4 text-purple-600" />
                    </div>
                );
            default:
                return null;
        }
    };

    const handleSessionDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = sessionsWithProgress.findIndex((s) => s.sessionId === active.id);
            const newIndex = sessionsWithProgress.findIndex((s) => s.sessionId === over.id);
            if (oldIndex !== -1 && newIndex !== -1) {
                const reorderedSessions = arrayMove(sessionsWithProgress, oldIndex, newIndex);
                // Reorder slides based on new session order
                const reorderedSlides: SlideGeneration[] = [];
                reorderedSessions.forEach((session) => {
                    reorderedSlides.push(...session.slides);
                });
                setSlides(reorderedSlides);
            }
        }
    };

    const handleSlideDragEnd = (event: DragEndEvent, sessionId: string) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const session = sessionsWithProgress.find((s) => s.sessionId === sessionId);
            if (session) {
                const oldIndex = session.slides.findIndex((s) => s.id === active.id);
                const newIndex = session.slides.findIndex((s) => s.id === over.id);
                if (oldIndex !== -1 && newIndex !== -1) {
                    const reorderedSlides = arrayMove(session.slides, oldIndex, newIndex);
                    setSlides((prev) => {
                        const otherSlides = prev.filter((s) => s.sessionId !== sessionId);
                        return [...otherSlides, ...reorderedSlides];
                    });
                }
            }
        }
    };

    const handleSessionEdit = (sessionId: string, newTitle: string) => {
        setSlides((prev) =>
            prev.map((slide) =>
                slide.sessionId === sessionId
                    ? { ...slide, sessionTitle: newTitle }
                    : slide
            )
        );
    };

    const handleSessionDelete = (sessionId: string) => {
        if (confirm(t('confirmDeleteSession'))) {
            setSlides((prev) => prev.filter((slide) => slide.sessionId !== sessionId));
        }
    };

    const handleRegenerateSession = (sessionId: string) => {
        // In a real app, this would trigger regeneration
        console.log('Regenerate session:', sessionId);
    };

    const handleStartEdit = (sessionId: string, currentTitle: string) => {
        setEditingSessionId(sessionId);
        setEditSessionTitle(currentTitle);
    };

    const handleCancelEdit = () => {
        setEditingSessionId(null);
        setEditSessionTitle('');
    };

    const handleSaveEdit = (sessionId: string) => {
        if (editSessionTitle.trim()) {
            handleSessionEdit(sessionId, editSessionTitle.trim());
            handleCancelEdit();
        }
    };

    const handleSlideEdit = (slideId: string, newTitle: string) => {
        setSlides((prev) =>
            prev.map((slide) =>
                slide.id === slideId ? { ...slide, slideTitle: newTitle } : slide
            )
        );
    };

    const handleSlideContentEdit = (slideId: string, newContent: string) => {
        setSlides((prev) =>
            prev.map((slide) =>
                slide.id === slideId ? { ...slide, content: newContent } : slide
            )
        );
    };

    const handleSlideDelete = (slideId: string) => {
        if (confirm(t('confirmDeleteSlide', { slideTerm: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLowerCase() }))) {
            setSlides((prev) => prev.filter((slide) => slide.id !== slideId));
        }
    };

    // Helper function to check if a document slide has an image
    const documentHasImage = (content?: string): boolean => {
        if (!content) return false;
        // Check for img tags or mermaid diagrams (which are converted to images)
        return content.includes('<img') ||
               content.includes('mermaid.ink') ||
               content.includes('graph') ||
               content.includes('flowchart') ||
               content.includes('sequenceDiagram') ||
               content.includes('classDiagram');
    };

    const handleRegenerateSlide = (slideId: string, section?: 'video' | 'code') => {
        const slide = slides.find((s) => s.id === slideId);
        if (!slide) return;

        // Store which section is being regenerated
        setRegeneratingSection(section);

        // Check if this is a document with image or video type
        const isDocumentWithImage = (slide.slideType === 'doc' || slide.slideType === 'objectives') && documentHasImage(slide.content);
        const isVideoType = slide.slideType === 'video' ||
                           slide.slideType === 'video-code-editor' ||
                           slide.slideType === 'video-jupyter' ||
                           slide.slideType === 'video-scratch';
        const isTopicSlide = slide.slideType === 'topic';
        const regenerationCount = slide.regenerationCount || 0;

        // For topic slides, only show warning for video section, not code
        if (isTopicSlide) {
            if (section === 'video') {
                // If already regenerated twice, prevent further regeneration
                if (regenerationCount >= 2) {
                    alert(t('regenerationLimitReachedVideo'));
                    return;
                }
                // Show warning inside the regenerate dialog for video
                if (regenerationCount < 2) {
                    setRegeneratingSlideId(slideId);
                    setRegenerationPrompt('');
                    setRegenerateDialogOpen(true);
                    // Focus textarea after dialog opens
                    setTimeout(() => {
                        regenerationPromptTextareaRef.current?.focus();
                    }, 100);
                    return;
                }
            } else {
                // For code section, no warning needed - proceed directly
                setRegeneratingSlideId(slideId);
                setRegenerationPrompt('');
                setRegenerateDialogOpen(true);
                // Focus textarea after dialog opens
                setTimeout(() => {
                    regenerationPromptTextareaRef.current?.focus();
                }, 100);
                return;
            }
        }

        // If already regenerated twice, prevent further regeneration
        if ((isDocumentWithImage || isVideoType) && regenerationCount >= 2) {
            alert(t('regenerationLimitReached'));
            return;
        }

        // For video slides, show warning inside the regenerate dialog
        if (isVideoType && regenerationCount < 2) {
            setRegeneratingSlideId(slideId);
            setRegenerationPrompt('');
            setRegenerateDialogOpen(true);
            // Focus textarea after dialog opens
            setTimeout(() => {
                regenerationPromptTextareaRef.current?.focus();
            }, 100);
            return;
        }

        // For document slides with images, show warning inside the regenerate dialog
        if (isDocumentWithImage && regenerationCount < 2) {
            setRegeneratingSlideId(slideId);
            setRegenerationPrompt('');
            setRegenerateDialogOpen(true);
            // Focus textarea after dialog opens
            setTimeout(() => {
                regenerationPromptTextareaRef.current?.focus();
            }, 100);
            return;
        }

        // For other slide types, proceed directly
        setRegeneratingSlideId(slideId);
        setRegenerationPrompt('');
        setRegenerateDialogOpen(true);
        // Focus textarea after dialog opens
        setTimeout(() => {
            regenerationPromptTextareaRef.current?.focus();
        }, 100);
    };

    const handleConfirmRegenerateWarning = () => {
        if (pendingRegenerateSlideId) {
            setRegeneratingSlideId(pendingRegenerateSlideId);
            setRegenerationPrompt('');
            setRegenerateDialogOpen(true);
            // Focus textarea after dialog opens
            setTimeout(() => {
                regenerationPromptTextareaRef.current?.focus();
            }, 100);
        }
        setRegenerateWarningDialogOpen(false);
        setPendingRegenerateSlideId(null);
    };

    const handleCancelRegenerateWarning = () => {
        setRegenerateWarningDialogOpen(false);
        setPendingRegenerateSlideId(null);
    };

    const handleConfirmRegenerate = () => {
        if (!regeneratingSlideId) return;

        // In a real app, this would trigger regeneration with or without prompt
        const prompt = regenerationPrompt.trim();
        if (prompt) {
            console.log('Regenerate slide (with prompt):', regeneratingSlideId, prompt);
        } else {
            console.log('Regenerate slide (simple):', regeneratingSlideId);
        }

        // Update regeneration count
        setSlides((prev) =>
            prev.map((slide) => {
                if (slide.id === regeneratingSlideId) {
                    const currentCount = slide.regenerationCount || 0;
                    return {
                        ...slide,
                        regenerationCount: currentCount + 1
                    };
                }
                return slide;
            })
        );

        // Close dialog and reset state
        setRegenerateDialogOpen(false);
        setRegeneratingSlideId(null);
        setRegenerationPrompt('');
    };

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>

            <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50">
                <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                    {/* Header */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="mb-6"
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <button
                                onClick={() => setBackToLibraryDialogOpen(true)}
                                className="flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-indigo-600"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                {t('backToLibrary')}
                            </button>

                            {/* Create CTA Button */}
                            <MyButton
                                buttonType="primary"
                                onClick={() => {
                                    // TODO: Handle course creation
                                    console.log('Create course');
                                }}
                            >
                                {t('createButton')}
                            </MyButton>
                        </div>

                        <div>
                            <h1 className="mb-2 text-3xl font-semibold text-neutral-900">
                                {t('finalStepHeading')}
                            </h1>
                            <p className="text-base text-gray-600">
                                {t('finalStepSubtitle')}
                            </p>
                        </div>
                    </motion.div>

                    {/* Sessions List */}
                    {sessionsWithProgress.length === 0 ? (
                        <div className="rounded-xl bg-white p-6 shadow-md">
                            <div className="text-center py-12">
                                <p className="text-neutral-600 mb-4">{t('noContentAvailable')}</p>
                                <p className="text-sm text-neutral-500">
                                    {t('noContentAvailableHint')}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl bg-white p-6 shadow-md">
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleSessionDragEnd}
                            >
                                <SortableContext
                                    items={sessionsWithProgress.map((s) => s.sessionId)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <Accordion
                                        type="multiple"
                                        value={Array.from(expandedSessions)}
                                        onValueChange={(values) => setExpandedSessions(new Set(values))}
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
                                                    <div className="ml-11">
                                                        <DndContext
                                                            sensors={sensors}
                                                            collisionDetection={closestCenter}
                                                            onDragEnd={(event) => handleSlideDragEnd(event, session.sessionId)}
                                                        >
                                                            <SortableContext
                                                                items={session.slides.map((s) => s.id)}
                                                                strategy={verticalListSortingStrategy}
                                                            >
                                                                <div className="space-y-2">
                                                                    {session.slides.map((slide) => (
                                                                        <SortableViewerSlideItem
                                                                            key={slide.id}
                                                                            slide={slide}
                                                                            onEdit={handleSlideEdit}
                                                                            onDelete={handleSlideDelete}
                                                                            getSlideIcon={getSlideIcon}
                                                                            onRegenerate={handleRegenerateSlide}
                                                                            onContentEdit={handleSlideContentEdit}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </SortableContext>
                                                        </DndContext>
                                                    </div>
                                                </AccordionContent>
                                            </SortableSessionItem>
                                        ))}
                                    </Accordion>
                                </SortableContext>
                            </DndContext>
                        </div>
                    )}
                </div>
            </div>

            {/* Regenerate Warning Dialog */}
            <Dialog open={regenerateWarningDialogOpen} onOpenChange={setRegenerateWarningDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{t('regenerationLimitWarningTitle')}</DialogTitle>
                        <DialogDescription>
                            {t('regenerationLimitWarningDescription', {
                                replace: {
                                    ordinal:
                                        slides.find((s) => s.id === pendingRegenerateSlideId)
                                            ?.regenerationCount === 0
                                            ? t('ordinalFirst')
                                            : t('ordinalSecond'),
                                },
                            })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-neutral-600">
                            {t('regenerationLimitWarningBody')}
                        </p>
                    </div>
                    <DialogFooter>
                        <MyButton
                            buttonType="secondary"
                            onClick={handleCancelRegenerateWarning}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmRegenerateWarning}
                        >
                            {t('proceedButton')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Regenerate Page Dialog */}
            <Dialog open={regenerateDialogOpen} onOpenChange={(open) => {
                setRegenerateDialogOpen(open);
                if (!open) {
                    setRegenerationPrompt('');
                    setRegeneratingSlideId(null);
                    setRegeneratingSection(undefined);
                }
            }}>
                <DialogContent className="w-[80vw] max-w-[80vw] max-h-[90vh] flex flex-col p-0">
                    <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0 border-b">
                        <DialogTitle>{t('regeneratePageTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {(() => {
                            if (!regeneratingSlideId) return null;

                            const slide = slides.find(s => s.id === regeneratingSlideId);
                            if (!slide) return null;

                            const isVideoType = slide.slideType === 'video' ||
                                               slide.slideType === 'video-code-editor' ||
                                               slide.slideType === 'video-jupyter' ||
                                               slide.slideType === 'video-scratch';
                            const isTopicSlide = slide.slideType === 'topic';
                            const isDocumentWithImage = (slide.slideType === 'doc' || slide.slideType === 'objectives') && documentHasImage(slide.content);
                            const regenerationCount = slide.regenerationCount ?? 0;

                            // Show warning for video types, document slides with images, or for topic slides only when regenerating video section
                            const shouldShowWarning = (isVideoType || isDocumentWithImage || (isTopicSlide && regeneratingSection === 'video')) && regenerationCount < 2;

                            if (shouldShowWarning) {
                                return (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="flex-shrink-0 mt-0.5">
                                                <svg className="h-5 w-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="text-sm font-semibold text-amber-800 mb-1">
                                                    {t('regenerationLimitWarningTitle')}
                                                </h4>
                                                <p className="text-sm text-amber-700">
                                                    {t('regenerationLimitWarningInline', {
                                                        replace: {
                                                            ordinal:
                                                                regenerationCount === 0
                                                                    ? t('ordinalFirst')
                                                                    : t('ordinalSecond'),
                                                        },
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        })()}
                        <div>
                            <Textarea
                                ref={regenerationPromptTextareaRef}
                                value={regenerationPrompt}
                                onChange={(e) => setRegenerationPrompt(e.target.value)}
                                placeholder={t('regeneratePromptPlaceholder')}
                                className="min-h-[150px] text-sm"
                            />
                        </div>
                    </div>
                    <div className="px-6 py-4 flex-shrink-0 border-t flex justify-end">
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmRegenerate}
                        >
                            {t('regenerateButton')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Back to Library Confirmation Dialog */}
            <Dialog
                open={backToLibraryDialogOpen}
                onOpenChange={setBackToLibraryDialogOpen}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('goBackToLibraryTitle')}</DialogTitle>
                        <DialogDescription className="text-neutral-600">
                            {t('goBackToLibraryDescription')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-neutral-200">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setBackToLibraryDialogOpen(false)}
                            className="min-w-[100px]"
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={handleDiscardCourse}
                            className="min-w-[120px] border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-400"
                        >
                            {t('discardCourseButton')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleSaveToDrafts}
                            className="min-w-[130px]"
                        >
                            {t('saveToDraftsButton')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>
        </LayoutContainer>
    );
}
