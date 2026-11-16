import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CheckCircle, CircleNotch, Copy, Warning } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    defaultDuplicateName,
    duplicateErrorMessage,
    DUPLICATE_NAME_MAX_LENGTH,
    useDuplicateCourse,
    type DuplicateCourseResponse,
} from '@/services/study-library/course-operations/duplicate-course';

interface DuplicateCourseDialogProps {
    courseId: string;
    courseName: string;
    /** icon: square icon button (course list cards). button: labelled secondary button (course header). */
    variant?: 'icon' | 'button';
}

/**
 * One-click "Duplicate course": asks for the new name, says what is and is not copied, shows
 * progress while the server copies, then links to the new course. The list refreshes on success.
 */
export const DuplicateCourseDialog = ({
    courseId,
    courseName,
    variant = 'icon',
}: DuplicateCourseDialogProps) => {
    const { t } = useTranslation('courseList');
    const navigate = useNavigate();
    const duplicate = useDuplicateCourse();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [result, setResult] = useState<DuplicateCourseResponse | null>(null);

    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const courseLower = course.toLocaleLowerCase();
    const terms = {
        course,
        courseLower,
        coursesLower: getTerminologyPlural(
            ContentTerms.Course,
            SystemTerms.Course
        ).toLocaleLowerCase(),
        batches: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLocaleLowerCase(),
        learners: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner).toLocaleLowerCase(),
        chapters: getTerminologyPlural(
            ContentTerms.Chapters,
            SystemTerms.Chapter
        ).toLocaleLowerCase(),
        slides: getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slide).toLocaleLowerCase(),
    };
    const isPending = duplicate.isPending;

    const handleOpenChange = (next: boolean) => {
        // Closing mid-copy would hide the result; the request keeps running on the server.
        if (!next && isPending) return;
        if (next) {
            setName(defaultDuplicateName(courseName, t('duplicate.copySuffix')));
            setResult(null);
            duplicate.reset();
        }
        setOpen(next);
    };

    const handleDuplicate = () => {
        duplicate.mutate(
            { courseId, newCourseName: name },
            {
                onSuccess: (data) => {
                    setResult(data);
                    toast.success(t('duplicate.success', { ...terms, name: data.course_name }));
                },
                onError: (error) => {
                    toast.error(duplicateErrorMessage(error) || t('duplicate.failed', terms));
                },
            }
        );
    };

    const openNewCourse = () => {
        if (!result) return;
        setOpen(false);
        navigate({
            to: '/study-library/courses/course-details',
            search: {
                courseId: result.course_id,
                sessionId: result.session_id ?? undefined,
                levelId: result.level_id ?? undefined,
            },
        });
    };

    const trigger =
        variant === 'icon' ? (
            <button
                type="button"
                aria-label={t('duplicate.action', terms)}
                className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-500 active:scale-95"
            >
                <Copy size={18} />
            </button>
        ) : (
            <MyButton type="button" buttonType="secondary" scale="small">
                <Copy size={16} />
                {t('duplicate.action', terms)}
            </MyButton>
        );

    const footer = result ? (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <MyButton type="button" buttonType="secondary" onClick={() => setOpen(false)}>
                {t('duplicate.close')}
            </MyButton>
            <MyButton type="button" buttonType="primary" onClick={openNewCourse}>
                {t('duplicate.openNew', terms)}
            </MyButton>
        </div>
    ) : (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <MyButton
                type="button"
                buttonType="secondary"
                disable={isPending}
                onClick={() => setOpen(false)}
            >
                {t('cancel')}
            </MyButton>
            <MyButton
                type="button"
                buttonType="primary"
                disable={isPending || !name.trim()}
                onClick={handleDuplicate}
            >
                {isPending ? t('duplicate.duplicating') : t('duplicate.confirm')}
            </MyButton>
        </div>
    );

    return (
        // The list card navigates on click; React events bubble out of the dialog portal too.
        <div onClick={(e) => e.stopPropagation()}>
            <MyDialog
                trigger={trigger}
                triggerTooltip={variant === 'icon' ? t('duplicate.action', terms) : undefined}
                heading={t('duplicate.title', terms)}
                open={open}
                onOpenChange={handleOpenChange}
                dialogWidth="max-w-lg"
                footer={footer}
            >
                {result ? (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-start gap-3 rounded-lg border border-success-200 bg-success-50 p-4">
                            <CheckCircle size={22} className="shrink-0 text-success-600" />
                            <div className="flex min-w-0 flex-col gap-1">
                                <p className="break-words font-semibold text-neutral-800">
                                    {t('duplicate.doneTitle', {
                                        ...terms,
                                        name: result.course_name,
                                    })}
                                </p>
                                <p className="text-sm text-neutral-600">
                                    {t('duplicate.doneCounts', {
                                        ...terms,
                                        batchCount: result.batches_copied,
                                        chapterCount: result.copied_chapters,
                                        slideCount: result.copied_slides,
                                    })}
                                </p>
                            </div>
                        </div>
                        {result.warnings?.length > 0 && (
                            <div className="flex flex-col gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4">
                                <p className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                                    <Warning size={16} className="text-warning-600" />
                                    {t('duplicate.warningsTitle')}
                                </p>
                                <ul className="list-disc space-y-1 ps-5 text-sm text-neutral-700">
                                    {result.warnings.map((w, i) => (
                                        <li key={i} className="break-words">
                                            {w}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : isPending ? (
                    <div
                        className="flex flex-col items-center gap-3 py-6 text-center"
                        role="status"
                        aria-live="polite"
                    >
                        <CircleNotch size={32} className="animate-spin text-primary-500" />
                        <p className="font-semibold text-neutral-800">
                            {t('duplicate.progressTitle', terms)}
                        </p>
                        <p className="text-sm text-neutral-600">
                            {t('duplicate.progressBody', terms)}
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor={`duplicate-name-${courseId}`}>
                                {t('duplicate.nameLabel', terms)}
                            </Label>
                            <Input
                                id={`duplicate-name-${courseId}`}
                                value={name}
                                maxLength={DUPLICATE_NAME_MAX_LENGTH}
                                autoFocus
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && name.trim()) handleDuplicate();
                                }}
                            />
                        </div>
                        <div className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
                            <p className="font-semibold text-neutral-800">
                                {t('duplicate.copiedTitle')}
                            </p>
                            <ul className="list-disc space-y-1 ps-5 text-neutral-700">
                                <li>{t('duplicate.copiedDetails', terms)}</li>
                                <li>{t('duplicate.copiedBatches', terms)}</li>
                                <li>{t('duplicate.copiedContent', terms)}</li>
                            </ul>
                            <p className="mt-2 font-semibold text-neutral-800">
                                {t('duplicate.notCopiedTitle')}
                            </p>
                            <p className="text-neutral-700">
                                {t('duplicate.notCopiedBody', terms)}
                            </p>
                        </div>
                        {duplicate.isError && (
                            <p className="text-sm text-danger-600" role="alert">
                                {duplicateErrorMessage(duplicate.error) ||
                                    t('duplicate.failed', terms)}
                            </p>
                        )}
                    </div>
                )}
            </MyDialog>
        </div>
    );
};

export default DuplicateCourseDialog;
