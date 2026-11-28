import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { PlainSelect } from '@/routes/commerce/-components/CatalogueBits';
import { DialogButtons, OrderErrorAlert, OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { triggerTitle } from './NotificationTriggerRow';
import { testSend } from './notifications-api';
import {
    NOTIFICATION_LOCALES,
    type NotificationLocale,
    TEST_CHANNELS,
    type TestChannel,
    type TestSendRow,
    mapTestResults,
    retryMinutes,
} from './notifications-logic';

/**
 * A test message of one trigger, in one language, to the staff member's own
 * e-mail and mobile number, with sample order data.
 */
export function NotificationTestSendDialog({
    open,
    onOpenChange,
    trigger,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger: string;
}) {
    const { t } = useTranslation('commerce');
    const [locale, setLocale] = useState<NotificationLocale>('hi');
    const [channels, setChannels] = useState<Record<TestChannel, boolean>>({ EMAIL: true, WHATSAPP: true });
    const [rows, setRows] = useState<TestSendRow[] | null>(null);
    const [error, setError] = useState<OrderError | null>(null);

    useEffect(() => {
        if (!open) return;
        setRows(null);
        setError(null);
    }, [open, trigger]);

    const chosen = TEST_CHANNELS.filter((channel) => channels[channel]);

    const send = async () => {
        setError(null);
        if (chosen.length === 0) return;
        try {
            setRows(mapTestResults(await testSend({ trigger, locale, channels: [...chosen] })));
        } catch (failure) {
            setRows(null);
            setError(readOrderError(failure));
        }
    };

    return (
        <MyDialog
            heading={t('notifications.testSend')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={chosen.length === 0}
                        onAsyncClick={send}
                        loadingText={t('notifications.testDialog.sending')}
                    >
                        {rows ? t('notifications.testDialog.sendAgain') : t('notifications.testSend')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-foreground">{triggerTitle(trigger, t)}</p>
                <p className="text-caption text-muted-foreground">{t('notifications.testDialog.explain')}</p>
                <PlainSelect
                    label={t('notifications.testDialog.language')}
                    value={locale}
                    onChange={(value) => setLocale(value === 'en' ? 'en' : 'hi')}
                    options={NOTIFICATION_LOCALES.map((l) => ({ value: l, label: t(`notifications.languages.${l}`) }))}
                />
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-caption text-muted-foreground">{t('notifications.testDialog.channels')}</legend>
                    {TEST_CHANNELS.map((channel) => (
                        <label key={channel} className="flex min-h-10 items-center gap-2 text-body text-foreground">
                            <Checkbox
                                checked={channels[channel]}
                                onCheckedChange={(checked) =>
                                    setChannels((current) => ({ ...current, [channel]: checked === true }))
                                }
                            />
                            {channel === 'EMAIL' ? t('notifications.email') : t('notifications.whatsapp')}
                        </label>
                    ))}
                    {chosen.length === 0 && (
                        <p role="alert" className="text-caption text-danger-600">
                            {t('notifications.testDialog.pickChannel')}
                        </p>
                    )}
                </fieldset>

                {error?.code === 'rate_limited' ? (
                    <OrderNotice tone="warning">
                        {t('notifications.testDialog.tooMany', { minutes: retryMinutes(error.retryAfterSeconds) })}
                    </OrderNotice>
                ) : (
                    <OrderErrorAlert error={error} />
                )}

                {rows && (
                    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {rows.map((row) => (
                            <li key={row.channel} className="flex flex-col gap-1 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-body font-medium text-foreground">
                                        {row.channel === 'EMAIL' ? t('notifications.email') : t('notifications.whatsapp')}
                                    </span>
                                    <CommerceStatusChip kind="delivery" value={row.status} />
                                </div>
                                {(row.codeKey || row.raw) && (
                                    <span className="text-caption text-muted-foreground">
                                        {row.codeKey ? t(row.codeKey) : row.raw}
                                    </span>
                                )}
                                {row.recipient && (
                                    <span className="text-caption text-muted-foreground">
                                        {t('notifications.testDialog.sentTo', { recipient: row.recipient })}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
}
