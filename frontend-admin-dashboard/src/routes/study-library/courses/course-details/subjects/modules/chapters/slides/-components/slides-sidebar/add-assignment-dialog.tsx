import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { Route } from '../..';
import { useSlidesMutations } from '../../-hooks/use-slides';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CheckCircle, File } from '@phosphor-icons/react';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

const AddAssignmentDialog = ({
    openState,
}: {
    openState?: ((open: boolean) => void) | undefined;
}) => {
    const { t } = useTranslation('studyLibrarySlidesSidebarAddAssignmentDialog');
    const { setActiveItem, getSlideById, items } = useContentStore();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { updateAssignmentOrder, updateSlideOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const [title, setTitle] = useState('');
    const [isAssignmentAdding, setIsAssignmentAdding] = useState(false);

    // Function to reorder slides after adding a new one at the bottom
    const reorderSlidesAfterNewSlide = async (newSlideId: string) => {
        try {
            const currentSlides = items || [];
            const newSlide = currentSlides.find((slide) => slide.id === newSlideId);

            if (!newSlide) return;

            const reorderedSlides = buildAppendReorderPayload(newSlideId, currentSlides);

            await updateSlideOrder({
                chapterId: chapterId || '',
                slideOrderPayload: reorderedSlides,
            });

            // Set the new slide as active
            setTimeout(() => {
                setActiveItem(getSlideById(newSlideId));
            }, 500);
        } catch (error) {
            console.error('Error reordering slides:', error);
            toast.error(t('toast.reorderFailed'));
        }
    };

    const handleAddAssignment = async (title: string | undefined) => {
        setIsAssignmentAdding(true);
        try {
            const slideStatus = getSlideStatusForUser();
            const response: string = await updateAssignmentOrder({
                id: crypto.randomUUID(),
                source_id: '',
                source_type: 'ASSIGNMENT',
                title: title || '',
                image_file_id: '',
                description: '',
                status: slideStatus,
                slide_order: getNextSlideOrder(items || []),
                assignment_slide: {
                    id: crypto.randomUUID(),
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    parent_rich_text: {
                        id: null,
                        type: '',
                        content: '',
                    },
                    text_data: {
                        id: null,
                        type: '',
                        content: '',
                    },
                    live_date: '',
                    end_date: '',
                    re_attempt_count: 0,
                    comma_separated_media_ids: 'types:',
                },
                is_loaded: true,
                new_slide: true,
            });

            if (response) {
                // Reorder slides and set as active
                await reorderSlidesAfterNewSlide(response);
                openState?.(false);
                toast.success(t('toast.addSuccess'));
            }
        } catch (error) {
            toast.error(t('toast.addFailed'));
        } finally {
            setIsAssignmentAdding(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 p-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
            {/* Header Section */}
            <div className="space-y-3 border-b border-neutral-100 pb-4 text-center">
                <div className="mx-auto flex size-16 animate-pulse items-center justify-center rounded-full bg-blue-100">
                    <File className="size-8 text-blue-600" />
                </div>
                <div>
                    <h3 className="mb-1 text-lg font-semibold text-neutral-700">
                        {t('header.title')}
                    </h3>
                    <p className="text-sm text-neutral-500">{t('header.subtitle')}</p>
                </div>
            </div>

            {/* Form Section */}
            <div className="space-y-4">
                <div className="relative">
                    <MyInput
                        input={title}
                        onChangeFunction={(e) => setTitle(e.target.value)}
                        label={t('form.titleLabel')}
                        required={true}
                        inputType="text"
                        inputPlaceholder={t('form.titlePlaceholder')}
                        className="w-full pr-10"
                    />
                    {title.trim() && (
                        <div className="absolute right-3 top-1/2 mt-3 -translate-y-1/2">
                            <CheckCircle className="size-5 text-green-500 duration-300 animate-in fade-in" />
                        </div>
                    )}
                </div>

                {/* Preview Card */}
                {title.trim() && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 duration-300 animate-in fade-in slide-in-from-bottom-2">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-blue-100 p-2">
                                <File className="size-5 text-blue-600" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-blue-800">{title}</p>
                                <p className="text-xs text-blue-600">{t('preview.assignmentDraft')}</p>
                            </div>
                            <CheckCircle className="size-4 text-green-500" />
                        </div>
                    </div>
                )}

                {/* Helper Text */}
                <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
                    <p className="flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-blue-500"></span>
                        {t('helperText')}
                    </p>
                </div>
            </div>

            {/* Footer Section */}
            <div className="flex justify-end border-t border-neutral-100 pt-4">
                {isAssignmentAdding ? (
                    <MyButton type="button" scale="large" buttonType="primary" className="w-full">
                        <div className="flex items-center justify-center gap-2">
                            <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            {t('creating')}
                        </div>
                    </MyButton>
                ) : (
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        className={`
                            w-full transition-all duration-300 ease-in-out
                            ${
                                !title.trim()
                                    ? 'cursor-not-allowed opacity-50'
                                    : 'shadow-lg hover:scale-105 hover:shadow-xl active:scale-95'
                            }
                        `}
                        onClick={() => handleAddAssignment(title)}
                        disable={!title.trim()}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <File className="size-4" />
                            {t('createAssignment')}
                        </div>
                    </MyButton>
                )}
            </div>
        </div>
    );
};

export default AddAssignmentDialog;
