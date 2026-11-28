import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { X, Lightning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation, Trans } from 'react-i18next';
import { getAllRoles } from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    useLeadSlaConfig,
    saveLeadSlaConfig,
    LEAD_SLA_CONFIG_QUERY_KEY,
    splitMinutes,
    type LeadSlaSettings as SlaConfig,
} from '@/hooks/use-lead-sla-config';
import { getInstituteId } from '@/constants/helper';
import { TriggerWorkflowDialog } from './pools/TriggerWorkflowDialog';

// Multi-select of the institute's roles → saved with the SLA config and passed into the workflow
// trigger (ctx.notifyRoles). The backend never notifies directly.
function NotifyRolesPicker({
    roleNames,
    selected,
    onChange,
}: {
    roleNames: string[];
    selected: string[];
    onChange: (next: string[]) => void;
}) {
    const { t } = useTranslation('settingsLeadSla');
    const available = roleNames.filter((r) => !selected.includes(r));
    return (
        <div>
            <p className="text-sm font-medium">{t('notifyRoles.label')}</p>
            <p className="text-xs text-muted-foreground">{t('notifyRoles.description')}</p>
            {selected.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {selected.map((name) => (
                        <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-600"
                        >
                            {name}
                            <button
                                type="button"
                                aria-label={t('notifyRoles.removeAria', { name })}
                                onClick={() => onChange(selected.filter((r) => r !== name))}
                                className="rounded-full p-0.5 hover:bg-primary-200"
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="mt-2">
                <Select
                    value=""
                    onValueChange={(name) => {
                        if (name && !selected.includes(name)) onChange([...selected, name]);
                    }}
                >
                    <SelectTrigger className="w-64">
                        <SelectValue
                            placeholder={
                                selected.length === 0
                                    ? t('notifyRoles.placeholderEmpty')
                                    : t('notifyRoles.placeholderMore')
                            }
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {roleNames.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                {t('notifyRoles.noRolesFound')}
                            </div>
                        ) : available.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                {t('notifyRoles.allRolesAdded')}
                            </div>
                        ) : (
                            available.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {name}
                                </SelectItem>
                            ))
                        )}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}

// Hours : minutes pair for an SLA duration. Stores one total-minutes value and never lets the
// total drop below 1 minute, so a deadline can't land "immediately".
function DurationInput({
    totalMinutes,
    onChange,
    idPrefix,
}: {
    totalMinutes: number;
    onChange: (next: number) => void;
    idPrefix: string;
}) {
    const { t } = useTranslation('settingsLeadSla');
    const { hours, minutes } = splitMinutes(totalMinutes);
    const emit = (h: number, m: number) => onChange(Math.max(1, h * 60 + m));
    return (
        <div className="flex items-center gap-1">
            <Input
                id={`${idPrefix}-hours`}
                type="number"
                min={0}
                value={hours}
                onChange={(e) => emit(Math.max(0, parseInt(e.target.value, 10) || 0), minutes)}
                className="w-20 text-center"
                aria-label={t('common.hoursLabel')}
            />
            <span className="text-sm text-muted-foreground">{t('common.hoursLabel')}</span>
            <Input
                id={`${idPrefix}-minutes`}
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) =>
                    emit(hours, Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))
                }
                className="ms-2 w-20 text-center"
                aria-label={t('common.minutesLabel')}
            />
            <span className="text-sm text-muted-foreground">{t('common.minutesLabel')}</span>
        </div>
    );
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

// Working hours shared by TAT and the follow-up SLA. A clock that starts inside these hours runs
// for the configured duration; one that starts outside them is due at the card's off-hours time
// on the next working day.
function WorkingHoursCard({
    draft,
    patch,
}: {
    draft: SlaConfig;
    patch: (p: Partial<SlaConfig>) => void;
}) {
    const { t } = useTranslation('settingsLeadSla');
    const days = draft.working_days ?? [];
    const toggleDay = (d: number) =>
        patch({
            working_days: days.includes(d)
                ? days.filter((x) => x !== d)
                : [...days, d].sort((a, b) => a - b),
        });
    const endBeforeStart = draft.working_end_time <= draft.working_start_time;
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('workingHours.title')}</CardTitle>
                <CardDescription>{t('workingHours.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                    <Switch
                        id="working-hours-enabled"
                        checked={draft.working_hours_enabled}
                        onCheckedChange={(v) => patch({ working_hours_enabled: v })}
                    />
                    <Label htmlFor="working-hours-enabled" className="cursor-pointer">
                        {draft.working_hours_enabled ? t('common.onLabel') : t('common.offLabel')}
                    </Label>
                </div>

                {draft.working_hours_enabled && (
                    <>
                        <div>
                            <p className="text-sm font-medium">{t('workingHours.days')}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {WEEKDAYS.map((d) => {
                                    const on = days.includes(d);
                                    return (
                                        <button
                                            key={d}
                                            type="button"
                                            aria-pressed={on}
                                            onClick={() => toggleDay(d)}
                                            className={
                                                on
                                                    ? 'rounded-full border border-primary-400 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-600'
                                                    : 'rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500'
                                            }
                                        >
                                            {t(`workingHours.dayShort.${d}`)}
                                        </button>
                                    );
                                })}
                            </div>
                            {days.length === 0 && (
                                <p className="mt-1 text-xs text-danger-600">{t('workingHours.noDays')}</p>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-medium">{t('workingHours.hoursLabel')}</p>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="time"
                                    value={draft.working_start_time}
                                    onChange={(e) => patch({ working_start_time: e.target.value })}
                                    className="w-32"
                                    aria-label={t('workingHours.from')}
                                />
                                <span className="text-sm text-muted-foreground">{t('workingHours.to')}</span>
                                <Input
                                    type="time"
                                    value={draft.working_end_time}
                                    onChange={(e) => patch({ working_end_time: e.target.value })}
                                    className="w-32"
                                    aria-label={t('workingHours.to')}
                                />
                            </div>
                        </div>
                        {endBeforeStart && (
                            <p className="text-xs text-danger-600">{t('workingHours.endBeforeStart')}</p>
                        )}
                        {draft.timezone && (
                            <p className="text-xs text-muted-foreground">
                                {t('workingHours.timezoneNote', { tz: draft.timezone })}
                            </p>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// "Outside working hours → due at HH:mm on the next working day" row, shown in each SLA card.
function OffhoursDueRow({
    label,
    hint,
    value,
    onChange,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <Input
                type="time"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-32"
                aria-label={label}
            />
        </div>
    );
}

/**
 * Table-backed TAT + Follow-up SLA settings (replaces the JSON tatReminder/followUp cards).
 * Reads/writes via the lead-sla-config endpoint. Emit-only: the workflow engine delivers.
 */
export default function LeadSlaSettings() {
    const { t } = useTranslation('settingsLeadSla');
    const queryClient = useQueryClient();
    const { config, isLoading } = useLeadSlaConfig();

    const [draft, setDraft] = useState<SlaConfig>(config);
    const [hasChanges, setHasChanges] = useState(false);
    const [saving, setSaving] = useState(false);
    const [triggerOpen, setTriggerOpen] = useState(false);
    const instituteId = getInstituteId() ?? '';

    useEffect(() => {
        setDraft(config);
        setHasChanges(false);
    }, [config]);

    const { data: rolesData } = useQuery({
        queryKey: ['institute-roles-for-lead-notify'],
        queryFn: getAllRoles,
        staleTime: 5 * 60 * 1000,
    });
    const roleNames: string[] = Array.isArray(rolesData)
        ? Array.from(new Set(rolesData.map((r: { name?: string }) => r?.name).filter(Boolean) as string[]))
        : [];

    const patch = (p: Partial<SlaConfig>) => {
        setDraft((prev) => ({ ...prev, ...p }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveLeadSlaConfig(draft);
            await queryClient.invalidateQueries({ queryKey: LEAD_SLA_CONFIG_QUERY_KEY });
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
        } catch {
            toast.error(t('toasts.saveError'));
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                    {t('loading')}
                </CardContent>
            </Card>
        );
    }

    const beforeMinutes = draft.tat_before_minutes ?? [];
    const workingHoursInvalid =
        draft.working_hours_enabled &&
        ((draft.working_days ?? []).length === 0 ||
            draft.working_end_time <= draft.working_start_time);

    // "1 hour 30 minutes" / "45 minutes" / "24 hours" for the plain-words summaries.
    const formatDuration = (total: number) => {
        const { hours, minutes } = splitMinutes(total);
        const parts: string[] = [];
        if (hours > 0) parts.push(t('common.hoursUnit', { count: hours }));
        if (minutes > 0 || hours === 0) parts.push(t('common.minutesUnit', { count: minutes }));
        return parts.join(' ');
    };

    return (
        <>
            {/* ── Working hours (TAT + follow-up SLA) ── */}
            <WorkingHoursCard draft={draft} patch={patch} />

            {/* ── New Lead Response Time ── */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('tat.title')}</CardTitle>
                    <CardDescription>
                        <Trans i18nKey="settingsLeadSla:tat.description">Make sure new leads get contacted quickly. If the assigned counsellor doesn&apos;t reach out in time, they&apos;ll be reminded. Choose how they&apos;re notified (email, WhatsApp, in-app) under <span className="font-medium">Settings → Automations</span>.</Trans>
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="tat-enabled"
                            checked={draft.tat_enabled}
                            onCheckedChange={(v) => patch({ tat_enabled: v })}
                        />
                        <Label htmlFor="tat-enabled" className="cursor-pointer">
                            {draft.tat_enabled ? t('common.onLabel') : t('common.offLabel')}
                        </Label>
                    </div>

                    {draft.tat_enabled && (
                        <>
                            <div className="rounded-md bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
                                <span className="font-semibold">{t('common.inPlainWordsLabel')}</span>
                                {beforeMinutes.length > 0 ? (
                                    <>
                                        {t('tat.summary.withRemindersPart1')}
                                        <span className="font-semibold">{formatDuration(draft.tat_minutes)}</span>
                                        {t('tat.summary.withRemindersPart2')}
                                        <span className="font-semibold">{beforeMinutes.map((m) => `${m} ${t('common.minAbbrev')}`).join(' and ')}</span>
                                        {t('tat.summary.withRemindersPart3')}
                                        <span className="font-semibold">{t('tat.summary.overdueLabel')}</span>
                                        {t('tat.summary.withRemindersPart4')}
                                    </>
                                ) : (
                                    <>
                                        {t('tat.summary.noRemindersPart1')}
                                        <span className="font-semibold">{formatDuration(draft.tat_minutes)}</span>
                                        {t('tat.summary.noRemindersPart2')}
                                        <span className="font-semibold">{t('tat.summary.overdueLabel')}</span>
                                        {t('tat.summary.noRemindersPart3')}
                                    </>
                                )}
                                {draft.working_hours_enabled && (
                                    <> {t('tat.summary.offhours', { time: draft.tat_offhours_due_time })}</>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium">{t('tat.responseWithin.label')}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('tat.responseWithin.hint')}
                                    </p>
                                </div>
                                <DurationInput
                                    idPrefix="tat"
                                    totalMinutes={draft.tat_minutes}
                                    onChange={(m) => patch({ tat_minutes: m })}
                                />
                            </div>

                            {draft.working_hours_enabled && (
                                <OffhoursDueRow
                                    label={t('tat.offhours.label')}
                                    hint={t('tat.offhours.hint')}
                                    value={draft.tat_offhours_due_time}
                                    onChange={(v) => patch({ tat_offhours_due_time: v })}
                                />
                            )}

                            <Separator />

                            <div>
                                <p className="text-sm font-medium">{t('tat.earlyReminders.title')}</p>
                                <p className="text-xs text-muted-foreground">
                                    {t('tat.earlyReminders.description')}
                                </p>
                            </div>
                            {beforeMinutes.map((m, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground">{t('common.remind')}</span>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={m}
                                        onChange={(e) => {
                                            const list = [...beforeMinutes];
                                            list[i] = parseInt(e.target.value, 10) || 0;
                                            patch({ tat_before_minutes: list });
                                        }}
                                        className="w-24 text-center"
                                    />
                                    <span className="text-sm text-muted-foreground">
                                        {t('tat.earlyReminders.beforeDeadlineLabel')}
                                    </span>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() =>
                                            patch({
                                                tat_before_minutes: beforeMinutes.filter((_, idx) => idx !== i),
                                            })
                                        }
                                    >
                                        {t('common.remove')}
                                    </MyButton>
                                </div>
                            ))}
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => patch({ tat_before_minutes: [...beforeMinutes, 30] })}
                            >
                                {t('tat.earlyReminders.addButton')}
                            </MyButton>

                            <Separator />

                            <NotifyRolesPicker
                                roleNames={roleNames}
                                selected={draft.tat_notify_roles ?? []}
                                onChange={(roles) => patch({ tat_notify_roles: roles })}
                            />
                        </>
                    )}
                </CardContent>
            </Card>

            {/* ── Follow-up Reminders ── */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('followup.title')}</CardTitle>
                    <CardDescription>{t('followup.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="followup-enabled"
                            checked={draft.followup_enabled}
                            onCheckedChange={(v) => patch({ followup_enabled: v })}
                        />
                        <Label htmlFor="followup-enabled" className="cursor-pointer">
                            {draft.followup_enabled ? t('common.onLabel') : t('common.offLabel')}
                        </Label>
                    </div>

                    {draft.followup_enabled && (
                        <>
                            <div className="rounded-md bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
                                <span className="font-semibold">{t('common.inPlainWordsLabel')}</span>
                                {t('followup.summaryPart1')}
                                <span className="font-semibold">{formatDuration(draft.followup_sla_minutes)}</span>
                                {t('followup.summaryPart2')}
                                <span className="font-semibold">{`${draft.followup_remind_before_minutes} ${t('common.minAbbrev')}`}</span>
                                {t('followup.summaryPart3')}
                                {draft.working_hours_enabled && (
                                    <> {t('followup.summaryOffhours', { time: draft.followup_offhours_due_time })}</>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium">{t('followup.within.label')}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('followup.within.hint')}
                                    </p>
                                </div>
                                <DurationInput
                                    idPrefix="followup"
                                    totalMinutes={draft.followup_sla_minutes}
                                    onChange={(m) => patch({ followup_sla_minutes: m })}
                                />
                            </div>

                            {draft.working_hours_enabled && (
                                <OffhoursDueRow
                                    label={t('followup.offhours.label')}
                                    hint={t('followup.offhours.hint')}
                                    value={draft.followup_offhours_due_time}
                                    onChange={(v) => patch({ followup_offhours_due_time: v })}
                                />
                            )}
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium">{t('followup.earlyReminder.label')}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('followup.earlyReminder.hint')}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Input
                                        type="number"
                                        min={1}
                                        value={draft.followup_remind_before_minutes}
                                        onChange={(e) =>
                                            patch({
                                                followup_remind_before_minutes:
                                                    parseInt(e.target.value, 10) || 30,
                                            })
                                        }
                                        className="w-20 text-center"
                                    />
                                    <span className="text-sm text-muted-foreground">
                                        {t('common.minutesLabel')}
                                    </span>
                                </div>
                            </div>

                            <Separator />

                            <NotifyRolesPicker
                                roleNames={roleNames}
                                selected={draft.followup_notify_roles ?? []}
                                onChange={(roles) => patch({ followup_notify_roles: roles })}
                            />
                        </>
                    )}

                    <div className="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setTriggerOpen(true)}
                        >
                            <Lightning size={16} /> {t('footer.triggerWorkflow')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSave}
                            disable={saving || !hasChanges || workingHoursInvalid}
                        >
                            {saving ? t('footer.saving') : t('footer.save')}
                        </MyButton>
                    </div>
                </CardContent>
            </Card>

            <TriggerWorkflowDialog
                open={triggerOpen}
                onOpenChange={setTriggerOpen}
                instituteId={instituteId}
                scopeLabel={t('footer.scopeLabel')}
            />
        </>
    );
}
