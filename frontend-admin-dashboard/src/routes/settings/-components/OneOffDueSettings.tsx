/**
 * Settings → One-off charges: the institute switch for single extra charges on a learner
 *. Off by default; while off, the card is hidden from the learner's
 * Payments tab, the learner app shows nothing and the server refuses new charges.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellSlash, CreditCard, Receipt, ClockCounterClockwise } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import {
    ONE_OFF_DUES_QUERY_KEY,
    ONE_OFF_DUE_SETTINGS_DEFAULTS,
    ONE_OFF_DUE_SETTINGS_QUERY_KEY,
    fetchOneOffDueSettingsStrict,
    saveOneOffDueSettings,
    type OneOffDueSettings as Settings,
} from '@/services/one-off-dues';

const Explainer = ({
    icon,
    title,
    points,
}: {
    icon: React.ReactNode;
    title: string;
    points: string[];
}) => (
    <div className="rounded-lg border border-neutral-200 p-4">
        <div className="mb-2 flex items-center gap-2 text-subtitle font-semibold text-neutral-800">
            <span className="text-primary-500">{icon}</span>
            {title}
        </div>
        <ul className="list-disc space-y-1 ps-5 text-body text-neutral-600">
            {points.map((p) => (
                <li key={p}>{p}</li>
            ))}
        </ul>
    </div>
);

export default function OneOffDueSettings() {
    const { t } = useTranslation('settingsOneOffDues');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<Settings>(ONE_OFF_DUE_SETTINGS_DEFAULTS);
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: [ONE_OFF_DUE_SETTINGS_QUERY_KEY, 'page'],
        queryFn: fetchOneOffDueSettingsStrict,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutateAsync: save } = useMutation({
        mutationFn: saveOneOffDueSettings,
        onSuccess: () => {
            toast.success(t('saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: [ONE_OFF_DUE_SETTINGS_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [ONE_OFF_DUES_QUERY_KEY] });
        },
        onError: () => toast.error(t('saveFailed')),
    });

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('title')}</CardTitle>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {isLoading && <Skeleton className="h-6 w-48" />}
                    {isError && (
                        <div className="flex items-center gap-3 text-body text-danger-600">
                            {t('loadFailed')}
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={() => refetch()}
                            >
                                {t('retry')}
                            </MyButton>
                        </div>
                    )}
                    {!isLoading && !isError && (
                        <div className="flex items-center gap-3">
                            <Switch
                                id="one-off-dues-enabled"
                                checked={settings.enabled}
                                onCheckedChange={(v) => {
                                    setSettings((prev) => ({ ...prev, enabled: v }));
                                    setHasChanges(true);
                                }}
                            />
                            <Label htmlFor="one-off-dues-enabled" className="cursor-pointer">
                                {t('toggleLabel')}
                            </Label>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <Explainer
                            icon={<Receipt className="size-5" />}
                            title={t('add.title')}
                            points={[t('add.point1'), t('add.point2'), t('add.point3')]}
                        />
                        <Explainer
                            icon={<CreditCard className="size-5" />}
                            title={t('pay.title')}
                            points={[t('pay.point1'), t('pay.point2'), t('pay.point3')]}
                        />
                        <Explainer
                            icon={<BellSlash className="size-5" />}
                            title={t('quiet.title')}
                            points={[t('quiet.point1'), t('quiet.point2')]}
                        />
                    </div>

                    <p className="text-caption text-neutral-500">{t('offNote')}</p>

                    <p className="flex items-start gap-2 text-caption text-neutral-500">
                        <ClockCounterClockwise className="mt-0.5 size-4 shrink-0" />
                        {t('audit')}
                    </p>

                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={!hasChanges || isLoading}
                            onAsyncClick={() => save(settings)}
                            loadingText={t('saving')}
                        >
                            {t('save')}
                        </MyButton>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
