import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import SelectField from '@/components/design-system/select-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/formatters';
import { TableError } from '../TableParts';
import {
    notifySettingKey,
    saveNotifySetting,
    useNotifySettingQuery,
    type ClassroomNotifySetting,
} from './api';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** "9:00 am" or "09:00", as the admin's language writes a time. */
function hourLabel(hour: number): string {
    return formatDateTime(new Date(2026, 0, 1, hour, 0), {
        day: undefined,
        month: undefined,
        year: undefined,
        hour: 'numeric',
        minute: '2-digit',
    });
}

const schema = z.object({
    alerts_email: z.boolean(),
    hour: z.string().refine((value) => HOURS.some((hour) => String(hour) === value)),
});
type NotifyForm = z.infer<typeof schema>;

/**
 * The daily alert email for this institute (CLASSROOM_NOTIFY_SETTING). Off until the admin
 * turns it on. Only the fields shown are changed; anything else stored in the setting is kept.
 */
export function NotifySettingsCard({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const setting = useNotifySettingQuery(instituteId);

    return (
        <Card>
            <CardHeader className="flex flex-col gap-1.5 space-y-0">
                <CardTitle>
                    <h2 className="text-h3 font-medium">{t('alerts.notify.title')}</h2>
                </CardTitle>
                <CardDescription>{t('alerts.notify.description')}</CardDescription>
            </CardHeader>
            <CardContent>
                {setting.isPending && (
                    <div aria-busy="true" className="flex flex-col gap-3">
                        <Skeleton className="h-6 w-56" />
                        <Skeleton className="h-10 w-44" />
                    </div>
                )}
                {setting.isError && (
                    <TableError
                        message={t('alerts.notify.loadError')}
                        error={setting.error}
                        onRetry={() => void setting.refetch()}
                    />
                )}
                {setting.data && <NotifyForm instituteId={instituteId} stored={setting.data} />}
            </CardContent>
        </Card>
    );
}

function NotifyForm({
    instituteId,
    stored,
}: {
    instituteId: string;
    stored: ClassroomNotifySetting;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const queryClient = useQueryClient();
    const [failure, setFailure] = useState(false);
    const defaults = useMemo<NotifyForm>(
        () => ({ alerts_email: stored.alerts_email, hour: String(stored.hour) }),
        [stored]
    );
    const form = useForm<NotifyForm>({ resolver: zodResolver(schema), defaultValues: defaults });

    useEffect(() => {
        form.reset(defaults);
    }, [defaults, form]);

    const submit = form.handleSubmit(async (values) => {
        setFailure(false);
        try {
            await saveNotifySetting(instituteId, {
                ...stored,
                alerts_email: values.alerts_email,
                hour: Number(values.hour),
            });
            await queryClient.invalidateQueries({ queryKey: notifySettingKey(instituteId) });
            toast.success(t('alerts.notify.saved'));
        } catch {
            setFailure(true);
        }
    });

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                <FormField
                    control={form.control}
                    name="alerts_email"
                    render={({ field }) => (
                        <FormItem className="flex items-center gap-3 space-y-0">
                            <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="text-body font-regular text-neutral-700">
                                {t('alerts.notify.email')}
                            </FormLabel>
                        </FormItem>
                    )}
                />
                <div className="flex flex-col gap-1">
                    <SelectField
                        label={t('alerts.notify.hour')}
                        labelStyle="text-body font-medium text-neutral-700"
                        name="hour"
                        control={form.control}
                        disabled={!form.watch('alerts_email')}
                        options={HOURS.map((hour) => ({
                            _id: hour,
                            value: String(hour),
                            label: hourLabel(hour),
                        }))}
                    />
                    <span className="text-caption text-neutral-500">
                        {t('alerts.notify.timezone', { zone: stored.timezone })}
                    </span>
                </div>
                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{t('alerts.notify.saveError')}</AlertDescription>
                    </Alert>
                )}
                <div className="flex justify-end">
                    <MyButton
                        type="submit"
                        disable={form.formState.isSubmitting || !form.formState.isDirty}
                    >
                        {form.formState.isSubmitting
                            ? t('common.working')
                            : t('alerts.notify.save')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}
