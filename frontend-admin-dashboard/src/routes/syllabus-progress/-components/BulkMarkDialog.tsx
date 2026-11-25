import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import type { SyllabusBlock } from '@/services/syllabus-progress';
import { StatusPicker } from './StatusPicker';
import { blockLongLabel } from './status-meta';
import { NOTE_MAX, type MarkPayload } from './CellDialog';

const STATUS_VALUES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'] as const;

/**
 * "Mark week as…" for many learners and/or many week blocks at once. With no learner ticked
 * it applies to every learner in the batch, and says so.
 */
export function BulkMarkDialog({
    open,
    onOpenChange,
    blocks,
    initialBlockIds,
    userIds,
    allLearners,
    onSave,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    blocks: SyllabusBlock[];
    initialBlockIds: string[];
    userIds: string[];
    /** True when no learner was ticked, so `userIds` is the whole batch. */
    allLearners: boolean;
    onSave: (payload: MarkPayload) => Promise<unknown>;
}) {
    const { t } = useTranslation('syllabusProgress');

    const schema = useMemo(
        () =>
            z.object({
                block_ids: z.array(z.string()).min(1, t('bulk.weeksRequired')),
                status: z.enum(STATUS_VALUES, {
                    errorMap: () => ({ message: t('dialog.statusRequired') }),
                }),
                note: z.string().max(NOTE_MAX, t('dialog.noteTooLong', { max: NOTE_MAX })),
            }),
        [t]
    );
    type Values = z.infer<typeof schema>;

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            block_ids: initialBlockIds,
            status: undefined,
            note: '',
        },
    });

    const blockOptions = useMemo(
        () => blocks.map((b) => ({ value: b.id, label: blockLongLabel(b, t) })),
        [blocks, t]
    );
    const status = form.watch('status');
    const blockIds = form.watch('block_ids');
    const note = form.watch('note');

    const submit = async (values: Values) => {
        const trimmed = values.note.trim();
        await onSave({
            block_ids: values.block_ids,
            user_ids: userIds,
            status: values.status,
            ...(trimmed ? { note: trimmed } : {}),
        });
    };

    return (
        <MyDialog
            heading={t('bulk.title')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={form.handleSubmit(submit)}
                        loadingText={t('dialog.saving')}
                    >
                        {t('bulk.apply', { count: userIds.length * blockIds.length })}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form
                    className="space-y-6"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void form.handleSubmit(submit)();
                    }}
                >
                    <p className="text-body text-neutral-700">
                        {allLearners
                            ? t('bulk.allLearners', { count: userIds.length })
                            : t('bulk.selectedLearners', { count: userIds.length })}
                    </p>

                    <FormField
                        control={form.control}
                        name="block_ids"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('bulk.weeks')}</FormLabel>
                                <FormControl>
                                    <div>
                                        <MultiSelect
                                            options={blockOptions}
                                            selected={field.value}
                                            onChange={(v) => field.onChange(v)}
                                            placeholder={t('bulk.weeksPlaceholder')}
                                            portal={false}
                                            checkboxes
                                        />
                                    </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="status"
                        render={() => (
                            <FormItem>
                                <FormLabel>{t('bulk.markAs')}</FormLabel>
                                <FormControl>
                                    <div>
                                        <StatusPicker
                                            value={status ?? ''}
                                            onChange={(v) =>
                                                form.setValue('status', v, {
                                                    shouldDirty: true,
                                                    shouldValidate: true,
                                                })
                                            }
                                        />
                                    </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="note"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('bulk.note')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        rows={3}
                                        placeholder={t('dialog.notePlaceholder')}
                                    />
                                </FormControl>
                                <div className="flex justify-between gap-2 text-caption text-neutral-500">
                                    <span>{t('bulk.noteHint')}</span>
                                    <span>
                                        {note.length}/{NOTE_MAX}
                                    </span>
                                </div>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <p className="flex items-start gap-2 text-caption text-neutral-500">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {t('bulk.replaceNote')}
                    </p>
                </form>
            </Form>
        </MyDialog>
    );
}
