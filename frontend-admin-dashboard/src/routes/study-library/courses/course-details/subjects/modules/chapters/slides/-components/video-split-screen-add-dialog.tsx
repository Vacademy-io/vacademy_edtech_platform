import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { BookOpen, Gamepad2, Code, Split, PlayCircle } from 'lucide-react';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import { toast } from 'sonner';
import { useSlides } from '../-hooks/use-slides';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Route } from '..';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';

interface SplitScreenData {
    splitScreen: boolean;
    splitType: 'JUPYTER' | 'SCRATCH' | 'CODE';
    videoSlideId: string;
    originalVideoData: {
        id?: string;
        url?: string;
        title?: string;
        description?: string;
        source_type?: string;
        video_length_in_millis?: number;
        published_url?: string;
        published_video_length_in_millis?: number;
        questions?: unknown[];
    };
    [key: string]: unknown; // Allow additional properties
}

interface SplitScreenOption {
    icon: React.ReactNode;
    text: string;
    type: 'JUPYTER' | 'SCRATCH' | 'CODE';
    description: string;
    color: string;
}

interface VideoSplitScreenAddDialogProps {
    videoSlideId: string;
    isEditable: boolean;
}

export const VideoSplitScreenAddDialog: React.FC<VideoSplitScreenAddDialogProps> = ({
    videoSlideId,
    isEditable,
}) => {
    const { t } = useTranslation('studyLibraryVideoSplitScreenAddDialog');
    const { setActiveItem, getSlideById } = useContentStore();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // Add these hooks for auto-save functionality
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { addUpdateVideoSlide } = useSlides(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );

    // Per-role Display Setting (Settings → Display Settings → Course Permission).
    // Hide the "Convert to Split Screen" affordance when disabled for this role.
    // Fail-open: if settings aren't cached yet, the button stays visible.
    const slideView = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey())?.slideView;
    if (slideView?.showConvertToSplitScreen === false) return null;

    const splitScreenOptions: SplitScreenOption[] = [
        {
            icon: <BookOpen className="size-6 text-violet-600" />,
            text: t('jupyterNotebook'),
            type: 'JUPYTER',
            description: t('jupyterDescription'),
            color: 'bg-violet-100 border-violet-200',
        },
        {
            icon: <Gamepad2 className="size-6 text-orange-600" />,
            text: t('scratchProject'),
            type: 'SCRATCH',
            description: t('scratchDescription'),
            color: 'bg-orange-100 border-orange-200',
        },
        {
            icon: <Code className="size-6 text-green-600" />,
            text: t('codeEditor'),
            type: 'CODE',
            description: t('codeDescription'),
            color: 'bg-green-100 border-green-200',
        },
    ];

    const handleAddSplitScreen = async (type: 'JUPYTER' | 'SCRATCH' | 'CODE') => {
        try {
            setIsCreating(true);

            // Get the current video slide
            const currentSlide = getSlideById(videoSlideId);
            if (!currentSlide || currentSlide.source_type !== 'VIDEO') {
                toast.error(t('videoSlideNotFound'));
                return;
            }

            // Create split-screen data structure with complete video slide data
            let data: SplitScreenData = {
                splitScreen: true,
                splitType: type,
                videoSlideId,
                originalVideoData: {
                    id: currentSlide.video_slide?.id,
                    url: currentSlide.video_slide?.url,
                    title: currentSlide.video_slide?.title,
                    description: currentSlide.video_slide?.description,
                    source_type: currentSlide.video_slide?.source_type,
                    video_length_in_millis: currentSlide.video_slide?.video_length_in_millis,
                    published_url: currentSlide.video_slide?.published_url,
                    published_video_length_in_millis:
                        currentSlide.video_slide?.published_video_length_in_millis,
                    questions: currentSlide.video_slide?.questions,
                },
            };

            switch (type) {
                case 'JUPYTER':
                    data = {
                        ...data,
                        projectName: '',
                        contentUrl: '',
                        contentBranch: 'main',
                        notebookLocation: 'root',
                        activeTab: 'settings',
                        editorType: 'jupyterEditor',
                        timestamp: Date.now(),
                    };
                    break;
                case 'SCRATCH':
                    data = {
                        ...data,
                        projectId: '',
                        projectName: '',
                        scratchUrl: '',
                        timestamp: Date.now(),
                    };
                    break;
                case 'CODE':
                    data = {
                        ...data,
                        language: 'python',
                        theme: 'dark',
                        code: '# Welcome to the split-screen code editor\nprint("Hello, World!")',
                        readOnly: false,
                        showLineNumbers: true,
                        fontSize: 14,
                        editorType: 'codeEditor',
                        timestamp: Date.now(),
                    };
                    break;
            }

            // Keep as VIDEO type but add split screen data
            const updatedSlide = {
                ...currentSlide,
                source_type: 'VIDEO', // Keep as VIDEO type for backend compatibility
                splitScreenMode: true,
                splitScreenData: data,
                splitScreenType: `SPLIT_${type}`,
                isNewSplitScreen: true, // Flag to indicate this is a newly created split screen
                // Store original video data
                originalVideoSlide: currentSlide.video_slide,
                // Update video_slide to include embedded data
                video_slide: currentSlide.video_slide
                    ? {
                          ...currentSlide.video_slide,
                          embedded_type: type,
                          embedded_data: JSON.stringify(data),
                      }
                    : null,
            };

            // Automatically save the split screen to the backend first
            const videoSlidePayload = {
                id: currentSlide.id,
                title: currentSlide.title,
                description: currentSlide.description,
                image_file_id: currentSlide.image_file_id,
                slide_order: null,
                video_slide: {
                    id: currentSlide.video_slide?.id || '',
                    description: currentSlide.video_slide?.description || '',
                    title: currentSlide.title,
                    url: currentSlide.video_slide?.url || '',
                    video_length_in_millis: currentSlide.video_slide?.video_length_in_millis || 0,
                    published_url: currentSlide.video_slide?.published_url || '',
                    published_video_length_in_millis:
                        currentSlide.video_slide?.published_video_length_in_millis || 0,
                    source_type: currentSlide.video_slide?.source_type || 'VIDEO',
                    embedded_type: type,
                    embedded_data: JSON.stringify(data),
                    questions: currentSlide.video_slide?.questions || [],
                },
                status: currentSlide.status === 'PUBLISHED' ? 'UNSYNC' : 'DRAFT',
                new_slide: false,
                notify: false,
            };

            await addUpdateVideoSlide(videoSlidePayload);

            // Update the active item locally after successful save
            // This ensures the newly created split screen becomes the active slide
            setActiveItem(updatedSlide);

            // Add a small delay to ensure the slide remains active after query refetch
            setTimeout(() => {
                const refreshedSlide = getSlideById(currentSlide.id);
                if (refreshedSlide) {
                    // Reconstruct split screen properties for the refreshed slide
                    const updatedRefreshedSlide = {
                        ...refreshedSlide,
                        splitScreenMode: true,
                        splitScreenData: data,
                        splitScreenType: `SPLIT_${type}`,
                    };
                    setActiveItem(updatedRefreshedSlide);
                }
            }, 500);

            const typeLabel = (
                splitScreenOptions.find((o) => o.type === type)?.text ?? type
            ).toLowerCase();
            toast.success(t('convertSuccess', { type: typeLabel }));
            setIsDialogOpen(false);
        } catch (error) {
            console.error(`Error converting to split-screen ${type}:`, error);
            const typeLabel = (
                splitScreenOptions.find((o) => o.type === type)?.text ?? type
            ).toLowerCase();
            toast.error(t('convertError', { type: typeLabel }));
        } finally {
            setIsCreating(false);
        }
    };

    if (!isEditable) {
        return null;
    }

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="mt-4 w-full"
                    disabled={isCreating}
                >
                    <Split className="mr-2 size-4" />
                    {t('convertToSplitScreen')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <div className="flex flex-col space-y-4">
                    {/* Header */}
                    <div className="text-center">
                        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-blue-100">
                            <Split className="size-6 text-blue-600" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900">
                            {t('convertToSplitScreen')}
                        </h2>
                        <p className="mt-1 text-xs text-gray-600">{t('dialogSubtitle')}</p>
                    </div>

                    {/* Options */}
                    <div className="space-y-2">
                        {splitScreenOptions.map((option) => (
                            <button
                                key={option.type}
                                onClick={() => handleAddSplitScreen(option.type)}
                                disabled={isCreating}
                                className={`
                                    group w-full rounded-lg border-2 p-3 text-left transition-all duration-200
                                    ${option.color}
                                    hover:scale-[1.01] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50
                                `}
                            >
                                <div className="flex items-center space-x-3">
                                    <div className="shrink-0">{option.icon}</div>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-sm font-medium text-gray-900 group-hover:text-gray-700">
                                            {option.text}
                                        </h3>
                                        <p className="text-xs text-gray-600">
                                            {option.description}
                                        </p>
                                    </div>
                                    <div className="shrink-0">
                                        <PlayCircle className="size-4 text-gray-400 group-hover:text-gray-600" />
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    {isCreating && (
                        <div className="flex items-center justify-center space-x-2 text-xs text-gray-600">
                            <div className="size-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                            <span>{t('creatingSlide')}</span>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
