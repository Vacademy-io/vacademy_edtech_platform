import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import {
    JOURNEY_STATUS_QUERY_KEY,
    setJourneyStatus,
    type JourneyStatusSettings,
} from '@/services/journey-status';

const ALL = '__all__';

export interface JourneyBatchOption {
    package_session_id: string;
    course_label: string | null;
}

interface ChangeJourneyStatusDialogProps {
    onClose: () => void;
    instituteId: string;
    settings: JourneyStatusSettings;
    /** One learner (side view) or many (bulk action). */
    userIds: string[];
    /** Side view: the learner's batches to choose from. */
    batches?: JourneyBatchOption[];
    initialBatch?: string | null;
    initialStatus?: string | null;
    /** Bulk: only these batches (the list's batch filter); empty = every current batch. */
    scopePackageSessionIds?: string[];
    heading?: string;
}

const schema = z.object({
    status: z.string().min(1),
    batch: z.string(),
    reason: z.string().max(500),
    nextActionDate: z.string(),
});

type FormValues = z.infer<typeof schema>;

/** Sets the journey status of one learner's batch, all their batches, or many learners. */
export const ChangeJourneyStatusDialog = ({
    onClose,
    instituteId,
    settings,
    userIds,
    batches,
    initialBatch,
    initialStatus,
    scopePackageSessionIds,
    heading,
}: ChangeJourneyStatusDialogProps) => {
    const { t } = useTranslation('manageStudentsJourney');
    const queryClient = useQueryClient();
    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            status: initialStatus ?? settings.default_status,
            batch: initialBatch ?? (batches && batches.length === 1 ? batches[0]!.package_session_id : ALL),
            reason: '',
            nextActionDate: '',
        },
    });

    const statusOptions = useMemo(
        () => settings.statuses.map((s, i) => ({ _id: i, value: s.key, label: s.label })),
        [settings.statuses]
    );
    const batchOptions = useMemo(
        () => [
            ...(batches && batches.length > 1
                ? [{ _id: 'all', value: ALL, label: t('dialog.allBatches') }]
                : []),
            ...(batches ?? []).map((b) => ({
                _id: b.package_session_id,
                value: b.package_session_id,
                label: b.course_label || b.package_session_id,
            })),
        ],
        [batches, t]
    );

    const mutation = useMutation({
        mutationFn: (v: FormValues) => {
            const common = {
                status_key: v.status,
                reason: v.reason.trim() || null,
                next_action_date: v.nextActionDate || null,
            };
            if (batches) {
                return setJourneyStatus(instituteId, {
                    ...common,
                    items: userIds.map((u) => ({
                        user_id: u,
                        package_session_id: v.batch === ALL ? null : v.batch,
                    })),
                });
            }
            return setJourneyStatus(instituteId, {
                ...common,
                user_ids: userIds,
                package_session_ids: scopePackageSessionIds ?? [],
            });
        },
        onSuccess: (res) => {
            toast.success(t('dialog.saved', { count: res.updated }));
            queryClient.invalidateQueries({ queryKey: [JOURNEY_STATUS_QUERY_KEY] });
            onClose();
        },
        onError: (err: { response?: { data?: { message?: string } }; message?: string }) => {
            toast.error(err?.response?.data?.message || err?.message || t('dialog.failed'));
        },
    });

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={heading ?? t('dialog.title')}
            dialogWidth="max-w-md"
            footer={
                <>
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={mutation.isPending}
                        onAsyncClick={form.handleSubmit((v) => mutation.mutateAsync(v))}
                        loadingText={t('dialog.saving')}
                    >
                        {t('dialog.submit')}
                    </MyButton>
                </>
            }
        >
            <Form {...form}>
                <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                    {!batches && (
                        <p className="text-body text-neutral-600">
                            {scopePackageSessionIds && scopePackageSessionIds.length > 0
                                ? t('dialog.bulkScopeFiltered', { count: userIds.length })
                                : t('dialog.bulkScopeAll', { count: userIds.length })}
                        </p>
                    )}
                    {batches && batches.length > 0 && (
                        <SelectField
                            control={form.control}
                            name="batch"
                            label={t('dialog.batch')}
                            options={batchOptions}
                            className="w-full sm:w-full"
                            labelStyle="w-full"
                        />
                    )}
                    <SelectField
                        control={form.control}
                        name="status"
                        label={t('dialog.status')}
                        required
                        options={statusOptions}
                        className="w-full sm:w-full"
                        labelStyle="w-full"
                    />
                    <FormField
                        control={form.control}
                        name="reason"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('dialog.reason')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        rows={2}
                                        placeholder={t('dialog.reasonPlaceholder')}
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="nextActionDate"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('dialog.nextAction')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="date"
                                        input={field.value}
                                        onChangeFunction={(e) => field.onChange(e.target.value)}
                                        className="w-full sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <p className="text-caption text-neutral-500">{t('dialog.noMessages')}</p>
                </form>
            </Form>
        </MyDialog>
    );
};
