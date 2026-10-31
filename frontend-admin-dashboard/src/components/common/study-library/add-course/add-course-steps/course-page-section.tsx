import { useState } from 'react';
import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import {
    ArrowDown,
    ArrowUp,
    CaretDown,
    CircleNotch,
    Plus,
    Sparkle,
    Trash,
} from '@phosphor-icons/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { AI_TEXT_CREDIT_COST, generateCourseFieldText } from '@/services/ai-course-assist';
import {
    COURSE_PAGE_MAX_FAQS,
    type CoursePageMode,
    buildFaqSuggestionPrompt,
    htmlToPlainText,
    isEmptyFaq,
    parseFaqsFromHtml,
} from '../-utils/course-page-content';
import type { Step1Data } from './add-course-step1';

const SUGGESTED_FAQ_COUNT = 5;

/**
 * 'loading' / 'unavailable' only happen when editing: the stored value is read from
 * course-init first, and the section stays read-only (and is left out of the save)
 * until it has been.
 */
export type CoursePageStatus = 'ready' | 'loading' | 'unavailable';

const MODE_OPTIONS: { value: CoursePageMode | null; label: string }[] = [
    { value: 'SELF_PACED', label: 'Self-paced' },
    { value: 'LIVE', label: 'Live' },
    { value: null, label: 'Not set' },
];

const MODE_LABELS: Record<CoursePageMode, string> = {
    SELF_PACED: 'Self-paced',
    LIVE: 'Live',
};

/**
 * Optional "course page" extras on Step 1: the delivery mode shown in the public page's
 * fact strip and the FAQ tab. Collapsed by default; the header summarises what is set so
 * an edit shows at a glance that the course already has FAQs.
 */
export const CoursePageSection = ({
    form,
    courseTerm,
    status = 'ready',
    open,
    onOpenChange,
}: {
    form: UseFormReturn<Step1Data>;
    /** The institute's word for "course" (naming settings). */
    courseTerm: string;
    status?: CoursePageStatus;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { fields, append, remove, move, replace } = useFieldArray({
        control: form.control,
        name: 'coursePage.faqs',
    });
    const mode = useWatch({ control: form.control, name: 'coursePage.mode' }) ?? null;
    const faqValues = useWatch({ control: form.control, name: 'coursePage.faqs' }) ?? [];
    const [isSuggesting, setIsSuggesting] = useState(false);

    const filledCount = faqValues.filter((faq) => !isEmptyFaq(faq)).length;
    const atCap = fields.length >= COURSE_PAGE_MAX_FAQS;
    const term = courseTerm.toLocaleLowerCase('en');

    const setMode = (value: CoursePageMode | null) =>
        form.setValue('coursePage.mode', value, { shouldDirty: true });

    const addFaq = () => {
        if (atCap) return;
        append({ q: '', a: '' });
    };

    const suggestFaqs = async () => {
        if (isSuggesting) return;
        const courseName = (form.getValues('course') ?? '').trim();
        const context = [
            courseName ? `Name: ${courseName}` : '',
            htmlToPlainText(form.getValues('description')) ||
                htmlToPlainText(form.getValues('aboutCourse')),
        ]
            .filter(Boolean)
            .join('\n');

        if (!courseName) {
            toast.error(`Add the ${term} name first`, {
                description: `FAQs are drafted from the ${term} name and description.`,
            });
            return;
        }

        const kept = (form.getValues('coursePage.faqs') ?? []).filter((faq) => !isEmptyFaq(faq));
        const room = COURSE_PAGE_MAX_FAQS - kept.length;
        if (room <= 0) {
            toast.error(`You already have ${COURSE_PAGE_MAX_FAQS} FAQs, the maximum.`);
            return;
        }

        setIsSuggesting(true);
        try {
            const result = await generateCourseFieldText({
                prompt: buildFaqSuggestionPrompt({
                    courseTerm,
                    count: SUGGESTED_FAQ_COUNT,
                    context,
                }),
                course_name: courseName,
            });
            const suggestions = parseFaqsFromHtml(result.html).slice(0, room);
            if (suggestions.length === 0) {
                toast.error('No FAQs came back', {
                    description: 'Please try again, or add them by hand.',
                });
                return;
            }
            // TipTap ignores outside value changes while focused — blur so new rows render.
            (document.activeElement as HTMLElement | null)?.blur?.();
            // Untouched blank rows are replaced by the suggestions rather than left above them.
            replace([...kept, ...suggestions]);
            if (!open) onOpenChange(true);
            toast.success(
                `Added ${suggestions.length} suggested FAQ${suggestions.length === 1 ? '' : 's'}`,
                { description: 'Review and edit them before saving.' }
            );
        } catch (error) {
            const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
            const insufficient = isAxiosError(error) && error.response?.status === 402;
            toast.error(insufficient ? 'Not enough AI credits' : 'Could not suggest FAQs', {
                description:
                    typeof detail === 'string'
                        ? detail
                        : insufficient
                          ? 'Please top up AI credits and try again.'
                          : 'Something went wrong. Please try again.',
            });
        } finally {
            setIsSuggesting(false);
        }
    };

    const summary =
        status === 'loading'
            ? 'Loading…'
            : status === 'unavailable'
              ? 'Not loaded'
              : [
                    mode ? MODE_LABELS[mode] : null,
                    filledCount > 0 ? `${filledCount} FAQ${filledCount === 1 ? '' : 's'}` : null,
                ]
                    .filter(Boolean)
                    .join(' · ');

    return (
        <Collapsible
            open={open}
            onOpenChange={onOpenChange}
            className="rounded-lg border border-neutral-200 bg-white"
        >
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-4 py-3 text-start transition-colors hover:bg-neutral-50"
                >
                    <div className="min-w-0">
                        <p className="text-base font-medium text-neutral-900">
                            {courseTerm} page{' '}
                            <span className="text-sm font-normal text-neutral-500">(optional)</span>
                        </p>
                        <p className="text-sm text-neutral-500">
                            Shown on the {term}&apos;s public page. Leave empty to hide.
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {summary && (
                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500">
                                {summary}
                            </span>
                        )}
                        <CaretDown
                            className={`size-4 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}
                        />
                    </div>
                </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
                {status !== 'ready' ? (
                    <div className="flex items-center gap-2 border-t border-neutral-200 p-4 text-sm text-neutral-500">
                        {status === 'loading' ? (
                            <>
                                <CircleNotch className="size-4 animate-spin" />
                                Loading the saved {term} page content…
                            </>
                        ) : (
                            `Could not load this ${term}'s page content, so saving leaves it unchanged. Close and reopen the editor to try again.`
                        )}
                    </div>
                ) : (
                    <div className="space-y-6 border-t border-neutral-200 p-4">
                        {/* Mode */}
                        <div className="space-y-2">
                            <p
                                id="course-page-mode-label"
                                className="text-sm font-medium text-neutral-700"
                            >
                                Mode
                            </p>
                            <div
                                role="radiogroup"
                                aria-labelledby="course-page-mode-label"
                                className="inline-flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1"
                            >
                                {MODE_OPTIONS.map((option) => {
                                    const selected = mode === option.value;
                                    return (
                                        <button
                                            key={option.label}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            onClick={() => setMode(option.value)}
                                            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                                                selected
                                                    ? 'bg-white font-medium text-primary-500 shadow-sm'
                                                    : 'text-neutral-600 hover:text-neutral-900'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-neutral-500">
                                Appears with the {term}&apos;s key facts.
                            </p>
                        </div>

                        {/* FAQs */}
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-700">
                                    FAQs · {filledCount}
                                </p>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-neutral-500">
                                        Uses {AI_TEXT_CREDIT_COST} AI credit
                                        {AI_TEXT_CREDIT_COST > 1 ? 's' : ''}
                                    </span>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        layoutVariant="default"
                                        className="gap-1 text-primary-500"
                                        disable={isSuggesting || atCap}
                                        onClick={suggestFaqs}
                                    >
                                        {isSuggesting ? (
                                            <CircleNotch className="size-4 animate-spin" />
                                        ) : (
                                            <Sparkle className="size-4" weight="duotone" />
                                        )}
                                        {isSuggesting ? 'Suggesting…' : 'Suggest FAQs with AI'}
                                    </MyButton>
                                </div>
                            </div>

                            {fields.length === 0 && (
                                <p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
                                    No FAQs yet. Add the questions learners ask before they join.
                                </p>
                            )}

                            {fields.map((field, index) => (
                                <div
                                    key={field.id}
                                    data-testid="course-page-faq-row"
                                    className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3"
                                >
                                    <span className="mt-2 w-6 shrink-0 text-xs font-semibold text-neutral-500">
                                        Q{index + 1}
                                    </span>
                                    <div className="min-w-0 flex-1 space-y-2">
                                        <FormField
                                            control={form.control}
                                            name={`coursePage.faqs.${index}.q`}
                                            render={({ field: questionField }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <Input
                                                            {...questionField}
                                                            value={questionField.value ?? ''}
                                                            aria-label={`Question ${index + 1}`}
                                                            placeholder="Question, e.g. Do I need any prior experience?"
                                                            maxLength={300}
                                                            className="h-9 border-neutral-300"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`coursePage.faqs.${index}.a`}
                                            render={({ field: answerField }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <RichTextEditor
                                                            value={answerField.value || ''}
                                                            onChange={answerField.onChange}
                                                            onBlur={answerField.onBlur}
                                                            minimalToolbar
                                                            minHeight={70}
                                                            placeholder="Answer"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <div className="flex shrink-0 flex-col gap-1">
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={`Move question ${index + 1} up`}
                                            disable={index === 0}
                                            onClick={() => move(index, index - 1)}
                                        >
                                            <ArrowUp className="size-4" />
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={`Move question ${index + 1} down`}
                                            disable={index === fields.length - 1}
                                            onClick={() => move(index, index + 1)}
                                        >
                                            <ArrowDown className="size-4" />
                                        </MyButton>
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={`Remove question ${index + 1}`}
                                            className="hover:border-danger-500 hover:!text-danger-600"
                                            onClick={() => remove(index)}
                                        >
                                            <Trash className="size-4" />
                                        </MyButton>
                                    </div>
                                </div>
                            ))}

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="default"
                                    className="gap-1"
                                    disable={atCap}
                                    onClick={addFaq}
                                >
                                    <Plus className="size-4" />
                                    Add FAQ
                                </MyButton>
                                <span className="text-xs text-neutral-500">
                                    {atCap
                                        ? `Maximum of ${COURSE_PAGE_MAX_FAQS} FAQs reached.`
                                        : `Up to ${COURSE_PAGE_MAX_FAQS} FAQs. Empty rows are skipped.`}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
};
