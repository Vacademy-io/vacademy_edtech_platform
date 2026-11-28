import { CalendarBlank, Clock, EnvelopeSimple, Globe, SealCheck } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import { buildTimezoneOptions } from '@/routes/study-library/live-session/schedule/-constants/options';
import {
    EmptyState,
    FieldHint,
    LoadFailure,
    SectionCard,
} from '../../create/-components/primitives';
import { buildCronPresets } from '../../create/-utils/constants';
import { senderKey } from '../-utils/validation';
import { Field, StepBadge } from './primitives';
import type { EmailPriority, FieldErrors, ScheduleType } from '../-types';
import { EMAIL_PRIORITIES } from '../-types';

interface SenderSettingsSectionProps {
    senders: EmailConfiguration[];
    sendersLoading: boolean;
    sendersError: string | null;
    onReloadSenders: () => void;
    fromKey: string;
    onFromKeyChange: (value: string) => void;
    priority: EmailPriority;
    onPriorityChange: (value: EmailPriority) => void;
    expiresAt: string;
    onExpiresAtChange: (value: string) => void;
    scheduleType: ScheduleType;
    onScheduleTypeChange: (value: ScheduleType) => void;
    timezone: string;
    onTimezoneChange: (value: string) => void;
    oneTimeStart: string;
    onOneTimeStartChange: (value: string) => void;
    cronExpression: string;
    onCronExpressionChange: (value: string) => void;
    errors: FieldErrors;
    showErrors: boolean;
    disabled?: boolean;
}

const toLocalInput = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type QuickPick = 'IN_1H' | 'TODAY_5PM' | 'TOMORROW_9AM' | 'NEXT_MON_9AM';

export function SenderSettingsSection(props: SenderSettingsSectionProps) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const { t: tConstants } = useTranslation('announcementCreateConstants');
    const { t: tOptions } = useTranslation('studyLibraryOptions');
    const navigate = useNavigate();
    const { errors, showErrors, disabled } = props;
    const err = (key: string) => (showErrors ? errors[key] : undefined);

    const knownTimezones = buildTimezoneOptions(tOptions);
    // A browser/edit timezone outside the curated list would otherwise render as a blank select
    // while still being sent — show it so the admin can see (and change) what will be used.
    const timezoneOptions =
        props.timezone && !knownTimezones.some((tz) => tz.value === props.timezone)
            ? [{ value: props.timezone, label: props.timezone }, ...knownTimezones]
            : knownTimezones;
    const cronPresets = buildCronPresets(tConstants);
    const selectedSender = props.senders.find((s) => senderKey(s) === props.fromKey);

    const invalid = Boolean(
        err('fromKey') ||
            err('priority') ||
            err('expiresAt') ||
            err('schedule.startDate') ||
            err('schedule.cronExpression')
    );
    const done = !invalid && Boolean(selectedSender);

    const quickSchedule = (pick: QuickPick) => {
        const now = new Date();
        const target = new Date(now);
        if (pick === 'IN_1H') {
            target.setHours(target.getHours() + 1, 0, 0, 0);
        } else if (pick === 'TODAY_5PM') {
            target.setHours(17, 0, 0, 0);
            if (target <= now) target.setDate(target.getDate() + 1);
        } else if (pick === 'TOMORROW_9AM') {
            target.setDate(target.getDate() + 1);
            target.setHours(9, 0, 0, 0);
        } else {
            const daysUntilMonday = (8 - target.getDay()) % 7 || 7;
            target.setDate(target.getDate() + daysUntilMonday);
            target.setHours(9, 0, 0, 0);
        }
        props.onScheduleTypeChange('ONE_TIME');
        props.onOneTimeStartChange(toLocalInput(target));
    };

    const scheduleOptions: Array<{ value: ScheduleType; label: string; hint: string }> = [
        {
            value: 'IMMEDIATE',
            label: t('settings.schedule.immediate.label'),
            hint: t('settings.schedule.immediate.hint'),
        },
        {
            value: 'ONE_TIME',
            label: t('settings.schedule.oneTime.label'),
            hint: t('settings.schedule.oneTime.hint'),
        },
        {
            value: 'RECURRING',
            label: t('settings.schedule.recurring.label'),
            hint: t('settings.schedule.recurring.hint'),
        },
    ];

    return (
        <SectionCard
            title={t('settings.title')}
            description={t('settings.description')}
            badge={<StepBadge step={4} invalid={invalid} done={done} />}
            invalid={invalid}
            action={
                selectedSender && !err('fromKey') ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-caption font-semibold text-success-600">
                        <SealCheck className="size-4" weight="fill" />
                        {t('settings.sender.verified')}
                    </span>
                ) : undefined
            }
        >
            {/* Sender */}
            <Field
                label={t('settings.sender.label')}
                required
                error={err('fromKey')}
                hint={
                    selectedSender
                        ? t('settings.sender.fromHint', { email: selectedSender.email })
                        : t('settings.sender.hint')
                }
            >
                {props.sendersError ? (
                    <LoadFailure message={props.sendersError} onRetry={props.onReloadSenders} />
                ) : props.sendersLoading ? (
                    <Skeleton className="h-9 w-full rounded-md" />
                ) : props.senders.length === 0 ? (
                    <EmptyState
                        Icon={EnvelopeSimple}
                        title={t('settings.sender.noneTitle')}
                        description={t('settings.sender.noneDescription')}
                        action={
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() =>
                                    navigate({
                                        to: '/settings',
                                        search: { selectedTab: 'notification' },
                                    })
                                }
                            >
                                {t('settings.sender.configure')}
                            </MyButton>
                        }
                    />
                ) : (
                    <Select
                        value={props.fromKey}
                        onValueChange={props.onFromKeyChange}
                        disabled={disabled}
                    >
                        <SelectTrigger
                            aria-invalid={Boolean(err('fromKey'))}
                            className={cn(err('fromKey') && 'border-danger-400')}
                        >
                            <SelectValue placeholder={t('settings.sender.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {props.senders.map((sender, index) => (
                                <SelectItem
                                    key={`${sender.email}-${index}`}
                                    value={senderKey(sender)}
                                >
                                    <span className="flex items-center gap-2">
                                        <EnvelopeSimple className="size-3.5 shrink-0" />
                                        {sender.name} ({sender.email})
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </Field>

            {/* Priority & expiry */}
            <div className="grid gap-4 md:grid-cols-2">
                <Field
                    label={t('settings.priority.label')}
                    hint={t('settings.priority.hint')}
                    required
                    error={err('priority')}
                >
                    <Select
                        value={props.priority}
                        onValueChange={(value) => props.onPriorityChange(value as EmailPriority)}
                        disabled={disabled}
                    >
                        <SelectTrigger className={cn(err('priority') && 'border-danger-400')}>
                            <SelectValue placeholder={t('settings.priority.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {EMAIL_PRIORITIES.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {t(`settings.priority.options.${value}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>

                <Field
                    label={t('settings.expiresAt.label')}
                    hint={t('settings.expiresAt.hint')}
                    error={err('expiresAt')}
                    htmlFor="email-campaign-expires-at"
                >
                    <Input
                        id="email-campaign-expires-at"
                        type="datetime-local"
                        value={props.expiresAt}
                        onChange={(e) => props.onExpiresAtChange(e.target.value)}
                        disabled={disabled}
                        aria-invalid={Boolean(err('expiresAt'))}
                        className={cn(err('expiresAt') && 'border-danger-400')}
                    />
                </Field>
            </div>

            {/* Schedule */}
            <div className="space-y-4 border-t pt-4">
                <div className="flex items-center gap-2">
                    <CalendarBlank className="size-4 text-primary-500" weight="duotone" />
                    <p className="text-body font-semibold text-foreground">
                        {t('settings.schedule.label')}
                    </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    {scheduleOptions.map((option) => {
                        const selected = props.scheduleType === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                disabled={disabled}
                                onClick={() => props.onScheduleTypeChange(option.value)}
                                className={cn(
                                    'rounded-lg border p-3 text-start transition-colors',
                                    'hover:border-primary-300 hover:bg-primary-50/40',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    'disabled:cursor-not-allowed disabled:opacity-60',
                                    selected
                                        ? 'border-primary-500 bg-primary-50/60'
                                        : 'border-border bg-card'
                                )}
                            >
                                <span className="block text-body font-semibold text-foreground">
                                    {option.label}
                                </span>
                                <span className="block text-caption text-muted-foreground">
                                    {option.hint}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <Field
                        label={t('settings.schedule.timezone.label')}
                        hint={t('settings.schedule.timezone.hint')}
                    >
                        <Select
                            value={props.timezone}
                            onValueChange={props.onTimezoneChange}
                            disabled={disabled}
                        >
                            <SelectTrigger>
                                <span className="flex min-w-0 items-center gap-2">
                                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                                    <SelectValue
                                        placeholder={t('settings.schedule.timezone.label')}
                                    />
                                </span>
                            </SelectTrigger>
                            <SelectContent>
                                {timezoneOptions.map((tz) => (
                                    <SelectItem key={tz.value} value={tz.value}>
                                        {tz.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>

                    {props.scheduleType === 'ONE_TIME' && (
                        <Field
                            label={t('settings.schedule.oneTime.sendAt')}
                            required
                            error={err('schedule.startDate')}
                            htmlFor="email-campaign-send-at"
                        >
                            <Input
                                id="email-campaign-send-at"
                                type="datetime-local"
                                value={props.oneTimeStart}
                                onChange={(e) => props.onOneTimeStartChange(e.target.value)}
                                disabled={disabled}
                                aria-invalid={Boolean(err('schedule.startDate'))}
                                className={cn(err('schedule.startDate') && 'border-danger-400')}
                            />
                        </Field>
                    )}

                    {props.scheduleType === 'RECURRING' && (
                        <Field
                            label={t('settings.schedule.recurring.cron')}
                            hint={t('settings.schedule.recurring.cronHint')}
                            required
                            error={err('schedule.cronExpression')}
                            htmlFor="email-campaign-cron"
                        >
                            <Input
                                id="email-campaign-cron"
                                value={props.cronExpression}
                                onChange={(e) => props.onCronExpressionChange(e.target.value)}
                                placeholder="0 0 9 * * ?"
                                disabled={disabled}
                                aria-invalid={Boolean(err('schedule.cronExpression'))}
                                className={cn(
                                    'font-mono',
                                    err('schedule.cronExpression') && 'border-danger-400'
                                )}
                            />
                        </Field>
                    )}
                </div>

                {props.scheduleType !== 'RECURRING' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="flex items-center gap-1 text-caption text-muted-foreground">
                            <Clock className="size-4" />
                            {t('settings.schedule.quickPicks')}
                        </span>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={disabled}
                            onClick={() => quickSchedule('IN_1H')}
                        >
                            {t('settings.schedule.quick.in1h')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={disabled}
                            onClick={() => quickSchedule('TODAY_5PM')}
                        >
                            {t('settings.schedule.quick.today5pm')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={disabled}
                            onClick={() => quickSchedule('TOMORROW_9AM')}
                        >
                            {t('settings.schedule.quick.tomorrow9am')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            disable={disabled}
                            onClick={() => quickSchedule('NEXT_MON_9AM')}
                        >
                            {t('settings.schedule.quick.nextMonday9am')}
                        </MyButton>
                    </div>
                )}

                {props.scheduleType === 'RECURRING' && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption text-muted-foreground">
                            {t('settings.schedule.recurring.presets')}
                        </span>
                        {cronPresets.map((preset) => (
                            <MyButton
                                key={preset.id}
                                buttonType="secondary"
                                scale="small"
                                disable={disabled}
                                onClick={() => props.onCronExpressionChange(preset.expression)}
                            >
                                {preset.label}
                            </MyButton>
                        ))}
                        <FieldHint>{t('settings.schedule.recurring.note')}</FieldHint>
                    </div>
                )}
            </div>
        </SectionCard>
    );
}
