import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import {
    DEFAULT_TERMINATION_REASON_SETTING,
    TerminationReasonSetting,
    saveTerminationReasonSetting,
    terminationReasonQueryKey,
    useTerminationReasonSetting,
} from '@/services/termination-reason-setting';

/**
 * Whether Remove from Course → Hard Terminate asks the admin for a reason, and
 * whether that reason is mandatory. The reason lands in the admin activity log.
 */
export default function TerminationReasonSettings() {
    const { t } = useTranslation('settingsTerminationReason');
    const queryClient = useQueryClient();

    const { data: saved, isLoading } = useTerminationReasonSetting();
    const [value, setValue] = useState<TerminationReasonSetting>(
        DEFAULT_TERMINATION_REASON_SETTING
    );

    useEffect(() => {
        if (saved) setValue(saved);
    }, [saved]);

    const mutation = useMutation({
        mutationFn: saveTerminationReasonSetting,
        onSuccess: () => {
            toast.success(t('toasts.saveSuccess'));
            queryClient.invalidateQueries({ queryKey: terminationReasonQueryKey() });
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toasts.saveError'));
        },
    });

    if (isLoading) return <div className="p-4">{t('loading')}</div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-1">
                        <Label htmlFor="termination-reason-enabled" className="font-semibold">
                            {t('enabled.label')}
                        </Label>
                        <p className="text-sm text-muted-foreground">{t('enabled.description')}</p>
                    </div>
                    <Switch
                        id="termination-reason-enabled"
                        checked={value.enabled}
                        onCheckedChange={(enabled) =>
                            setValue((v) => ({ enabled, required: enabled && v.required }))
                        }
                    />
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div className="space-y-1">
                        <Label htmlFor="termination-reason-required" className="font-semibold">
                            {t('required.label')}
                        </Label>
                        <p className="text-sm text-muted-foreground">{t('required.description')}</p>
                    </div>
                    <Switch
                        id="termination-reason-required"
                        checked={value.required}
                        disabled={!value.enabled}
                        onCheckedChange={(required) => setValue((v) => ({ ...v, required }))}
                    />
                </div>

                <div className="flex justify-end border-t pt-4">
                    <MyButton
                        buttonType="primary"
                        onClick={() => mutation.mutate(value)}
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? t('saveButton.saving') : t('saveButton.save')}
                    </MyButton>
                </div>
            </CardContent>
        </Card>
    );
}
