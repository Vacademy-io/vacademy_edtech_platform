/**
 * Settings → Journey status: the institute's list of learner statuses per batch (Learning,
 * Temporary Break, At Risk, ...), how they follow Breaks and holds, and the daily At Risk check.
 * Off by default; while off no journey status appears anywhere. Nothing here sends a message.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Trash, ClockCounterClockwise } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ColorPicker } from '@/components/ui/color-picker';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    JOURNEY_KINDS,
    JOURNEY_STATUS_QUERY_KEY,
    JOURNEY_STATUS_SETTINGS_DEFAULTS,
    JOURNEY_STATUS_SETTINGS_QUERY_KEY,
    fetchJourneyStatusSettingsStrict,
    saveJourneyStatusSettings,
    toJourneyKey,
    type JourneyKind,
    type JourneyStatusDef,
    type JourneyStatusSettings as Settings,
} from '@/services/journey-status';

const NONE = '__none__';

const StatusSelect = ({
    id,
    value,
    statuses,
    onChange,
    allowNone,
    noneLabel,
    disabled,
}: {
    id: string;
    value: string | null;
    statuses: JourneyStatusDef[];
    onChange: (v: string | null) => void;
    allowNone?: boolean;
    noneLabel?: string;
    disabled?: boolean;
}) => (
    <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled}
    >
        <SelectTrigger id={id} className="w-full sm:w-64">
            <SelectValue />
        </SelectTrigger>
        <SelectContent>
            {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
            {statuses.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                    {s.label}
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
);

const NumberField = ({
    id,
    label,
    hint,
    value,
    max,
    onChange,
    disabled,
}: {
    id: string;
    label: string;
    hint: string;
    value: number;
    max: number;
    onChange: (n: number) => void;
    disabled?: boolean;
}) => (
    <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <MyInput
            id={id}
            inputType="text"
            input={String(value)}
            onChangeFunction={(e) => {
                const raw = e.target.value.trim();
                const n = raw === '' ? 0 : Number(raw);
                if (!Number.isInteger(n) || n < 0 || n > max) return;
                onChange(n);
            }}
            disabled={disabled}
            className="w-full sm:w-32"
        />
        <p className="text-caption text-neutral-500">{hint}</p>
    </div>
);

export default function JourneyStatusSettings() {
    const { t } = useTranslation('settingsJourneyStatus');
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<Settings>(JOURNEY_STATUS_SETTINGS_DEFAULTS);
    const [hasChanges, setHasChanges] = useState(false);
    const [newLabel, setNewLabel] = useState('');

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: [JOURNEY_STATUS_SETTINGS_QUERY_KEY, 'page'],
        queryFn: fetchJourneyStatusSettingsStrict,
    });

    useEffect(() => {
        if (data) {
            setSettings(data);
            setHasChanges(false);
        }
    }, [data]);

    const update = (patch: Partial<Settings>) => {
        setSettings((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };
    const updateRisk = (patch: Partial<Settings['auto_risk']>) =>
        update({ auto_risk: { ...settings.auto_risk, ...patch } });
    const updateStatus = (index: number, patch: Partial<JourneyStatusDef>) =>
        update({
            statuses: settings.statuses.map((s, i) => (i === index ? { ...s, ...patch } : s)),
        });
    const move = (index: number, by: number) => {
        const next = [...settings.statuses];
        const target = index + by;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target]!, next[index]!];
        update({ statuses: next });
    };
    /** A status the rules point at cannot be removed (keys stay stable once used). */
    const inUse = (key: string) =>
        key === settings.default_status ||
        key === settings.status_on_pause ||
        key === settings.status_on_resume ||
        key === settings.auto_risk.status;

    const newKey = toJourneyKey(newLabel);
    const addError =
        newLabel.trim() === ''
            ? null
            : !newKey || settings.statuses.some((s) => s.key === newKey)
              ? t('statuses.duplicate')
              : null;

    const labelsValid = settings.statuses.every((s) => s.label.trim().length > 0);

    const { mutateAsync: save } = useMutation({
        mutationFn: saveJourneyStatusSettings,
        onSuccess: () => {
            toast.success(t('saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: [JOURNEY_STATUS_SETTINGS_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [JOURNEY_STATUS_QUERY_KEY] });
        },
        onError: () => toast.error(t('saveFailed')),
    });

    const off = !settings.enabled;
    const riskStatuses = settings.statuses.filter((s) => s.kind === 'RISK');
    const activeStatuses = settings.statuses.filter((s) => s.kind === 'ACTIVE');
    const breakStatuses = settings.statuses.filter((s) => s.kind === 'BREAK');

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('title')}</CardTitle>
                    <CardDescription>{t('description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
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
                        <>
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="journey-status-enabled"
                                    checked={settings.enabled}
                                    onCheckedChange={(v) => update({ enabled: v })}
                                />
                                <Label htmlFor="journey-status-enabled" className="cursor-pointer">
                                    {t('toggleLabel')}
                                </Label>
                            </div>

                            {/* Statuses */}
                            <section className="space-y-3" aria-labelledby="journey-statuses-title">
                                <div>
                                    <h3
                                        id="journey-statuses-title"
                                        className="text-subtitle font-semibold text-neutral-800"
                                    >
                                        {t('statuses.title')}
                                    </h3>
                                    <p className="text-caption text-neutral-500">
                                        {t('statuses.hint')}
                                    </p>
                                </div>
                                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                                    {settings.statuses.map((s, i) => (
                                        <li
                                            key={s.key}
                                            className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
                                        >
                                            <div className="flex items-center gap-2">
                                                <ColorPicker
                                                    value={s.color}
                                                    onChange={(c) => updateStatus(i, { color: c })}
                                                    disabled={off}
                                                    aria-label={t('statuses.color', {
                                                        label: s.label,
                                                    })}
                                                    className="size-8 shrink-0"
                                                />
                                                <MyInput
                                                    inputType="text"
                                                    input={s.label}
                                                    onChangeFunction={(e) =>
                                                        updateStatus(i, {
                                                            label: e.target.value.slice(0, 60),
                                                        })
                                                    }
                                                    disabled={off}
                                                    className="w-full sm:w-56"
                                                    aria-label={t('statuses.label')}
                                                />
                                            </div>
                                            <Select
                                                value={s.kind}
                                                onValueChange={(v) =>
                                                    updateStatus(i, { kind: v as JourneyKind })
                                                }
                                                disabled={off}
                                            >
                                                <SelectTrigger
                                                    className="w-full sm:w-48"
                                                    aria-label={t('statuses.kind')}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {JOURNEY_KINDS.map((k) => (
                                                        <SelectItem key={k} value={k}>
                                                            {t(`kinds.${k}`)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <span className="text-caption text-neutral-400">
                                                {s.key}
                                            </span>
                                            <div className="flex gap-1 sm:ms-auto">
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    layoutVariant="icon"
                                                    disable={off || i === 0}
                                                    onClick={() => move(i, -1)}
                                                    aria-label={t('statuses.up')}
                                                >
                                                    <ArrowUp className="size-4" />
                                                </MyButton>
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    layoutVariant="icon"
                                                    disable={off || i === settings.statuses.length - 1}
                                                    onClick={() => move(i, 1)}
                                                    aria-label={t('statuses.down')}
                                                >
                                                    <ArrowDown className="size-4" />
                                                </MyButton>
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    layoutVariant="icon"
                                                    disable={off || inUse(s.key)}
                                                    onClick={() =>
                                                        update({
                                                            statuses: settings.statuses.filter(
                                                                (_, j) => j !== i
                                                            ),
                                                        })
                                                    }
                                                    aria-label={t('statuses.remove')}
                                                >
                                                    <Trash className="size-4" />
                                                </MyButton>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                                    <div className="space-y-1">
                                        <MyInput
                                            inputType="text"
                                            input={newLabel}
                                            onChangeFunction={(e) =>
                                                setNewLabel(e.target.value.slice(0, 60))
                                            }
                                            inputPlaceholder={t('statuses.newPlaceholder')}
                                            disabled={off}
                                            className="w-full sm:w-56"
                                        />
                                        {addError && (
                                            <p className="text-caption text-danger-600">{addError}</p>
                                        )}
                                    </div>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="medium"
                                        disable={off || !newLabel.trim() || Boolean(addError)}
                                        onClick={() => {
                                            update({
                                                statuses: [
                                                    ...settings.statuses,
                                                    {
                                                        key: newKey,
                                                        label: newLabel.trim(),
                                                        color: settings.statuses[0]?.color ?? '',
                                                        kind: 'ACTIVE',
                                                    },
                                                ],
                                            });
                                            setNewLabel('');
                                        }}
                                    >
                                        <Plus className="me-1 size-4" />
                                        {t('statuses.add')}
                                    </MyButton>
                                </div>
                                <p className="text-caption text-neutral-500">
                                    {t('statuses.kindsHint')}
                                </p>
                            </section>

                            {/* Rules */}
                            <section className="space-y-4" aria-labelledby="journey-rules-title">
                                <h3
                                    id="journey-rules-title"
                                    className="text-subtitle font-semibold text-neutral-800"
                                >
                                    {t('rules.title')}
                                </h3>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="journey-default">{t('rules.default')}</Label>
                                        <StatusSelect
                                            id="journey-default"
                                            value={settings.default_status}
                                            statuses={activeStatuses.length ? activeStatuses : settings.statuses}
                                            onChange={(v) => v && update({ default_status: v })}
                                            disabled={off}
                                        />
                                        <p className="text-caption text-neutral-500">
                                            {t('rules.defaultHint')}
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="journey-pause">{t('rules.onPause')}</Label>
                                        <StatusSelect
                                            id="journey-pause"
                                            value={settings.status_on_pause}
                                            statuses={breakStatuses}
                                            allowNone
                                            noneLabel={t('rules.noChange')}
                                            onChange={(v) => update({ status_on_pause: v })}
                                            disabled={off}
                                        />
                                        <p className="text-caption text-neutral-500">
                                            {t('rules.onPauseHint')}
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="journey-resume">{t('rules.onResume')}</Label>
                                        <StatusSelect
                                            id="journey-resume"
                                            value={settings.status_on_resume}
                                            statuses={settings.statuses}
                                            allowNone
                                            noneLabel={t('rules.noChange')}
                                            onChange={(v) => update({ status_on_resume: v })}
                                            disabled={off}
                                        />
                                        <p className="text-caption text-neutral-500">
                                            {t('rules.onResumeHint')}
                                        </p>
                                    </div>
                                </div>
                            </section>

                            {/* Re-entry */}
                            <section className="space-y-3" aria-labelledby="journey-reentry-title">
                                <div>
                                    <h3
                                        id="journey-reentry-title"
                                        className="text-subtitle font-semibold text-neutral-800"
                                    >
                                        {t('reentry.title')}
                                    </h3>
                                    <p className="text-caption text-neutral-500">{t('reentry.hint')}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="journey-reentry-return"
                                        checked={settings.reentry_auto_return}
                                        onCheckedChange={(v) => update({ reentry_auto_return: v })}
                                        disabled={off}
                                    />
                                    <Label htmlFor="journey-reentry-return" className="cursor-pointer">
                                        {t('reentry.autoReturn', {
                                            status:
                                                settings.statuses.find(
                                                    (s) => s.key === settings.default_status
                                                )?.label ?? settings.default_status,
                                        })}
                                    </Label>
                                </div>
                                {!settings.statuses.some((s) => s.kind === 'REENTRY') && (
                                    <p className="text-caption text-warning-700">
                                        {t('reentry.noStatus')}
                                    </p>
                                )}
                            </section>

                            {/* At Risk check */}
                            <section className="space-y-4" aria-labelledby="journey-risk-title">
                                <div>
                                    <h3
                                        id="journey-risk-title"
                                        className="text-subtitle font-semibold text-neutral-800"
                                    >
                                        {t('risk.title')}
                                    </h3>
                                    <p className="text-caption text-neutral-500">{t('risk.hint')}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="journey-risk-enabled"
                                        checked={settings.auto_risk.enabled}
                                        onCheckedChange={(v) => updateRisk({ enabled: v })}
                                        disabled={off}
                                    />
                                    <Label htmlFor="journey-risk-enabled" className="cursor-pointer">
                                        {t('risk.toggle')}
                                    </Label>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label htmlFor="journey-risk-status">{t('risk.status')}</Label>
                                        <StatusSelect
                                            id="journey-risk-status"
                                            value={settings.auto_risk.status}
                                            statuses={riskStatuses.length ? riskStatuses : settings.statuses}
                                            onChange={(v) => updateRisk({ status: v })}
                                            disabled={off || !settings.auto_risk.enabled}
                                        />
                                    </div>
                                    <NumberField
                                        id="journey-risk-classes"
                                        label={t('risk.classes')}
                                        hint={t('risk.classesHint')}
                                        value={settings.auto_risk.missed_classes}
                                        max={20}
                                        onChange={(n) => updateRisk({ missed_classes: n })}
                                        disabled={off || !settings.auto_risk.enabled}
                                    />
                                    <NumberField
                                        id="journey-risk-fee"
                                        label={t('risk.fee')}
                                        hint={t('risk.feeHint')}
                                        value={settings.auto_risk.fee_overdue_days}
                                        max={365}
                                        onChange={(n) => updateRisk({ fee_overdue_days: n })}
                                        disabled={off || !settings.auto_risk.enabled}
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="journey-risk-return"
                                        checked={settings.auto_risk.auto_return}
                                        onCheckedChange={(v) => updateRisk({ auto_return: v })}
                                        disabled={off || !settings.auto_risk.enabled}
                                    />
                                    <Label htmlFor="journey-risk-return" className="cursor-pointer">
                                        {t('risk.autoReturn')}
                                    </Label>
                                </div>
                                <p className="text-caption text-neutral-500">{t('risk.noMessages')}</p>
                            </section>
                        </>
                    )}

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
                            disable={!hasChanges || isLoading || !labelsValid}
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
