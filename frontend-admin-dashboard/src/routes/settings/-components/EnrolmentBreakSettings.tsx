/**
 * Settings → Breaks and holds: the institute switch for learner breaks (docs/ENROLMENT_BREAKS.md).
 * Off by default; while off, no breaks UI appears anywhere and the server refuses new breaks.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellSlash, PauseCircle, ClockCounterClockwise } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import {
    ENROLMENT_BREAK_SETTINGS_DEFAULTS,
    ENROLMENT_BREAK_SETTINGS_QUERY_KEY,
    ENROLMENT_BREAKS_QUERY_KEY,
    fetchEnrolmentBreakSettings,
    saveEnrolmentBreakSettings,
    type EnrolmentBreakSettings as Settings,
} from '@/services/enrolment-breaks';

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

export default function EnrolmentBreakSettings() {
    const { t } = useTranslation('settingsBreaks');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<Settings>(ENROLMENT_BREAK_SETTINGS_DEFAULTS);
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: [ENROLMENT_BREAK_SETTINGS_QUERY_KEY],
        queryFn: fetchEnrolmentBreakSettings,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutateAsync: save } = useMutation({
        mutationFn: saveEnrolmentBreakSettings,
        onSuccess: () => {
            toast.success(t('saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAK_SETTINGS_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [ENROLMENT_BREAKS_QUERY_KEY] });
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
                                id="enrolment-breaks-enabled"
                                checked={settings.enabled}
                                onCheckedChange={(v) => {
                                    setSettings((prev) => ({ ...prev, enabled: v }));
                                    setHasChanges(true);
                                }}
                            />
                            <Label htmlFor="enrolment-breaks-enabled" className="cursor-pointer">
                                {settings.enabled ? t('enabledLabel') : t('disabledLabel')}
                            </Label>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Explainer
                            icon={<BellSlash className="size-5" />}
                            title={t('hold.title')}
                            points={[t('hold.point1'), t('hold.point2'), t('hold.point3')]}
                        />
                        <Explainer
                            icon={<PauseCircle className="size-5" />}
                            title={t('pause.title')}
                            points={[t('pause.point1'), t('pause.point2'), t('pause.point3')]}
                        />
                    </div>

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
