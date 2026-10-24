import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    CircleNotch,
    PlugsConnected,
    CheckCircle,
    ArrowSquareIn,
    Plus,
    Trash,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    applyLmsConnectionToPackage,
    getLmsProviders,
    getPackageSettingAll,
    type LmsConnection,
    type LmsProvidersResponse,
} from '@/services/package-settings';

interface LmsSettingsCardProps {
    packageId: string;
    refreshKey?: number;
}

interface CourseLms {
    type: string;
    courseId: string;
    baseUrl: string;
    username: string;
}

const normUrl = (s: string) => (s ?? '').trim().toLowerCase().replace(/\/+$/, '');

/** The LMS this course currently syncs with, read from its course_setting (type + courseId + creds). */
const deriveCourseLms = (envelope: Record<string, unknown> | null): CourseLms | null => {
    const setting = (envelope?.setting ?? {}) as Record<
        string,
        { data?: { data?: Record<string, unknown> } }
    >;
    // Unwrap the double-data envelope (setting.<KEY>.data.data), falling back to single-data.
    const readInner = (key: string): Record<string, unknown> | undefined => {
        const entry = setting[key];
        if (!entry) return undefined;
        return entry.data?.data ?? (entry.data as Record<string, unknown> | undefined);
    };
    const moodle = readInner('MOODLE_SETTING');
    if (moodle?.moodleBaseUrl) {
        return {
            type: 'MOODLE',
            courseId: String(moodle.moodleCourseId ?? ''),
            baseUrl: String(moodle.moodleBaseUrl ?? ''),
            username: String(moodle.moodleToken ?? ''),
        };
    }
    const lms = readInner('LMS_SETTING');
    if (lms?.apiUrl || lms?.activeLms) {
        return {
            type: String(lms.activeLms ?? 'LEARNDASH'),
            courseId: String(lms.ldCourseId ?? ''),
            baseUrl: String(lms.apiUrl ?? ''),
            username: String(lms.apiKey ?? ''),
        };
    }
    return null;
};

/** Match the course's stored LMS back to an institute connection (by base URL + username). */
const matchConnectionId = (conns: LmsConnection[], cur: CourseLms): string | null => {
    const m = conns.find((c) =>
        cur.type === 'MOODLE'
            ? c.type === 'MOODLE' && normUrl(c.moodleBaseUrl ?? '') === normUrl(cur.baseUrl)
            : c.type !== 'MOODLE' &&
              normUrl(c.apiUrl ?? '') === normUrl(cur.baseUrl) &&
              (c.apiKey ?? '') === cur.username
    );
    return m?.id ?? null;
};

/**
 * Per-course LMS setup: pick one of the institute's saved connections, enter this course's id in
 * that LMS, and (optionally) add extra key–value fields. Workflows that fire on enrolment are
 * managed in the "Workflow Triggers" tab. (Connections are managed under Settings → Connect your LMS.)
 */
export const LmsSettingsCard: React.FC<LmsSettingsCardProps> = ({ packageId, refreshKey }) => {
    const { t } = useTranslation('studyLibraryLmsSettingsCard');
    const [providers, setProviders] = useState<LmsProvidersResponse | null>(null);
    const [connections, setConnections] = useState<LmsConnection[]>([]);
    const [currentLms, setCurrentLms] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);

    const [connectionId, setConnectionId] = useState<string>('');
    const [courseId, setCourseId] = useState<string>('');
    // Extra arbitrary key–value pairs merged into this course's LMS setting JSON.
    const [extraFields, setExtraFields] = useState<Array<{ key: string; value: string }>>([]);

    const updateExtra = (i: number, field: 'key' | 'value', val: string) =>
        setExtraFields((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    const removeExtra = (i: number) => setExtraFields((prev) => prev.filter((_, idx) => idx !== i));

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [prov, envelope] = await Promise.all([
                getLmsProviders(),
                getPackageSettingAll(packageId),
            ]);
            setProviders(prov);
            const conns = (prov.connections ?? []) as LmsConnection[];
            setConnections(conns);

            // Reflect the course's existing config: which LMS + its courseId.
            const cur = deriveCourseLms(envelope);
            setCurrentLms(cur?.type ?? null);
            if (cur?.courseId) setCourseId((prev) => prev || cur.courseId);
            const matchId = cur ? matchConnectionId(conns, cur) : null;
            setConnectionId(
                (prev) => prev || matchId || prov.defaultConnectionId || conns[0]?.id || ''
            );
        } catch (e) {
            console.error('Failed to load LMS info', e);
            toast.error(t('errors.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [packageId, t]);

    useEffect(() => {
        void load();
    }, [load, refreshKey]);

    const friendlyName = useCallback(
        (type: string | null | undefined): string => {
            if (!type) return t('builtInLms');
            return providers?.providers?.find((p) => p.id === type)?.displayName ?? type;
        },
        [providers, t]
    );

    const selectedConnection = useMemo(
        () => connections.find((c) => c.id === connectionId) ?? null,
        [connections, connectionId]
    );
    const isMoodle = selectedConnection?.type === 'MOODLE';
    const courseIdLabel = isMoodle ? t('moodleCourseId') : t('courseIdInLms');

    const handleApply = async () => {
        if (!connectionId) {
            toast.error(t('errors.pickConnection'));
            return;
        }
        setApplying(true);
        try {
            const extra: Record<string, string> = {};
            extraFields.forEach(({ key, value }) => {
                const k = key.trim();
                if (k) extra[k] = value;
            });
            await applyLmsConnectionToPackage(packageId, {
                connectionId,
                courseId: courseId.trim() || undefined,
                extraFields: Object.keys(extra).length ? extra : undefined,
            });
            toast.success(
                t('toasts.applySuccess', { lmsName: friendlyName(selectedConnection?.type) })
            );
            await load();
        } catch (e) {
            console.error('Failed to apply LMS connection', e);
            toast.error(e instanceof Error ? e.message : t('errors.applyFailed'));
        } finally {
            setApplying(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <PlugsConnected className="size-5 text-primary-500" weight="fill" />
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                {loading ? (
                    <div className="flex items-center justify-center py-8 text-neutral-500">
                        <CircleNotch className="me-2 size-5 animate-spin" /> {t('loading')}
                    </div>
                ) : (
                    <>
                        <div className="flex items-start gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                            <CheckCircle
                                className="mt-0.5 size-5 shrink-0 text-success-500"
                                weight="fill"
                            />
                            <p className="text-sm text-neutral-600">
                                {t('enrolSyncNotice.prefix')}{' '}
                                <span className="font-semibold text-neutral-800">
                                    {friendlyName(currentLms)}
                                </span>
                                {t('enrolSyncNotice.suffix')}
                            </p>
                        </div>

                        {connections.length === 0 ? (
                            <p className="text-sm text-neutral-500">
                                {t('noConnections.prefix')}{' '}
                                <span className="font-medium">{t('noConnections.settingsPath')}</span>
                                {t('noConnections.suffix')}
                            </p>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm font-medium text-neutral-700">
                                    {t('setupHeading')}
                                </p>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-sm">{t('lmsConnectionLabel')}</Label>
                                        <Select
                                            value={connectionId}
                                            onValueChange={setConnectionId}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('chooseConnectionPlaceholder')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {connections.map((c) => (
                                                    <SelectItem key={c.id} value={c.id}>
                                                        {c.name} · {friendlyName(c.type)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label htmlFor="lms-course-id" className="text-sm">
                                            {courseIdLabel}
                                        </Label>
                                        <Input
                                            id="lms-course-id"
                                            value={courseId}
                                            onChange={(e) => setCourseId(e.target.value)}
                                            placeholder={
                                                isMoodle
                                                    ? t('moodleCourseIdPlaceholder')
                                                    : t('courseIdPlaceholder')
                                            }
                                        />
                                        <p className="text-caption text-neutral-400">
                                            {t('courseIdHelp.prefix')}{' '}
                                            {friendlyName(selectedConnection?.type)}
                                            {t('courseIdHelp.suffix')}
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-sm">{t('additionalFieldsLabel')}</Label>
                                    {extraFields.map((row, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <Input
                                                value={row.key}
                                                onChange={(e) =>
                                                    updateExtra(i, 'key', e.target.value)
                                                }
                                                placeholder={t('fieldKeyPlaceholder')}
                                                className="md:max-w-xs"
                                            />
                                            <Input
                                                value={row.value}
                                                onChange={(e) =>
                                                    updateExtra(i, 'value', e.target.value)
                                                }
                                                placeholder={t('fieldValuePlaceholder')}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeExtra(i)}
                                                aria-label={t('removeFieldAriaLabel')}
                                            >
                                                <Trash className="size-4 text-danger-500" />
                                            </Button>
                                        </div>
                                    ))}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setExtraFields((prev) => [
                                                ...prev,
                                                { key: '', value: '' },
                                            ])
                                        }
                                        className="gap-1 text-primary-600"
                                    >
                                        <Plus className="size-4" /> {t('addFieldButton')}
                                    </Button>
                                    <p className="text-caption text-neutral-400">
                                        {t('additionalFieldsHelp')}
                                    </p>
                                </div>

                                <div className="flex justify-end">
                                    <MyButton
                                        onClick={handleApply}
                                        disabled={applying || !connectionId}
                                        className="gap-2 bg-primary-500"
                                    >
                                        {applying ? (
                                            <CircleNotch className="size-4 animate-spin" />
                                        ) : (
                                            <ArrowSquareIn className="size-4" />
                                        )}
                                        {applying ? t('applyingButton') : t('applyButton')}
                                    </MyButton>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
};
