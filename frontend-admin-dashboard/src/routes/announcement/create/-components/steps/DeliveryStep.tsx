import { CalendarBlank, Check, Clock, Globe, PaperPlaneTilt } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { buildTimezoneOptions } from '@/routes/study-library/live-session/schedule/-constants/options';
import type { MediumType } from '@/services/announcement';
import type { MessageTemplate } from '@/types/message-template-types';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import { buildCronPresets, buildMediumMeta, MEDIUM_META } from '../../-utils/constants';
import { EmailChannelCard } from '../channels/EmailChannelCard';
import { PushChannelCard } from '../channels/PushChannelCard';
import { WhatsAppChannelCard } from '../channels/WhatsAppChannelCard';
import { FieldError, FieldHint, SectionCard } from '../primitives';
import type {
    EmailConfig,
    FieldErrors,
    PushConfig,
    ScheduleType,
    WhatsAppConfig,
} from '../../-types';

interface DeliveryStepProps {
    mediums: MediumType[];
    onToggleMedium: (medium: MediumType) => void;

    push: PushConfig;
    onPushChange: (patch: Partial<PushConfig>) => void;
    pushSynced: boolean;
    onPushSyncedChange: (synced: boolean) => void;

    email: EmailConfig;
    onEmailChange: (patch: Partial<EmailConfig>) => void;
    onApplyEmailTemplate: (templateId: string) => void;
    applyingEmailTemplate: boolean;
    emailTemplates: MessageTemplate[];
    emailTemplatesLoading: boolean;
    emailTemplatesError: string | null;
    onLoadEmailTemplates: (force?: boolean) => void;
    emailSenders: EmailConfiguration[];
    emailSendersLoading: boolean;
    emailSendersError: string | null;
    onReloadEmailSenders: () => void;
    announcementTitle: string;

    whatsapp: WhatsAppConfig;
    onWhatsAppChange: (patch: Partial<WhatsAppConfig>) => void;
    whatsappTemplates: WhatsAppTemplateDTO[];
    selectedWhatsAppTemplate: WhatsAppTemplateDTO | null;
    whatsappLoading: boolean;
    whatsappError: string | null;
    whatsappSyncing: boolean;
    onLoadWhatsApp: () => void;
    onReloadWhatsApp: () => void;
    onSyncWhatsApp: () => void;

    scheduleType: ScheduleType;
    onScheduleTypeChange: (type: ScheduleType) => void;
    timezone: string;
    onTimezoneChange: (timezone: string) => void;
    oneTimeStart: string;
    onOneTimeStartChange: (value: string) => void;
    cronExpression: string;
    onCronExpressionChange: (value: string) => void;

    errors: FieldErrors;
    showErrors: boolean;
}

const toLocalInput = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function DeliveryStep(props: DeliveryStepProps) {
    const { t } = useTranslation('announcementDeliveryStep');
    const { t: tConstants } = useTranslation('announcementCreateConstants');
    // Option labels are translated, so the list is built from this screen's own
    // `t` bound to the shared options namespace.
    const { t: tOptions } = useTranslation('studyLibraryOptions');
    const TIMEZONE_OPTIONS = buildTimezoneOptions(tOptions);
    const { errors, showErrors } = props;
    const err = (key: string) => (showErrors ? errors[key] : undefined);
    const mediumMeta = buildMediumMeta(tConstants);
    const cronPresets = buildCronPresets(tConstants);

    const quickSchedule = (pick: 'TODAY_5PM' | 'TOMORROW_9AM' | 'NEXT_MON_9AM') => {
        const now = new Date();
        const target = new Date(now);
        if (pick === 'TODAY_5PM') {
            target.setHours(17, 0, 0, 0);
            if (target < now) target.setDate(target.getDate() + 1);
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

    return (
        <div className="space-y-6">
            <SectionCard
                title={t('channels.title')}
                description={t('channels.description')}
                Icon={PaperPlaneTilt}
            >
                <div className="grid gap-3 sm:grid-cols-3">
                    {mediumMeta.map((meta) => {
                        const selected = props.mediums.includes(meta.type);
                        return (
                            <button
                                key={meta.type}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => props.onToggleMedium(meta.type)}
                                className={cn(
                                    'flex h-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                                    'hover:border-primary-300 hover:bg-primary-50/40',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    selected
                                        ? 'border-primary-500 bg-primary-50/60'
                                        : 'border-border bg-card'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                                        selected
                                            ? 'bg-primary-100 text-primary-600'
                                            : 'bg-muted text-muted-foreground'
                                    )}
                                >
                                    <meta.Icon className="size-5" weight="duotone" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                        <span className="text-body font-semibold text-foreground">
                                            {meta.label}
                                        </span>
                                        {selected && (
                                            <Check
                                                weight="bold"
                                                className="size-3.5 shrink-0 text-primary-500"
                                            />
                                        )}
                                    </span>
                                    <span className="block text-caption text-muted-foreground">
                                        {meta.description}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                {props.mediums.length === 0 && (
                    <FieldHint>{t('channels.noneSelectedHint')}</FieldHint>
                )}
            </SectionCard>

            {props.mediums.includes('PUSH_NOTIFICATION') && (
                <SectionCard
                    title={t('push.title')}
                    description={t('push.description')}
                    Icon={MEDIUM_META[0]!.Icon}
                    invalid={Boolean(err('push.title') || err('push.body'))}
                >
                    <PushChannelCard
                        config={props.push}
                        onChange={props.onPushChange}
                        synced={props.pushSynced}
                        onSyncedChange={props.onPushSyncedChange}
                        errors={errors}
                        showErrors={showErrors}
                    />
                </SectionCard>
            )}

            {props.mediums.includes('EMAIL') && (
                <SectionCard
                    title={t('email.title')}
                    description={t('email.description')}
                    Icon={MEDIUM_META[1]!.Icon}
                    invalid={Boolean(err('email.from'))}
                >
                    <EmailChannelCard
                        config={props.email}
                        onChange={props.onEmailChange}
                        onApplyTemplate={props.onApplyEmailTemplate}
                        applying={props.applyingEmailTemplate}
                        templates={props.emailTemplates}
                        templatesLoading={props.emailTemplatesLoading}
                        templatesError={props.emailTemplatesError}
                        onLoadTemplates={props.onLoadEmailTemplates}
                        senders={props.emailSenders}
                        sendersLoading={props.emailSendersLoading}
                        sendersError={props.emailSendersError}
                        onReloadSenders={props.onReloadEmailSenders}
                        announcementTitle={props.announcementTitle}
                        errors={errors}
                        showErrors={showErrors}
                    />
                </SectionCard>
            )}

            {props.mediums.includes('WHATSAPP') && (
                <SectionCard
                    title={t('whatsapp.title')}
                    description={t('whatsapp.description')}
                    Icon={MEDIUM_META[2]!.Icon}
                    invalid={Object.keys(errors).some(
                        (key) => showErrors && key.startsWith('whatsapp.')
                    )}
                >
                    <WhatsAppChannelCard
                        config={props.whatsapp}
                        onChange={props.onWhatsAppChange}
                        templates={props.whatsappTemplates}
                        selectedTemplate={props.selectedWhatsAppTemplate}
                        loading={props.whatsappLoading}
                        error={props.whatsappError}
                        syncing={props.whatsappSyncing}
                        onLoad={props.onLoadWhatsApp}
                        onReload={props.onReloadWhatsApp}
                        onSync={props.onSyncWhatsApp}
                        errors={errors}
                        showErrors={showErrors}
                    />
                </SectionCard>
            )}

            <SectionCard
                id="announcement-schedule"
                className="scroll-mt-24"
                title={t('schedule.title')}
                Icon={CalendarBlank}
                invalid={Boolean(err('schedule.startDate') || err('schedule.cronExpression'))}
            >
                <div className="grid gap-3 sm:grid-cols-3">
                    {(
                        [
                            {
                                value: 'IMMEDIATE',
                                label: t('schedule.type.immediate.label'),
                                hint: t('schedule.type.immediate.hint'),
                            },
                            {
                                value: 'ONE_TIME',
                                label: t('schedule.type.oneTime.label'),
                                hint: t('schedule.type.oneTime.hint'),
                            },
                            {
                                value: 'RECURRING',
                                label: t('schedule.type.recurring.label'),
                                hint: t('schedule.type.recurring.hint'),
                            },
                        ] as const
                    ).map((option) => {
                        const selected = props.scheduleType === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => props.onScheduleTypeChange(option.value)}
                                className={cn(
                                    'rounded-lg border p-3 text-left transition-colors',
                                    'hover:border-primary-300 hover:bg-primary-50/40',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

                <div className="space-y-1">
                    <Label className="flex items-center gap-1.5 text-caption font-semibold">
                        <Globe className="size-4" />
                        {t('schedule.timezone.label')}
                    </Label>
                    <Select value={props.timezone} onValueChange={props.onTimezoneChange}>
                        <SelectTrigger className="sm:max-w-sm">
                            <SelectValue placeholder={t('schedule.timezone.label')} />
                        </SelectTrigger>
                        <SelectContent>
                            {TIMEZONE_OPTIONS.map((tz) => (
                                <SelectItem key={tz.value} value={tz.value}>
                                    {tz.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FieldHint>{t('schedule.timezone.hint')}</FieldHint>
                </div>

                {props.scheduleType === 'ONE_TIME' && (
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <Label className="flex items-center gap-1.5 text-caption font-semibold">
                                <Clock className="size-4" />
                                {t('schedule.oneTime.sendAt')}
                            </Label>
                            <Input
                                type="datetime-local"
                                value={props.oneTimeStart}
                                onChange={(e) => props.onOneTimeStartChange(e.target.value)}
                                className={cn(
                                    'sm:max-w-sm',
                                    err('schedule.startDate') && 'border-danger-400'
                                )}
                            />
                            <FieldError message={err('schedule.startDate')} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => quickSchedule('TODAY_5PM')}
                            >
                                {t('schedule.quickPick.today5pm')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => quickSchedule('TOMORROW_9AM')}
                            >
                                {t('schedule.quickPick.tomorrow9am')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => quickSchedule('NEXT_MON_9AM')}
                            >
                                {t('schedule.quickPick.nextMonday9am')}
                            </MyButton>
                        </div>
                    </div>
                )}

                {props.scheduleType === 'RECURRING' && (
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <Label className="text-caption font-semibold">
                                {t('schedule.recurring.cronExpression')}
                            </Label>
                            <Input
                                value={props.cronExpression}
                                onChange={(e) => props.onCronExpressionChange(e.target.value)}
                                placeholder="0 0 9 * * ?"
                                className={cn(
                                    'font-mono sm:max-w-sm',
                                    err('schedule.cronExpression') && 'border-danger-400'
                                )}
                            />
                            <FieldError message={err('schedule.cronExpression')} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {cronPresets.map((preset) => (
                                <MyButton
                                    key={preset.id}
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => props.onCronExpressionChange(preset.expression)}
                                >
                                    {preset.label}
                                </MyButton>
                            ))}
                        </div>
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
