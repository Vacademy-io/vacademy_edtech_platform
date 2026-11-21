import { useState } from 'react';
import { useController, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { GraduationCap, PencilSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { ComposerForm } from '../forms/composer-schema';
import { CourseSlidePicker, type PickedSlide } from '../CourseSlidePicker';
import { FieldError, loose, useFieldError, type ItemPath } from './item-fields';

function asPickedSlide(value: unknown): Partial<PickedSlide> | null {
    return value && typeof value === 'object' ? (value as Partial<PickedSlide>) : null;
}

/**
 * A Course content task: one lesson from the batch's course, opened in the course
 * library. The picked lesson is stored whole (slideId plus the path the learner app
 * deep-links with). An empty task title takes the lesson's name.
 *
 * The lesson comes from the plan's batch: the saved plan's batch when editing, else the
 * first chosen batch (`packageSessionId` overrides both, for surfaces outside the
 * composer such as the AI review).
 */
export function CourseContentEditor({
    control,
    name,
    packageSessionId: batchOverride,
}: {
    control: Control<ComposerForm>;
    name: ItemPath;
    packageSessionId?: string | null;
}) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    const [pickerOpen, setPickerOpen] = useState(false);
    const { field: slideField } = useController({ control: c, name: `${name}.slide` });
    const { field: slideIdField } = useController({ control: c, name: `${name}.slideId` });
    const { field: titleField } = useController({ control: c, name: `${name}.title` });
    const error = useFieldError(c, `${name}.slideId`);

    const savedBatch = useWatch({ control, name: 'packageSessionId' });
    const chosenBatches = useWatch({ control, name: 'packageSessionIds' });
    const batch = batchOverride || savedBatch || chosenBatches?.[0] || '';
    const manyBatches = !savedBatch && (chosenBatches?.length ?? 0) > 1;

    const slide = asPickedSlide(slideField.value);
    const hasSlide = Boolean(slideIdField.value);
    const path = [slide?.subjectName, slide?.moduleName, slide?.chapterName]
        .filter(Boolean)
        .join(' › ');

    function onPick(picked: PickedSlide) {
        slideField.onChange({ ...picked });
        slideIdField.onChange(picked.slideId);
        const title = typeof titleField.value === 'string' ? titleField.value : '';
        // Seed an empty title with the lesson's own name.
        if (!title.trim()) titleField.onChange(picked.slideTitle);
    }

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-neutral-700">
                {t('composer.courseContent')}
            </span>
            {hasSlide ? (
                <div
                    className={cn(
                        'flex items-center gap-3 rounded-lg border p-3',
                        error ? 'border-danger-600' : 'border-neutral-200'
                    )}
                >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700">
                        <GraduationCap size={20} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium text-neutral-900">
                            {slide?.slideTitle || t('items.course.savedLesson')}
                        </p>
                        {path && (
                            <p className="line-clamp-2 break-words text-caption text-neutral-500">
                                {path}
                            </p>
                        )}
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={!batch}
                        onClick={() => setPickerOpen(true)}
                        className="shrink-0"
                    >
                        <PencilSimple size={14} aria-hidden /> {t('items.course.change')}
                    </MyButton>
                </div>
            ) : (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    disable={!batch}
                    onClick={() => setPickerOpen(true)}
                    className={cn(
                        'h-auto w-full justify-start gap-3 whitespace-normal border-dashed p-4 text-start',
                        error && 'border-danger-600'
                    )}
                >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <GraduationCap size={20} aria-hidden />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-body font-medium text-neutral-900">
                            {batch ? t('composer.chooseLesson') : t('composer.pickBatchFirst')}
                        </span>
                        <span className="block text-caption text-neutral-500">
                            {t('items.course.pickHint')}
                        </span>
                    </span>
                </MyButton>
            )}
            <p className="text-caption text-neutral-500">{t('composer.lessonHint')}</p>
            {manyBatches && hasSlide && (
                <p className="text-caption text-warning-700">{t('items.course.firstBatch')}</p>
            )}
            <FieldError message={error} />

            {batch && (
                <CourseSlidePicker
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    packageSessionId={batch}
                    currentSlide={slide}
                    onPick={onPick}
                />
            )}
        </div>
    );
}
