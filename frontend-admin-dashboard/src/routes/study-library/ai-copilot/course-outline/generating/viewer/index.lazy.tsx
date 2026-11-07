import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import React, { useState, useEffect, useId, useMemo, useCallback, useRef } from 'react';
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
import { useTranslation } from 'react-i18next';
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
import { HtmlDocField } from '@/components/html-slide/html-doc-field';
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
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createLazyFileRoute('/study-library/ai-copilot/course-outline/generating/viewer/')({
    component: RouteComponent,
});

// Circular Progress Component
interface CircularProgressProps {
    value: number;
    size?: number;
    strokeWidth?: number;
    className?: string;
}

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

type SlideType =
    | 'objectives'
    | 'topic'
    | 'quiz'
    | 'assessment'
    | 'homework'
    | 'solution'
    | 'doc'
    | 'pdf'
    | 'video'
    | 'ai-video'
    | 'image'
    | 'jupyter'
    | 'code-editor'
    | 'scratch'
    | 'video-jupyter'
    | 'video-code-editor'
    | 'video-scratch'
    | 'assignment';

interface QuizQuestion {
    question: string;
    options: string[];
    correctAnswerIndex?: number;
    explanation?: string;
}

interface SlideGeneration {
    id: string;
    sessionId: string;
    sessionTitle: string;
    slideTitle: string;
    slideType: SlideType;
    status: 'pending' | 'generating' | 'completed';
    progress: number;
    content?: string;
    regenerationCount?: number; // Number of times this slide has been regenerated
}

interface SessionProgress {
    sessionId: string;
    sessionTitle: string;
    slides: SlideGeneration[];
    progress: number;
}

// Sortable Session Item Component
interface SortableSessionItemProps {
    session: SessionProgress;
    sessionIndex: number;
    onEdit: (sessionId: string, newTitle: string) => void;
    onDelete: (sessionId: string) => void;
    onRegenerate: (sessionId: string) => void;
    editingSessionId: string | null;
    editSessionTitle: string;
    onStartEdit: (sessionId: string, currentTitle: string) => void;
    onCancelEdit: () => void;
    onSaveEdit: (sessionId: string) => void;
    setEditSessionTitle: (title: string) => void;
    children: React.ReactNode;
}

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
    const { t } = useTranslation('studyLibraryCourseOutlineViewer');
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
                                        title={t('session.edit')}
                                    >
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(session.sessionId);
                                        }}
                                        className="rounded p-1 text-xs text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('session.delete')}
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
                                        title={t('session.save')}
                                    >
                                        <CheckCircle className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCancelEdit();
                                        }}
                                        className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                        title={t('session.cancel')}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            )}
                            <div className="text-xs text-neutral-500">
                                {t('session.pagesProgress', { completed: completedCount, count: session.slides.length })}
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

// Sortable Slide Item Component
interface SortableSlideItemProps {
    slide: SlideGeneration;
    onEdit: (slideId: string, newTitle: string) => void;
    onDelete: (slideId: string) => void;
    getSlideIcon: (type: SlideType) => React.ReactNode;
    onRegenerate?: (slideId: string, section?: 'video' | 'code') => void;
    onContentEdit?: (slideId: string, newContent: string) => void;
}

// Helper function to process document content and convert mermaid diagrams to images
const processDocumentContent = (content: string): string => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;

    // Find all code blocks
    const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

    codeBlocks.forEach((block) => {
        const codeText = block.textContent || '';
        const isMermaid = codeText.includes('graph') ||
            codeText.includes('flowchart') ||
            codeText.includes('sequenceDiagram') ||
            codeText.includes('classDiagram') ||
            codeText.includes('stateDiagram') ||
            codeText.includes('erDiagram') ||
            codeText.includes('gantt') ||
            codeText.includes('pie') ||
            codeText.includes('gitgraph') ||
            codeText.includes('journey');

        if (isMermaid) {
            // Encode mermaid code for mermaid.ink API
            const base64Code = btoa(unescape(encodeURIComponent(codeText)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            const mermaidImageUrl = `https://mermaid.ink/img/${base64Code}`;

            // Create image element
            const img = document.createElement('img');
            img.src = mermaidImageUrl;
            img.alt = 'Mermaid Diagram';
            img.className = 'max-w-full rounded-lg my-4';
            img.style.cssText = 'width: 100%; height: auto; display: block;';

            // Replace the code block
            const parent = block.parentElement;
            if (parent && parent.tagName === 'PRE') {
                parent.replaceWith(img);
            } else {
                block.replaceWith(img);
            }
        }
    });

    return tempDiv.innerHTML;
};

const SortableSlideItem = React.memo(({ slide, onEdit, onDelete, getSlideIcon, onRegenerate, onContentEdit }: SortableSlideItemProps) => {
    const { t } = useTranslation('studyLibraryCourseOutlineViewer');
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(slide.slideTitle);
    const [codeContent, setCodeContent] = useState('');
    const [documentContent, setDocumentContent] = useState('');
    const [splitterPosition, setSplitterPosition] = useState(50); // 50% default
    const [isResizing, setIsResizing] = useState(false);
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
    const [videoUrlInput, setVideoUrlInput] = useState<string>('');
    const [videoUrlDialogOpen, setVideoUrlDialogOpen] = useState(false);
    const [tempVideoUrl, setTempVideoUrl] = useState<string>('');
    const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
    const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    /* Radio groups are document-wide: every completed slide renders its quiz
     * editor at once, so a bare `correct-${qIndex}` made question 1 of slide A
     * and question 1 of slide B one group — picking an answer in one silently
     * unchecked the other. Scope the group to this slide's component instance. */
    const quizGroupId = useId();

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: slide.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    // Initialize code content from slide content
    useEffect(() => {
        if (slide.content && (slide.slideType === 'video-code-editor' || slide.slideType === 'video-jupyter' || slide.slideType === 'video-scratch' || slide.slideType === 'topic')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = slide.content;
            const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

            // For topic slides, extract regular code (excluding mermaid)
            if (slide.slideType === 'topic') {
                let regularCode = '';
                codeBlocks.forEach((block) => {
                    const codeText = block.textContent || '';
                    const isMermaid = codeText.includes('graph') ||
                        codeText.includes('flowchart') ||
                        codeText.includes('sequenceDiagram') ||
                        codeText.includes('classDiagram');
                    if (!isMermaid && codeText.trim().length > 0) {
                        regularCode = codeText;
                    }
                });
                // Set default code if none found (for slides like "Topic 1: What is Python?")
                if (!regularCode) {
                    regularCode = '// Start writing your code here';
                }
                setCodeContent(regularCode);
            } else {
                // For video-code-editor types, extract first code block
                const codeBlock = codeBlocks[0];
                const code = codeBlock ? (codeBlock.textContent || '') : '';
                if (code) {
                    setCodeContent(code);
                }
            }
        }
    }, [slide.content, slide.slideType]);

    // Initialize document content
    useEffect(() => {
        if (slide.slideType === 'doc' || slide.slideType === 'objectives') {
            if (slide.content) {
                setDocumentContent(slide.content);
            } else {
                setDocumentContent('');
            }
        }
    }, [slide.content, slide.slideType, slide.id]);

    // Initialize quiz questions from slide content - must be called unconditionally
    useEffect(() => {
        if (slide.slideType === 'quiz' && slide.content) {
            try {
                // Try to parse as JSON first (old format)
                const quizData = JSON.parse(slide.content);
                if (quizData && quizData.questions && Array.isArray(quizData.questions)) {
                    // Ensure each question has a correctAnswerIndex (default to 0 if missing or invalid)
                    const normalizedQuestions = quizData.questions.map((q: QuizQuestion) => {
                        const options = q.options || [];
                        let correctIndex = 0;

                        // Convert to number if it's a string
                        if (q.correctAnswerIndex !== undefined && q.correctAnswerIndex !== null) {
                            const numIndex = typeof q.correctAnswerIndex === 'string'
                                ? parseInt(q.correctAnswerIndex, 10)
                                : q.correctAnswerIndex;

                            // Ensure it's a valid number and within bounds
                            if (typeof numIndex === 'number' && !isNaN(numIndex) && numIndex >= 0 && numIndex < options.length) {
                                correctIndex = numIndex;
                            }
                        }

                        return {
                            question: q.question || '',
                            options: options,
                            correctAnswerIndex: Number(correctIndex)
                        };
                    });
                    setQuizQuestions(normalizedQuestions);
                } else {
                    setQuizQuestions([]);
                }
            } catch (e) {
                // If not JSON, try to parse as HTML (new document format)
                if (slide.content && slide.content.includes('<h3>') && slide.content.includes('Question')) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = slide.content;
                    const questionHeaders = tempDiv.querySelectorAll('h3');

                    if (questionHeaders.length > 0) {
                        const questions: QuizQuestion[] = [];
                        questionHeaders.forEach((header) => {
                            // Structure: h3 -> p (question) -> ol (options) -> p (correct answer)
                            const questionParagraph = header.nextElementSibling;
                            const questionText = questionParagraph?.textContent?.trim() || '';
                            const listElement = questionParagraph?.nextElementSibling;

                            if (listElement && listElement.tagName === 'OL') {
                                const options: string[] = [];
                                let correctIndex = 0;

                                // Extract options from the ordered list
                                listElement.querySelectorAll('li').forEach((li) => {
                                    const text = li.textContent?.trim() || '';
                                    if (text) {
                                        options.push(text);
                                    }
                                });

                                // Find the correct answer paragraph below the list
                                let nextElement = listElement.nextElementSibling;
                                while (nextElement) {
                                    const text = nextElement.textContent || '';
                                    if (text.includes('Correct Answer:') || text.includes('Correct Answer')) {
                                        // Extract the correct answer text
                                        const correctAnswerMatch = text.match(/Correct Answer:\s*(.+)/i);
                                        if (correctAnswerMatch && correctAnswerMatch[1]) {
                                            const correctAnswerText = correctAnswerMatch[1].trim();
                                            // Find which option matches the correct answer
                                            const foundIndex = options.findIndex(opt => opt.trim() === correctAnswerText);
                                            if (foundIndex !== -1) {
                                                correctIndex = foundIndex;
                                            }
                                        }
                                        break;
                                    }
                                    // Skip hr elements
                                    if (nextElement.tagName === 'HR') {
                                        nextElement = nextElement.nextElementSibling;
                                    } else {
                                        nextElement = nextElement.nextElementSibling;
                                    }
                                }

                                if (questionText && options.length > 0) {
                                    questions.push({
                                        question: questionText,
                                        options: options,
                                        correctAnswerIndex: correctIndex
                                    });
                                }
                            }
                        });
                        setQuizQuestions(questions);
                    } else {
                        setQuizQuestions([]);
                    }
                } else {
                    setQuizQuestions([]);
                }
            }
        } else if (slide.slideType !== 'quiz') {
            // Clear quiz questions if not a quiz slide
            setQuizQuestions([]);
        }
    }, [slide.content, slide.id, slide.slideType]);

    const handleSaveEdit = () => {
        if (editValue.trim()) {
            onEdit(slide.id, editValue.trim());
            setIsEditing(false);
        }
    };

    const handleCancelEdit = () => {
        setEditValue(slide.slideTitle);
        setIsEditing(false);
    };

    const handleCodeChange = (value: string | undefined) => {
        const code = value || '';
        setCodeContent(code);
        // In a real app, you would save this to the slide content
        // For now, we'll just update the local state
    };

    const handleDocumentChange = (html: string) => {
        setDocumentContent(html);
        // In a real app, you would save this to the slide content
        // For now, we'll just update the local state
    };

    // Resizer handlers
    const resizerRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing || !resizerRef.current) return;

            const container = resizerRef.current.closest('.resizable-container') as HTMLElement;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = (x / rect.width) * 100;

            // Limit between 20% and 80%
            const clampedPercentage = Math.max(20, Math.min(80, percentage));
            setSplitterPosition(clampedPercentage);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    const parseCodeContent = (content: string): string => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const codeBlock = tempDiv.querySelector('pre code, pre');
        if (codeBlock) {
            return codeBlock.textContent || '';
        }
        return content;
    };

    const parseVideoContent = (content: string): { videoUrl?: string; script?: string } => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        const youtubeMatch = content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        const videoUrl = youtubeMatch ? `https://www.youtube.com/embed/${youtubeMatch[1]}` : undefined;

        const codeBlocks = tempDiv.querySelectorAll('pre code, pre');
        codeBlocks.forEach(block => block.remove());
        const script = tempDiv.innerHTML.trim();

        return { videoUrl, script: script || undefined };
    };

    const parseQuizContent = (content: string): QuizQuestion[] => {
        try {
            const quizData = JSON.parse(content);
            return quizData.questions || [];
        } catch (e) {
            return [];
        }
    };

    const renderSlideContent = () => {
        if (!slide.content) {
            return <div className="text-center text-neutral-500 py-8">{t('slide.noContent')}</div>;
        }

        const { slideType, content } = slide;

        // Topic pages - always render as video + code (especially "Topic 1: What is Python?")
        if (slideType === 'topic') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

            // Check if topic has code blocks (excluding mermaid)
            let hasRegularCode = false;
            let regularCode = '';
            codeBlocks.forEach((block) => {
                const codeText = block.textContent || '';
                const isMermaid = codeText.includes('graph') ||
                    codeText.includes('flowchart') ||
                    codeText.includes('sequenceDiagram') ||
                    codeText.includes('classDiagram');
                if (!isMermaid && codeText.trim().length > 0) {
                    hasRegularCode = true;
                    if (!regularCode) {
                        regularCode = codeText;
                    }
                }
            });

            // Always render topic slides as video + code
            // If no code is found, use default placeholder code
            if (!regularCode) {
                regularCode = '// Start writing your code here';
            }

            // Extract video script (everything except regular code blocks)
            const scriptDiv = document.createElement('div');
            scriptDiv.innerHTML = content;
            const scriptCodeBlocks = scriptDiv.querySelectorAll('pre code, pre');
            scriptCodeBlocks.forEach((block) => {
                const codeText = block.textContent || '';
                const isMermaid = codeText.includes('graph') ||
                    codeText.includes('flowchart') ||
                    codeText.includes('sequenceDiagram') ||
                    codeText.includes('classDiagram');
                if (!isMermaid) {
                    const parent = block.parentElement;
                    if (parent && parent.tagName === 'PRE') {
                        parent.remove();
                    } else {
                        block.remove();
                    }
                }
            });
            const scriptHtml = scriptDiv.innerHTML.trim();

            // Initialize video URL from content
            useEffect(() => {
                if (slide.content) {
                    // Check for uploaded video reference first
                    const uploadedVideoMatch = slide.content.match(/\[UPLOADED_VIDEO:([^\]]+)\]/);
                    if (uploadedVideoMatch) {
                        // If there's an uploaded video reference, we'd need to restore it
                        // For now, we'll just clear URL input since uploaded videos are handled separately
                        setVideoUrlInput('');
                        // Note: In a real app, you'd restore the file from storage
                    } else {
                        // Check for YouTube video URL in content
                        const youtubeMatch = slide.content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                        if (youtubeMatch) {
                            setVideoUrlInput(`https://www.youtube.com/watch?v=${youtubeMatch[1]}`);
                            setUploadedVideoUrl(''); // Clear uploaded video if URL is found
                        } else {
                            // Check if there's already an embed URL or other video URL
                            const embedMatch = slide.content.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
                            if (embedMatch) {
                                setVideoUrlInput(embedMatch[0]);
                                setUploadedVideoUrl(''); // Clear uploaded video if URL is found
                            } else {
                                setVideoUrlInput('');
                            }
                        }
                    }
                } else {
                    setVideoUrlInput('');
                    setUploadedVideoUrl('');
                }
            }, [slide.content, slide.id]);

            // Cleanup object URL on unmount or when slide changes
            useEffect(() => {
                return () => {
                    if (uploadedVideoUrl) {
                        URL.revokeObjectURL(uploadedVideoUrl);
                    }
                };
            }, [uploadedVideoUrl]);

            // Convert video URL to embed format
            const convertToEmbedUrl = (url: string): string | null => {
                if (!url || !url.trim()) return null;

                // YouTube URL patterns
                const youtubeWatchMatch = url.match(/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]+)/);
                const youtubeShortMatch = url.match(/(?:youtu\.be\/)([a-zA-Z0-9_-]+)/);
                const youtubeEmbedMatch = url.match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);

                if (youtubeWatchMatch || youtubeShortMatch) {
                    const videoId = youtubeWatchMatch ? youtubeWatchMatch[1] : youtubeShortMatch![1];
                    return `https://www.youtube.com/embed/${videoId}`;
                }

                if (youtubeEmbedMatch) {
                    return url; // Already in embed format
                }

                // For other video URLs, return as is (might be Vimeo, etc.)
                return url;
            };

            // Get embed URL from input or uploaded video
            const embedUrl = convertToEmbedUrl(videoUrlInput);
            const videoSource = uploadedVideoUrl || embedUrl;

            // Use codeContent state if available, otherwise use extracted regularCode
            const currentCode = codeContent || regularCode;

            // Initialize code content if not already set
            if (!codeContent && regularCode) {
                setCodeContent(regularCode);
            }

            // Handle opening video URL dialog
            const handleOpenVideoUrlDialog = () => {
                setTempVideoUrl(videoUrlInput);
                setVideoUrlDialogOpen(true);
            };

            // Handle saving video URL from dialog
            const handleSaveVideoUrl = () => {
                setVideoUrlInput(tempVideoUrl);
                // Clear uploaded video when URL is saved
                if (uploadedVideoUrl) {
                    URL.revokeObjectURL(uploadedVideoUrl);
                    setUploadedVideoUrl('');
                    setUploadedVideoFile(null);
                }
                // Save to slide content if onContentEdit is available
                if (onContentEdit) {
                    // Preserve existing content and add/update video URL
                    let updatedContent = slide.content || '';

                    // Remove existing YouTube URLs from content (both watch and embed formats)
                    updatedContent = updatedContent.replace(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g, '');
                    updatedContent = updatedContent.replace(/https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                    updatedContent = updatedContent.replace(/https:\/\/youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                    // Remove uploaded video references
                    updatedContent = updatedContent.replace(/\[UPLOADED_VIDEO:[^\]]+\]/g, '');

                    // Clean up extra whitespace
                    updatedContent = updatedContent.replace(/\n{3,}/g, '\n\n').trim();

                    // Add new video URL if provided
                    if (tempVideoUrl && tempVideoUrl.trim()) {
                        // Add URL to content (append it with proper spacing)
                        if (updatedContent.trim()) {
                            updatedContent += `\n\n${tempVideoUrl.trim()}`;
                        } else {
                            updatedContent = tempVideoUrl.trim();
                        }
                    }

                    onContentEdit(slide.id, updatedContent);
                }
                setVideoUrlDialogOpen(false);
            };

            // Handle canceling video URL dialog
            const handleCancelVideoUrlDialog = () => {
                setTempVideoUrl('');
                setVideoUrlDialogOpen(false);
            };

            // Handle file upload
            const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) {
                    // Check if file is a video
                    if (file.type.startsWith('video/')) {
                        // Revoke previous object URL if exists
                        if (uploadedVideoUrl) {
                            URL.revokeObjectURL(uploadedVideoUrl);
                        }
                        setUploadedVideoFile(file);
                        const videoUrl = URL.createObjectURL(file);
                        setUploadedVideoUrl(videoUrl);
                        // Clear URL input when uploading file
                        setVideoUrlInput('');

                        // Save to slide content if onContentEdit is available
                        if (onContentEdit) {
                            // For uploaded files, we'll store a reference or the file name
                            // In a real app, you'd upload to a server and get a URL
                            // For now, we'll store the file name and create a local URL
                            let updatedContent = slide.content || '';

                            // Remove existing YouTube URLs from content
                            updatedContent = updatedContent.replace(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g, '');
                            updatedContent = updatedContent.replace(/https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                            updatedContent = updatedContent.replace(/https:\/\/youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');

                            // Add file reference
                            if (updatedContent.trim()) {
                                updatedContent += `\n\n[UPLOADED_VIDEO:${file.name}]`;
                            } else {
                                updatedContent = `[UPLOADED_VIDEO:${file.name}]`;
                            }

                            onContentEdit(slide.id, updatedContent);
                        }
                    } else {
                        alert(t('slide.selectVideoFileAlert'));
                    }
                }
                // Reset input
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
            };

            // Handle upload button click
            const handleUploadClick = () => {
                fileInputRef.current?.click();
            };

            return (
                <>
                    <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                        <div className="resizable-container flex gap-2" style={{ height: '600px' }}>
                            <div
                                className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                                style={{ width: `${splitterPosition}%` }}
                            >
                                <div className="bg-neutral-100 px-4 py-2 border-b flex items-center justify-between flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Code className="h-4 w-4 text-green-600" />
                                        <span className="text-sm font-semibold">{t('slide.codeEditor')}</span>
                                    </div>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => onRegenerate(slide.id, 'code')}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('slide.regenerateCode')}
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            <span>{t('slide.regenerate')}</span>
                                        </button>
                                    )}
                                </div>
                                <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                                    <Editor
                                        height="550px"
                                        defaultLanguage="javascript"
                                        value={currentCode}
                                        onChange={handleCodeChange}
                                        theme="vs-light"
                                        options={{
                                            readOnly: false,
                                            minimap: { enabled: false },
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                        }}
                                    />
                                </div>
                            </div>
                            <div
                                ref={resizerRef}
                                className="w-1 bg-neutral-300 hover:bg-indigo-500 cursor-col-resize flex-shrink-0 transition-colors"
                                onMouseDown={handleMouseDown}
                                style={{ cursor: isResizing ? 'col-resize' : 'col-resize' }}
                            />
                            <div
                                className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                                style={{ width: `${100 - splitterPosition}%` }}
                            >
                                <div className="bg-neutral-100 px-4 py-2 border-b flex items-center justify-between flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Video className="h-4 w-4 text-red-600" />
                                        <span className="text-sm font-semibold">{t('slide.videoPlayer')}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleUploadClick}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('slide.uploadVideoFromDevice')}
                                        >
                                            <Upload className="h-3.5 w-3.5" />
                                        </button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="video/*"
                                            onChange={handleFileUpload}
                                            className="hidden"
                                        />
                                        <button
                                            onClick={handleOpenVideoUrlDialog}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('slide.addVideoUrl')}
                                        >
                                            <Link className="h-3.5 w-3.5" />
                                        </button>
                                        {onRegenerate && (
                                            <button
                                                onClick={() => onRegenerate(slide.id, 'video')}
                                                className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                                title={t('slide.regenerateVideo')}
                                            >
                                                <RefreshCw className="h-3.5 w-3.5" />
                                                <span>{t('slide.regenerate')}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 overflow-auto">
                                    {videoSource ? (
                                        uploadedVideoUrl ? (
                                            // Display uploaded video file
                                            (<div className="aspect-video w-full bg-black min-h-[300px]">
                                                <video
                                                    src={uploadedVideoUrl}
                                                    controls
                                                    className="w-full h-full"
                                                    style={{ objectFit: 'contain' }}
                                                />
                                            </div>)
                                        ) : (
                                            // Display embedded video (YouTube, etc.)
                                            (<div className="aspect-video w-full bg-black min-h-[300px]">
                                                <iframe
                                                    src={embedUrl!}
                                                    className="w-full h-full"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                />
                                            </div>)
                                        )
                                    ) : (
                                        <div className="w-full aspect-video bg-black flex items-center justify-center min-h-[300px]">
                                            <div className="text-center text-white">
                                                <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                                <p className="text-lg">{t('slide.videoPlayer')}</p>
                                                <p className="text-sm opacity-75">{t('slide.uploadOrUrlHint')}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Video URL Dialog */}
                    <Dialog open={videoUrlDialogOpen} onOpenChange={setVideoUrlDialogOpen}>
                        <DialogContent className="sm:max-w-[500px]">
                            <DialogHeader>
                                <DialogTitle>{t('slide.addVideoUrl')}</DialogTitle>
                            </DialogHeader>
                            <div className="py-4">
                                <Label className="text-sm font-medium mb-2 block">{t('slide.videoUrlLabel')}</Label>
                                <Input
                                    type="url"
                                    value={tempVideoUrl}
                                    onChange={(e) => setTempVideoUrl(e.target.value)}
                                    placeholder={t('slide.videoUrlPlaceholder')}
                                    className="w-full"
                                />
                            </div>
                            <DialogFooter>
                                <MyButton
                                    buttonType="primary"
                                    onClick={handleSaveVideoUrl}
                                >
                                    {t('slide.save')}
                                </MyButton>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )
        }

        // Document/Objectives pages - editable
        if (slideType === 'doc' || slideType === 'objectives') {
            // Use documentContent state if available, otherwise use content
            const rawContent = documentContent || content;
            // Process content to convert mermaid diagrams to images
            const processedContent = processDocumentContent(rawContent);

            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="mb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-semibold text-neutral-900">
                                    {slideType === 'objectives' ? t('slide.learningObjectives') : t('slide.document')}
                                </span>
                            </div>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('slide.regenerate')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('slide.regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <HtmlDocField
                        value={processedContent}
                        onChange={handleDocumentChange}
                        minHeight={400}
                    />
                </div>
            );
        }

        // Video pages
        if (slideType === 'video') {
            const { videoUrl, script } = parseVideoContent(content);
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="space-y-4">
                        {videoUrl ? (
                            <div className="aspect-video w-full rounded-lg overflow-hidden bg-black">
                                <iframe
                                    src={videoUrl}
                                    className="w-full h-full"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                />
                            </div>
                        ) : (
                            <div className="aspect-video w-full rounded-lg bg-black flex items-center justify-center">
                                <div className="text-center text-white">
                                    <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p className="text-lg">{t('slide.videoPlayer')}</p>
                                    <p className="text-sm opacity-75">{t('slide.videoWillBeDisplayed')}</p>
                                </div>
                            </div>
                        )}
                        {script && (
                            <div className="mt-4 p-4 bg-white rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-semibold">{t('slide.videoScript')}</h4>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('slide.regenerateVideoScript')}
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            <span>{t('slide.regenerate')}</span>
                                        </button>
                                    )}
                                </div>
                                <div
                                    className="prose max-w-none text-sm"
                                    dangerouslySetInnerHTML={{ __html: script }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // Code editor pages
        if (slideType === 'code-editor' || slideType === 'jupyter' || slideType === 'scratch') {
            const code = parseCodeContent(content);
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="mb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Code className="h-4 w-4 text-green-600" />
                                <span className="text-sm font-semibold text-neutral-900">{t('slide.codeEditor')}</span>
                            </div>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('slide.regenerateCode')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('slide.regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <Editor
                        height="400px"
                        defaultLanguage="javascript"
                        value={code}
                        theme="vs-light"
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                        }}
                    />
                </div>
            );
        }

        // Video + Code pages (split screen)
        if (slideType === 'video-code-editor' || slideType === 'video-jupyter' || slideType === 'video-scratch') {
            const youtubeMatch = content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
            const videoUrl = youtubeMatch ? `https://www.youtube.com/embed/${youtubeMatch[1]}` : undefined;

            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="resizable-container flex gap-2" style={{ height: '600px' }}>
                        <div
                            className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                            style={{ width: `${splitterPosition}%` }}
                        >
                            <div className="bg-neutral-100 px-4 py-2 border-b flex items-center gap-2 flex-shrink-0">
                                <Code className="h-4 w-4 text-green-600" />
                                <span className="text-sm font-semibold">{t('slide.codeEditor')}</span>
                            </div>
                            <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                                <Editor
                                    height="550px"
                                    defaultLanguage="javascript"
                                    value={codeContent}
                                    onChange={handleCodeChange}
                                    theme="vs-light"
                                    options={{
                                        readOnly: false,
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                    }}
                                />
                            </div>
                        </div>
                        <div
                            className="w-1 bg-neutral-300 hover:bg-indigo-500 cursor-col-resize flex-shrink-0 transition-colors"
                            onMouseDown={handleMouseDown}
                            style={{ cursor: isResizing ? 'col-resize' : 'col-resize' }}
                        />
                        <div
                            className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                            style={{ width: `${100 - splitterPosition}%` }}
                        >
                            <div className="bg-neutral-100 px-4 py-2 border-b flex items-center gap-2 flex-shrink-0">
                                <Video className="h-4 w-4 text-red-600" />
                                <span className="text-sm font-semibold">{t('slide.videoPlayer')}</span>
                            </div>
                            <div className="flex-1 overflow-auto">
                                {videoUrl ? (
                                    <div className="aspect-video w-full bg-black min-h-[300px]">
                                        <iframe
                                            src={videoUrl}
                                            className="w-full h-full"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            allowFullScreen
                                        />
                                    </div>
                                ) : (
                                    <div className="w-full aspect-video bg-black flex items-center justify-center min-h-[300px]">
                                        <div className="text-center text-white">
                                            <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                            <p className="text-lg">{t('slide.videoPlayer')}</p>
                                            <p className="text-sm opacity-75">{t('slide.videoWillBeDisplayed')}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // Quiz pages
        if (slideType === 'quiz') {

            // Save quiz questions to slide content
            const saveQuizQuestions = () => {
                if (!onContentEdit) return;
                const quizData = { questions: quizQuestions };
                onContentEdit(slide.id, JSON.stringify(quizData, null, 2));
            };

            // Add new question
            // Ref array to track question elements for scrolling
            const questionRefs = useRef<(HTMLDivElement | null)[]>([]);

            const addQuestion = () => {
                const newQuestion: QuizQuestion = {
                    question: '',
                    options: ['', '', '', ''],
                    correctAnswerIndex: 0
                };
                const newIndex = quizQuestions.length;
                setQuizQuestions([...quizQuestions, newQuestion]);

                // Scroll to the newly added question after state update
                setTimeout(() => {
                    const questionElement = questionRefs.current[newIndex];
                    if (questionElement) {
                        questionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // Focus on the question textarea
                        const textarea = questionElement.querySelector('textarea');
                        if (textarea) {
                            textarea.focus();
                        }
                    }
                }, 100);
            };

            // Delete question
            const deleteQuestion = (index: number) => {
                const updated = quizQuestions.filter((_, i) => i !== index);
                setQuizQuestions(updated);
                // Clean up refs array
                questionRefs.current = questionRefs.current.filter((_, i) => i !== index);
                // Save immediately after deletion
                setTimeout(() => {
                    if (onContentEdit) {
                        const quizData = { questions: updated };
                        onContentEdit(slide.id, JSON.stringify(quizData, null, 2));
                    }
                }, 0);
            };

            // Update question
            const updateQuestion = (index: number, field: keyof QuizQuestion, value: any) => {
                const updated = [...quizQuestions];
                const currentQuestion = updated[index];
                if (!currentQuestion) return;

                if (field === 'options' && Array.isArray(value)) {
                    updated[index] = {
                        question: currentQuestion.question || '',
                        options: value,
                        correctAnswerIndex: currentQuestion.correctAnswerIndex
                    };
                } else if (field === 'correctAnswerIndex' && typeof value === 'number') {
                    updated[index] = {
                        question: currentQuestion.question || '',
                        options: currentQuestion.options || [],
                        correctAnswerIndex: value
                    };
                } else {
                    updated[index] = {
                        question: currentQuestion.question || '',
                        options: currentQuestion.options || [],
                        correctAnswerIndex: currentQuestion.correctAnswerIndex,
                        ...(field === 'question' ? { question: value || '' } : {})
                    };
                }
                setQuizQuestions(updated);
            };

            // Add option to question
            const addOption = (questionIndex: number) => {
                const updated = [...quizQuestions];
                const currentQuestion = updated[questionIndex];
                if (!currentQuestion) return;

                updated[questionIndex] = {
                    question: currentQuestion.question || '',
                    options: [...(currentQuestion.options || []), ''],
                    correctAnswerIndex: currentQuestion.correctAnswerIndex
                };
                setQuizQuestions(updated);
            };

            // Remove option from question
            const removeOption = (questionIndex: number, optionIndex: number) => {
                const updated = [...quizQuestions];
                const currentQuestion = updated[questionIndex];
                if (!currentQuestion) return;

                const options = [...(currentQuestion.options || [])];
                options.splice(optionIndex, 1);

                const currentCorrectIndex = currentQuestion.correctAnswerIndex ?? 0;
                const newCorrectIndex = currentCorrectIndex >= optionIndex
                    ? Math.max(0, currentCorrectIndex - 1)
                    : currentCorrectIndex;

                updated[questionIndex] = {
                    question: currentQuestion.question || '',
                    options,
                    correctAnswerIndex: newCorrectIndex
                };
                setQuizQuestions(updated);
            };

            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <FileQuestion className="h-4 w-4 text-purple-600" />
                            <Label className="text-sm font-semibold text-neutral-900">{t('quiz.content')}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={addQuestion}
                                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors border border-indigo-200"
                                title={t('quiz.addQuestion')}
                            >
                                <span>+</span>
                                {t('quiz.addQuestion')}
                            </button>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('slide.regenerateQuiz')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('slide.regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="space-y-6">
                        {quizQuestions.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500">
                                <p className="mb-4">{t('quiz.noQuestions')}</p>
                            </div>
                        ) : (
                            <>
                                {quizQuestions.map((question, qIndex) => (
                                    <div
                                        key={qIndex}
                                        ref={(el) => {
                                            questionRefs.current[qIndex] = el;
                                        }}
                                        className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4"
                                    >
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-semibold text-neutral-900">{t('quiz.questionLabel', { number: qIndex + 1 })}</h4>
                                            <button
                                                onClick={() => deleteQuestion(qIndex)}
                                                className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded px-2 py-1 transition-colors"
                                                title={t('quiz.delete')}
                                            >
                                                {t('quiz.delete')}
                                            </button>
                                        </div>

                                        <div>
                                            <Label className="text-xs text-neutral-700 mb-1 block">{t('quiz.questionText')}</Label>
                                            <Textarea
                                                value={question.question || ''}
                                                onChange={(e) => {
                                                    updateQuestion(qIndex, 'question', e.target.value);
                                                    setTimeout(saveQuizQuestions, 100);
                                                }}
                                                placeholder={t('quiz.questionPlaceholder')}
                                                className="min-h-[80px] text-sm"
                                            />
                                        </div>

                                        <div>
                                            <Label className="text-xs text-neutral-700 mb-2 block">{t('quiz.options')}</Label>
                                            <div className="space-y-2">
                                                {(question.options || []).map((option, optIndex) => (
                                                    <div key={optIndex} className="flex items-center gap-2">
                                                        <input
                                                            type="radio"
                                                            name={`correct-${quizGroupId}-${qIndex}`}
                                                            checked={Number(question.correctAnswerIndex ?? 0) === optIndex}
                                                            onChange={() => {
                                                                updateQuestion(qIndex, 'correctAnswerIndex', optIndex);
                                                                setTimeout(saveQuizQuestions, 100);
                                                            }}
                                                            className="h-4 w-4 text-indigo-600"
                                                        />
                                                        <Input
                                                            value={option || ''}
                                                            onChange={(e) => {
                                                                const newOptions = [...(question.options || [])];
                                                                newOptions[optIndex] = e.target.value;
                                                                updateQuestion(qIndex, 'options', newOptions);
                                                                setTimeout(saveQuizQuestions, 100);
                                                            }}
                                                            placeholder={t('quiz.optionPlaceholder', { number: optIndex + 1 })}
                                                            className="flex-1 text-sm"
                                                        />
                                                        {(question.options || []).length > 2 && (
                                                            <button
                                                                onClick={() => {
                                                                    removeOption(qIndex, optIndex);
                                                                    setTimeout(saveQuizQuestions, 100);
                                                                }}
                                                                className="text-xs text-red-600 hover:text-red-700 px-2 py-1"
                                                                title={t('quiz.removeOption')}
                                                            >
                                                                ×
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={() => {
                                                        addOption(qIndex);
                                                        setTimeout(saveQuizQuestions, 100);
                                                    }}
                                                    className="text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded px-2 py-1 transition-colors"
                                                >
                                                    {t('quiz.addOption')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {/* Add Question button at the end */}
                                <div className="flex justify-center pt-2">
                                    <button
                                        onClick={addQuestion}
                                        className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors border border-indigo-200"
                                        title={t('quiz.addQuestion')}
                                    >
                                        <span>+</span>
                                        {t('quiz.addQuestion')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            );
        }

        // Homework/Assignment pages
        if (slideType === 'homework' || slideType === 'assignment') {
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="mb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-purple-600" />
                                <span className="text-sm font-semibold text-neutral-900">
                                    {slideType === 'homework' ? t('slide.homework') : t('slide.assignment')}
                                </span>
                            </div>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('slide.regenerateAssignment')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('slide.regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <div
                        className="prose max-w-none"
                        dangerouslySetInnerHTML={{ __html: content }}
                    />
                </div>
            );
        }

        // Solution pages
        if (slideType === 'solution') {
            const code = parseCodeContent(content);
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-semibold">{t('slide.solutionCode')}</h3>
                        {onRegenerate && (
                            <button
                                onClick={() => onRegenerate(slide.id)}
                                className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                title={t('slide.regenerateSolution')}
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>{t('slide.regenerate')}</span>
                            </button>
                        )}
                    </div>
                    <Editor
                        height="400px"
                        defaultLanguage="javascript"
                        value={code}
                        theme="vs-light"
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                        }}
                    />
                </div>
            );
        }

        return null;
    };

    return (
        <div className="mb-2">
            <div
                ref={setNodeRef}
                style={style}
                className="group flex items-center gap-2 rounded-md border border-transparent bg-white p-2 hover:border-neutral-200 hover:bg-neutral-50"
            >
                <button
                    {...attributes}
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <GripVertical className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-2 flex-1">
                    {getSlideIcon(slide.slideType)}
                    {isEditing ? (
                        <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                            }}
                            className="h-7 text-sm flex-1"
                            autoFocus
                        />
                    ) : (
                        <span className="text-sm text-neutral-700 flex-1">{slide.slideTitle}</span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {isEditing ? (
                        <>
                            <button
                                onClick={handleSaveEdit}
                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                title={t('slide.save')}
                            >
                                <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={handleCancelEdit}
                                className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                title={t('slide.cancel')}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setIsEditing(true)}
                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                title={t('slide.edit')}
                            >
                                <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => onDelete(slide.id)}
                                className="rounded p-1 text-xs text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                title={t('slide.delete')}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}

                    {slide.status === 'completed' && (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                </div>
            </div>
            {slide.status === 'completed' && renderSlideContent()}
            {/* Video URL Dialog - only show for topic slides */}
            {slide.slideType === 'topic' && (
                <Dialog open={videoUrlDialogOpen} onOpenChange={setVideoUrlDialogOpen}>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>{t('slide.addVideoUrl')}</DialogTitle>
                        </DialogHeader>
                        <div className="py-4">
                            <Label htmlFor="video-url-input" className="text-sm font-medium mb-2 block">{t('slide.videoUrlLabel')}</Label>
                            <Input
                                id="video-url-input"
                                type="url"
                                value={videoUrlInput}
                                onChange={(e) => setVideoUrlInput(e.target.value)}
                                placeholder={t('slide.videoUrlPlaceholder')}
                                className="w-full"
                            />
                        </div>
                        <DialogFooter>
                            <MyButton
                                buttonType="primary"
                                onClick={() => {
                                    setVideoUrlInput(videoUrlInput);
                                    // Clear uploaded video when URL is saved
                                    if (uploadedVideoUrl) {
                                        URL.revokeObjectURL(uploadedVideoUrl);
                                        setUploadedVideoUrl('');
                                        setUploadedVideoFile(null);
                                    }
                                    // Save to slide content if onContentEdit is available
                                    if (onContentEdit) {
                                        let updatedContent = slide.content || '';
                                        // Remove existing YouTube URLs from content
                                        updatedContent = updatedContent.replace(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g, '');
                                        updatedContent = updatedContent.replace(/https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                                        updatedContent = updatedContent.replace(/https:\/\/youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                                        // Remove uploaded video references
                                        updatedContent = updatedContent.replace(/\[UPLOADED_VIDEO:[^\]]+\]/g, '');
                                        // Clean up extra whitespace
                                        updatedContent = updatedContent.replace(/\n{3,}/g, '\n\n').trim();
                                        // Add new video URL if provided
                                        if (videoUrlInput && videoUrlInput.trim()) {
                                            if (updatedContent.trim()) {
                                                updatedContent += `\n\n${videoUrlInput.trim()}`;
                                            } else {
                                                updatedContent = videoUrlInput.trim();
                                            }
                                        }
                                        onContentEdit(slide.id, updatedContent);
                                    }
                                    setVideoUrlDialogOpen(false);
                                }}
                            >
                                {t('slide.save')}
                            </MyButton>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
});

SortableSlideItem.displayName = 'SortableSlideItem';

function RouteComponent() {
    const { t } = useTranslation('studyLibraryCourseOutlineViewer');
    const navigate = useNavigate();
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

    // Load slides from localStorage
    useEffect(() => {
        try {
            const storedSlides = localStorage.getItem('generatedSlides');
            if (storedSlides) {
                const parsedSlides = JSON.parse(storedSlides);
                if (Array.isArray(parsedSlides) && parsedSlides.length > 0) {
                    setSlides(parsedSlides);

                    const allSessionIds = new Set(
                        parsedSlides
                            .filter((slide: SlideGeneration) => slide && slide.sessionId)
                            .map((slide: SlideGeneration) => slide.sessionId)
                    );
                    setExpandedSessions(allSessionIds);
                }
            }
        } catch (e) {
            console.error('Error loading stored slides:', e);
        }
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
                sessionTitle: firstSlide?.sessionTitle || t('session.untitled'),
                slides: sessionSlides,
                progress,
            };
        });
    }, [slides]);

    const getSlideIcon = (slideType: SlideType) => {
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
        if (confirm(t('session.confirmDelete'))) {
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
        if (confirm(t('slide.confirmDelete', { term: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLowerCase() }))) {
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
                    alert(t('regenerationLimitAlert.video'));
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
            alert(t('regenerationLimitAlert.generic'));
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
                <title>{t('meta.title')}</title>
                <meta name="description" content={t('meta.description')} />
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
                                {t('header.backToLibrary')}
                            </button>

                            {/* Create CTA Button */}
                            <MyButton
                                buttonType="primary"
                                onClick={() => {
                                    // TODO: Handle course creation
                                    console.log('Create course');
                                }}
                            >
                                {t('header.create')}
                            </MyButton>
                        </div>

                        <div>
                            <h1 className="mb-2 text-3xl font-semibold text-neutral-900">
                                {t('header.heading')}
                            </h1>
                            <p className="text-base text-gray-600">
                                {t('header.subheading')}
                            </p>
                        </div>
                    </motion.div>

                    {/* Sessions List */}
                    {sessionsWithProgress.length === 0 ? (
                        <div className="rounded-xl bg-white p-6 shadow-md">
                            <div className="text-center py-12">
                                <p className="text-neutral-600 mb-4">{t('empty.noContent')}</p>
                                <p className="text-sm text-neutral-500">
                                    {t('empty.generateFirst')}
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
                                                                        <SortableSlideItem
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
                        <DialogTitle>{t('regenerateWarningDialog.title')}</DialogTitle>
                        <DialogDescription>
                            {t('regenerateWarningDialog.description', {
                                replace: {
                                    ordinal: slides.find(s => s.id === pendingRegenerateSlideId)?.regenerationCount === 0
                                        ? t('ordinal.first')
                                        : t('ordinal.second'),
                                },
                            })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-neutral-600">
                            {t('regenerateWarningDialog.body')}
                        </p>
                    </div>
                    <DialogFooter>
                        <MyButton
                            buttonType="secondary"
                            onClick={handleCancelRegenerateWarning}
                        >
                            {t('regenerateWarningDialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmRegenerateWarning}
                        >
                            {t('regenerateWarningDialog.proceed')}
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
                        <DialogTitle>{t('regenerateDialog.title')}</DialogTitle>
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
                                                    {t('regenerateDialog.warningTitle')}
                                                </h4>
                                                <p className="text-sm text-amber-700">
                                                    {t('regenerateDialog.warningBody', {
                                                        replace: {
                                                            ordinal: regenerationCount === 0 ? t('ordinal.first') : t('ordinal.second'),
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
                                placeholder={t('regenerateDialog.promptPlaceholder')}
                                className="min-h-[150px] text-sm"
                            />
                        </div>
                    </div>
                    <div className="px-6 py-4 flex-shrink-0 border-t flex justify-end">
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmRegenerate}
                        >
                            {t('regenerateDialog.regenerate')}
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
                        <DialogTitle>{t('backToLibraryDialog.title')}</DialogTitle>
                        <DialogDescription className="text-neutral-600">
                            {t('backToLibraryDialog.description')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-neutral-200">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setBackToLibraryDialogOpen(false)}
                            className="min-w-[100px]"
                        >
                            {t('backToLibraryDialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={handleDiscardCourse}
                            className="min-w-[120px] border-red-300 text-red-600 hover:text-red-700 hover:bg-red-50 hover:border-red-400"
                        >
                            {t('backToLibraryDialog.discard')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleSaveToDrafts}
                            className="min-w-[130px]"
                        >
                            {t('backToLibraryDialog.saveToDrafts')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>
        </LayoutContainer>
    );
}
