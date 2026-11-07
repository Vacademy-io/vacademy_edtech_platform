import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { CloudArrowDown } from '@phosphor-icons/react';
import {
    getOfflineAccessSettings,
    saveOfflineAccessSettings,
} from '@/services/offline-access';
import { DEFAULT_OFFLINE_ACCESS_SETTINGS } from '@/types/offline-access';

const offlineAccessSchema = z.object({
    enabled: z.boolean(),
    revalidationDays: z.coerce.number().int().min(1).max(90),
    maxDevices: z.coerce.number().int().min(1).max(10),
});

type OfflineAccessFormValues = z.infer<typeof offlineAccessSchema>;

/**
 * Institute-wide OFFLINE_ACCESS_SETTING editor (offline plan Part A6/B8).
 * Master enable + re-validation lease length + max concurrent offline
 * devices per learner — read by the learner app's device registration/
 * check-in flow and the resolver's `enabled=false` global kill switch.
 */
export default function OfflineAccessSettings() {
    const { t } = useTranslation('settingsOfflineAccess');
    const queryClient = useQueryClient();

    const { data, isLoading } = useQuery({
        queryKey: ['offline-access-settings'],
        queryFn: getOfflineAccessSettings,
        staleTime: 5 * 60 * 1000,
    });

    const form = useForm<OfflineAccessFormValues>({
        resolver: zodResolver(offlineAccessSchema),
        defaultValues: DEFAULT_OFFLINE_ACCESS_SETTINGS,
    });

    useEffect(() => {
        if (data) form.reset(data);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: (values: OfflineAccessFormValues) => saveOfflineAccessSettings(values),
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            queryClient.invalidateQueries({ queryKey: ['offline-access-settings'] });
        },
        onError: () => toast.error(t('toasts.saveError')),
    });

    const enabled = form.watch('enabled');

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CloudArrowDown className="size-5 text-primary-500" />
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit((values) => save(values))}
                        className="space-y-4"
                    >
                        <FormField
                            control={form.control}
                            name="enabled"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                                    <div className="space-y-0.5">
                                        <FormLabel>{t('enabled.label')}</FormLabel>
                                        <p className="text-caption text-neutral-500">
                                            {t('enabled.hint')}
                                        </p>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                            disabled={isLoading || saving}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="revalidationDays"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('revalidationDays.label')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="number"
                                                input={String(field.value)}
                                                onChangeFunction={(e) =>
                                                    field.onChange(Number(e.target.value))
                                                }
                                                disabled={!enabled || isLoading || saving}
                                            />
                                        </FormControl>
                                        <p className="text-caption text-neutral-500">
                                            {t('revalidationDays.hint')}
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="maxDevices"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('maxDevices.label')}</FormLabel>
                                        <FormControl>
                                            <MyInput
                                                inputType="number"
                                                input={String(field.value)}
                                                onChangeFunction={(e) =>
                                                    field.onChange(Number(e.target.value))
                                                }
                                                disabled={!enabled || isLoading || saving}
                                            />
                                        </FormControl>
                                        <p className="text-caption text-neutral-500">
                                            {t('maxDevices.hint')}
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="flex justify-end">
                            <MyButton
                                type="submit"
                                disabled={isLoading || saving || !form.formState.isDirty}
                                className="bg-primary-500"
                            >
                                {saving ? t('saving') : t('save')}
                            </MyButton>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
