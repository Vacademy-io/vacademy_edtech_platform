import { memo, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useController, useFieldArray, useWatch, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { TipTapEditor } from '@/components/tiptap/TipTapEditor';
import { cn } from '@/lib/utils';
import type { QuestionFormat } from '../../-types/types';
import { QUESTION_FORMATS, type ComposerForm, type QuestionOption } from '../forms/composer-schema';
import { FieldError, loose, useFieldError, type ItemPath, type LooseControl } from './item-fields';

/** A question or poll offers 2 to 6 options. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

const OPTION_ID_POOL = 'abcdefghijklmnopqrstuvwxyz';

/** The display letter for the option at `index` (A, B, C…), independent of its stored id. */
export function optionLetter(index: number): string {
    return String.fromCharCode(65 + (index % 26));
}

/** The first short id no option uses yet ("a", "b", …). */
export function nextOptionId(options: Pick<QuestionOption, 'id'>[]): string {
    const taken = new Set(options.map((o) => o.id));
    for (const ch of OPTION_ID_POOL) if (!taken.has(ch)) return ch;
    let n = options.length + 1;
    while (taken.has(`o${n}`)) n++;
    return `o${n}`;
}

function plainText(html: string): string {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * The prompt of a question or poll: rich text with a minimal toolbar. Shared by the
 * question and poll editors.
 */
export function PromptField({
    control,
    name,
    placeholder,
}: {
    control: LooseControl;
    name: ItemPath;
    placeholder: string;
}) {
    const { t } = useTranslation('engagement');
    const path = `${name}.question.prompt`;
    const { field } = useController({ control, name: path });
    const error = useFieldError(control, path);
    const labelId = useId();
    const value = typeof field.value === 'string' ? field.value : '';
    return (
        <div className="flex flex-col gap-1.5" role="group" aria-labelledby={labelId}>
            <span id={labelId} className="text-body font-medium text-neutral-700">
                {t('composer.question')}
            </span>
            <div
                className={cn(
                    'rounded-md border',
                    error ? 'border-danger-600' : 'border-transparent'
                )}
            >
                <TipTapEditor
                    value={value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={placeholder}
                    minHeight={90}
                    minimalToolbar
                />
            </div>
            {!error && !plainText(value) && (
                <p className="text-caption text-neutral-500">{t('items.question.promptHint')}</p>
            )}
            <FieldError message={error} />
        </div>
    );
}

interface OptionRowProps {
    control: LooseControl;
    path: string;
    index: number;
    optionId: string;
    withCorrect: boolean;
    canRemove: boolean;
    autoFocus: boolean;
    onRemove: (index: number) => void;
    onEnter: (index: number) => void;
    onFocused: () => void;
}

const OptionRow = memo(function OptionRow({
    control,
    path,
    index,
    optionId,
    withCorrect,
    canRemove,
    autoFocus,
    onRemove,
    onEnter,
    onFocused,
}: OptionRowProps) {
    const { t } = useTranslation('engagement');
    const { field } = useController({ control, name: `${path}.${index}.text` });
    const inputRef = useRef<HTMLInputElement | null>(null);
    const letter = optionLetter(index);

    useEffect(() => {
        if (!autoFocus) return;
        inputRef.current?.focus();
        onFocused();
    }, [autoFocus, onFocused]);

    return (
        <li className="flex items-center gap-2">
            {withCorrect && (
                <RadioGroupItem
                    value={optionId}
                    aria-label={t('composer.optionCorrect', { id: letter })}
                    className="size-5 shrink-0"
                />
            )}
            <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-caption font-semibold text-neutral-600"
            >
                {letter}
            </span>
            <div className="min-w-0 flex-1">
                <MyInput
                    ref={(el) => {
                        inputRef.current = el;
                        field.ref(el);
                    }}
                    inputType="text"
                    dir="auto"
                    input={typeof field.value === 'string' ? field.value : ''}
                    onChangeFunction={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            onEnter(index);
                        }
                    }}
                    inputPlaceholder={t('composer.optionPlaceholder', { id: letter })}
                    aria-label={t('composer.optionPlaceholder', { id: letter })}
                    className="sm:w-full"
                />
            </div>
            <MyButton
                type="button"
                buttonType="text"
                layoutVariant="icon"
                scale="medium"
                disable={!canRemove}
                aria-label={t('items.question.removeOption', { id: letter })}
                title={t('items.question.removeOption', { id: letter })}
                onClick={() => onRemove(index)}
                className="shrink-0 !text-neutral-500 hover:!text-danger-600"
            >
                <X size={16} aria-hidden />
            </MyButton>
        </li>
    );
});

/**
 * The option list of a multiple-choice question or a poll: 2–6 rows, removable, with
 * Enter adding the next one. For a question, a labelled "Correct answer" radio group
 * marks the key; removing the keyed option clears the key so the teacher picks again
 * instead of the key silently moving to another option.
 */
export function OptionListEditor({
    control,
    name,
    mode,
}: {
    control: LooseControl;
    name: ItemPath;
    mode: 'question' | 'poll';
}) {
    const { t } = useTranslation('engagement');
    const path = `${name}.question.options`;
    const keyPath = `${name}.question.correctOptionId`;
    const withCorrect = mode === 'question';
    const { fields, append, remove } = useFieldArray({ control, name: path, keyName: 'fieldKey' });
    const options = (useWatch({ control, name: path }) as QuestionOption[] | undefined) ?? [];
    const { field: keyField } = useController({ control, name: keyPath });
    const optionsError = useFieldError(control, path);
    const keyError = useFieldError(control, keyPath);
    const [focusIndex, setFocusIndex] = useState<number | null>(null);
    const optionsLabelId = useId();

    const latest = useRef({ options, keyValue: keyField.value as string, fieldsLength: 0 });
    latest.current = { options, keyValue: keyField.value as string, fieldsLength: fields.length };

    const addOption = useCallback(() => {
        const { options: current, fieldsLength } = latest.current;
        if (fieldsLength >= MAX_OPTIONS) return;
        append({ id: nextOptionId(current), text: '' }, { shouldFocus: false });
        setFocusIndex(fieldsLength);
    }, [append]);

    const removeOption = useCallback(
        (index: number) => {
            const { options: current, keyValue, fieldsLength } = latest.current;
            if (fieldsLength <= MIN_OPTIONS) return;
            const removedId = current[index]?.id;
            remove(index);
            if (withCorrect && removedId && removedId === keyValue) keyField.onChange('');
        },
        [remove, withCorrect, keyField]
    );

    const onEnter = useCallback(
        (index: number) => {
            const { fieldsLength } = latest.current;
            if (index === fieldsLength - 1) addOption();
            else setFocusIndex(index + 1);
        },
        [addOption]
    );

    const clearFocus = useCallback(() => setFocusIndex(null), []);

    const keyIndex = options.findIndex((o) => o.id === keyField.value);
    const keyOption = keyIndex >= 0 ? options[keyIndex] : undefined;

    const list = (
        <ul className="flex flex-col gap-2" aria-labelledby={optionsLabelId}>
            {fields.map((option, index) => (
                <OptionRow
                    key={option.fieldKey}
                    control={control}
                    path={path}
                    index={index}
                    optionId={options[index]?.id ?? (option as unknown as QuestionOption).id}
                    withCorrect={withCorrect}
                    canRemove={fields.length > MIN_OPTIONS}
                    autoFocus={focusIndex === index}
                    onRemove={removeOption}
                    onEnter={onEnter}
                    onFocused={clearFocus}
                />
            ))}
        </ul>
    );

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
                <div className="flex items-end justify-between gap-2">
                    <span id={optionsLabelId} className="text-body font-medium text-neutral-700">
                        {mode === 'poll' ? t('items.poll.choices') : t('composer.options')}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {t('items.question.optionRange', { min: MIN_OPTIONS, max: MAX_OPTIONS })}
                    </span>
                </div>
                {withCorrect && (
                    // The radio group's accessible name is "Correct answer"; this line
                    // tells sighted teachers what the circles are for.
                    <p className="text-caption text-neutral-500">
                        {t('items.question.pickCorrectHint')}
                    </p>
                )}
            </div>

            {withCorrect ? (
                <RadioGroup
                    value={typeof keyField.value === 'string' ? keyField.value : ''}
                    onValueChange={keyField.onChange}
                    aria-label={t('items.question.correctAnswer')}
                    aria-invalid={keyError ? true : undefined}
                    className="gap-0"
                >
                    {list}
                </RadioGroup>
            ) : (
                list
            )}

            <div className="flex flex-wrap items-center gap-3">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    disable={fields.length >= MAX_OPTIONS}
                    onClick={addOption}
                >
                    <Plus size={14} aria-hidden /> {t('items.question.addOption')}
                </MyButton>
                {fields.length >= MAX_OPTIONS && (
                    <span className="text-caption text-neutral-500">
                        {t('items.question.maxOptions', { max: MAX_OPTIONS })}
                    </span>
                )}
            </div>

            {withCorrect && keyOption && keyOption.text.trim() && (
                <p className="flex items-start gap-1.5 rounded-md bg-success-50 px-3 py-2 text-caption text-success-700">
                    <CheckCircle size={16} weight="fill" className="shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                        {t('items.question.answerKey', {
                            letter: optionLetter(keyIndex),
                            text: keyOption.text.trim(),
                        })}
                    </span>
                </p>
            )}
            <FieldError message={optionsError} />
            <FieldError message={keyError} />
        </div>
    );
}

/**
 * A question of the day: how learners answer (multiple choice, written, upload), the
 * prompt, the options with a labelled correct-answer radio group (MCQ only), the
 * explanation shown at reveal, and whether the result waits for the reveal.
 *
 * Switching away from multiple choice clears the MCQ-only fields (the bonus and the
 * hide-result switch) so they aren't saved invisibly.
 */
export function QuestionEditor({
    control,
    name,
}: {
    control: Control<ComposerForm>;
    name: ItemPath;
}) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    const { field: formatField } = useController({ control: c, name: `${name}.question.format` });
    const { field: explanationField } = useController({
        control: c,
        name: `${name}.question.explanation`,
    });
    const { field: hideField } = useController({
        control: c,
        name: `${name}.hideResultUntilReveal`,
    });
    const { field: bonusField } = useController({ control: c, name: `${name}.correctPoints` });
    const format = (formatField.value as QuestionFormat | undefined) ?? 'MCQ';
    const formatLabelId = useId();
    const explanationLabelId = useId();
    const hideId = useId();
    const hideHintId = useId();

    function changeFormat(next: string) {
        const value = next as QuestionFormat;
        if (value === format) return;
        formatField.onChange(value);
        if (value !== 'MCQ') {
            // Only a multiple-choice answer can be graded, so only it earns a bonus or
            // waits for the reveal.
            bonusField.onChange(0);
            hideField.onChange(false);
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
                <span id={formatLabelId} className="text-body font-medium text-neutral-700">
                    {t('composer.howAnswer')}
                </span>
                <RadioGroup
                    value={format}
                    onValueChange={changeFormat}
                    aria-labelledby={formatLabelId}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                    {QUESTION_FORMATS.map((f) => {
                        const id = `${formatLabelId}-${f}`;
                        const selected = f === format;
                        return (
                            <div
                                key={f}
                                className={cn(
                                    'flex items-start gap-2 rounded-lg border p-3 transition-colors',
                                    selected
                                        ? 'border-primary-400 bg-primary-50'
                                        : 'border-neutral-200 hover:border-neutral-300'
                                )}
                            >
                                <RadioGroupItem
                                    id={id}
                                    value={f}
                                    aria-describedby={`${id}-hint`}
                                    className="mt-0.5 shrink-0"
                                />
                                <Label
                                    htmlFor={id}
                                    className="min-w-0 flex-1 cursor-pointer space-y-0.5"
                                >
                                    <span className="block text-body font-medium text-neutral-900">
                                        {t(`composer.formats.${f}`)}
                                    </span>
                                    <span
                                        id={`${id}-hint`}
                                        className="block text-caption font-normal text-neutral-500"
                                    >
                                        {t(`composer.formats.${f}_hint`)}
                                    </span>
                                </Label>
                            </div>
                        );
                    })}
                </RadioGroup>
            </div>

            <PromptField control={c} name={name} placeholder={t('composer.askPlaceholder')} />

            {format === 'MCQ' ? (
                <OptionListEditor control={c} name={name} mode="question" />
            ) : (
                <p className="rounded-md bg-neutral-50 px-3 py-2 text-caption text-neutral-600">
                    {format === 'TEXT'
                        ? t('items.question.textNote')
                        : t('items.question.uploadNote')}
                </p>
            )}

            <div
                className="flex flex-col gap-1.5"
                role="group"
                aria-labelledby={explanationLabelId}
            >
                <span id={explanationLabelId} className="text-body font-medium text-neutral-700">
                    {format === 'MCQ' ? t('composer.explanation') : t('items.question.modelAnswer')}
                </span>
                <TipTapEditor
                    value={typeof explanationField.value === 'string' ? explanationField.value : ''}
                    onChange={explanationField.onChange}
                    onBlur={explanationField.onBlur}
                    placeholder={t('composer.explanationPlaceholder')}
                    minHeight={90}
                    minimalToolbar
                />
            </div>

            {format === 'MCQ' && (
                <div className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
                    <Switch
                        id={hideId}
                        checked={Boolean(hideField.value)}
                        onCheckedChange={hideField.onChange}
                        aria-describedby={hideHintId}
                        className="mt-0.5"
                    />
                    <div className="min-w-0 space-y-0.5">
                        <Label htmlFor={hideId} className="text-body font-medium text-neutral-800">
                            {t('composer.hideResult')}
                        </Label>
                        <p id={hideHintId} className="text-caption text-neutral-500">
                            {t('composer.hideResultHint')}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
