import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PaperPlaneTilt, PencilSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Switch } from '@/components/ui/switch';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { useOrderErrorText } from '@/routes/commerce/orders/-components/order-ui';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { updateTrigger } from './notifications-api';
import { NOTIFICATION_LOCALES, NOTIFICATION_TRIGGERS, type NotificationTrigger, switchBody } from './notifications-logic';

const KNOWN = new Set<string>(NOTIFICATION_TRIGGERS);

/** The trigger's name; a code the app does not know yet is shown as it came. */
export const triggerTitle = (code: string, t: TFunction): string =>
    KNOWN.has(code) ? t(`notifications.triggers.${code}.title`) : code;

const triggerDescription = (code: string, t: TFunction): string | null =>
    KNOWN.has(code) ? t(`notifications.triggers.${code}.description`) : null;

type SwitchKey = 'enabled' | 'whatsapp_enabled' | 'email_enabled';

/**
 * One order event: on/off, WhatsApp, email (each switch saves at once with the
 * row's version; the answer replaces the row), template approval per language,
 * Edit and Test.
 */
export function NotificationTriggerRow({
    trigger,
    canEdit,
    onChanged,
    onConflict,
    onEdit,
    onTest,
}: {
    trigger: NotificationTrigger;
    canEdit: boolean;
    onChanged: (fresh: NotificationTrigger) => void;
    onConflict: () => void;
    onEdit: () => void;
    onTest: () => void;
}) {
    const { t } = useTranslation('commerce');
    const errorText = useOrderErrorText();
    const [saving, setSaving] = useState<SwitchKey | null>(null);
    const description = triggerDescription(trigger.trigger, t);

    const flip = async (key: SwitchKey, value: boolean) => {
        setSaving(key);
        try {
            onChanged(await updateTrigger(trigger.trigger, switchBody(trigger, key, value)));
        } catch (failure) {
            const error = readOrderError(failure);
            toast.error(errorText(error));
            if (error.code === 'SETTING_VERSION_CONFLICT') onConflict();
        } finally {
            setSaving(null);
        }
    };

    const toggle = (key: SwitchKey, label: string) => (
        <label className="flex min-h-10 items-center gap-2 text-caption text-foreground">
            <Switch
                checked={trigger[key]}
                disabled={!canEdit || saving !== null || (key !== 'enabled' && !trigger.enabled)}
                aria-label={`${label} · ${triggerTitle(trigger.trigger, t)}`}
                onCheckedChange={(checked) => void flip(key, checked)}
            />
            {label}
        </label>
    );

    return (
        <li className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between" data-trigger={trigger.trigger}>
            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium text-foreground">{triggerTitle(trigger.trigger, t)}</span>
                    {trigger.handled_by_workflow && (
                        <StatusChip
                            text={t('notifications.byWorkflow')}
                            textSize="text-caption"
                            status="INFO"
                            showIcon={false}
                        />
                    )}
                </div>
                {description && <p className="text-caption text-muted-foreground">{description}</p>}
                <div className="flex flex-wrap items-center gap-2">
                    {NOTIFICATION_LOCALES.map((lang) => (
                        <span key={lang} className="flex items-center gap-1 text-caption text-muted-foreground">
                            {t('notifications.templateIn', { language: t(`notifications.languages.${lang}`) })}
                            <CommerceStatusChip kind="templateStatus" value={trigger.whatsapp.status[lang] ?? 'UNKNOWN'} />
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {toggle('enabled', t('notifications.on'))}
                {toggle('whatsapp_enabled', t('notifications.whatsapp'))}
                {toggle('email_enabled', t('notifications.email'))}
                <div className="flex items-center gap-2">
                    <MyButton type="button" buttonType="secondary" scale="small" onClick={onEdit}>
                        <PencilSimple size={14} />
                        {canEdit ? t('notifications.edit') : t('notifications.view')}
                    </MyButton>
                    {canEdit && (
                        <MyButton type="button" buttonType="secondary" scale="small" onClick={onTest}>
                            <PaperPlaneTilt size={14} />
                            {t('notifications.test')}
                        </MyButton>
                    )}
                </div>
            </div>
        </li>
    );
}
