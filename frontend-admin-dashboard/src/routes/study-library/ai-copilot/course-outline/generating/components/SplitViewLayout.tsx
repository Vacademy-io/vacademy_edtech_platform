import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
    ArrowLeft,
    Settings,
    Loader2,
    CheckCircle,
    FileText,
    Sparkles,
    List,
    PanelLeft,
} from 'lucide-react';
import { MyButton } from '@/components/design-system/button';
import { ContentHierarchyPanel } from './ContentHierarchyPanel';
import { ContentEditorPanel } from './ContentEditorPanel';
import { MetadataDialog } from './MetadataDialog';
import { SlideGeneration, SessionProgress } from '../../../shared/types';

interface SplitViewLayoutProps {
    sessionsWithProgress: SessionProgress[];
    slides: SlideGeneration[];
    courseMetadata: any;
    isGeneratingContent: boolean;
    isContentGenerated: boolean;
    contentGenerationProgress: string;
    isCreatingCourse: boolean;
    isTeacher: boolean;
    isAdmin: boolean;
    onBack: () => void;
    onSlideContentChange: (slideId: string, content: string) => void;
    onSlideSave: (slideId: string) => void;
    onMetadataSave: (metadata: any) => void;
    onCreateCourse: (status: 'DRAFT' | 'ACTIVE') => void;
    onGenerateContent: () => void;
}

export const SplitViewLayout: React.FC<SplitViewLayoutProps> = ({
    sessionsWithProgress,
    slides,
    courseMetadata,
    isGeneratingContent,
    isContentGenerated,
    contentGenerationProgress,
    isCreatingCourse,
    isTeacher,
    isAdmin,
    onBack,
    onSlideContentChange,
    onSlideSave,
    onMetadataSave,
    onCreateCourse,
    onGenerateContent,
}) => {
    const { t } = useTranslation('studyLibrarySplitViewLayout');
    const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
    const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
    const [showMetadataDialog, setShowMetadataDialog] = useState(false);
    // Mobile: track which panel is visible ('hierarchy' or 'editor')
    const [mobileActivePanel, setMobileActivePanel] = useState<'hierarchy' | 'editor'>('hierarchy');

    // Initialize with first chapter expanded and first slide selected
    useEffect(() => {
        if (sessionsWithProgress.length > 0) {
            const firstSession = sessionsWithProgress[0];
            if (firstSession) {
                setExpandedChapters(new Set([firstSession.sessionId]));

                const visibleSlides = firstSession.slides.filter(
                    (s) => s.slideTitle !== '_placeholder_'
                );
                if (visibleSlides.length > 0 && visibleSlides[0] && !selectedSlideId) {
                    setSelectedSlideId(visibleSlides[0].id);
                }
            }
        }
    }, [sessionsWithProgress.length]);

    // Auto-select newly completed slides during generation
    useEffect(() => {
        if (isGeneratingContent && slides.length > 0) {
            // Find the first slide that just completed
            const justCompleted = slides.find(
                (s) => s.status === 'completed' && s.slideTitle !== '_placeholder_'
            );
            if (justCompleted && !selectedSlideId) {
                setSelectedSlideId(justCompleted.id);
                // Expand the chapter containing this slide
                setExpandedChapters((prev) => new Set([...prev, justCompleted.sessionId]));
            }
        }
    }, [slides, isGeneratingContent]);

    const selectedSlide = useMemo(() => {
        return slides.find((s) => s.id === selectedSlideId) || null;
    }, [slides, selectedSlideId]);

    const handleChapterToggle = (chapterId: string) => {
        setExpandedChapters((prev) => {
            const next = new Set(prev);
            if (next.has(chapterId)) {
                next.delete(chapterId);
            } else {
                next.add(chapterId);
            }
            return next;
        });
    };

    const handleSlideSelect = (slide: SlideGeneration) => {
        setSelectedSlideId(slide.id);
        // Expand the chapter if not already expanded
        if (!expandedChapters.has(slide.sessionId)) {
            setExpandedChapters((prev) => new Set([...prev, slide.sessionId]));
        }
        // On mobile, switch to editor panel after selection
        setMobileActivePanel('editor');
    };

    const totalSlides = slides.filter((s) => s.slideTitle !== '_placeholder_').length;
    const completedSlides = slides.filter(
        (s) => s.status === 'completed' && s.slideTitle !== '_placeholder_'
    ).length;
    const progressPercent = totalSlides > 0 ? Math.round((completedSlides / totalSlides) * 100) : 0;

    return (
        <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-purple-50">
            <div className="mx-auto flex h-screen max-w-[1600px] flex-col p-3 sm:p-4 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mb-3 shrink-0 sm:mb-4"
                >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <button
                            onClick={onBack}
                            className="flex items-center gap-2 self-start text-sm font-medium text-neutral-600 transition-colors hover:text-indigo-600"
                        >
                            <ArrowLeft className="size-4" />
                            {t('back')}
                        </button>

                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            {/* Metadata Button */}
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setShowMetadataDialog(true)}
                            >
                                <Settings className="mr-1 size-4" />
                                <span className="hidden sm:inline">{t('courseDetails')}</span>
                                <span className="sm:hidden">{t('details')}</span>
                            </MyButton>

                            {/* Action Buttons */}
                            {isGeneratingContent ? (
                                <div className="flex items-center gap-2 sm:gap-3">
                                    <div className="flex items-center gap-2 text-sm text-indigo-600">
                                        <Loader2 className="size-4 animate-spin" />
                                        <span>{t('percent', { value: progressPercent })}</span>
                                    </div>
                                </div>
                            ) : isContentGenerated ? (
                                <MyButton
                                    buttonType="primary"
                                    onClick={() => onCreateCourse(isAdmin ? 'ACTIVE' : 'DRAFT')}
                                    disabled={isCreatingCourse}
                                >
                                    {isCreatingCourse ? (
                                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    ) : (
                                        <CheckCircle className="h-4 w-4 mr-1" />
                                    )}
                                    {isAdmin ? t('createCourse') : t('createDraftCourse')}
                                </MyButton>
                            ) : (
                                <MyButton buttonType="primary" onClick={onGenerateContent}>
                                    <Sparkles className="mr-1 size-4" />
                                    <span className="hidden sm:inline">
                                        {t('generatePageContent')}
                                    </span>
                                    <span className="sm:hidden">{t('generate')}</span>
                                </MyButton>
                            )}
                        </div>
                    </div>

                    {/* Progress Bar during generation */}
                    {isGeneratingContent && (
                        <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-xs text-neutral-600">
                                <span>{t('generatingContent')}</span>
                                <span>
                                    {t('pagesProgress', {
                                        completed: completedSlides,
                                        total: totalSlides,
                                    })}
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
                                <motion.div
                                    className="h-full rounded-full bg-indigo-500"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progressPercent}%` }}
                                    transition={{ duration: 0.3 }}
                                />
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* Mobile Panel Switcher - only visible on mobile */}
                <div className="mb-3 flex rounded-lg border border-neutral-200 bg-white p-1 shadow-sm md:hidden">
                    <button
                        onClick={() => setMobileActivePanel('hierarchy')}
                        className={cn(
                            'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            mobileActivePanel === 'hierarchy'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-neutral-600 hover:bg-neutral-100'
                        )}
                    >
                        <List className="size-4" />
                        {t('chapters')}
                    </button>
                    <button
                        onClick={() => setMobileActivePanel('editor')}
                        className={cn(
                            'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            mobileActivePanel === 'editor'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-neutral-600 hover:bg-neutral-100'
                        )}
                    >
                        <PanelLeft className="size-4" />
                        {t('content')}
                    </button>
                </div>

                {/* Split View - Main Content */}
                <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
                    {/* Left Panel - Hierarchy */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className={cn(
                            'flex-shrink-0',
                            // Desktop: always visible with fixed width
                            'hidden md:block md:w-80 lg:w-96',
                            // Mobile: full width, show/hide based on active panel
                            mobileActivePanel === 'hierarchy' && 'block w-full md:w-80'
                        )}
                    >
                        <ContentHierarchyPanel
                            sessionsWithProgress={sessionsWithProgress}
                            selectedSlideId={selectedSlideId}
                            expandedChapters={expandedChapters}
                            onChapterToggle={handleChapterToggle}
                            onSlideSelect={handleSlideSelect}
                        />
                    </motion.div>

                    {/* Right Panel - Content Editor */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.2 }}
                        className={cn(
                            'min-w-0',
                            // Desktop: always visible, flex-1
                            'hidden md:flex md:flex-1',
                            // Mobile: full width, show/hide based on active panel
                            mobileActivePanel === 'editor' && 'flex flex-1'
                        )}
                    >
                        <ContentEditorPanel
                            slide={selectedSlide}
                            onContentChange={onSlideContentChange}
                            onSave={onSlideSave}
                        />
                    </motion.div>
                </div>
            </div>

            {/* Metadata Dialog */}
            <MetadataDialog
                open={showMetadataDialog}
                onOpenChange={setShowMetadataDialog}
                metadata={courseMetadata}
                onSave={onMetadataSave}
            />
        </div>
    );
};
