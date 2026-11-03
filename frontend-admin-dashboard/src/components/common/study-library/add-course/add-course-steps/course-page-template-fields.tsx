import { useEffect, useState, type ReactNode } from 'react';
import { useFieldArray, useWatch, type FieldPath, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CaretDown, CircleNotch, Plus, Trash, UploadSimple } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    COURSE_TEMPLATE_MAX_CARDS,
    COURSE_TEMPLATE_MAX_TESTIMONIALS,
    countTemplateBlocks,
    emptyFrameworkCard,
    emptyLearningCard,
    emptyTestimonial,
} from '../-utils/course-page-template';
import type { Step1Data } from './add-course-step1';

type Form = UseFormReturn<Step1Data>;
type Name = FieldPath<Step1Data>;

const Block = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
    <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
        <div>
            <p className="text-sm font-medium text-neutral-700">{title}</p>
            {hint && <p className="text-xs text-neutral-500">{hint}</p>}
        </div>
        {children}
    </div>
);

const TextField = ({
    form,
    name,
    label,
    placeholder,
    maxLength = 300,
}: {
    form: Form;
    name: Name;
    label: string;
    placeholder?: string;
    maxLength?: number;
}) => (
    <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
            <FormItem>
                <FormControl>
                    <Input
                        {...field}
                        value={typeof field.value === 'string' ? field.value : ''}
                        aria-label={label}
                        placeholder={placeholder ?? label}
                        maxLength={maxLength}
                        className="h-9 border-neutral-300"
                    />
                </FormControl>
                <FormMessage />
            </FormItem>
        )}
    />
);

const TextAreaField = ({
    form,
    name,
    label,
    placeholder,
    rows = 3,
}: {
    form: Form;
    name: Name;
    label: string;
    placeholder?: string;
    rows?: number;
}) => (
    <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
            <FormItem>
                <FormControl>
                    <Textarea
                        {...field}
                        value={typeof field.value === 'string' ? field.value : ''}
                        aria-label={label}
                        placeholder={placeholder ?? label}
                        rows={rows}
                        maxLength={4000}
                        className="border-neutral-300"
                    />
                </FormControl>
                <FormMessage />
            </FormItem>
        )}
    />
);

const RichField = ({ form, name, placeholder }: { form: Form; name: Name; placeholder: string }) => (
    <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
            <FormItem>
                <FormControl>
                    <RichTextEditor
                        value={typeof field.value === 'string' ? field.value : ''}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        minimalToolbar
                        minHeight={70}
                        placeholder={placeholder}
                    />
                </FormControl>
                <FormMessage />
            </FormItem>
        )}
    />
);

/** Up / down / remove for one row of a repeatable list. */
const RowActions = ({
    label,
    index,
    count,
    move,
    remove,
}: {
    label: string;
    index: number;
    count: number;
    move: (from: number, to: number) => void;
    remove: (index: number) => void;
}) => (
    <div className="flex shrink-0 flex-col gap-1">
        <MyButton
            type="button"
            buttonType="secondary"
            layoutVariant="icon"
            scale="small"
            aria-label={`Move ${label} ${index + 1} up`}
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
            aria-label={`Move ${label} ${index + 1} down`}
            disable={index === count - 1}
            onClick={() => move(index, index + 1)}
        >
            <ArrowDown className="size-4" />
        </MyButton>
        <MyButton
            type="button"
            buttonType="secondary"
            layoutVariant="icon"
            scale="small"
            aria-label={`Remove ${label} ${index + 1}`}
            className="hover:border-danger-500 hover:!text-danger-600"
            onClick={() => remove(index)}
        >
            <Trash className="size-4" />
        </MyButton>
    </div>
);

const AddRowButton = ({
    label,
    atCap,
    max,
    onClick,
}: {
    label: string;
    atCap: boolean;
    max: number;
    onClick: () => void;
}) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
        <MyButton
            type="button"
            buttonType="secondary"
            scale="small"
            layoutVariant="default"
            className="gap-1"
            disable={atCap}
            onClick={onClick}
        >
            <Plus className="size-4" />
            {label}
        </MyButton>
        <span className="text-xs text-neutral-500">
            {atCap ? `Maximum of ${max} reached.` : `Up to ${max}. Empty ones are skipped.`}
        </span>
    </div>
);

const FrameworkCards = ({ form }: { form: Form }) => {
    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: 'coursePage.template.framework.cards',
    });
    const atCap = fields.length >= COURSE_TEMPLATE_MAX_CARDS;
    return (
        <div className="space-y-3">
            {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-3 rounded-lg bg-neutral-50 p-3">
                    <span className="mt-2 w-6 shrink-0 text-xs font-semibold text-neutral-500">
                        {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                        <TextField
                            form={form}
                            name={`coursePage.template.framework.cards.${index}.title`}
                            label="Card title"
                        />
                        <TextAreaField
                            form={form}
                            name={`coursePage.template.framework.cards.${index}.body`}
                            label="Description"
                            rows={2}
                        />
                        <TextAreaField
                            form={form}
                            name={`coursePage.template.framework.cards.${index}.points`}
                            label="Points"
                            placeholder="Points (one per line, optional)"
                            rows={3}
                        />
                        <TextField
                            form={form}
                            name={`coursePage.template.framework.cards.${index}.takeaway`}
                            label="Key takeaway"
                            placeholder="Key takeaway (optional)"
                        />
                    </div>
                    <RowActions
                        label="card"
                        index={index}
                        count={fields.length}
                        move={move}
                        remove={remove}
                    />
                </div>
            ))}
            <AddRowButton
                label="Add card"
                atCap={atCap}
                max={COURSE_TEMPLATE_MAX_CARDS}
                onClick={() => !atCap && append(emptyFrameworkCard())}
            />
        </div>
    );
};

const LearningCards = ({ form }: { form: Form }) => {
    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: 'coursePage.template.learning.cards',
    });
    const atCap = fields.length >= COURSE_TEMPLATE_MAX_CARDS;
    return (
        <div className="space-y-3">
            {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-3 rounded-lg bg-neutral-50 p-3">
                    <span className="mt-2 w-6 shrink-0 text-xs font-semibold text-neutral-500">
                        {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                        <TextField
                            form={form}
                            name={`coursePage.template.learning.cards.${index}.title`}
                            label="Card title"
                        />
                        <TextAreaField
                            form={form}
                            name={`coursePage.template.learning.cards.${index}.body`}
                            label="Description"
                            rows={2}
                        />
                    </div>
                    <RowActions
                        label="card"
                        index={index}
                        count={fields.length}
                        move={move}
                        remove={remove}
                    />
                </div>
            ))}
            <AddRowButton
                label="Add card"
                atCap={atCap}
                max={COURSE_TEMPLATE_MAX_CARDS}
                onClick={() => !atCap && append(emptyLearningCard())}
            />
        </div>
    );
};

const Testimonials = ({ form }: { form: Form }) => {
    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: 'coursePage.template.testimonials',
    });
    const atCap = fields.length >= COURSE_TEMPLATE_MAX_TESTIMONIALS;
    return (
        <div className="space-y-3">
            {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-3 rounded-lg bg-neutral-50 p-3">
                    <span className="mt-2 w-6 shrink-0 text-xs font-semibold text-neutral-500">
                        {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                        <TextAreaField
                            form={form}
                            name={`coursePage.template.testimonials.${index}.quote`}
                            label="Quote"
                            placeholder="Short quote shown in large text"
                            rows={2}
                        />
                        <div className="grid gap-2 sm:grid-cols-2">
                            <TextField
                                form={form}
                                name={`coursePage.template.testimonials.${index}.name`}
                                label="Reviewer name"
                            />
                            <TextField
                                form={form}
                                name={`coursePage.template.testimonials.${index}.details`}
                                label="Reviewer details"
                                placeholder="Role / details (optional)"
                            />
                        </div>
                        <TextAreaField
                            form={form}
                            name={`coursePage.template.testimonials.${index}.review`}
                            label="Full review"
                            placeholder="Full review (optional)"
                            rows={3}
                        />
                    </div>
                    <RowActions
                        label="review"
                        index={index}
                        count={fields.length}
                        move={move}
                        remove={remove}
                    />
                </div>
            ))}
            <AddRowButton
                label="Add review"
                atCap={atCap}
                max={COURSE_TEMPLATE_MAX_TESTIMONIALS}
                onClick={() => !atCap && append(emptyTestimonial())}
            />
        </div>
    );
};

const EnrolmentImage = ({ form }: { form: Form }) => {
    const imageId = useWatch({ control: form.control, name: 'coursePage.template.enrolment.imageId' }) ?? '';
    const { uploadFile } = useFileUpload();
    const [uploading, setUploading] = useState(false);
    const preview = useQuery({
        queryKey: ['course-template-enrolment-image', imageId],
        queryFn: () => getPublicUrl(imageId),
        enabled: !!imageId,
        staleTime: 30 * 60 * 1000,
    });

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Please choose an image file.');
            return;
        }
        try {
            const id = await uploadFile({
                file,
                setIsUploading: setUploading,
                userId: 'your-user-id',
                source: getCurrentInstituteId(),
                sourceId: 'COURSES',
            });
            if (id) {
                form.setValue('coursePage.template.enrolment.imageId', id, { shouldDirty: true });
            }
        } catch {
            toast.error('Image upload failed. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-3">
            {imageId && preview.data && (
                <img
                    src={preview.data}
                    alt="Enrolment section"
                    className="size-20 rounded-md border border-neutral-200 object-cover"
                />
            )}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
                {uploading ? (
                    <CircleNotch className="size-4 animate-spin" />
                ) : (
                    <UploadSimple className="size-4" />
                )}
                {imageId ? 'Replace image' : 'Upload image'}
                <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                        void onFile(e.target.files?.[0]);
                        e.target.value = '';
                    }}
                />
            </label>
            {imageId && (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="default"
                    className="gap-1 hover:border-danger-500 hover:!text-danger-600"
                    onClick={() =>
                        form.setValue('coursePage.template.enrolment.imageId', '', { shouldDirty: true })
                    }
                >
                    <Trash className="size-4" />
                    Remove
                </MyButton>
            )}
        </div>
    );
};

/**
 * Content for an HTML course template — a Manage Pages `course-details` HTML page that uses
 * `{{course.*}}` tokens. Nested and collapsed inside the course-page section: institutes
 * without such a template never need it. Every field is optional; an empty one hides its
 * section on the public page.
 */
export const CoursePageTemplateFields = ({ form, courseTerm }: { form: Form; courseTerm: string }) => {
    const [open, setOpen] = useState(false);
    const template = useWatch({ control: form.control, name: 'coursePage.template' });
    const filled = countTemplateBlocks(template);
    const term = courseTerm.toLocaleLowerCase('en');
    // A half-filled card blocks Next; open the block so its message is visible.
    const hasErrors = !!form.formState.errors.coursePage?.template;
    // Whole-section error (size cap); field errors show under their own inputs.
    const sizeError = form.formState.errors.coursePage?.template?.message;
    useEffect(() => {
        if (hasErrors) setOpen(true);
    }, [hasErrors]);

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-neutral-200">
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-start transition-colors hover:bg-neutral-50"
                >
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-700">Page template content</p>
                        <p className="text-xs text-neutral-500">
                            Used only when your website has a custom {term} page template. Leave
                            empty to hide a section.
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {filled > 0 && (
                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-500">
                                {filled} filled
                            </span>
                        )}
                        <CaretDown
                            className={`size-4 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`}
                        />
                    </div>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-4 border-t border-neutral-200 p-3">
                    {sizeError && (
                        <p role="alert" className="text-sm text-danger-600">
                            {sizeError}
                        </p>
                    )}
                    <Block title="Tagline and short description" hint="Shown below the title.">
                        <TextField
                            form={form}
                            name="coursePage.template.tagline"
                            label="Tagline"
                            placeholder="Tagline: one short line"
                        />
                        <TextAreaField
                            form={form}
                            name="coursePage.template.shortDescription"
                            label="Short description"
                            rows={2}
                        />
                    </Block>

                    <Block title={`${courseTerm} framework`} hint="Heading, introduction and cards.">
                        <TextField form={form} name="coursePage.template.framework.heading" label="Heading" />
                        <TextAreaField
                            form={form}
                            name="coursePage.template.framework.intro"
                            label="Introduction"
                            placeholder="Introduction (a blank line starts a new paragraph)"
                        />
                        <FrameworkCards form={form} />
                    </Block>

                    <Block
                        title="Learning experience"
                        hint="Heading, introduction, cards and an optional highlighted note."
                    >
                        <TextField form={form} name="coursePage.template.learning.heading" label="Heading" />
                        <TextAreaField
                            form={form}
                            name="coursePage.template.learning.intro"
                            label="Introduction"
                            placeholder="Introduction (a blank line starts a new paragraph)"
                        />
                        <LearningCards form={form} />
                        <RichField
                            form={form}
                            name="coursePage.template.learning.callout"
                            placeholder="Highlighted note (optional)"
                        />
                    </Block>

                    <Block title="Testimonials" hint="Real reviews from learners.">
                        <Testimonials form={form} />
                    </Block>

                    <Block title="Enrolment section" hint="Image and closing text beside the price.">
                        <EnrolmentImage form={form} />
                        <RichField
                            form={form}
                            name="coursePage.template.enrolment.description"
                            placeholder="Closing description"
                        />
                    </Block>

                    <Block title={`What the ${term} includes`}>
                        <TextField
                            form={form}
                            name="coursePage.template.inclusions.heading"
                            label="Heading"
                            placeholder="Heading, e.g. What you get"
                        />
                        <TextAreaField
                            form={form}
                            name="coursePage.template.inclusions.items"
                            label="Inclusions"
                            placeholder="One inclusion per line"
                            rows={4}
                        />
                    </Block>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
};
