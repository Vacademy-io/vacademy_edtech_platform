import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    UsersThree,
    CalendarPlus,
    CalendarX,
    EnvelopeSimple,
    BellRinging,
    DeviceMobile,
    WhatsappLogo,
    Alarm,
    HandWaving,
    UserPlus,
} from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';

import {
    DEFAULT_MENTORSHIP_SETTINGS,
    MENTORSHIP_PLACEHOLDERS,
    getMentorshipSettings,
    saveMentorshipSettings,
    type MentorshipSettings as MentorshipSettingsType,
    type MentorshipTriggerSettings,
    type MentorshipEmailTemplate,
    type MentorshipTextTemplate,
    type MentorshipWhatsappTemplate,
} from '@/services/mentorship-settings';
import { whatsappTemplateService } from '@/services/whatsapp-template-service';
import type { MetaWhatsAppTemplate } from '@/types/message-template-types';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';

/** Mentorship fields an admin can map a WhatsApp template variable to. '' = auto-match by name. */
const getWaFieldOptions = (t: TFunction): { value: string; label: string }[] => [
    { value: '', label: t('waFieldOptions.auto') },
    { value: 'name', label: t('waFieldOptions.recipientName') },
    { value: 'mentor_name', label: t('waFieldOptions.mentorName') },
    { value: 'student_name', label: t('waFieldOptions.studentName') },
    { value: 'session_title', label: t('waFieldOptions.sessionTitle') },
    { value: 'session_datetime', label: t('waFieldOptions.sessionDatetime') },
    { value: 'decision_note', label: t('waFieldOptions.declineReason') },
];

/** Extract {{tokens}} from an approved template's BODY text. */
const templateBodyTokens = (template: MetaWhatsAppTemplate | undefined): string[] => {
    if (!template) return [];
    const body = template.components?.find((c) => c.type === 'BODY')?.text ?? '';
    const tokens = Array.from(body.matchAll(/\{\{([^}]+)\}\}/g)).map((m) => m[1]!.trim());
    return Array.from(new Set(tokens));
};

const PlaceholderHint = () => {
    const { t } = useTranslation('settingsMentorship');
    return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-neutral-400">{t('placeholderHint.label')}</span>
        {MENTORSHIP_PLACEHOLDERS.map((p) => (
            <code
                key={p.token}
                title={p.label}
                className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600"
            >
                {p.token}
            </code>
        ))}
    </div>
    );
};

/**
 * Email or in-app/push channel: just the toggle. The message itself uses the
 * system default and stays hidden — an explicit "Customize" reveals the
 * editors, and admins who already customized see them expanded with a
 * one-click reset back to the default.
 */
const InlineTemplateBlock = ({
    icon,
    label,
    description,
    enabled,
    onToggle,
    primaryLabel,
    primaryValue,
    onPrimaryChange,
    bodyValue,
    onBodyChange,
    defaultPrimary,
    defaultBody,
    idPrefix,
}: {
    icon: React.ReactNode;
    label: string;
    description?: string;
    enabled: boolean;
    onToggle: (v: boolean) => void;
    primaryLabel: string;
    primaryValue: string;
    onPrimaryChange: (v: string) => void;
    bodyValue: string;
    onBodyChange: (v: string) => void;
    defaultPrimary: string;
    defaultBody: string;
    idPrefix: string;
}) => {
    const { t } = useTranslation('settingsMentorship');
    const [customizing, setCustomizing] = useState(false);
    const isDefault = primaryValue === defaultPrimary && bodyValue === defaultBody;
    const showEditors = enabled && (customizing || !isDefault);

    return (
        <div className="py-3">
            <div className="flex items-center justify-between gap-4">
                <div className="flex flex-1 items-center gap-3">
                    <div className="text-neutral-500">{icon}</div>
                    <div className="flex-1">
                        <div className="text-sm font-medium text-neutral-800">{label}</div>
                        {description && (
                            <div className="mt-0.5 text-xs text-neutral-500">{description}</div>
                        )}
                    </div>
                </div>
                <Switch checked={enabled} onCheckedChange={onToggle} />
            </div>
            {enabled && !showEditors && (
                <div className="ml-9 mt-2 flex items-center gap-2">
                    <span className="text-xs text-neutral-400">
                        {t('channel.usesDefault')}
                    </span>
                    <button
                        type="button"
                        onClick={() => setCustomizing(true)}
                        className="text-xs font-medium text-primary-500 hover:text-primary-600"
                    >
                        {t('channel.customize')}
                    </button>
                </div>
            )}
            {showEditors && (
                <div className="ml-9 mt-3 space-y-2">
                    <div>
                        <Label htmlFor={`${idPrefix}-primary`} className="text-xs text-neutral-600">
                            {primaryLabel}
                        </Label>
                        <Input
                            id={`${idPrefix}-primary`}
                            value={primaryValue}
                            onChange={(e) => onPrimaryChange(e.target.value)}
                            className="mt-1"
                        />
                    </div>
                    <div>
                        <Label htmlFor={`${idPrefix}-body`} className="text-xs text-neutral-600">
                            {t('channel.messageLabel')}
                        </Label>
                        <Textarea
                            id={`${idPrefix}-body`}
                            value={bodyValue}
                            onChange={(e) => onBodyChange(e.target.value)}
                            rows={3}
                            className="mt-1"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            onPrimaryChange(defaultPrimary);
                            onBodyChange(defaultBody);
                            setCustomizing(false);
                        }}
                        className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
                    >
                        {t('channel.resetToDefault')}
                    </button>
                </div>
            )}
        </div>
    );
};

/** WhatsApp channel: toggle + approved-template picker + optional variable mapping. */
const WhatsappBlock = ({
    value,
    onChange,
    templates,
    loading,
}: {
    value: MentorshipWhatsappTemplate;
    onChange: (patch: Partial<MentorshipWhatsappTemplate>) => void;
    templates: MetaWhatsAppTemplate[];
    loading: boolean;
}) => {
    const { t } = useTranslation('settingsMentorship');
    const waFieldOptions = useMemo(() => getWaFieldOptions(t), [t]);
    const selected = useMemo(
        () => templates.find((tpl) => tpl.name === value.template_name),
        [templates, value.template_name]
    );
    const tokens = useMemo(() => templateBodyTokens(selected), [selected]);

    const setMapping = (token: string, field: string) => {
        const next = { ...value.variable_mapping };
        if (field) next[token] = field;
        else delete next[token];
        onChange({ variable_mapping: next });
    };

    return (
        <div className="py-3">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-1 items-start gap-3">
                    <div className="mt-0.5 text-neutral-500">
                        <WhatsappLogo size={18} />
                    </div>
                    <div className="flex-1">
                        <div className="text-sm font-medium text-neutral-800">{t('whatsapp.label')}</div>
                        <div className="mt-0.5 text-xs text-neutral-500">
                            {t('whatsapp.requiresTemplate')}
                        </div>
                    </div>
                </div>
                <Switch checked={value.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
            </div>
            {value.enabled && (
                <div className="ml-9 mt-3 space-y-3">
                    <div>
                        <Label className="text-xs text-neutral-600">{t('whatsapp.approvedTemplateLabel')}</Label>
                        <TemplateSearchableSelect
                            className="mt-1"
                            options={toTemplateOptions(templates)}
                            value={value.template_name || undefined}
                            onChange={(name) => {
                                const tpl = templates.find((x) => x.name === name);
                                onChange({
                                    template_name: name,
                                    language_code: tpl?.language || value.language_code || 'en',
                                    variable_mapping: {},
                                });
                            }}
                            loading={loading}
                            placeholder={t('whatsapp.selectTemplatePlaceholder')}
                            emptyText={
                                templates.length === 0
                                    ? t('whatsapp.noTemplatesFound')
                                    : t('whatsapp.noTemplateMatchesSearch')
                            }
                        />
                    </div>

                    {selected && tokens.length > 0 && (
                        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                            <div className="text-xs font-medium text-neutral-600">
                                {t('whatsapp.mapVariables')}
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-400">
                                {t('whatsapp.mapVariablesHint')}
                            </div>
                            <div className="mt-2 space-y-2">
                                {tokens.map((token) => (
                                    <div key={token} className="flex items-center gap-2">
                                        <code className="w-40 shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                                            {`{{${token}}}`}
                                        </code>
                                        <Select
                                            value={value.variable_mapping[token] ?? ''}
                                            onValueChange={(field) => setMapping(token, field)}
                                        >
                                            <SelectTrigger className="flex-1">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {waFieldOptions.map((o) => (
                                                    <SelectItem key={o.value || 'auto'} value={o.value}>
                                                        {o.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/** One trigger card: the four channel blocks + a shared placeholder hint. */
const TriggerCard = ({
    icon,
    title,
    description,
    idPrefix,
    trigger,
    defaults,
    onChannelChange,
    waTemplates,
    waLoading,
    children,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
    idPrefix: string;
    trigger: MentorshipTriggerSettings;
    /** System-default texts for this trigger — messages matching them stay collapsed. */
    defaults: MentorshipTriggerSettings;
    onChannelChange: (
        channel: keyof MentorshipTriggerSettings,
        patch: Record<string, unknown>
    ) => void;
    waTemplates: MetaWhatsAppTemplate[];
    waLoading: boolean;
    children?: React.ReactNode;
}) => {
    const { t } = useTranslation('settingsMentorship');
    return (
    <Card>
        <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-2">
            <div className="mt-0.5 rounded-md bg-primary-50 p-2 text-primary-500">{icon}</div>
            <div>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </div>
        </CardHeader>
        <CardContent className="px-5 pb-4 pt-0">
            {children}
            <InlineTemplateBlock
                icon={<EnvelopeSimple size={18} />}
                label={t('channel.email.label')}
                enabled={trigger.email.enabled}
                onToggle={(v) => onChannelChange('email', { enabled: v })}
                primaryLabel={t('channel.email.subjectLabel')}
                primaryValue={trigger.email.subject}
                onPrimaryChange={(v) => onChannelChange('email', { subject: v })}
                bodyValue={trigger.email.body}
                onBodyChange={(v) => onChannelChange('email', { body: v })}
                defaultPrimary={defaults.email.subject}
                defaultBody={defaults.email.body}
                idPrefix={`${idPrefix}-email`}
            />
            <Separator />
            <InlineTemplateBlock
                icon={<BellRinging size={18} />}
                label={t('channel.inAppAlert.label')}
                enabled={trigger.system_alert.enabled}
                onToggle={(v) => onChannelChange('system_alert', { enabled: v })}
                primaryLabel={t('channel.inAppAlert.titleLabel')}
                primaryValue={trigger.system_alert.title}
                onPrimaryChange={(v) => onChannelChange('system_alert', { title: v })}
                bodyValue={trigger.system_alert.body}
                onBodyChange={(v) => onChannelChange('system_alert', { body: v })}
                defaultPrimary={defaults.system_alert.title}
                defaultBody={defaults.system_alert.body}
                idPrefix={`${idPrefix}-alert`}
            />
            <Separator />
            <InlineTemplateBlock
                icon={<DeviceMobile size={18} />}
                label={t('channel.push.label')}
                enabled={trigger.push.enabled}
                onToggle={(v) => onChannelChange('push', { enabled: v })}
                primaryLabel={t('channel.push.titleLabel')}
                primaryValue={trigger.push.title}
                onPrimaryChange={(v) => onChannelChange('push', { title: v })}
                bodyValue={trigger.push.body}
                onBodyChange={(v) => onChannelChange('push', { body: v })}
                defaultPrimary={defaults.push.title}
                defaultBody={defaults.push.body}
                idPrefix={`${idPrefix}-push`}
            />
            <Separator />
            <WhatsappBlock
                value={trigger.whatsapp}
                onChange={(patch) => onChannelChange('whatsapp', patch)}
                templates={waTemplates}
                loading={waLoading}
            />
            <PlaceholderHint />
        </CardContent>
    </Card>
    );
};

interface MentorshipSettingsProps {
    /** Rendered inside the quick-access popup rather than the full /settings page. */
    embedded?: boolean;
}

export default function MentorshipSettings({ embedded = false }: MentorshipSettingsProps = {}) {
    const { t } = useTranslation('settingsMentorship');
    const [settings, setSettings] = useState<MentorshipSettingsType>(DEFAULT_MENTORSHIP_SETTINGS);
    const [initial, setInitial] = useState<MentorshipSettingsType>(DEFAULT_MENTORSHIP_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [waTemplates, setWaTemplates] = useState<MetaWhatsAppTemplate[]>([]);
    const [waLoading, setWaLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                const fresh = await getMentorshipSettings();
                if (!cancelled) {
                    setSettings(fresh);
                    setInitial(fresh);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        (async () => {
            try {
                const list = await whatsappTemplateService.getMetaTemplates();
                if (!cancelled) setWaTemplates(list.filter((tpl) => tpl.status === 'APPROVED'));
            } catch {
                if (!cancelled) setWaTemplates([]);
            } finally {
                if (!cancelled) setWaLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const dirty = JSON.stringify(settings) !== JSON.stringify(initial);

    const updateChannel = (
        triggerKey: keyof MentorshipSettingsType,
        channel: keyof MentorshipTriggerSettings,
        patch: Record<string, unknown>
    ) =>
        setSettings(
            (prev) =>
                ({
                    ...prev,
                    [triggerKey]: {
                        ...prev[triggerKey],
                        [channel]: {
                            ...(prev[triggerKey] as MentorshipTriggerSettings)[channel],
                            ...patch,
                        },
                    },
                }) as MentorshipSettingsType
        );

    const setAssignmentFlag = (key: 'notify_student' | 'notify_mentor', v: boolean) =>
        setSettings((prev) => ({ ...prev, assignment: { ...prev.assignment, [key]: v } }));

    const setRequestFlag = (key: 'notify_student' | 'notify_mentor', v: boolean) =>
        setSettings((prev) => ({ ...prev, request: { ...prev.request, [key]: v } }));

    const setReminderField = (key: 'enabled' | 'hours_before', v: boolean | number) =>
        setSettings((prev) => ({
            ...prev,
            session_reminder: { ...prev.session_reminder, [key]: v },
        }));

    const setCheckinField = (key: 'enabled' | 'inactivity_days', v: boolean | number) =>
        setSettings((prev) => ({
            ...prev,
            checkin_reminder: { ...prev.checkin_reminder, [key]: v },
        }));

    const reset = () => setSettings(initial);

    const save = async () => {
        try {
            setSaving(true);
            await saveMentorshipSettings(settings);
            setInitial(settings);
            toast.success(t('toasts.saveSuccess'));
        } catch (err) {
            console.error(err);
            toast.error(t('toasts.saveError'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div
                className={cn(
                    'flex flex-wrap items-center gap-3',
                    embedded ? 'justify-end' : 'justify-between'
                )}
            >
                {!embedded && (
                    <div>
                        <h2 className="text-xl font-semibold text-neutral-800">
                            {t('header.title')}
                        </h2>
                        <p className="text-sm text-neutral-500">
                            {t('header.subtitle')}
                        </p>
                    </div>
                )}
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={reset} disabled={!dirty || saving}>
                        {t('actions.reset')}
                    </Button>
                    <Button
                        size="sm"
                        onClick={save}
                        disabled={!dirty || saving}
                        className="bg-primary-500 hover:bg-primary-600"
                    >
                        {saving ? t('actions.saving') : t('actions.save')}
                    </Button>
                </div>
            </div>

            <TriggerCard
                icon={<UsersThree size={20} />}
                title={t('assignment.title')}
                description={t('assignment.description')}
                idPrefix="assignment"
                defaults={DEFAULT_MENTORSHIP_SETTINGS.assignment}
                trigger={settings.assignment}
                onChannelChange={(channel, patch) => updateChannel('assignment', channel, patch)}
                waTemplates={waTemplates}
                waLoading={waLoading}
            >
                <div className="pb-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {t('whoToNotify')}
                    </div>
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-neutral-700">{t('assignment.notifyStudent')}</span>
                        <Switch
                            checked={settings.assignment.notify_student}
                            onCheckedChange={(v) => setAssignmentFlag('notify_student', v)}
                        />
                    </div>
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-neutral-700">{t('assignment.notifyMentor')}</span>
                        <Switch
                            checked={settings.assignment.notify_mentor}
                            onCheckedChange={(v) => setAssignmentFlag('notify_mentor', v)}
                        />
                    </div>
                    <Separator />
                    <div className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {t('learnerMessageAndChannels')}
                    </div>
                </div>
            </TriggerCard>

            <TriggerCard
                icon={<UserPlus size={20} />}
                title={t('request.title')}
                description={t('request.description')}
                idPrefix="request"
                defaults={DEFAULT_MENTORSHIP_SETTINGS.request}
                trigger={settings.request}
                onChannelChange={(channel, patch) => updateChannel('request', channel, patch)}
                waTemplates={waTemplates}
                waLoading={waLoading}
            >
                <div className="pb-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {t('whoToNotify')}
                    </div>
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-neutral-700">
                            {t('request.notifyMentorRequested')}
                        </span>
                        <Switch
                            checked={settings.request.notify_mentor}
                            onCheckedChange={(v) => setRequestFlag('notify_mentor', v)}
                        />
                    </div>
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-neutral-700">
                            {t('request.notifyStudentDeclined')}
                        </span>
                        <Switch
                            checked={settings.request.notify_student}
                            onCheckedChange={(v) => setRequestFlag('notify_student', v)}
                        />
                    </div>
                    <p className="pb-1 text-xs text-neutral-400">
                        {t('request.approvalNote')}
                    </p>
                    <Separator />
                    <div className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {t('request.declineMessageAndChannels')}
                    </div>
                </div>
            </TriggerCard>

            <TriggerCard
                icon={<CalendarPlus size={20} />}
                title={t('booking.title')}
                description={t('booking.description')}
                idPrefix="booking"
                defaults={DEFAULT_MENTORSHIP_SETTINGS.booking}
                trigger={settings.booking}
                onChannelChange={(channel, patch) => updateChannel('booking', channel, patch)}
                waTemplates={waTemplates}
                waLoading={waLoading}
            />

            <TriggerCard
                icon={<CalendarX size={20} />}
                title={t('cancellation.title')}
                description={t('cancellation.description')}
                idPrefix="cancellation"
                defaults={DEFAULT_MENTORSHIP_SETTINGS.cancellation}
                trigger={settings.cancellation}
                onChannelChange={(channel, patch) => updateChannel('cancellation', channel, patch)}
                waTemplates={waTemplates}
                waLoading={waLoading}
            />

            <TriggerCard
                icon={<Alarm size={20} />}
                title={t('sessionReminder.title')}
                description={t('sessionReminder.description')}
                idPrefix="session-reminder"
                defaults={DEFAULT_MENTORSHIP_SETTINGS.session_reminder}
                trigger={settings.session_reminder}
                onChannelChange={(channel, patch) =>
                    updateChannel('session_reminder', channel, patch)
                }
                waTemplates={waTemplates}
                waLoading={waLoading}
            >
                <div className="pb-1">
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-neutral-700">{t('sessionReminder.sendReminders')}</span>
                        <Switch
                            checked={settings.session_reminder.enabled}
                            onCheckedChange={(v) => setReminderField('enabled', v)}
                        />
                    </div>
                    {settings.session_reminder.enabled && (
                        <div className="flex items-center justify-between gap-4 py-2">
                            <Label
                                htmlFor="session-reminder-hours"
                                className="text-sm font-normal text-neutral-700"
                            >
                                {t('sessionReminder.hoursBeforeSession')}
                            </Label>
                            <Input
                                id="session-reminder-hours"
                                type="number"
                                min={1}
                                max={168}
                                value={settings.session_reminder.hours_before}
                                onChange={(e) =>
                                    // Clamp to the backend's accepted range so the UI never
                                    // shows a value the scheduler won't actually use.
                                    setReminderField(
                                        'hours_before',
                                        Math.min(168, Math.max(1, Math.round(Number(e.target.value) || 1)))
                                    )
                                }
                                className="w-24"
                            />
                        </div>
                    )}
                    <Separator />
                    <div className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {t('learnerMessageAndChannels')}
                    </div>
                </div>
            </TriggerCard>

            <TriggerCard
                icon={<HandWaving size={20} />}
                title={t('checkinReminder.title')}
                description={t('checkinReminder.description')}
                idPrefix="checkin-reminder"
                defaults={DEFAULT_MENTORSHIP_SETTINGS.checkin_reminder}
                trigger={settings.checkin_reminder}
                onChannelChange={(channel, patch) =>
                    updateChannel('checkin_reminder', channel, patch)
                }
                waTemplates={waTemplates}
                waLoading={waLoading}
            >
                <div className="pb-1">
                    <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-neutral-700">{t('checkinReminder.sendNudges')}</span>
                        <Switch
                            checked={settings.checkin_reminder.enabled}
                            onCheckedChange={(v) => setCheckinField('enabled', v)}
                        />
                    </div>
                    {settings.checkin_reminder.enabled && (
                        <div className="flex items-center justify-between gap-4 py-2">
                            <Label
                                htmlFor="checkin-days"
                                className="text-sm font-normal text-neutral-700"
                            >
                                {t('checkinReminder.daysWithoutSession')}
                            </Label>
                            <Input
                                id="checkin-days"
                                type="number"
                                min={1}
                                max={365}
                                value={settings.checkin_reminder.inactivity_days}
                                onChange={(e) =>
                                    // Clamp to the backend's accepted range (see intCfg 1..365).
                                    setCheckinField(
                                        'inactivity_days',
                                        Math.min(365, Math.max(1, Math.round(Number(e.target.value) || 1)))
                                    )
                                }
                                className="w-24"
                            />
                        </div>
                    )}
                    <Separator />
                    <div className="mt-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                        {t('learnerMessageAndChannels')}
                    </div>
                </div>
            </TriggerCard>
        </div>
    );
}
