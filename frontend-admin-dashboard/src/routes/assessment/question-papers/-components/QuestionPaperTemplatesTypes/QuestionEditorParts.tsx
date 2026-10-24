import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { MyButton } from '@/components/design-system/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { Check, Plus, Trash } from '@phosphor-icons/react';
import { useFormState, useWatch } from 'react-hook-form';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatStructure } from '../../-utils/helper';

/**
 * Shared building blocks for the question editor (main view).
 *
 * Every MCQ variant used to hand-roll the same "Answer:" grid with slightly
 * different keys, which is why the options drifted visually between question
 * types. They now share `AnswerOptionsEditor`.
 */

/**
 * Paper-level labels are stored with their punctuation ("Answer:", "Explanation:").
 * They now render as headings, where a trailing colon reads as a typo.
 */
export const stripTrailingColon = (label: string) => label.replace(/\s*:\s*$/, '');

/** Section heading used above each block of the question editor. */
export const QuestionSectionHeader = ({
    title,
    hint,
    action,
}: {
    title: string;
    hint?: string;
    action?: React.ReactNode;
}) => (
    <div className="flex w-full items-end justify-between gap-4">
        <div className="flex flex-col">
            <span className="text-subtitle font-semibold text-neutral-700">
                {stripTrailingColon(title)}
            </span>
            {hint && <span className="text-caption text-neutral-500">{hint}</span>}
        </div>
        {action}
    </div>
);

type OptionValue = { id?: string; name?: string; isSelected?: boolean };

export type AnswerOptionsEditorProps = {
    // Each question type has its own schema branch; the editor only touches
    // `{ name, isSelected }`, so the loose form type keeps it reusable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: UseFormReturn<any>;
    currentQuestionIndex: number;
    /** Key of the option array on the question, e.g. `singleChoiceOptions`. */
    optionsKey: string;
    /** `single` clears the other options when one is picked. */
    selectionMode: 'single' | 'multiple';
    /** Label configured on the paper (e.g. "Answer:"). */
    title: string;
    /** Option numbering structure configured on the paper (e.g. "(a.)"). */
    optionsType?: string;
    examType?: string;
    enableOptionModalCompose?: boolean;
};

export const AnswerOptionsEditor = ({
    form,
    currentQuestionIndex,
    optionsKey,
    selectionMode,
    title,
    optionsType,
    examType,
    enableOptionModalCompose = false,
}: AnswerOptionsEditorProps) => {
    const { t } = useTranslation('assessmentQuestionEditorParts');
    const { control, getValues, setValue } = form;
    const basePath = `questions.${currentQuestionIndex}.${optionsKey}`;
    const isSurvey = examType === 'SURVEY';

    // Watch (rather than getValues) so the correct-answer tint and the add /
    // remove buttons re-render the whole grid, not just the changed field.
    const watched = useWatch({ control, name: basePath }) as OptionValue[] | undefined;
    const options: OptionValue[] = watched ?? (getValues(basePath) as OptionValue[]) ?? [];
    const canRemove = options.length > 2;

    // Group-level issues ("must have exactly one option selected") land on the
    // array itself, which nothing used to render — the question just silently
    // failed to save.
    const { errors } = useFormState({ control, name: basePath });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupError: string | undefined = (errors as any)?.questions?.[currentQuestionIndex]?.[
        optionsKey
    ]?.message;

    const handleToggle = (optionIndex: number) => {
        if (isSurvey) return;
        const isCurrentlySelected = !!getValues(`${basePath}.${optionIndex}.isSelected`);
        if (selectionMode === 'single') {
            options.forEach((_, i) => {
                setValue(
                    `${basePath}.${i}.isSelected`,
                    i === optionIndex ? !isCurrentlySelected : false,
                    {
                        shouldDirty: true,
                        shouldValidate: true,
                    }
                );
            });
        } else {
            setValue(`${basePath}.${optionIndex}.isSelected`, !isCurrentlySelected, {
                shouldDirty: true,
                shouldValidate: true,
            });
        }
        form.trigger(basePath);
    };

    const handleAddOption = () => {
        setValue(basePath, [...options, { id: '', name: '', isSelected: false }], {
            shouldDirty: true,
        });
    };

    const handleRemoveOption = (optionIndex: number) => {
        if (!canRemove) return;
        setValue(
            basePath,
            options.filter((_, i) => i !== optionIndex),
            { shouldDirty: true, shouldValidate: true }
        );
    };

    const hint = isSurvey
        ? t('answerOptions.hint.survey')
        : selectionMode === 'single'
          ? t('answerOptions.hint.single')
          : t('answerOptions.hint.multiple');

    return (
        <div className="flex w-full flex-col gap-3">
            <QuestionSectionHeader
                title={title}
                hint={hint}
                action={
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        className="h-8 gap-1"
                        onClick={handleAddOption}
                    >
                        <Plus size={14} />
                        {t('answerOptions.addOption')}
                    </MyButton>
                }
            />
            <div
                role={selectionMode === 'single' ? 'radiogroup' : 'group'}
                aria-label={t('answerOptions.ariaLabel')}
                className="grid grid-cols-1 gap-3 lg:grid-cols-2"
            >
                {options.map((opt, optionIndex) => {
                    const letter = String.fromCharCode(97 + optionIndex);
                    const label = optionsType
                        ? formatStructure(optionsType, letter)
                        : letter.toUpperCase();
                    const isCorrect = !!opt?.isSelected && !isSurvey;
                    return (
                        <div
                            key={optionIndex}
                            className={cn(
                                'group flex items-start gap-3 rounded-lg border p-3 transition-colors',
                                isCorrect
                                    ? 'border-success-400 bg-success-50'
                                    : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-white'
                            )}
                        >
                            {!isSurvey && (
                                <button
                                    type="button"
                                    role={selectionMode === 'single' ? 'radio' : 'checkbox'}
                                    aria-checked={isCorrect}
                                    aria-label={t('answerOptions.markCorrect.ariaLabel', {
                                        letter: letter.toUpperCase(),
                                    })}
                                    title={
                                        isCorrect
                                            ? t('answerOptions.markCorrect.titleCorrect')
                                            : t('answerOptions.markCorrect.titleMark')
                                    }
                                    onClick={() => handleToggle(optionIndex)}
                                    className={cn(
                                        'mt-1 flex size-5 shrink-0 items-center justify-center border-2 transition-colors',
                                        selectionMode === 'single' ? 'rounded-full' : 'rounded-sm',
                                        isCorrect
                                            ? 'border-success-500 bg-success-500 text-white'
                                            : 'border-neutral-300 bg-white text-transparent hover:border-success-400 hover:text-success-300'
                                    )}
                                >
                                    <Check size={12} weight="bold" />
                                </button>
                            )}
                            <span
                                className={cn(
                                    'mt-1 shrink-0 text-body font-semibold',
                                    isCorrect ? 'text-success-700' : 'text-neutral-500'
                                )}
                            >
                                {label}
                            </span>
                            <FormField
                                control={control}
                                name={`${basePath}.${optionIndex}.name`}
                                render={({ field }) => (
                                    <FormItem className="min-w-0 flex-1">
                                        <FormControl>
                                            <RichTextEditor
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                onChange={field.onChange}
                                                minHeight={28}
                                                hideToolbar
                                                borderless
                                                enableModalCompose={enableOptionModalCompose}
                                                placeholder={t('answerOptions.optionPlaceholder', {
                                                    letter: letter.toUpperCase(),
                                                })}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            {canRemove && (
                                <button
                                    type="button"
                                    className="mt-1 shrink-0 rounded-sm p-0.5 text-neutral-400 opacity-0 transition-opacity hover:text-danger-500 focus-visible:opacity-100 group-hover:opacity-100"
                                    onClick={() => handleRemoveOption(optionIndex)}
                                    aria-label={t('answerOptions.removeOption.ariaLabel', {
                                        letter: letter.toUpperCase(),
                                    })}
                                    title={t('answerOptions.removeOption.title')}
                                >
                                    <Trash size={16} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            {groupError && <p className="text-caption text-danger-600">{groupError}</p>}
        </div>
    );
};
