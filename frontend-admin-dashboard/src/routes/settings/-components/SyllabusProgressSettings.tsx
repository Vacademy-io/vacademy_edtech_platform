/**
 * Settings → Syllabus progress: the institute switch for per-week syllabus tracking.
 * Off by default; while off, the Syllabus progress page and its nav entry stay hidden and
 * learners see nothing new.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ChalkboardTeacher, Student } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import {
    SYLLABUS_PROGRESS_QUERY_KEY,
    SYLLABUS_PROGRESS_SETTINGS_DEFAULTS,
    SYLLABUS_PROGRESS_SETTINGS_QUERY_KEY,
    fetchSyllabusProgressSettingsStrict,
    saveSyllabusProgressSettings,
    syllabusErrorMessage,
    syllabusProgressKeys,
    type SyllabusProgressSettings as Settings,
} from '@/services/syllabus-progress';

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

export default function SyllabusProgressSettings() {
    const { t } = useTranslation('settingsSyllabusProgress');
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [settings, setSettings] = useState<Settings>(SYLLABUS_PROGRESS_SETTINGS_DEFAULTS);
    const [hasChanges, setHasChanges] = useState(false);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: syllabusProgressKeys.settings('page'),
        queryFn: fetchSyllabusProgressSettingsStrict,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutateAsync: save } = useMutation({
        mutationFn: saveSyllabusProgressSettings,
        onSuccess: () => {
            toast.success(t('saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: [SYLLABUS_PROGRESS_SETTINGS_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [SYLLABUS_PROGRESS_QUERY_KEY] });
        },
        onError: (error) => toast.error(syllabusErrorMessage(error, t('saveFailed'))),
    });

    const savedOn = data?.enabled === true;

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('title')}</CardTitle>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {isLoading && <Skeleton className="h-6 w-48" />}
                    {isError && (
                        <div className="flex flex-wrap items-center gap-3 text-body text-danger-600">
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
                                id="syllabus-progress-enabled"
                                checked={settings.enabled}
                                onCheckedChange={(v) => {
                                    setSettings((prev) => ({ ...prev, enabled: v }));
                                    setHasChanges(v !== savedOn);
                                }}
                            />
                            <Label htmlFor="syllabus-progress-enabled" className="cursor-pointer">
                                {t('toggleLabel')}
                            </Label>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Explainer
                            icon={<ChalkboardTeacher className="size-5" />}
                            title={t('teachers.title')}
                            points={[
                                t('teachers.point1'),
                                t('teachers.point2'),
                                t('teachers.point3'),
                            ]}
                        />
                        <Explainer
                            icon={<Student className="size-5" />}
                            title={t('learners.title')}
                            points={[t('learners.point1'), t('learners.point2')]}
                        />
                    </div>

                    <p className="text-caption text-neutral-500">{t('syllabusNote')}</p>
                    <p className="text-caption text-neutral-500">{t('offNote')}</p>

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        {savedOn && !hasChanges && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => void navigate({ to: '/syllabus-progress' })}
                            >
                                {t('openPage')}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={!hasChanges || isLoading || isError}
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
