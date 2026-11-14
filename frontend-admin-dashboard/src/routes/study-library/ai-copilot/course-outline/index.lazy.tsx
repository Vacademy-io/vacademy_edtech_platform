import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { getAiProductName } from '@/config/branding';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { TagInput } from '@/components/ui/tag-input';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';
import {
    ArrowLeft,
    BookOpen,
    Layers,
    Brain,
    CheckCircle,
    Clock,
    User,
    Tag,
    RefreshCw,
    Save,
    Target,
    Edit2,
    ChevronsDown,
    ChevronsUp,
    FileText,
    Video,
    Code,
    FileQuestion,
    ClipboardList,
    FileCode,
    Upload,
    X,
    Image as ImageIcon,
    GripVertical,
    Trash2,
    Sparkles,
    Plus,
    File,
    Notebook,
    Terminal,
    Puzzle,
    BookOpen as BookOpenIcon,
    Info,
    Link,
    AlertTriangle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Shimmer } from '@/components/ui/shimmer';
import { useEffect, useRef } from 'react';
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
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createLazyFileRoute('/study-library/ai-copilot/course-outline/')({
    component: RouteComponent,
});

// Mock data structure - in real app, this would come from API/state
interface Topic {
    title: string;
    duration: string;
}

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

interface Slide {
    id: string;
    type: SlideType;
    title: string;
    topicIndex?: number;
    duration?: string;
    prompt?: string;
}

interface Session {
    id: string;
    title: string;
    learningObjectives: string[];
    topics: Topic[];
    hasQuiz: boolean;
    hasHomework: boolean;
    slides: Slide[];
}

const createDefaultSlides = (
    sessionId: string,
    topics: Topic[],
    hasQuiz: boolean,
    hasHomework: boolean
): Slide[] => {
    const slides: Slide[] = [
        {
            id: `${sessionId}-objectives`,
            type: 'objectives',
            title: 'Learning Objectives Overview',
        },
    ];

    topics.forEach((topic, index) => {
        slides.push({
            id: `${sessionId}-topic-${index + 1}`,
            type: 'topic',
            title: topic.title,
            topicIndex: index,
            duration: topic.duration,
        });
    });

    if (hasQuiz) {
        slides.push({
            id: `${sessionId}-quiz`,
            type: 'quiz',
            title: 'Session Quiz',
        });
    }

    if (hasHomework) {
        slides.push({
            id: `${sessionId}-homework`,
            type: 'homework',
            title: 'Assignment',
        });
        slides.push({
            id: `${sessionId}-solution`,
            type: 'solution',
            title: 'Assignment Solution',
        });
    }

    return slides;
};

const createSession = (session: Omit<Session, 'slides'>): Session => ({
    ...session,
    slides: createDefaultSlides(session.id, session.topics, session.hasQuiz, session.hasHomework),
});

interface CourseData {
    title: string;
    subtitle: string;
    level: string;
    totalSessions: number;
    totalDuration: string;
    bannerImage?: string;
    previewImage?: string;
    courseMedia?: string;
    courseMediaType?: 'image' | 'video' | 'youtube';
    tags: string[];
    instructor: string;
    whatLearnersGain: string[];
    whoShouldJoin: string;
    aboutCourse: string[];
    sessions: Session[];
}

// Mock course data - replace with actual data from API/state
const mockCourseData: CourseData = {
    title: 'Python Programming',
    subtitle: 'A beginner-level course for aspiring developers',
    level: '', // Will be populated with levelId from institute levels
    totalSessions: 8,
    totalDuration: '12 Hours Total',
    tags: ['#Python', '#BeginnerLevel', '#Programming', '#Coding'],
    instructor: 'Generated by AI Instructor',
    previewImage: 'https://images.unsplash.com/photo-1555255707-c07966088b7b?w=800&h=600&fit=crop&q=80',
    bannerImage: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=1600&h=400&fit=crop&q=80',
    courseMedia: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=600&fit=crop&q=80',
    courseMediaType: 'image',
    whatLearnersGain: [
        'Master Python programming fundamentals',
        'Understand variables, data types, and control flow',
        'Learn to work with functions, lists, tuples, and dictionaries',
        'Build practical programming skills through hands-on practice',
        'Develop problem-solving abilities with Python',
    ],
    whoShouldJoin:
        'Aspiring developers, beginners in programming, and anyone looking to start their journey with Python programming.',
    aboutCourse: [
        'This comprehensive beginner-level course takes you from Python basics to working with data structures. You\'ll learn fundamental programming concepts and apply them through hands-on practice.',
        'Through interactive lessons, quizzes, and assignments, you\'ll gain practical experience with Python programming and build a strong foundation for advanced topics.',
        'By the end of this course, you\'ll be equipped to write Python programs, work with different data types, and solve programming problems confidently.',
    ],
    sessions: [
        createSession({
            id: '1',
            title: 'Introduction to Python',
            learningObjectives: [
                'Understand what Python is and its applications',
                'Set up Python development environment',
                'Write and run your first Python program',
            ],
            topics: [
                { title: 'What is Python?', duration: '10 min' },
                { title: 'Setting Up Python', duration: '12 min' },
                { title: 'Writing Your First Program', duration: '15 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '2',
            title: 'Variables and Data Types in Python',
            learningObjectives: [
                'Understand variables and how to use them',
                'Learn different data types in Python',
                'Practice working with variables and data types',
            ],
            topics: [
                { title: 'Variables in Python', duration: '10 min' },
                { title: 'Data Types', duration: '12 min' },
                { title: 'Hands-On Practice', duration: '15 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '3',
            title: 'Input and Output in Python',
            learningObjectives: [
                'Learn how to get input from users',
                'Understand different output methods',
                'Practice input and output operations',
            ],
            topics: [
                { title: 'Input in Python', duration: '10 min' },
                { title: 'Output in Python', duration: '12 min' },
                { title: 'Hands-On Practice', duration: '15 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '4',
            title: 'Control Flow in Python – if Statements',
            learningObjectives: [
                'Understand control flow concepts',
                'Learn to write conditional statements',
                'Practice using if, elif, and else statements',
            ],
            topics: [
                { title: 'Introduction to Control Flow', duration: '10 min' },
                { title: 'Writing Conditional Statements', duration: '12 min' },
                { title: 'Hands-On Practice', duration: '15 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '5',
            title: 'Loops in Python – for and while',
            learningObjectives: [
                'Understand the concept of loops',
                'Learn to use for loops effectively',
                'Master while loops and their applications',
            ],
            topics: [
                { title: 'Introduction to Loops', duration: '10 min' },
                { title: 'Using while Loops', duration: '12 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '6',
            title: 'Functions in Python',
            learningObjectives: [
                'Understand what functions are and why they are useful',
                'Learn to define and call functions',
                'Practice creating reusable code with functions',
            ],
            topics: [
                { title: 'What Are Functions?', duration: '10 min' },
                { title: 'Hands-On Practice', duration: '15 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '7',
            title: 'Lists and Tuples in Python',
            learningObjectives: [
                'Understand lists and their operations',
                'Learn about tuples and their differences from lists',
                'Practice working with lists and tuples',
            ],
            topics: [
                { title: 'Introduction to Lists', duration: '12 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
        createSession({
            id: '8',
            title: 'Dictionaries in Python',
            learningObjectives: [
                'Understand dictionaries and key-value pairs',
                'Learn dictionary operations and methods',
                'Practice using dictionaries in real-world scenarios',
            ],
            topics: [
                { title: 'Introduction to Dictionaries', duration: '12 min' },
            ],
            hasQuiz: true,
            hasHomework: true,
        }),
    ],
};

// Helper function to extract YouTube video ID
const extractYouTubeVideoId = (url: string): string | null => {
    const regExp = /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[1] && match[1].length === 11 ? match[1] : null;
};

// Helper function to convert YouTube URL to embed URL
const getYouTubeEmbedUrl = (url: string): string | null => {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
    }
    return null;
};

// Helper function to check if URL is YouTube
const isYouTubeUrl = (url: string): boolean => {
    return /(?:youtube\.com|youtu\.be)/.test(url);
};

// Helper function to extract keywords from text
const extractKeywords = (text: string): string[] => {
    // Remove common words and extract meaningful terms
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'about', 'into', 'through', 'during', 'including', 'against', 'among', 'throughout', 'despite', 'towards', 'upon', 'concerning'];

    // Split by spaces, hyphens, and other delimiters, then clean
    const words = text
        .toLowerCase()
        .split(/[\s\-_]+/)
        .map(word => word.replace(/[^a-z0-9]/g, '')) // Remove special chars but keep alphanumeric
        .filter(word =>
            word.length > 2 &&
            !commonWords.includes(word) &&
            /[a-z]/.test(word) // Must contain at least one letter
        );

    // Return unique keywords, limit to most relevant ones
    return [...new Set(words)].slice(0, 5);
};

// Helper function to generate keyword-focused prompt based on session and slide
const generateOneLinerPrompt = (
    sessionTitle: string,
    slideTitle: string,
    slideType: SlideType,
    session?: Omit<Session, 'slides'>,
    topicTitle?: string
): string => {
    const slideName = slideTitle.replace(/^Topic \d+: /, ''); // Remove "Topic X: " prefix if present

    switch (slideType) {
        case 'objectives':
            if (session && session.learningObjectives.length > 0) {
                // Extract keywords from learning objectives
                const objKeywords = session.learningObjectives
                    .flatMap(obj => extractKeywords(obj))
                    .slice(0, 5);
                const keywordsStr = objKeywords.length > 0
                    ? objKeywords.join(', ')
                    : extractKeywords(sessionTitle).join(', ');
                return `Focus on: ${keywordsStr}`;
            }
            return `Focus on: ${extractKeywords(sessionTitle).join(', ')}`;

        case 'topic':
            // Extract keywords from topic title and session title
            const topicKeywords = extractKeywords(topicTitle || slideName);
            const sessionKeywords = extractKeywords(sessionTitle).slice(0, 2);
            const allKeywords = [...new Set([...topicKeywords, ...sessionKeywords])].slice(0, 5);
            return `Cover: ${allKeywords.join(', ')}`;

        case 'image':
            // Extract keywords from slide title and session title
            const imageKeywords = extractKeywords(slideName);
            const imageSessionKeywords = extractKeywords(sessionTitle).slice(0, 2);
            const imageAllKeywords = [...new Set([...imageKeywords, ...imageSessionKeywords])].slice(0, 5);
            return `Show: ${imageAllKeywords.join(', ')}`;

        case 'quiz':
            if (session && session.topics.length > 0) {
                // Extract keywords from all topics
                const quizKeywords = session.topics
                    .flatMap(topic => extractKeywords(topic.title))
                    .slice(0, 5);
                return `Test: ${quizKeywords.join(', ')}`;
            }
            return `Test: ${extractKeywords(sessionTitle).join(', ')}`;

        case 'homework':
            if (session && session.topics.length > 0) {
                // Extract keywords from all topics
                const hwKeywords = session.topics
                    .flatMap(topic => extractKeywords(topic.title))
                    .slice(0, 5);
                return `Practice: ${hwKeywords.join(', ')}`;
            }
            return `Practice: ${extractKeywords(sessionTitle).join(', ')}`;

        case 'solution':
            if (session && session.topics.length > 0) {
                // Extract keywords from all topics
                const solKeywords = session.topics
                    .flatMap(topic => extractKeywords(topic.title))
                    .slice(0, 5);
                return `Solutions for: ${solKeywords.join(', ')}`;
            }
            return `Solutions for: ${extractKeywords(sessionTitle).join(', ')}`;

        default:
            const defaultKeywords = extractKeywords(slideTitle);
            return `Cover: ${defaultKeywords.join(', ')}`;
    }
};

// Helper function to generate slides from session data
const generateSlidesFromSession = (session: Omit<Session, 'slides'>): Slide[] => {
    const slides: Slide[] = [];

    // Learning Objectives
    if (session.learningObjectives.length > 0) {
        const slideTitle = 'Learning objective';
        slides.push({
            id: `${session.id}-objectives`,
            type: 'objectives',
            title: slideTitle,
            prompt: generateOneLinerPrompt(session.title, slideTitle, 'objectives', session),
        });
    }

    // Topics
    session.topics.forEach((topic, index) => {
        const slideTitle = `Topic ${index + 1}: ${topic.title}`;
        slides.push({
            id: `${session.id}-topic-${index}`,
            type: 'topic',
            title: slideTitle,
            topicIndex: index,
            duration: topic.duration,
            prompt: generateOneLinerPrompt(session.title, slideTitle, 'topic', session, topic.title),
        });
    });

    // Quiz
    if (session.hasQuiz) {
        const slideTitle = 'Wrap-Up Quiz';
        slides.push({
            id: `${session.id}-quiz`,
            type: 'quiz',
            title: slideTitle,
            prompt: generateOneLinerPrompt(session.title, slideTitle, 'quiz', session),
        });
    }

    // Assignment
    if (session.hasHomework) {
        const slideTitle = 'Assignment';
        slides.push({
            id: `${session.id}-homework`,
            type: 'homework',
            title: slideTitle,
            prompt: generateOneLinerPrompt(session.title, slideTitle, 'homework', session),
        });
    }

    // Assignment solution
    if (session.hasHomework) {
        const slideTitle = 'Assignment Solution';
        slides.push({
            id: `${session.id}-solution`,
            type: 'solution',
            title: slideTitle,
            prompt: generateOneLinerPrompt(session.title, slideTitle, 'solution', session),
        });
    }

    return slides;
};

// Initialize mock data with slides
const initializeMockData = (): CourseData => {
    const data = { ...mockCourseData };
    data.sessions = data.sessions.map((session) => ({
        ...session,
        slides: generateSlidesFromSession(session),
    }));
    return data;
};

// Sortable Session Item Component
interface SortableSessionItemProps {
    session: Session;
    index: number;
    onEdit: (sessionId: string, newTitle: string) => void;
    onDelete: (sessionId: string) => void;
    children: React.ReactNode;
}

const SortableSessionItem = ({
    session,
    index,
    onEdit,
    onDelete,
    children,
}: SortableSessionItemProps) => {
    const { t } = useTranslation('studyLibraryCourseOutline');
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(session.title);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: session.id });

    useEffect(() => {
        setEditValue(session.title);
    }, [session.title]);

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const handleSaveEdit = () => {
        if (editValue.trim()) {
            onEdit(session.id, editValue.trim());
            setIsEditing(false);
        }
    };

    const handleCancelEdit = () => {
        setEditValue(session.title);
        setIsEditing(false);
    };

    return (
        <div ref={setNodeRef} style={style}>
            <AccordionItem
                value={session.id}
                className="border-b border-neutral-200 last:border-b-0"
            >
                <AccordionTrigger className="group py-4 text-left hover:no-underline">
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
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveEdit();
                                        if (e.key === 'Escape') handleCancelEdit();
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-7 text-sm flex-1"
                                    autoFocus
                                />
                            ) : (
                                <h3 className="text-base font-semibold text-neutral-900">
                                    {t('session.label', { number: index + 1, title: session.title })}
                                </h3>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
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
                                            handleCancelEdit();
                                        }}
                                        className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                        title={t('actions.cancel')}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsEditing(true);
                                        }}
                                        className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('actions.edit')}
                                    >
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDelete(session.id);
                                        }}
                                        className="rounded p-1 text-xs text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title={t('actions.delete')}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </>
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
    slide: Slide;
    sessionId: string;
    onEdit: (slideId: string, newTitle: string) => void;
    onDelete: (slideId: string) => void;
    onUpdatePrompt: (slideId: string, prompt: string) => void;
}

const SortableSlideItem = ({ slide, sessionId, onEdit, onDelete, onUpdatePrompt }: SortableSlideItemProps) => {
    const { t } = useTranslation('studyLibraryCourseOutline');
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(slide.title);
    const [showPromptDialog, setShowPromptDialog] = useState(false);
    const [promptValue, setPromptValue] = useState(slide.prompt || '');
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setEditValue(slide.title);
    }, [slide.title]);

    useEffect(() => {
        setPromptValue(slide.prompt || '');
    }, [slide.prompt]);

    // Set cursor to end of text when dialog opens
    useEffect(() => {
        if (showPromptDialog && promptTextareaRef.current) {
            const textarea = promptTextareaRef.current;
            // Use setTimeout to ensure the textarea is fully rendered
            setTimeout(() => {
                textarea.focus();
                const length = textarea.value.length;
                textarea.setSelectionRange(length, length);
            }, 0);
        }
    }, [showPromptDialog]);
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

    const handleSaveEdit = () => {
        if (editValue.trim()) {
            onEdit(slide.id, editValue.trim());
            setIsEditing(false);
        }
    };

    const handleCancelEdit = () => {
        setEditValue(slide.title);
        setIsEditing(false);
    };

    const getSlideIcon = () => {
        switch (slide.type) {
            case 'objectives':
                return <FileText className="h-4 w-4 text-blue-600" />;
            case 'topic':
                return (
                    <>
                        <Video className="h-4 w-4 text-red-600" />
                        <Code className="h-4 w-4 text-green-600" />
                    </>
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
            case 'image':
                return <ImageIcon className="h-4 w-4 text-blue-600" />;
            case 'jupyter':
                return <Notebook className="h-4 w-4 text-orange-600" />;
            case 'code-editor':
                return <Code className="h-4 w-4 text-green-600" />;
            case 'scratch':
                return <Puzzle className="h-4 w-4 text-purple-600" />;
            case 'video-jupyter':
                return (
                    <>
                        <Video className="h-4 w-4 text-red-600" />
                        <Notebook className="h-4 w-4 text-orange-600" />
                    </>
                );
            case 'video-code-editor':
                return (
                    <>
                        <Video className="h-4 w-4 text-red-600" />
                        <Code className="h-4 w-4 text-green-600" />
                    </>
                );
            case 'video-scratch':
                return (
                    <>
                        <Video className="h-4 w-4 text-red-600" />
                        <Puzzle className="h-4 w-4 text-purple-600" />
                    </>
                );
            default:
                return null;
        }
    };

    return (
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
                {getSlideIcon()}
                {isEditing ? (
                    <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="h-7 text-sm"
                        autoFocus
                    />
                ) : (
                    <span className="text-sm text-neutral-700 flex-1">{slide.title}</span>
                )}
            </div>

            <div className="flex items-center gap-1">
                {isEditing ? (
                    <>
                        <button
                            onClick={handleSaveEdit}
                            className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                            title={t('actions.save')}
                        >
                            <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={handleCancelEdit}
                            className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                            title={t('actions.cancel')}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={() => setIsEditing(true)}
                            className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('actions.edit')}
                        >
                            <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => onDelete(slide.id)}
                            className="rounded p-1 text-xs text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={t('actions.delete')}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </>
                )}
            </div>

            {/* Prompt Dialog */}
            <Dialog open={showPromptDialog} onOpenChange={(open) => {
                setShowPromptDialog(open);
                if (!open) {
                    // Reset to original prompt when dialog closes without saving
                    setPromptValue(slide.prompt || '');
                }
            }}>
                <DialogContent className="w-[80vw] max-w-[80vw] max-h-[90vh] flex flex-col p-0">
                    <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0 border-b">
                        <DialogTitle>{t('aiPromptDialog.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        <Textarea
                            ref={promptTextareaRef}
                            value={promptValue}
                            onChange={(e) => setPromptValue(e.target.value)}
                            placeholder={t('aiPromptDialog.placeholder')}
                            className="min-h-[120px] text-sm"
                        />
                    </div>
                    <div className="px-6 py-4 flex-shrink-0 border-t flex justify-end">
                        <MyButton
                            buttonType="primary"
                            onClick={() => {
                                onUpdatePrompt(slide.id, promptValue.trim());
                                setShowPromptDialog(false);
                            }}
                        >
                            {t('actions.save')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

function RouteComponent() {
    const { t } = useTranslation('studyLibraryCourseOutline');
    const navigate = useNavigate();
    const initialData = initializeMockData();
    const [courseData, setCourseData] = useState<CourseData>(initialData);

    // Get institute levels
    const instituteDetails = useInstituteDetailsStore((state) => state.instituteDetails);
    const instituteLevels = instituteDetails?.levels || [];
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor)
    );
    const [isGenerating, setIsGenerating] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<Record<string, any>>({});
    const [mediaEditMode, setMediaEditMode] = useState<Record<string, 'upload' | 'youtube' | null>>({});
    const [isMetadataSticky, setIsMetadataSticky] = useState(false);
    const [addSlideDialogOpen, setAddSlideDialogOpen] = useState<Record<string, boolean>>({});
    const [selectedSlideType, setSelectedSlideType] = useState<Record<string, SlideType | null>>({});
    const [slideTitle, setSlideTitle] = useState<Record<string, string>>({});
    const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
    const [regeneratePrompt, setRegeneratePrompt] = useState('');
    const regeneratePromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    // Course configuration state for regenerate dialog
    const [regenerateAgeRange, setRegenerateAgeRange] = useState('');
    const [regenerateSkillLevel, setRegenerateSkillLevel] = useState<string>('');
    const [regeneratePrerequisiteFiles, setRegeneratePrerequisiteFiles] = useState<Array<{ file: File; id: string }>>([]);
    const [regeneratePrerequisiteUrls, setRegeneratePrerequisiteUrls] = useState<Array<{ url: string; id: string }>>([]);
    const [regenerateNewPrerequisiteUrl, setRegenerateNewPrerequisiteUrl] = useState('');
    const [regenerateCourseGoal, setRegenerateCourseGoal] = useState('');
    const [regenerateLearningOutcome, setRegenerateLearningOutcome] = useState('');
    const [regenerateCourseIncludeDiagrams, setRegenerateCourseIncludeDiagrams] = useState(false);
    const [regenerateCourseIncludeCodeSnippets, setRegenerateCourseIncludeCodeSnippets] = useState(false);
    const [regenerateCourseIncludePracticeProblems, setRegenerateCourseIncludePracticeProblems] = useState(false);
    const [regenerateCourseIncludeYouTubeVideo, setRegenerateCourseIncludeYouTubeVideo] = useState(false);
    const [regenerateCourseIncludeAIGeneratedVideo, setRegenerateCourseIncludeAIGeneratedVideo] = useState(false);
    const [regenerateCourseProgrammingLanguage, setRegenerateCourseProgrammingLanguage] = useState('');
    const [regenerateCourseNumberOfSessions, setRegenerateCourseNumberOfSessions] = useState('');
    const [regenerateCourseSessionLength, setRegenerateCourseSessionLength] = useState<string>('60');
    const [regenerateCourseCustomSessionLength, setRegenerateCourseCustomSessionLength] = useState<string>('');
    const [regenerateCourseIncludeQuizzes, setRegenerateCourseIncludeQuizzes] = useState(false);
    const [regenerateCourseIncludeHomework, setRegenerateCourseIncludeHomework] = useState(false);
    const [regenerateCourseIncludeSolutions, setRegenerateCourseIncludeSolutions] = useState(false);
    const [regenerateCourseTopicsPerSession, setRegenerateCourseTopicsPerSession] = useState('');
    const [regenerateCourseTopics, setRegenerateCourseTopics] = useState<string[]>([]);
    const [regenerateCourseNewTopic, setRegenerateCourseNewTopic] = useState('');
    const [regenerateReferenceFiles, setRegenerateReferenceFiles] = useState<Array<{ file: File; id: string }>>([]);
    const [regenerateReferenceUrls, setRegenerateReferenceUrls] = useState<Array<{ url: string; id: string }>>([]);
    const [regenerateNewReferenceUrl, setRegenerateNewReferenceUrl] = useState('');
    const [regenerateSessionDialogOpen, setRegenerateSessionDialogOpen] = useState(false);
    const [regeneratingSessionId, setRegeneratingSessionId] = useState<string | null>(null);
    const [regenerateSessionPrompt, setRegenerateSessionPrompt] = useState('');
    const regenerateSessionPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [regenerateSessionLength, setRegenerateSessionLength] = useState<string>('60');
    const [regenerateCustomSessionLength, setRegenerateCustomSessionLength] = useState<string>('');
    const [regenerateIncludeDiagrams, setRegenerateIncludeDiagrams] = useState(false);
    const [regenerateIncludeCodeSnippets, setRegenerateIncludeCodeSnippets] = useState(false);
    const [regenerateIncludePracticeProblems, setRegenerateIncludePracticeProblems] = useState(false);
    const [regenerateIncludeQuizzes, setRegenerateIncludeQuizzes] = useState(false);
    const [regenerateIncludeHomework, setRegenerateIncludeHomework] = useState(false);
    const [regenerateIncludeSolutions, setRegenerateIncludeSolutions] = useState(false);
    const [regenerateIncludeYouTubeVideo, setRegenerateIncludeYouTubeVideo] = useState(false);
    const [regenerateIncludeAIGeneratedVideo, setRegenerateIncludeAIGeneratedVideo] = useState(false);
    const [regenerateSessionTopics, setRegenerateSessionTopics] = useState<string[]>([]);
    const [regenerateSessionNumberOfTopics, setRegenerateSessionNumberOfTopics] = useState<string>('');
    const [addSessionDialogOpen, setAddSessionDialogOpen] = useState(false);
    const [addSessionName, setAddSessionName] = useState('');
    const [showGenerateConfirmDialog, setShowGenerateConfirmDialog] = useState(false);
    const metadataRef = useRef<HTMLDivElement>(null);
    const metadataContainerRef = useRef<HTMLDivElement>(null);
    // Initialize with all sessions open
    const [openSessions, setOpenSessions] = useState<string[]>(
        initialData.sessions.map((session) => session.id)
    );

    // Simulate initial AI generation loading
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsInitialLoading(false);
        }, 2000);
        return () => clearTimeout(timer);
    }, []);

    // Set cursor to end of textarea when regenerate dialog opens
    useEffect(() => {
        if (regenerateDialogOpen && regeneratePromptTextareaRef.current) {
            const textarea = regeneratePromptTextareaRef.current;
            setTimeout(() => {
                textarea.focus();
                const length = textarea.value.length;
                textarea.setSelectionRange(length, length);
            }, 0);
        }
    }, [regenerateDialogOpen]);

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


    // Keep all sessions expanded when course data changes
    useEffect(() => {
        setOpenSessions(courseData.sessions.map((session) => session.id));
    }, [courseData.sessions.length]);

    // Handle metadata sticky behavior
    useEffect(() => {
        const handleScroll = () => {
            if (!metadataRef.current || !metadataContainerRef.current) return;

            const metadataRect = metadataRef.current.getBoundingClientRect();
            const containerRect = metadataContainerRef.current.getBoundingClientRect();
            const headerOffset = 24; // top-6 = 1.5rem = 24px

            // Get the absolute position of metadata bottom in the document
            const metadataBottom = containerRect.top + metadataRect.height;

            // When the bottom of the metadata section (in natural flow) reaches the viewport top + header offset
            // This means all metadata content has been scrolled past, so make it sticky
            if (metadataBottom <= headerOffset) {
                setIsMetadataSticky(true);
            } else {
                setIsMetadataSticky(false);
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // Check initial state

        // Also check on resize in case content changes
        window.addEventListener('resize', handleScroll, { passive: true });

        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [courseData]);

    const handleBack = () => {
        navigate({ to: '/study-library/ai-copilot' });
    };

    const handleRegenerateOutline = () => {
        // Pre-fill all fields from current courseData
        // Note: Some fields may not be available in CourseData, so we'll use defaults or extract what we can

        // Extract skill level from courseData.level (levelId)
        // No need for mapping anymore, we're using levelId directly
        setRegenerateSkillLevel(courseData.level || '');

        // Pre-fill number of sessions
        setRegenerateCourseNumberOfSessions(courseData.totalSessions.toString());

        // Check if sessions have quizzes/homework to pre-fill components
        const hasQuizzes = courseData.sessions.some(s => s.hasQuiz);
        const hasHomework = courseData.sessions.some(s => s.hasHomework);
        setRegenerateCourseIncludeQuizzes(hasQuizzes);
        setRegenerateCourseIncludeHomework(hasHomework);
        setRegenerateCourseIncludeSolutions(hasHomework);

        // Extract average topics per session
        const avgTopics = courseData.sessions.length > 0
            ? Math.round(courseData.sessions.reduce((sum, s) => sum + s.topics.length, 0) / courseData.sessions.length)
            : 0;
        setRegenerateCourseTopicsPerSession(avgTopics.toString());

        // Extract topics from all sessions
        const allTopics = courseData.sessions.flatMap(s => s.topics.map(t => t.title));
        setRegenerateCourseTopics([...new Set(allTopics)]); // Remove duplicates

        // Extract course goal and learning outcome from aboutCourse and whatLearnersGain
        setRegenerateCourseGoal(courseData.aboutCourse.join('\n\n') || '');
        setRegenerateLearningOutcome(courseData.whatLearnersGain.join('\n\n') || '');

        // Try to extract age range from whoShouldJoin text
        // Look for patterns like "18-25", "25-35", etc.
        let extractedAgeRange = '';
        if (courseData.whoShouldJoin) {
            const agePattern = /\b(\d{2,3})-(\d{2,3})\b/;
            const match = courseData.whoShouldJoin.match(agePattern);
            if (match) {
                extractedAgeRange = `${match[1]}-${match[2]}`;
            }
        }
        setRegenerateAgeRange(extractedAgeRange);

        // Reset prompt (should be empty)
        setRegeneratePrompt('');

        // Reset other fields to defaults
        setRegeneratePrerequisiteFiles([]);
        setRegeneratePrerequisiteUrls([]);
        setRegenerateNewPrerequisiteUrl('');
        setRegenerateCourseIncludeDiagrams(false);
        setRegenerateCourseIncludeCodeSnippets(false);
        setRegenerateCourseIncludePracticeProblems(false);
        setRegenerateCourseIncludeYouTubeVideo(false);
        setRegenerateCourseIncludeAIGeneratedVideo(false);
        setRegenerateCourseProgrammingLanguage('');
        setRegenerateCourseSessionLength('60');
        setRegenerateCourseCustomSessionLength('');
        setRegenerateCourseNewTopic('');
        setRegenerateReferenceFiles([]);
        setRegenerateReferenceUrls([]);
        setRegenerateNewReferenceUrl('');

        setRegenerateDialogOpen(true);
    };

    const handleConfirmRegenerate = () => {
        // Only course goal is required
        if (!regenerateCourseGoal.trim()) {
            alert(t('errors.courseGoalRequired'));
            return;
        }
        setRegenerateDialogOpen(false);
        setIsGenerating(true);
        // TODO: Call API to regenerate course outline based on the configuration
        // For now, simulate regeneration
        setTimeout(() => {
            setIsGenerating(false);
            // In a real app, you would update courseData with the regenerated outline
        }, 2000);
    };

    const handleRegenerateSession = (sessionId: string) => {
        const session = courseData.sessions.find((s) => s.id === sessionId);
        if (!session) return;

        setRegeneratingSessionId(sessionId);

        // Pre-fill prompt with a default based on session data
        const defaultPrompt = `Regenerate the session "${session.title}" with the following topics: ${session.topics.map(t => t.title).join(', ')}. ${session.learningObjectives.length > 0 ? `Learning objectives: ${session.learningObjectives.join('; ')}.` : ''}`;
        setRegenerateSessionPrompt(defaultPrompt);

        // Extract session length from topics duration (sum up durations or use first topic's duration)
        // For simplicity, we'll try to extract a numeric value from the first topic's duration
        // If topics have durations like "10 min", we can sum them or use a default
        let sessionLengthValue = '60'; // default
        let customLength = '';

        const firstTopic = session.topics[0];
        if (firstTopic?.duration) {
            // Try to extract minutes from duration string (e.g., "10 min" -> 10)
            const durationMatch = firstTopic.duration.match(/(\d+)/);
            const durationValue = durationMatch?.[1];
            if (durationValue) {
                const minutes = parseInt(durationValue, 10);
                // Check if it matches standard values
                if (minutes === 45 || minutes === 60 || minutes === 90) {
                    sessionLengthValue = minutes.toString();
                } else {
                    sessionLengthValue = 'custom';
                    customLength = minutes.toString();
                }
            }
        }
        setRegenerateSessionLength(sessionLengthValue);
        setRegenerateCustomSessionLength(customLength);

        // Pre-fill session components based on session data
        // Note: diagrams, code snippets, practice problems aren't stored in Session interface
        // so we'll default them to false, but user can change them
        setRegenerateIncludeDiagrams(false);
        setRegenerateIncludeCodeSnippets(false);
        setRegenerateIncludePracticeProblems(false);
        setRegenerateIncludeQuizzes(session.hasQuiz);
        setRegenerateIncludeHomework(session.hasHomework);
        // If session has homework, it likely has solutions too
        setRegenerateIncludeSolutions(session.hasHomework);
        setRegenerateIncludeYouTubeVideo(false);
        setRegenerateIncludeAIGeneratedVideo(false);

        // Pre-fill topics from session
        const topicTitles = session.topics.map(t => t.title);
        setRegenerateSessionTopics(topicTitles);

        // Pre-fill number of topics
        setRegenerateSessionNumberOfTopics(session.topics.length.toString());

        setRegenerateSessionDialogOpen(true);
    };

    const handleConfirmRegenerateSession = () => {
        if (!regenerateSessionPrompt.trim() || !regeneratingSessionId) {
            return;
        }
        setRegenerateSessionDialogOpen(false);
        setIsGenerating(true);
        // TODO: Call API to regenerate session based on the prompt and config
        // For now, simulate regeneration
        setTimeout(() => {
            setIsGenerating(false);
            setRegenerateSessionPrompt('');
            setRegeneratingSessionId(null);
            setRegenerateSessionTopics([]);
            setRegenerateSessionNumberOfTopics('');
            setRegenerateIncludeYouTubeVideo(false);
            setRegenerateIncludeAIGeneratedVideo(false);
            // In a real app, you would update the specific session in courseData
        }, 2000);
    };

    const handleRegenerateSessionLengthChange = (value: string) => {
        setRegenerateSessionLength(value);
        if (value !== 'custom') {
            setRegenerateCustomSessionLength('');
        }
    };

    // Handler functions for regenerate course outline dialog
    const handleRegenerateCourseSessionLengthChange = (value: string) => {
        setRegenerateCourseSessionLength(value);
        if (value !== 'custom') {
            setRegenerateCourseCustomSessionLength('');
        }
    };

    const handleRegenerateAddPrerequisiteUrl = () => {
        if (regenerateNewPrerequisiteUrl.trim()) {
            const newUrl = {
                id: `url-${Date.now()}`,
                url: regenerateNewPrerequisiteUrl.trim(),
            };
            setRegeneratePrerequisiteUrls([...regeneratePrerequisiteUrls, newUrl]);
            setRegenerateNewPrerequisiteUrl('');
        }
    };

    const handleRegenerateRemovePrerequisiteUrl = (id: string) => {
        setRegeneratePrerequisiteUrls(regeneratePrerequisiteUrls.filter((url) => url.id !== id));
    };

    const handleRegenerateRemovePrerequisiteFile = (id: string) => {
        setRegeneratePrerequisiteFiles(regeneratePrerequisiteFiles.filter((file) => file.id !== id));
    };

    const handleRegenerateAddTopic = () => {
        if (regenerateCourseNewTopic.trim() && !regenerateCourseTopics.includes(regenerateCourseNewTopic.trim())) {
            setRegenerateCourseTopics([...regenerateCourseTopics, regenerateCourseNewTopic.trim()]);
            setRegenerateCourseNewTopic('');
        }
    };

    const handleRegenerateRemoveTopic = (index: number) => {
        setRegenerateCourseTopics(regenerateCourseTopics.filter((_, i) => i !== index));
    };

    const handleRegenerateAddReferenceUrl = () => {
        if (regenerateNewReferenceUrl.trim()) {
            const newUrl = {
                id: `url-${Date.now()}`,
                url: regenerateNewReferenceUrl.trim(),
            };
            setRegenerateReferenceUrls([...regenerateReferenceUrls, newUrl]);
            setRegenerateNewReferenceUrl('');
        }
    };

    const handleRegenerateRemoveReferenceUrl = (id: string) => {
        setRegenerateReferenceUrls(regenerateReferenceUrls.filter((url) => url.id !== id));
    };

    const handleRegenerateRemoveReferenceFile = (id: string) => {
        setRegenerateReferenceFiles(regenerateReferenceFiles.filter((file) => file.id !== id));
    };

    // Dropzone for prerequisite files
    const onRegeneratePrerequisiteDrop = useCallback((acceptedFiles: File[]) => {
        const newFiles = acceptedFiles.map((file) => ({
            file,
            id: `file-${Date.now()}-${Math.random()}`,
        }));
        setRegeneratePrerequisiteFiles([...regeneratePrerequisiteFiles, ...newFiles]);
    }, [regeneratePrerequisiteFiles]);

    const {
        getRootProps: getRegeneratePrerequisiteRootProps,
        getInputProps: getRegeneratePrerequisiteInputProps,
        isDragActive: isRegeneratePrerequisiteDragActive,
    } = useDropzone({
        onDrop: onRegeneratePrerequisiteDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    });

    // Dropzone for reference files
    const onRegenerateReferenceDrop = useCallback((acceptedFiles: File[]) => {
        const newFiles = acceptedFiles.map((file) => ({
            file,
            id: `file-${Date.now()}-${Math.random()}`,
        }));
        setRegenerateReferenceFiles([...regenerateReferenceFiles, ...newFiles]);
    }, [regenerateReferenceFiles]);

    const {
        getRootProps: getRegenerateReferenceRootProps,
        getInputProps: getRegenerateReferenceInputProps,
        isDragActive: isRegenerateReferenceDragActive,
    } = useDropzone({
        onDrop: onRegenerateReferenceDrop,
        accept: {
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    });


    const handleEditField = (field: string, currentValue: any) => {
        setEditingField(field);
        setEditValues({ [field]: currentValue });
    };

    const handleSaveEdit = (field: string) => {
        if (field === 'tags') {
            const tagsArray = editValues[field]
                .split(',')
                .map((tag: string) => tag.trim())
                .filter((tag: string) => tag);
            setCourseData((prev) => ({ ...prev, [field]: tagsArray }));
        } else if (field === 'whatLearnersGain' || field === 'aboutCourse') {
            const arrayValue = editValues[field]
                .split('\n')
                .map((item: string) => item.trim())
                .filter((item: string) => item);
            setCourseData((prev) => ({ ...prev, [field]: arrayValue }));
        } else {
            setCourseData((prev) => ({ ...prev, [field]: editValues[field] }));
        }
        setEditingField(null);
        setEditValues({});
    };

    const handleCancelEdit = () => {
        setEditingField(null);
        setEditValues({});
    };

    const handleGenerateCourse = () => {
        // Show confirmation dialog
        setShowGenerateConfirmDialog(true);
    };

    const handleConfirmGenerate = () => {
        console.log('Generating course with outline:', courseData);
        // Close dialog and navigate to course generation page
        setShowGenerateConfirmDialog(false);
        navigate({ to: '/study-library/ai-copilot/course-outline/generating' });
    };

    const handleSlideEdit = (sessionId: string, slideId: string, newTitle: string) => {
        setCourseData((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) =>
                session.id === sessionId
                    ? {
                        ...session,
                        slides: session.slides.map((slide) =>
                            slide.id === slideId ? { ...slide, title: newTitle } : slide
                        ),
                    }
                    : session
            ),
        }));
    };

    const handleSlideDelete = (sessionId: string, slideId: string) => {
        setCourseData((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) =>
                session.id === sessionId
                    ? {
                        ...session,
                        slides: session.slides.filter((slide) => slide.id !== slideId),
                    }
                    : session
            ),
        }));
    };

    const handleSlidePromptUpdate = (sessionId: string, slideId: string, prompt: string) => {
        setCourseData((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) =>
                session.id === sessionId
                    ? {
                        ...session,
                        slides: session.slides.map((slide) =>
                            slide.id === slideId ? { ...slide, prompt: prompt || undefined } : slide
                        ),
                    }
                    : session
            ),
        }));
    };

    const getDefaultSlideTitle = (type: SlideType): string => {
        switch (type) {
            case 'doc':
                return t('defaultSlideTitle.doc');
            case 'pdf':
                return t('defaultSlideTitle.pdf');
            case 'video':
                return t('defaultSlideTitle.video');
            case 'image':
                return t('defaultSlideTitle.image');
            case 'jupyter':
                return t('defaultSlideTitle.jupyter');
            case 'code-editor':
                return t('defaultSlideTitle.codeEditor');
            case 'scratch':
                return t('defaultSlideTitle.scratch');
            case 'video-jupyter':
                return t('defaultSlideTitle.videoJupyter');
            case 'video-code-editor':
                return t('defaultSlideTitle.videoCodeEditor');
            case 'video-scratch':
                return t('defaultSlideTitle.videoScratch');
            case 'assignment':
                return t('defaultSlideTitle.assignment');
            default:
                return t('defaultSlideTitle.newPage');
        }
    };

    const handleAddSlide = (sessionId: string, slideType: SlideType, title: string) => {
        const session = courseData.sessions.find((s) => s.id === sessionId);
        if (!session) return;

        const newSlide: Slide = {
            id: `${sessionId}-slide-${Date.now()}`,
            type: slideType,
            title: title.trim() || getDefaultSlideTitle(slideType),
        };

        setCourseData((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) =>
                session.id === sessionId
                    ? {
                        ...session,
                        slides: [...session.slides, newSlide],
                    }
                    : session
            ),
        }));

        setAddSlideDialogOpen((prev) => ({ ...prev, [sessionId]: false }));
        setSelectedSlideType((prev) => ({ ...prev, [sessionId]: null }));
        setSlideTitle((prev) => {
            const newPrev = { ...prev };
            delete newPrev[`${sessionId}-${slideType}`];
            return newPrev;
        });
    };

    const handleSelectSlideType = (sessionId: string, slideType: SlideType) => {
        setSelectedSlideType((prev) => ({ ...prev, [sessionId]: slideType }));
        // Don't pre-fill the title - let user enter it manually
    };

    const handleConfirmAddSlide = (sessionId: string) => {
        const slideType = selectedSlideType[sessionId];
        if (slideType) {
            const titleKey = `${sessionId}-${slideType}`;
            const title = slideTitle[titleKey] || getDefaultSlideTitle(slideType);
            handleAddSlide(sessionId, slideType, title);
        }
    };

    const handleDragEnd = (sessionId: string, event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setCourseData((prev) => {
            const session = prev.sessions.find((s) => s.id === sessionId);
            if (!session) return prev;

            const oldIndex = session.slides.findIndex((slide) => slide.id === active.id);
            const newIndex = session.slides.findIndex((slide) => slide.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return prev;

            const newSlides = arrayMove(session.slides, oldIndex, newIndex);

            return {
                ...prev,
                sessions: prev.sessions.map((s) =>
                    s.id === sessionId ? { ...s, slides: newSlides } : s
                ),
            };
        });
    };

    const handleSessionDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setCourseData((prev) => {
            const oldIndex = prev.sessions.findIndex((session) => session.id === active.id);
            const newIndex = prev.sessions.findIndex((session) => session.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return prev;

            const newSessions = arrayMove(prev.sessions, oldIndex, newIndex);
            return {
                ...prev,
                sessions: newSessions,
            };
        });
    };

    const handleSessionEdit = (sessionId: string, newTitle: string) => {
        setCourseData((prev) => ({
            ...prev,
            sessions: prev.sessions.map((session) =>
                session.id === sessionId ? { ...session, title: newTitle } : session
            ),
        }));
    };

    const handleSessionDelete = (sessionId: string) => {
        setCourseData((prev) => ({
            ...prev,
            sessions: prev.sessions.filter((session) => session.id !== sessionId),
            totalSessions: prev.totalSessions - 1,
        }));
        // Remove from open sessions if it was open
        setOpenSessions((prev) => prev.filter((id) => id !== sessionId));
    };

    const handleAddSession = () => {
        setAddSessionName('');
        setAddSessionDialogOpen(true);
    };

    const handleConfirmAddSession = () => {
        if (!addSessionName.trim()) {
            return;
        }
        setAddSessionDialogOpen(false);
        const newSessionId = `session-${Date.now()}`;
        const newSession: Session = {
            id: newSessionId,
            title: addSessionName.trim(),
            learningObjectives: [],
            topics: [],
            hasQuiz: false,
            hasHomework: false,
            slides: [],
        };
        setCourseData((prev) => ({
            ...prev,
            sessions: [...prev.sessions, newSession],
            totalSessions: prev.totalSessions + 1,
        }));
        setOpenSessions((prev) => [...prev, newSessionId]);
        setAddSessionName('');
    };

    const handleToggleAllSessions = () => {
        if (openSessions.length === courseData.sessions.length) {
            // Collapse all
            setOpenSessions([]);
        } else {
            // Expand all
            setOpenSessions(courseData.sessions.map((session) => session.id));
        }
    };

    const isAllExpanded = openSessions.length === courseData.sessions.length;

    // Loading state
    if (isInitialLoading) {
        return (
            <LayoutContainer>
                <Helmet>
                    <title>{t('pageMeta.loadingTitle')}</title>
                </Helmet>
                <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50">
                    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                        <div className="flex items-center justify-center gap-2 py-20">
                            <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
                            <span className="text-sm font-medium text-indigo-600">
                                {t('loading', { product: getAiProductName() })}
                            </span>
                        </div>
                    </div>
                </div>
            </LayoutContainer>
        );
    }

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageMeta.title')}</title>
                <meta name="description" content={t('pageMeta.description')} />
            </Helmet>

            <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50">
                <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
                    {/* Header Section */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="mb-6"
                    >
                        <button
                            onClick={handleBack}
                            className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-indigo-600"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            {t('backToCreateCourse')}
                        </button>

                        <div className="mb-6 flex items-start justify-between">
                            <div>
                                <h1 className="mb-2 text-3xl font-semibold text-neutral-900">
                                    {t('stepHeading')}
                                </h1>
                                <p className="text-base text-gray-600">
                                    {t('stepDescription')}
                                </p>
                            </div>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleGenerateCourse}
                                className="min-w-[140px] bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                            >
                                <Sparkles className="h-4 w-4" />
                                {t('generatePageContent')}
                            </MyButton>
                        </div>
                    </motion.div>

                    {/* Two Column Layout */}
                    <div ref={metadataContainerRef} className="grid gap-6 lg:grid-cols-[1fr_400px]">
                        {/* Left Column - Course Outline */}
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="rounded-xl bg-white p-6 shadow-md"
                        >
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="flex items-center gap-2 text-2xl font-semibold text-neutral-900">
                                    <Layers className="h-6 w-6 text-indigo-600" />
                                    {t('courseOutline')}
                                </h2>
                                <div className="flex gap-2">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={handleToggleAllSessions}
                                    >
                                        {isAllExpanded ? (
                                            <>
                                                <ChevronsUp className="h-3 w-3" />
                                                {t('collapseAll')}
                                            </>
                                        ) : (
                                            <>
                                                <ChevronsDown className="h-3 w-3" />
                                                {t('expandAll')}
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
                                    items={courseData.sessions.map((s) => s.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <Accordion
                                        type="multiple"
                                        value={openSessions}
                                        onValueChange={setOpenSessions}
                                        className="w-full"
                                    >
                                        {courseData.sessions.map((session, index) => (
                                            <SortableSessionItem
                                                key={session.id}
                                                session={session}
                                                index={index}
                                                onEdit={handleSessionEdit}
                                                onDelete={handleSessionDelete}
                                            >
                                                <AccordionContent className="pb-4 pt-0">
                                                    <div className="ml-11">
                                                        <DndContext
                                                            sensors={sensors}
                                                            collisionDetection={closestCenter}
                                                            onDragEnd={(event) => handleDragEnd(session.id, event)}
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
                                                                            sessionId={session.id}
                                                                            onEdit={(slideId, newTitle) =>
                                                                                handleSlideEdit(session.id, slideId, newTitle)
                                                                            }
                                                                            onDelete={(slideId) => handleSlideDelete(session.id, slideId)}
                                                                            onUpdatePrompt={(slideId, prompt) =>
                                                                                handleSlidePromptUpdate(session.id, slideId, prompt)
                                                                            }
                                                                        />
                                                                    ))}
                                                                    {/* Add Page Button */}
                                                                    <Dialog
                                                                        open={addSlideDialogOpen[session.id] || false}
                                                                        onOpenChange={(open) => {
                                                                            setAddSlideDialogOpen((prev) => ({
                                                                                ...prev,
                                                                                [session.id]: open,
                                                                            }));
                                                                            if (!open) {
                                                                                setSelectedSlideType((prev) => ({ ...prev, [session.id]: null }));
                                                                                setSlideTitle((prev) => {
                                                                                    const newPrev = { ...prev };
                                                                                    Object.keys(newPrev).forEach((key) => {
                                                                                        if (key.startsWith(`${session.id}-`)) {
                                                                                            delete newPrev[key];
                                                                                        }
                                                                                    });
                                                                                    return newPrev;
                                                                                });
                                                                            }
                                                                        }}
                                                                    >
                                                                        <DialogTrigger asChild>
                                                                            <button className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50">
                                                                                <Plus className="h-4 w-4" />
                                                                                {t('addPage')}
                                                                            </button>
                                                                        </DialogTrigger>
                                                                        <DialogContent className="w-[80vw] max-w-[80vw] max-h-[90vh] flex flex-col p-0">
                                                                            <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0 border-b">
                                                                                <DialogTitle>{t('selectPageType')}</DialogTitle>
                                                                                <DialogDescription>
                                                                                    {t('selectPageTypeDescription')}
                                                                                </DialogDescription>
                                                                            </DialogHeader>
                                                                            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                                                                <div>
                                                                                    <Label className="mb-3 block text-sm font-medium">{t('pageType')}</Label>
                                                                                    <div className="grid grid-cols-3 gap-3">
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'doc')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'doc'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <FileText className="h-6 w-6 text-blue-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.doc')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'pdf')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'pdf'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <File className="h-6 w-6 text-red-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.pdf')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'video')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'video'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <Video className="h-6 w-6 text-red-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.video')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'image')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'image'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <ImageIcon className="h-6 w-6 text-blue-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.image')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'jupyter')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'jupyter'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <Notebook className="h-6 w-6 text-orange-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.jupyter')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'code-editor')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'code-editor'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <Code className="h-6 w-6 text-green-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.codeEditor')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'scratch')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'scratch'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <Puzzle className="h-6 w-6 text-purple-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.scratch')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'video-jupyter')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'video-jupyter'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <div className="flex items-center gap-1">
                                                                                                <Video className="h-5 w-5 text-red-600" />
                                                                                                <Notebook className="h-5 w-5 text-orange-600" />
                                                                                            </div>
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.videoJupyter')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'video-code-editor')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'video-code-editor'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <div className="flex items-center gap-1">
                                                                                                <Video className="h-5 w-5 text-red-600" />
                                                                                                <Code className="h-5 w-5 text-green-600" />
                                                                                            </div>
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.videoCodeEditor')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'video-scratch')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'video-scratch'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <div className="flex items-center gap-1">
                                                                                                <Video className="h-5 w-5 text-red-600" />
                                                                                                <Puzzle className="h-5 w-5 text-purple-600" />
                                                                                            </div>
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.videoScratch')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'quiz')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'quiz'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <FileQuestion className="h-6 w-6 text-purple-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.quiz')}</span>
                                                                                        </button>
                                                                                        <button
                                                                                            onClick={() => handleSelectSlideType(session.id, 'assignment')}
                                                                                            className={cn(
                                                                                                "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                                                                                                selectedSlideType[session.id] === 'assignment'
                                                                                                    ? "border-indigo-500 bg-indigo-50"
                                                                                                    : "border-neutral-200 bg-white hover:border-indigo-400 hover:bg-indigo-50"
                                                                                            )}
                                                                                        >
                                                                                            <ClipboardList className="h-6 w-6 text-orange-600" />
                                                                                            <span className="text-sm font-medium">{t('slideTypeOption.assignment')}</span>
                                                                                        </button>
                                                                                    </div>
                                                                                </div>

                                                                                <div>
                                                                                    <Label htmlFor="slideTitle" className="mb-2 block text-sm font-medium">
                                                                                        {t('pageTitle')}
                                                                                    </Label>
                                                                                    <Input
                                                                                        id="slideTitle"
                                                                                        value={slideTitle[`${session.id}-${selectedSlideType[session.id] || ''}`] || ''}
                                                                                        onChange={(e) =>
                                                                                            setSlideTitle((prev) => ({
                                                                                                ...prev,
                                                                                                [`${session.id}-${selectedSlideType[session.id] || ''}`]: e.target.value,
                                                                                            }))
                                                                                        }
                                                                                        placeholder={selectedSlideType[session.id] ? t('pageTitlePlaceholder', { example: getDefaultSlideTitle(selectedSlideType[session.id]!) }) : t('selectPageTypeFirst')}
                                                                                        className="w-full"
                                                                                        disabled={!selectedSlideType[session.id]}
                                                                                        onKeyDown={(e) => {
                                                                                            if (e.key === 'Enter' && selectedSlideType[session.id] && slideTitle[`${session.id}-${selectedSlideType[session.id]}`]?.trim()) {
                                                                                                handleConfirmAddSlide(session.id);
                                                                                            }
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            <div className="px-6 py-4 flex-shrink-0 border-t flex justify-end">
                                                                                <MyButton
                                                                                    buttonType="primary"
                                                                                    onClick={() => handleConfirmAddSlide(session.id)}
                                                                                    disabled={!selectedSlideType[session.id] || !slideTitle[`${session.id}-${selectedSlideType[session.id]}`]?.trim()}
                                                                                >
                                                                                    {t('addPage')}
                                                                                </MyButton>
                                                                            </div>
                                                                        </DialogContent>
                                                                    </Dialog>
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

                            {/* {`Add ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`} Button */}
                            <button
                                onClick={handleAddSession}
                                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50"
                            >
                                <Plus className="h-4 w-4" />
                                {`Add ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`}
                            </button>
                        </motion.div>

                        {/* Right Column - Metadata */}
                        <motion.div
                            ref={metadataRef}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className={`space-y-4 ${isMetadataSticky ? 'sticky top-6 [&::-webkit-scrollbar]:hidden' : ''}`}
                            style={{
                                maxHeight: isMetadataSticky ? 'calc(100vh - 3rem)' : 'none',
                                overflowY: isMetadataSticky ? 'auto' : 'visible',
                                scrollbarWidth: 'none', // Firefox
                                msOverflowStyle: 'none', // IE/Edge
                            }}
                        >
                            {/* Course Name */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">{t('courseName')}</label>
                                    <div className="flex gap-2">
                                        {editingField !== 'title' && (
                                            <button
                                                onClick={() => handleEditField('title', courseData.title)}
                                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                                title={t('actions.edit')}
                                            >
                                                <Edit2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editingField === 'title' ? (
                                    <div className="space-y-2">
                                        <Input
                                            value={editValues.title || ''}
                                            onChange={(e) => setEditValues({ title: e.target.value })}
                                            className="text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => handleSaveEdit('title')}
                                            >
                                                {t('actions.save')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={handleCancelEdit}
                                            >
                                                {t('actions.cancel')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-neutral-900">{courseData.title}</p>
                                )}
                            </div>

                            {/* Description */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">{t('description')}</label>
                                    <div className="flex gap-2">
                                        {editingField !== 'subtitle' && (
                                            <button
                                                onClick={() => handleEditField('subtitle', courseData.subtitle)}
                                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                            >
                                                <Edit2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editingField === 'subtitle' ? (
                                    <div className="space-y-2">
                                        <Textarea
                                            value={editValues.subtitle || ''}
                                            onChange={(e) => setEditValues({ subtitle: e.target.value })}
                                            className="min-h-[60px] text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => handleSaveEdit('subtitle')}
                                            >
                                                {t('actions.save')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={handleCancelEdit}
                                            >
                                                {t('actions.cancel')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-neutral-700">{courseData.subtitle}</p>
                                )}
                            </div>

                            {/* Level */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">{t('level')}</label>
                                </div>
                                <Select
                                    value={courseData.level}
                                    onValueChange={(value) => {
                                        setCourseData((prev) => ({ ...prev, level: value }));
                                    }}
                                >
                                    <SelectTrigger className="w-full text-sm">
                                        <SelectValue placeholder={t('selectLevel')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {instituteLevels.length > 0 ? (
                                            instituteLevels.map((level) => (
                                                <SelectItem key={level.id} value={level.id}>
                                                    {level.level_name}
                                                </SelectItem>
                                            ))
                                        ) : (
                                            <>
                                                <SelectItem value="Beginner">{t('levelOption.beginner')}</SelectItem>
                                                <SelectItem value="Basic">{t('levelOption.basic')}</SelectItem>
                                                <SelectItem value="Intermediate">{t('levelOption.intermediate')}</SelectItem>
                                                <SelectItem value="Advanced">{t('levelOption.advanced')}</SelectItem>
                                            </>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Course Tags */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">{t('courseTags')}</label>
                                    <div className="flex gap-2">
                                        {editingField !== 'tags' && (
                                            <button
                                                onClick={() => handleEditField('tags', courseData.tags.join(', '))}
                                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                            >
                                                <Edit2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editingField === 'tags' ? (
                                    <div className="space-y-2">
                                        <Textarea
                                            value={editValues.tags || ''}
                                            onChange={(e) => setEditValues({ tags: e.target.value })}
                                            placeholder={t('tagsPlaceholder')}
                                            className="min-h-[60px] text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => handleSaveEdit('tags')}
                                            >
                                                {t('actions.save')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={handleCancelEdit}
                                            >
                                                {t('actions.cancel')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {courseData.tags.map((tag, index) => (
                                            <span
                                                key={index}
                                                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                                            >
                                                <Tag className="h-3 w-3" />
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Course Preview Image */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <label className="text-base font-bold text-neutral-900">
                                            {t('coursePreviewImage.label')}
                                        </label>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            {t('coursePreviewImage.hint')}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {courseData.previewImage ? (
                                        <div className="relative">
                                            <img
                                                src={courseData.previewImage}
                                                alt={t('coursePreviewImage.alt')}
                                                className="h-32 w-full rounded-lg object-cover"
                                            />
                                            <button
                                                onClick={() =>
                                                    setCourseData((prev) => ({ ...prev, previewImage: undefined }))
                                                }
                                                className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                                                title={t('removeImage')}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                            <div className="mt-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                    <Upload className="h-3 w-3" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url = URL.createObjectURL(file);
                                                                setCourseData((prev) => ({ ...prev, previewImage: url }));
                                                            }
                                                        }}
                                                    />
                                                    {t('actions.upload')}
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
                                                        setCourseData((prev) => ({ ...prev, previewImage: url }));
                                                    }
                                                }}
                                            />
                                            <ImageIcon className="mb-2 h-8 w-8 text-neutral-400" />
                                            <span className="text-sm font-medium text-neutral-600">
                                                {t('coursePreviewImage.uploadHint')}
                                            </span>
                                            <span className="mt-1 text-xs text-neutral-500">
                                                {t('coursePreviewImage.uploadSubHint')}
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
                                            {t('courseBannerImage.label')}
                                        </label>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            {t('courseBannerImage.hint')}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {courseData.bannerImage ? (
                                        <div className="relative">
                                            <img
                                                src={courseData.bannerImage}
                                                alt={t('courseBannerImage.alt')}
                                                className="h-32 w-full rounded-lg object-cover"
                                            />
                                            <button
                                                onClick={() =>
                                                    setCourseData((prev) => ({ ...prev, bannerImage: undefined }))
                                                }
                                                className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                                                title={t('removeImage')}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                            <div className="mt-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                    <Upload className="h-3 w-3" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url = URL.createObjectURL(file);
                                                                setCourseData((prev) => ({ ...prev, bannerImage: url }));
                                                            }
                                                        }}
                                                    />
                                                    {t('actions.upload')}
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
                                                        setCourseData((prev) => ({ ...prev, bannerImage: url }));
                                                    }
                                                }}
                                            />
                                            <ImageIcon className="mb-2 h-8 w-8 text-neutral-400" />
                                            <span className="text-sm font-medium text-neutral-600">
                                                {t('courseBannerImage.uploadHint')}
                                            </span>
                                            <span className="mt-1 text-xs text-neutral-500">
                                                {t('courseBannerImage.uploadSubHint')}
                                            </span>
                                        </label>
                                    )}
                                </div>
                            </div>

                            {/* Course Media */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <label className="text-base font-bold text-neutral-900">{t('courseMedia.label')}</label>
                                        <p className="mt-1 text-xs text-neutral-500">
                                            {t('courseMedia.hint')}
                                        </p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {courseData.courseMedia ? (
                                        <div className="relative">
                                            {courseData.courseMediaType === 'youtube' ? (
                                                <iframe
                                                    src={courseData.courseMedia}
                                                    className="h-32 w-full rounded-lg"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                />
                                            ) : courseData.courseMediaType === 'video' ? (
                                                <video
                                                    src={courseData.courseMedia}
                                                    className="h-32 w-full rounded-lg object-cover"
                                                    controls
                                                />
                                            ) : (
                                                <img
                                                    src={courseData.courseMedia}
                                                    alt={t('courseMedia.alt')}
                                                    className="h-32 w-full rounded-lg object-cover"
                                                />
                                            )}
                                            <button
                                                onClick={() =>
                                                    setCourseData((prev) => ({
                                                        ...prev,
                                                        courseMedia: undefined,
                                                        courseMediaType: undefined,
                                                    }))
                                                }
                                                className="absolute right-2 top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                                                title={t('courseMedia.removeMedia')}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                            <div className="mt-2 flex gap-2">
                                                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50">
                                                    <Upload className="h-3 w-3" />
                                                    <input
                                                        type="file"
                                                        accept="image/*,video/*"
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) {
                                                                const url = URL.createObjectURL(file);
                                                                const isVideo = file.type.startsWith('video/');
                                                                setCourseData((prev) => ({
                                                                    ...prev,
                                                                    courseMedia: url,
                                                                    courseMediaType: isVideo ? 'video' : 'image',
                                                                }));
                                                            }
                                                        }}
                                                    />
                                                    {t('actions.upload')}
                                                </label>
                                                <button
                                                    onClick={() => setMediaEditMode((prev) => ({ ...prev, courseMedia: 'youtube' }))}
                                                    className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                                                >
                                                    <Video className="h-3 w-3" />
                                                    {t('courseMedia.youtubeLink')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {mediaEditMode.courseMedia === 'youtube' ? (
                                                <div className="space-y-2">
                                                    <Input
                                                        placeholder={t('courseMedia.youtubeUrlPlaceholder')}
                                                        className="text-sm"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                const url = (e.target as HTMLInputElement).value;
                                                                if (isYouTubeUrl(url)) {
                                                                    const embedUrl = getYouTubeEmbedUrl(url);
                                                                    if (embedUrl) {
                                                                        setCourseData((prev) => ({
                                                                            ...prev,
                                                                            courseMedia: embedUrl,
                                                                            courseMediaType: 'youtube',
                                                                        }));
                                                                        setMediaEditMode((prev) => ({ ...prev, courseMedia: null }));
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
                                                                const input = (e.target as HTMLElement).closest('div')?.querySelector('input') as HTMLInputElement;
                                                                if (input) {
                                                                    const url = input.value;
                                                                    if (isYouTubeUrl(url)) {
                                                                        const embedUrl = getYouTubeEmbedUrl(url);
                                                                        if (embedUrl) {
                                                                            setCourseData((prev) => ({
                                                                                ...prev,
                                                                                courseMedia: embedUrl,
                                                                                courseMediaType: 'youtube',
                                                                            }));
                                                                            setMediaEditMode((prev) => ({ ...prev, courseMedia: null }));
                                                                        }
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {t('actions.save')}
                                                        </MyButton>
                                                        <MyButton
                                                            buttonType="secondary"
                                                            scale="small"
                                                            onClick={() => setMediaEditMode((prev) => ({ ...prev, courseMedia: null }))}
                                                        >
                                                            {t('actions.cancel')}
                                                        </MyButton>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50">
                                                        <input
                                                            type="file"
                                                            accept="image/*,video/*"
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                const file = e.target.files?.[0];
                                                                if (file) {
                                                                    const url = URL.createObjectURL(file);
                                                                    const isVideo = file.type.startsWith('video/');
                                                                    setCourseData((prev) => ({
                                                                        ...prev,
                                                                        courseMedia: url,
                                                                        courseMediaType: isVideo ? 'video' : 'image',
                                                                    }));
                                                                }
                                                            }}
                                                        />
                                                        <ImageIcon className="mb-2 h-8 w-8 text-neutral-400" />
                                                        <span className="text-sm font-medium text-neutral-600">
                                                            {t('courseMedia.uploadHint')}
                                                        </span>
                                                        <span className="mt-1 text-xs text-neutral-500">
                                                            {t('courseMedia.uploadSubHint')}
                                                        </span>
                                                    </label>
                                                    <button
                                                        onClick={() => setMediaEditMode((prev) => ({ ...prev, courseMedia: 'youtube' }))}
                                                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                                                    >
                                                        <Video className="h-4 w-4" />
                                                        {t('courseMedia.addYoutubeLink')}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* What Learners Will Gain */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">
                                        {t('whatLearnersGain.label')}
                                    </label>
                                    <div className="flex gap-2">
                                        {editingField !== 'whatLearnersGain' && (
                                            <button
                                                onClick={() =>
                                                    handleEditField(
                                                        'whatLearnersGain',
                                                        courseData.whatLearnersGain.join('\n')
                                                    )
                                                }
                                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                            >
                                                <Edit2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editingField === 'whatLearnersGain' ? (
                                    <div className="space-y-2">
                                        <Textarea
                                            value={editValues.whatLearnersGain || ''}
                                            onChange={(e) => setEditValues({ whatLearnersGain: e.target.value })}
                                            placeholder={t('whatLearnersGain.placeholder')}
                                            className="min-h-[120px] text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => handleSaveEdit('whatLearnersGain')}
                                            >
                                                {t('actions.save')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={handleCancelEdit}
                                            >
                                                {t('actions.cancel')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <ul className="ml-4 list-disc space-y-2">
                                        {courseData.whatLearnersGain.map((gain, index) => (
                                            <li key={index} className="text-sm text-neutral-700">
                                                {gain}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            {/* Who Should Join */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">{t('whoShouldJoin')}</label>
                                    <div className="flex gap-2">
                                        {editingField !== 'whoShouldJoin' && (
                                            <button
                                                onClick={() => handleEditField('whoShouldJoin', courseData.whoShouldJoin)}
                                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                            >
                                                <Edit2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editingField === 'whoShouldJoin' ? (
                                    <div className="space-y-2">
                                        <Textarea
                                            value={editValues.whoShouldJoin || ''}
                                            onChange={(e) => setEditValues({ whoShouldJoin: e.target.value })}
                                            className="min-h-[80px] text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => handleSaveEdit('whoShouldJoin')}
                                            >
                                                {t('actions.save')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={handleCancelEdit}
                                            >
                                                {t('actions.cancel')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-neutral-700">{courseData.whoShouldJoin}</p>
                                )}
                            </div>

                            {/* About the Course */}
                            <div className="rounded-xl bg-white p-4 shadow-md">
                                <div className="mb-3 flex items-center justify-between">
                                    <label className="text-base font-bold text-neutral-900">{t('aboutCourse')}</label>
                                    <div className="flex gap-2">
                                        {editingField !== 'aboutCourse' && (
                                            <button
                                                onClick={() =>
                                                    handleEditField('aboutCourse', courseData.aboutCourse.join('\n\n'))
                                                }
                                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                            >
                                                <Edit2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editingField === 'aboutCourse' ? (
                                    <div className="space-y-2">
                                        <Textarea
                                            value={editValues.aboutCourse || ''}
                                            onChange={(e) => setEditValues({ aboutCourse: e.target.value })}
                                            className="min-h-[150px] text-sm"
                                        />
                                        <div className="flex gap-2">
                                            <MyButton
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => handleSaveEdit('aboutCourse')}
                                            >
                                                {t('actions.save')}
                                            </MyButton>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={handleCancelEdit}
                                            >
                                                {t('actions.cancel')}
                                            </MyButton>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2 text-sm text-neutral-700">
                                        {courseData.aboutCourse.map((paragraph, index) => (
                                            <p key={index}>{paragraph}</p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>
            {/* Regenerate Outline Dialog */}
            <Dialog open={regenerateDialogOpen} onOpenChange={(open) => {
                setRegenerateDialogOpen(open);
            }}>
                <DialogContent className="w-[80vw] max-w-[80vw] max-h-[90vh] flex flex-col p-0">
                    <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0 border-b">
                        <DialogTitle>{t('regenerateDialog.title')}</DialogTitle>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        <div className="space-y-6">
                            {/* 1. Course Goal and Learning Outcome */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-neutral-900">{t('regenerateDialog.section1Heading')}</h3>

                                <div className="space-y-4">
                                    <div>
                                        <Label htmlFor="regenerateCourseGoal" className="mb-2 block">
                                            {t('regenerateDialog.courseGoalLabel')} <span className="text-red-500">*</span>
                                        </Label>
                                        <Textarea
                                            id="regenerateCourseGoal"
                                            value={regenerateCourseGoal}
                                            onChange={(e) => setRegenerateCourseGoal(e.target.value)}
                                            placeholder={t('regenerateDialog.courseGoalPlaceholder')}
                                            className="min-h-[100px] w-full"
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="regenerateLearningOutcome" className="mb-2 block">
                                            {t('regenerateDialog.learningOutcomeLabel')}
                                        </Label>
                                        <Textarea
                                            id="regenerateLearningOutcome"
                                            value={regenerateLearningOutcome}
                                            onChange={(e) => setRegenerateLearningOutcome(e.target.value)}
                                            placeholder={t('regenerateDialog.learningOutcomePlaceholder')}
                                            className="min-h-[100px] w-full"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 2. Learner Profile */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-neutral-900">{t('regenerateDialog.section2Heading')}</h3>

                                <div className="space-y-4">
                                    <div>
                                        <Label htmlFor="regenerateAgeRange" className="mb-2 block">
                                            {t('regenerateDialog.ageRangeLabel')}
                                        </Label>
                                        <Input
                                            id="regenerateAgeRange"
                                            value={regenerateAgeRange}
                                            onChange={(e) => setRegenerateAgeRange(e.target.value)}
                                            placeholder={t('regenerateDialog.ageRangePlaceholder')}
                                            className="w-full"
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="regenerateSkillLevel" className="mb-2 block">
                                            {t('regenerateDialog.skillLevelLabel')}
                                        </Label>
                                        <Select value={regenerateSkillLevel} onValueChange={setRegenerateSkillLevel}>
                                            <SelectTrigger id="regenerateSkillLevel" className="w-full">
                                                <SelectValue placeholder={t('regenerateDialog.selectSkillLevel')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {instituteLevels.length > 0 ? (
                                                    instituteLevels.map((level) => (
                                                        <SelectItem key={level.id} value={level.id}>
                                                            {level.level_name}
                                                        </SelectItem>
                                                    ))
                                                ) : (
                                                    <>
                                                        <SelectItem value="beginner">{t('levelOption.beginner')}</SelectItem>
                                                        <SelectItem value="intermediate">{t('levelOption.intermediate')}</SelectItem>
                                                        <SelectItem value="advanced">{t('levelOption.advanced')}</SelectItem>
                                                    </>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div>
                                        <Label className="mb-2 block">{t('regenerateDialog.prerequisiteCoursesLabel')}</Label>
                                        <div className="space-y-3">
                                            <div className="flex gap-2">
                                                <Input
                                                    value={regenerateNewPrerequisiteUrl}
                                                    onChange={(e) => setRegenerateNewPrerequisiteUrl(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleRegenerateAddPrerequisiteUrl();
                                                        }
                                                    }}
                                                    placeholder={t('regenerateDialog.urlPlaceholder')}
                                                    className="flex-1"
                                                />
                                                <MyButton
                                                    buttonType="secondary"
                                                    onClick={handleRegenerateAddPrerequisiteUrl}
                                                    disabled={!regenerateNewPrerequisiteUrl.trim()}
                                                >
                                                    <Link className="h-4 w-4 me-1" />
                                                    {t('regenerateDialog.addUrl')}
                                                </MyButton>
                                            </div>

                                            {regeneratePrerequisiteUrls.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {regeneratePrerequisiteUrls.map((url) => (
                                                        <div
                                                            key={url.id}
                                                            className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                                        >
                                                            <Link className="h-3.5 w-3.5" />
                                                            <span className="max-w-[200px] truncate">{url.url}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRegenerateRemovePrerequisiteUrl(url.id)}
                                                                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div
                                                {...getRegeneratePrerequisiteRootProps()}
                                                className={cn(
                                                    'flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-all duration-200',
                                                    isRegeneratePrerequisiteDragActive
                                                        ? 'border-indigo-400 bg-indigo-50'
                                                        : 'border-neutral-300 bg-neutral-50 hover:border-indigo-300 hover:bg-indigo-50'
                                                )}
                                            >
                                                <input {...getRegeneratePrerequisiteInputProps()} className="hidden" />
                                                <Upload className={cn('h-5 w-5', isRegeneratePrerequisiteDragActive ? 'text-indigo-600' : 'text-neutral-500')} />
                                                <span className="text-xs font-medium text-neutral-600">
                                                    {t('regenerateDialog.attachFilesHint')}
                                                </span>
                                            </div>

                                            {regeneratePrerequisiteFiles.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {regeneratePrerequisiteFiles.map((file) => (
                                                        <div
                                                            key={file.id}
                                                            className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                                        >
                                                            <FileText className="h-3.5 w-3.5" />
                                                            <span className="max-w-[150px] truncate">{file.file.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRegenerateRemovePrerequisiteFile(file.id)}
                                                                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 3. Duration, Format, and Structure */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-neutral-900">{t('regenerateDialog.section3Heading')}</h3>

                                <div className="space-y-4">
                                    <div>
                                        <Label htmlFor="regenerateCourseNumberOfSessions" className="mb-2 block">
                                            {t('regenerateDialog.numberOfSessions', { term: getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters) })}
                                        </Label>
                                        <Input
                                            id="regenerateCourseNumberOfSessions"
                                            type="number"
                                            min="1"
                                            value={regenerateCourseNumberOfSessions}
                                            onChange={(e) => setRegenerateCourseNumberOfSessions(e.target.value)}
                                            placeholder={t('regenerateDialog.numberOfSessionsPlaceholder')}
                                            className="w-full"
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="regenerateCourseSessionLength" className="mb-2 block">
                                            {t('regenerateDialog.sessionLengthLabel')}
                                        </Label>
                                        <div className="space-y-2">
                                            <Select value={regenerateCourseSessionLength} onValueChange={handleRegenerateCourseSessionLengthChange}>
                                                <SelectTrigger id="regenerateCourseSessionLength" className="w-full">
                                                    <SelectValue placeholder={t('regenerateDialog.selectSessionLength')} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="45">{t('sessionLengthOption.45')}</SelectItem>
                                                    <SelectItem value="60">{t('sessionLengthOption.60')}</SelectItem>
                                                    <SelectItem value="90">{t('sessionLengthOption.90')}</SelectItem>
                                                    <SelectItem value="custom">{t('sessionLengthOption.custom')}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {regenerateCourseSessionLength === 'custom' && (
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    value={regenerateCourseCustomSessionLength}
                                                    onChange={(e) => setRegenerateCourseCustomSessionLength(e.target.value)}
                                                    placeholder={t('regenerateDialog.customSessionLengthPlaceholder')}
                                                    className="w-full"
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <Label className="mb-2 block">{t('regenerateDialog.whatToIncludeLabel')}</Label>
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeDiagrams"
                                                    checked={regenerateCourseIncludeDiagrams}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeDiagrams(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeDiagrams" className="cursor-pointer">
                                                    {t('regenerateDialog.includeDiagrams')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeCodeSnippets"
                                                    checked={regenerateCourseIncludeCodeSnippets}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeCodeSnippets(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeCodeSnippets" className="cursor-pointer">
                                                    {t('regenerateDialog.includeCodeSnippets')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludePracticeProblems"
                                                    checked={regenerateCourseIncludePracticeProblems}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludePracticeProblems(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludePracticeProblems" className="cursor-pointer">
                                                    {t('regenerateDialog.includePracticeProblems')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeQuizzes"
                                                    checked={regenerateCourseIncludeQuizzes}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeQuizzes(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeQuizzes" className="cursor-pointer">
                                                    {t('regenerateDialog.includeQuizzes')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeHomework"
                                                    checked={regenerateCourseIncludeHomework}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeHomework(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeHomework" className="cursor-pointer">
                                                    {t('regenerateDialog.includeAssignments')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeSolutions"
                                                    checked={regenerateCourseIncludeSolutions}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeSolutions(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeSolutions" className="cursor-pointer">
                                                    {t('regenerateDialog.includeSolutions')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeYouTubeVideo"
                                                    checked={regenerateCourseIncludeYouTubeVideo}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeYouTubeVideo(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeYouTubeVideo" className="cursor-pointer">
                                                    {t('regenerateDialog.includeYoutubeVideo')}
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="regenerateCourseIncludeAIGeneratedVideo"
                                                    checked={regenerateCourseIncludeAIGeneratedVideo}
                                                    onCheckedChange={(checked) => setRegenerateCourseIncludeAIGeneratedVideo(checked === true)}
                                                />
                                                <Label htmlFor="regenerateCourseIncludeAIGeneratedVideo" className="cursor-pointer">
                                                    {t('regenerateDialog.includeAiVideo')}
                                                </Label>
                                            </div>
                                        </div>
                                        {regenerateCourseIncludeCodeSnippets && (
                                            <div className="mt-4">
                                                <Label htmlFor="regenerateCourseProgrammingLanguage" className="mb-2 block">
                                                    {t('regenerateDialog.programmingLanguageLabel')}
                                                </Label>
                                                <Select value={regenerateCourseProgrammingLanguage} onValueChange={setRegenerateCourseProgrammingLanguage}>
                                                    <SelectTrigger id="regenerateCourseProgrammingLanguage" className="w-full">
                                                        <SelectValue placeholder={t('regenerateDialog.selectProgrammingLanguage')} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="python">{t('programmingLanguage.python')}</SelectItem>
                                                        <SelectItem value="javascript">{t('programmingLanguage.javascript')}</SelectItem>
                                                        <SelectItem value="java">{t('programmingLanguage.java')}</SelectItem>
                                                        <SelectItem value="cpp">{t('programmingLanguage.cpp')}</SelectItem>
                                                        <SelectItem value="csharp">{t('programmingLanguage.csharp')}</SelectItem>
                                                        <SelectItem value="go">{t('programmingLanguage.go')}</SelectItem>
                                                        <SelectItem value="rust">{t('programmingLanguage.rust')}</SelectItem>
                                                        <SelectItem value="typescript">{t('programmingLanguage.typescript')}</SelectItem>
                                                        <SelectItem value="php">{t('programmingLanguage.php')}</SelectItem>
                                                        <SelectItem value="ruby">{t('programmingLanguage.ruby')}</SelectItem>
                                                        <SelectItem value="swift">{t('programmingLanguage.swift')}</SelectItem>
                                                        <SelectItem value="kotlin">{t('programmingLanguage.kotlin')}</SelectItem>
                                                        <SelectItem value="other">{t('programmingLanguage.other')}</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <Label htmlFor="regenerateCourseTopicsPerSession" className="mb-2 block">
                                            {t('regenerateDialog.topicsPerSessionLabel')}
                                        </Label>
                                        <Input
                                            id="regenerateCourseTopicsPerSession"
                                            type="number"
                                            min="1"
                                            value={regenerateCourseTopicsPerSession}
                                            onChange={(e) => setRegenerateCourseTopicsPerSession(e.target.value)}
                                            placeholder={t('regenerateDialog.topicsPerSessionPlaceholder')}
                                            className="w-full"
                                        />
                                    </div>

                                    <div>
                                        <Label className="mb-2 block">{t('regenerateDialog.topicsLabel')}</Label>
                                        <div className="space-y-3">
                                            <div className="flex gap-2">
                                                <Input
                                                    value={regenerateCourseNewTopic}
                                                    onChange={(e) => setRegenerateCourseNewTopic(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && regenerateCourseNewTopic.trim()) {
                                                            e.preventDefault();
                                                            handleRegenerateAddTopic();
                                                        }
                                                    }}
                                                    placeholder={t('regenerateDialog.topicPlaceholder')}
                                                    className="flex-1"
                                                />
                                                <MyButton
                                                    buttonType="secondary"
                                                    onClick={handleRegenerateAddTopic}
                                                    disabled={!regenerateCourseNewTopic.trim() || regenerateCourseTopics.includes(regenerateCourseNewTopic.trim())}
                                                >
                                                    {t('actions.add')}
                                                </MyButton>
                                            </div>

                                            {regenerateCourseTopics.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {regenerateCourseTopics.map((topic, index) => (
                                                        <div
                                                            key={index}
                                                            className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                                        >
                                                            <span>{topic}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRegenerateRemoveTopic(index)}
                                                                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <Label className="mb-2 block">{t('regenerateDialog.referencesLabel')}</Label>
                                        <div className="space-y-3">
                                            <div className="flex gap-2">
                                                <Input
                                                    value={regenerateNewReferenceUrl}
                                                    onChange={(e) => setRegenerateNewReferenceUrl(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleRegenerateAddReferenceUrl();
                                                        }
                                                    }}
                                                    placeholder={t('regenerateDialog.urlPlaceholder')}
                                                    className="flex-1"
                                                />
                                                <MyButton
                                                    buttonType="secondary"
                                                    onClick={handleRegenerateAddReferenceUrl}
                                                    disabled={!regenerateNewReferenceUrl.trim()}
                                                >
                                                    <Link className="h-4 w-4 me-1" />
                                                    {t('regenerateDialog.addUrl')}
                                                </MyButton>
                                            </div>

                                            {regenerateReferenceUrls.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {regenerateReferenceUrls.map((url) => (
                                                        <div
                                                            key={url.id}
                                                            className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                                        >
                                                            <Link className="h-3.5 w-3.5" />
                                                            <span className="max-w-[200px] truncate">{url.url}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRegenerateRemoveReferenceUrl(url.id)}
                                                                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div
                                                {...getRegenerateReferenceRootProps()}
                                                className={cn(
                                                    'flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-all duration-200',
                                                    isRegenerateReferenceDragActive
                                                        ? 'border-indigo-400 bg-indigo-50'
                                                        : 'border-neutral-300 bg-neutral-50 hover:border-indigo-300 hover:bg-indigo-50'
                                                )}
                                            >
                                                <input {...getRegenerateReferenceInputProps()} className="hidden" />
                                                <Upload className={cn('h-5 w-5', isRegenerateReferenceDragActive ? 'text-indigo-600' : 'text-neutral-500')} />
                                                <span className="text-xs font-medium text-neutral-600">
                                                    {t('regenerateDialog.attachFilesHint')}
                                                </span>
                                            </div>

                                            {regenerateReferenceFiles.length > 0 && (
                                                <div className="flex flex-wrap gap-2">
                                                    {regenerateReferenceFiles.map((file) => (
                                                        <div
                                                            key={file.id}
                                                            className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700"
                                                        >
                                                            <FileText className="h-3.5 w-3.5" />
                                                            <span className="max-w-[150px] truncate">{file.file.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRegenerateRemoveReferenceFile(file.id)}
                                                                className="ml-0.5 rounded-full p-0.5 hover:bg-indigo-100"
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 flex-shrink-0 border-t flex justify-end">
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmRegenerate}
                            disabled={!regenerateCourseGoal.trim()}
                        >
                            {t('regenerateDialog.regenerate')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>

            {/* {`Add ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`} Dialog */}
            <Dialog open={addSessionDialogOpen} onOpenChange={(open) => {
                setAddSessionDialogOpen(open);
                if (!open) {
                    setAddSessionName('');
                }
            }}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{`Add New ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label htmlFor="addSessionName" className="mb-2 block">
                                {t('addSessionDialog.nameLabel', { term: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters) })}
                            </Label>
                            <Input
                                id="addSessionName"
                                value={addSessionName}
                                onChange={(e) => setAddSessionName(e.target.value)}
                                placeholder={t('addSessionDialog.namePlaceholder', { term: getTerminology(ContentTerms.Chapters, SystemTerms.Chapters).toLowerCase() })}
                                className="w-full"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && addSessionName.trim()) {
                                        handleConfirmAddSession();
                                    }
                                }}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setAddSessionDialogOpen(false)}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmAddSession}
                            disabled={!addSessionName.trim()}
                        >
                            {`Add ${getTerminology(ContentTerms.Chapters, SystemTerms.Chapters)}`}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Generate Page Content Confirmation Dialog */}
            <Dialog open={showGenerateConfirmDialog} onOpenChange={setShowGenerateConfirmDialog}>
                <DialogContent className="w-[90vw] max-w-[900px] max-h-[80vh] flex flex-col p-0">
                    <DialogHeader className="sticky top-0 bg-white z-10 border-b border-neutral-200 px-6 pt-6 pb-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                                <AlertTriangle className="h-5 w-5 text-amber-600" />
                            </div>
                            <DialogTitle className="text-xl font-semibold text-neutral-900">
                                {t('generateConfirmDialog.title')}
                            </DialogTitle>
                        </div>
                        <DialogDescription className="text-sm text-neutral-600 pt-2">
                            <p className="mb-2">
                                {t('generateConfirmDialog.description1')}
                            </p>
                            <p>
                                {t('generateConfirmDialog.description2')}
                            </p>
                        </DialogDescription>
                    </DialogHeader>

                    {/* Summary Section - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-6">
                        <div className="space-y-4 py-4">
                            {/* Course Basic Info */}
                            <div>
                                <h4 className="text-sm font-semibold text-neutral-900 mb-2">{t('generateConfirmDialog.courseInformation')}</h4>
                                <div className="space-y-2">
                                    <div>
                                        <span className="text-xs font-medium text-neutral-500">{t('generateConfirmDialog.titleLabel')}</span>
                                        <p className="text-sm text-neutral-700 font-medium">{courseData.title}</p>
                                    </div>
                                    {courseData.subtitle && (
                                        <div>
                                            <span className="text-xs font-medium text-neutral-500">{t('generateConfirmDialog.subtitleLabel')}</span>
                                            <p className="text-sm text-neutral-600">{courseData.subtitle}</p>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-3 gap-4 mt-3">
                                        <div>
                                            <span className="text-xs font-medium text-neutral-500">{t('generateConfirmDialog.levelLabel')}</span>
                                            <p className="text-sm text-neutral-700 font-medium">{courseData.level}</p>
                                        </div>
                                        <div>
                                            <span className="text-xs font-medium text-neutral-500">{t('generateConfirmDialog.totalSessionsLabel')}</span>
                                            <p className="text-sm text-neutral-700 font-medium">{courseData.totalSessions}</p>
                                        </div>
                                        <div>
                                            <span className="text-xs font-medium text-neutral-500">{t('generateConfirmDialog.durationLabel')}</span>
                                            <p className="text-sm text-neutral-700 font-medium">{courseData.totalDuration}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Sessions Summary */}
                            <div>
                                <h4 className="text-sm font-semibold text-neutral-900 mb-3">{t('generateConfirmDialog.sessionsOverview')}</h4>
                                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                                    {courseData.sessions.map((session, index) => (
                                        <div
                                            key={session.id}
                                            className="bg-neutral-50 rounded-md p-3 border border-neutral-200"
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                                                            {t('session.shortLabel', { number: index + 1 })}
                                                        </span>
                                                        <span className="text-sm font-semibold text-neutral-900">
                                                            {session.title}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                                                <div>
                                                    <span className="text-neutral-500">{t('generateConfirmDialog.topicsLabel')}</span>
                                                    <span className="ms-1 font-medium text-neutral-700">{session.topics.length}</span>
                                                </div>
                                                <div>
                                                    <span className="text-neutral-500">{getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}:</span>
                                                    <span className="ms-1 font-medium text-neutral-700">{session.slides.length}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {session.hasQuiz && (
                                                        <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded text-xs font-medium">
                                                            {t('generateConfirmDialog.quizBadge')}
                                                        </span>
                                                    )}
                                                    {session.hasHomework && (
                                                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">
                                                            {t('generateConfirmDialog.homeworkBadge')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {session.topics.length > 0 && (
                                                <div className="mt-2 pt-2 border-t border-neutral-200">
                                                    <span className="text-xs text-neutral-500">{t('generateConfirmDialog.topicsLabel')}</span>
                                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                                        {session.topics.map((topic, topicIndex) => (
                                                            <span
                                                                key={topicIndex}
                                                                className="text-xs bg-white text-neutral-600 px-2 py-0.5 rounded border border-neutral-200"
                                                            >
                                                                {topic.title}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Total Statistics */}
                            <div className="bg-indigo-50 rounded-md p-3 border border-indigo-200">
                                <h4 className="text-sm font-semibold text-indigo-900 mb-2">{t('generateConfirmDialog.totalContent')}</h4>
                                <div className="grid grid-cols-4 gap-4 text-xs">
                                    <div>
                                        <span className="text-indigo-600 font-medium">{t('generateConfirmDialog.sessionsLabel')}</span>
                                        <p className="text-sm font-semibold text-indigo-900">{courseData.sessions.length}</p>
                                    </div>
                                    <div>
                                        <span className="text-indigo-600 font-medium">{t('generateConfirmDialog.topicsLabel')}</span>
                                        <p className="text-sm font-semibold text-indigo-900">
                                            {courseData.sessions.reduce((sum, s) => sum + s.topics.length, 0)}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-indigo-600 font-medium">{getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides)}:</span>
                                        <p className="text-sm font-semibold text-indigo-900">
                                            {courseData.sessions.reduce((sum, s) => sum + s.slides.length, 0)}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-indigo-600 font-medium">{t('generateConfirmDialog.quizzesLabel')}</span>
                                        <p className="text-sm font-semibold text-indigo-900">
                                            {courseData.sessions.filter(s => s.hasQuiz).length}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="sticky bottom-0 bg-white z-10 border-t border-neutral-200 px-6 py-4">
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setShowGenerateConfirmDialog(false)}
                        >
                            {t('generateConfirmDialog.goBack')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleConfirmGenerate}
                        >
                            {t('generateConfirmDialog.continue')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </LayoutContainer>
    );
}
