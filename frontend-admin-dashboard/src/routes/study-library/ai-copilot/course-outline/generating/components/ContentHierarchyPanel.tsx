import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
    ChevronDown,
    ChevronRight,
    FileText,
    Video,
    Code,
    FileQuestion,
    ClipboardList,
    FileCode,
    Loader2,
    CheckCircle,
    Clock,
    File,
    Layers,
    BookOpen,
} from 'lucide-react';
import { SlideGeneration, SlideType, SessionProgress } from '../../../shared/types';

interface ContentHierarchyPanelProps {
    sessionsWithProgress: SessionProgress[];
    selectedSlideId: string | null;
    expandedChapters: Set<string>;
    onChapterToggle: (chapterId: string) => void;
    onSlideSelect: (slide: SlideGeneration) => void;
}

const getSlideIcon = (type: SlideType) => {
    switch (type) {
        case 'objectives':
            return <FileText className="h-3.5 w-3.5 text-blue-600" />;
        case 'topic':
            return <FileText className="h-3.5 w-3.5 text-blue-600" />;
        case 'quiz':
        case 'assessment':
        case 'ASSESSMENT':
            return <FileQuestion className="h-3.5 w-3.5 text-purple-600" />;
        case 'homework':
        case 'assignment':
            return <ClipboardList className="h-3.5 w-3.5 text-orange-600" />;
        case 'solution':
            return <FileCode className="h-3.5 w-3.5 text-indigo-600" />;
        case 'doc':
            return <FileText className="h-3.5 w-3.5 text-blue-600" />;
        case 'pdf':
            return <File className="h-3.5 w-3.5 text-red-600" />;
        case 'video':
            return <Video className="h-3.5 w-3.5 text-red-600" />;
        case 'ai-video':
            return <Video className="h-3.5 w-3.5 text-purple-600" />;
        case 'ai-slides':
            return <Layers className="h-3.5 w-3.5 text-teal-600" />;
        case 'ai-storybook':
            return <BookOpen className="h-3.5 w-3.5 text-rose-600" />;
        case 'video-code':
            return (
                <div className="flex items-center">
                    <Video className="h-3.5 w-3.5 text-red-600" />
                </div>
            );
        case 'ai-video-code':
            return (
                <div className="flex items-center">
                    <Video className="h-3.5 w-3.5 text-blue-600" />
                </div>
            );
        case 'code-editor':
            return <Code className="h-3.5 w-3.5 text-green-600" />;
        default:
            return <FileText className="h-3.5 w-3.5 text-neutral-500" />;
    }
};

const getStatusIcon = (status: 'pending' | 'generating' | 'completed') => {
    switch (status) {
        case 'completed':
            return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
        case 'generating':
            return <Loader2 className="h-3.5 w-3.5 text-indigo-500 animate-spin" />;
        case 'pending':
        default:
            return <Clock className="h-3.5 w-3.5 text-neutral-400" />;
    }
};

export const ContentHierarchyPanel: React.FC<ContentHierarchyPanelProps> = ({
    sessionsWithProgress,
    selectedSlideId,
    expandedChapters,
    onChapterToggle,
    onSlideSelect,
}) => {
    const { t } = useTranslation('studyLibraryContentHierarchyPanel');
    const totalSlides = useMemo(() => {
        return sessionsWithProgress.reduce((acc, session) => acc + session.slides.filter(s => s.slideTitle !== '_placeholder_').length, 0);
    }, [sessionsWithProgress]);

    const completedSlides = useMemo(() => {
        return sessionsWithProgress.reduce((acc, session) =>
            acc + session.slides.filter(s => s.status === 'completed' && s.slideTitle !== '_placeholder_').length, 0
        );
    }, [sessionsWithProgress]);

    const generatingSlides = useMemo(() => {
        return sessionsWithProgress.reduce((acc, session) =>
            acc + session.slides.filter(s => s.status === 'generating' && s.slideTitle !== '_placeholder_').length, 0
        );
    }, [sessionsWithProgress]);

    const hasAiVideo = useMemo(() => {
        return sessionsWithProgress.some(session =>
            session.slides.some(s => s.slideType === 'ai-video' || s.slideType === 'ai-video-code')
        );
    }, [sessionsWithProgress]);

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-md overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 px-4 py-3 border-b border-neutral-200 bg-neutral-50">
                <div className="flex items-center gap-2 mb-2">
                    <Layers className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-neutral-900">
                        {t('courseStructure')}
                    </h2>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        {t('completedRatio', { completed: completedSlides, total: totalSlides })}
                    </span>
                    {generatingSlides > 0 && (
                        <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 text-indigo-500 animate-spin" />
                            {t('generatingCount', { count: generatingSlides })}
                        </span>
                    )}
                </div>
                {hasAiVideo && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-neutral-500">
                        <Clock className="h-3 w-3" />
                        {t('aiVideoDelay')}
                    </div>
                )}
            </div>

            {/* Tree View */}
            <div className="flex-1 overflow-y-auto p-2">
                {sessionsWithProgress.map((session, sessionIndex) => {
                    const isExpanded = expandedChapters.has(session.sessionId);
                    const visibleSlides = session.slides.filter(s => s.slideTitle !== '_placeholder_');
                    const sessionCompletedCount = visibleSlides.filter(s => s.status === 'completed').length;
                    const isSessionComplete = sessionCompletedCount === visibleSlides.length && visibleSlides.length > 0;

                    return (
                        <div key={session.sessionId} className="mb-1">
                            {/* Chapter Header */}
                            <button
                                onClick={() => onChapterToggle(session.sessionId)}
                                className={cn(
                                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                                    'hover:bg-neutral-100',
                                    isExpanded && 'bg-neutral-50'
                                )}
                            >
                                <span className="flex-shrink-0 text-neutral-400">
                                    {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4" />
                                    )}
                                </span>
                                <span className="flex-shrink-0 w-5 h-5 rounded bg-indigo-100 text-indigo-700 text-xs font-medium flex items-center justify-center">
                                    {sessionIndex + 1}
                                </span>
                                <span className="flex-1 text-sm font-medium text-neutral-800 truncate">
                                    {session.sessionTitle}
                                </span>
                                <span className="flex-shrink-0">
                                    {isSessionComplete ? (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                    ) : (
                                        <span className="text-[10px] text-neutral-400">
                                            {t('ratio', {
                                                completed: sessionCompletedCount,
                                                total: visibleSlides.length,
                                            })}
                                        </span>
                                    )}
                                </span>
                            </button>

                            {/* Slides List */}
                            {isExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="ml-6 mt-1 space-y-0.5"
                                >
                                    {visibleSlides.map((slide, slideIndex) => (
                                        <button
                                            key={slide.id}
                                            onClick={() => onSlideSelect(slide)}
                                            className={cn(
                                                'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors',
                                                'hover:bg-indigo-50',
                                                selectedSlideId === slide.id
                                                    ? 'bg-indigo-100 border border-indigo-200'
                                                    : 'border border-transparent'
                                            )}
                                        >
                                            <span className="flex-shrink-0">
                                                {getSlideIcon(slide.slideType)}
                                            </span>
                                            <span className={cn(
                                                'flex-1 text-xs truncate',
                                                selectedSlideId === slide.id
                                                    ? 'text-indigo-900 font-medium'
                                                    : 'text-neutral-700'
                                            )}>
                                                {slide.slideTitle}
                                            </span>
                                            <span className="flex-shrink-0">
                                                {getStatusIcon(slide.status)}
                                            </span>
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
