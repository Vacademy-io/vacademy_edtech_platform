import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceErrorState, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import {
    DialogButtons,
    Field,
    OrderErrorAlert,
    OrderNotice,
    useOrderErrorText,
} from '@/routes/commerce/orders/-components/order-ui';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { NotificationTestSendDialog } from './NotificationTestSendDialog';
import { NotificationTriggerEditor } from './NotificationTriggerEditor';
import { NotificationTriggerRow, triggerTitle } from './NotificationTriggerRow';
import {
    type TemplateSubmitItem,
    fetchNotificationSettings,
    submitWhatsappTemplates,
    updateShop,
} from './notifications-api';
import {
    MAX_LINK_DAYS,
    MAX_SHOP_NAME,
    MIN_LINK_DAYS,
    NOTIFICATION_LOCALES,
    type NotificationSettings,
    type NotificationShop,
    type NotificationTrigger,
    type ShopDraft,
    hasChanges,
    retryMinutes,
    shopDraftOf,
    shopProblems,
    shopUpdateBody,
} from './notifications-logic';
import { settingsBackLink } from './settings-shared';

export const notificationKeys = {
    settings: () => ['commerce', getInstituteId() ?? 'none', 'notification-settings'] as const,
};

/** Value of the "No link" row (a select cannot hold an empty value). */
const NO_LINK = '__none__';

/**
 * S9 Settings → Notifications: the order link and shop name the messages use,
 * and per order event whether WhatsApp and email go out, with the email text,
 * the WhatsApp template and a test send to the staff member's own contacts.
 */
export function NotificationsPage() {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage
            navId="commerce-settings"
            title={t('settings.cards.notifications.title')}
            description={t('notifications.description')}
            backTo={settingsBackLink(t)}
        >
            <NotificationsContent />
        </CommercePage>
    );
}

function NotificationsContent() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const queryClient = useQueryClient();
    const errorText = useOrderErrorText();
    const enabled = access.isResolved && access.canOpen('commerce-settings') && !!getInstituteId();
    const query = useQuery({
        queryKey: notificationKeys.settings(),
        queryFn: fetchNotificationSettings,
        enabled,
        staleTime: 30 * 1000,
    });
    const [editing, setEditing] = useState<string | null>(null);
    const [testing, setTesting] = useState<string | null>(null);

    const replaceTrigger = (fresh: NotificationTrigger) =>
        queryClient.setQueryData<NotificationSettings>(notificationKeys.settings(), (current) =>
            current
                ? { ...current, triggers: current.triggers.map((row) => (row.trigger === fresh.trigger ? fresh : row)) }
                : current
        );
    const reload = async (): Promise<NotificationSettings | undefined> => {
        const result = await query.refetch();
        return result.data;
    };

    if (query.isLoading) {
        return (
            <div className="flex flex-col gap-4" aria-busy="true">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }
    if (query.isError || !query.data) {
        return (
            <CommerceErrorState
                message={errorText(readOrderError(query.error))}
                onRetry={() => void query.refetch()}
            />
        );
    }
    const { shop, triggers } = query.data;
    const editingRow = triggers.find((row) => row.trigger === editing) ?? null;
    return (
        <div className="flex flex-col gap-4">
            {!shop.sending_enabled && <OrderNotice tone="info">{t('notifications.banners.sendingOff')}</OrderNotice>}
            {!shop.link_secret_configured && (
                <OrderNotice tone="warning">{t('notifications.banners.linksOff')}</OrderNotice>
            )}
            <ShopCard
                shop={shop}
                onSaved={(fresh) =>
                    queryClient.setQueryData<NotificationSettings>(notificationKeys.settings(), (current) =>
                        current ? { ...current, shop: fresh } : current
                    )
                }
            />
            <SectionCard
                title={t('notifications.triggersTitle')}
                description={t('notifications.triggersDescription')}
                actions={access.isManager ? <TemplateRequestButton /> : undefined}
            >
                <ul className="flex flex-col divide-y divide-border">
                    {triggers.map((row) => (
                        <NotificationTriggerRow
                            key={row.trigger}
                            trigger={row}
                            canEdit={access.isManager}
                            onChanged={replaceTrigger}
                            onConflict={() => void reload()}
                            onEdit={() => setEditing(row.trigger)}
                            onTest={() => setTesting(row.trigger)}
                        />
                    ))}
                </ul>
            </SectionCard>
            {editingRow && (
                <NotificationTriggerEditor
                    open
                    trigger={editingRow}
                    canEditTemplate={access.isManager}
                    onOpenChange={(open) => {
                        if (!open) setEditing(null);
                    }}
                    onSaved={replaceTrigger}
                    onReload={async () => (await reload())?.triggers.find((row) => row.trigger === editingRow.trigger) ?? null}
                />
            )}
            {testing && (
                <NotificationTestSendDialog
                    open
                    trigger={testing}
                    onOpenChange={(open) => {
                        if (!open) setTesting(null);
                    }}
                />
            )}
        </div>
    );
}

function ShopCard({ shop, onSaved }: { shop: NotificationShop; onSaved: (shop: NotificationShop) => void }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const [draft, setDraft] = useState<ShopDraft>(() => shopDraftOf(shop));
    const [error, setError] = useState<OrderError | null>(null);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [tried, setTried] = useState(false);

    useEffect(() => setDraft(shopDraftOf(shop)), [shop]);

    const problems = shopProblems(draft);
    const body = shopUpdateBody(shop, draft);
    const canSave = access.isManager && hasChanges(body);
    const options = [
        ...shop.link_base_candidates.map((url) => ({ value: url, label: url })),
        ...(shop.link_base_url && !shop.link_base_candidates.includes(shop.link_base_url)
            ? [{ value: shop.link_base_url, label: shop.link_base_url }]
            : []),
        { value: NO_LINK, label: t('notifications.shop.noLink') },
    ];

    const save = async () => {
        setTried(true);
        setError(null);
        setLinkError(null);
        if (problems.length > 0 || !hasChanges(body)) return;
        try {
            const fresh = await updateShop(body);
            onSaved(fresh);
            toast.success(t('notifications.shop.saved'));
        } catch (failure) {
            const read = readOrderError(failure);
            if (read.code === 'LINK_BASE_NOT_VERIFIED') setLinkError(t('orders.errors.LINK_BASE_NOT_VERIFIED'));
            else setError(read);
        }
    };

    const nameField = (lang: 'hi' | 'en') => (
        <Field
            key={lang}
            label={t(`notifications.shop.shopName.${lang}`)}
            htmlFor={`shop-name-${lang}`}
            hint={t('notifications.shop.shopNameHint', { name: shop.shop_name_default ?? '' })}
            error={
                tried && problems.includes(lang === 'hi' ? 'shopNameHi' : 'shopNameEn')
                    ? t('notifications.shop.shopNameTooLong', { max: MAX_SHOP_NAME })
                    : null
            }
        >
            <MyInput
                id={`shop-name-${lang}`}
                input={draft.shop_name[lang]}
                maxLength={MAX_SHOP_NAME}
                disabled={!access.isManager}
                inputPlaceholder={shop.shop_name_default ?? ''}
                onChangeFunction={(event) =>
                    setDraft((current) => ({
                        ...current,
                        shop_name: { ...current.shop_name, [lang]: event.target.value.replace(/[\r\n]/g, ' ') },
                    }))
                }
                className="sm:w-full"
            />
        </Field>
    );

    return (
        <SectionCard
            title={t('notifications.shop.title')}
            description={t('notifications.shop.description')}
            actions={
                access.isManager ? (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disable={!canSave}
                        onAsyncClick={save}
                        loadingText={t('common.saving')}
                    >
                        {t('common.save')}
                    </MyButton>
                ) : undefined
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <PlainSelect
                        label={t('notifications.shop.linkBase')}
                        value={draft.link_base_url || NO_LINK}
                        disabled={!access.isManager}
                        invalid={!!linkError}
                        onChange={(value) =>
                            setDraft((current) => ({ ...current, link_base_url: value === NO_LINK ? '' : value }))
                        }
                        options={options}
                    />
                    {linkError ? (
                        <p role="alert" className="text-caption text-danger-600">
                            {linkError}
                        </p>
                    ) : (
                        <p className="text-caption text-muted-foreground">{t('notifications.shop.linkBaseHint')}</p>
                    )}
                </div>
                <Field
                    label={t('notifications.shop.linkDays')}
                    htmlFor="shop-link-days"
                    hint={t('notifications.shop.linkDaysHint', { min: MIN_LINK_DAYS, max: MAX_LINK_DAYS })}
                    error={
                        tried && problems.includes('linkDays')
                            ? t('notifications.shop.linkDaysHint', { min: MIN_LINK_DAYS, max: MAX_LINK_DAYS })
                            : null
                    }
                >
                    <MyInput
                        id="shop-link-days"
                        inputType="number"
                        min={MIN_LINK_DAYS}
                        max={MAX_LINK_DAYS}
                        input={draft.link_days}
                        disabled={!access.isManager}
                        onChangeFunction={(event) => setDraft((current) => ({ ...current, link_days: event.target.value }))}
                        className="sm:w-full"
                    />
                </Field>
                {NOTIFICATION_LOCALES.map((lang) => nameField(lang))}
            </div>
            <OrderErrorAlert error={error} />
        </SectionCard>
    );
}

function TemplateRequestButton() {
    const { t } = useTranslation('commerce');
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<TemplateSubmitItem[] | null>(null);
    const [error, setError] = useState<OrderError | null>(null);

    const submit = async () => {
        setError(null);
        try {
            setItems(await submitWhatsappTemplates({ triggers: null, locales: ['hi', 'en'] }));
        } catch (failure) {
            setError(readOrderError(failure));
        }
    };

    return (
        <>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                onClick={() => {
                    setItems(null);
                    setError(null);
                    setOpen(true);
                }}
            >
                {t('notifications.templates.request')}
            </MyButton>
            <MyDialog
                heading={t('notifications.templates.request')}
                open={open}
                onOpenChange={setOpen}
                dialogWidth="max-w-2xl"
                footer={
                    items ? (
                        <div className="flex justify-end">
                            <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => setOpen(false)}>
                                {t('notifications.close')}
                            </MyButton>
                        </div>
                    ) : (
                        <DialogButtons onCancel={() => setOpen(false)}>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                onAsyncClick={submit}
                                loadingText={t('notifications.templates.sending')}
                            >
                                {t('notifications.templates.confirm')}
                            </MyButton>
                        </DialogButtons>
                    )
                }
            >
                <div className="flex flex-col gap-3">
                    {!items && <p className="text-body text-foreground">{t('notifications.templates.explain')}</p>}
                    {error?.code === 'rate_limited' ? (
                        <OrderNotice tone="warning">
                            {t('notifications.tryAgainIn', { minutes: retryMinutes(error.retryAfterSeconds) })}
                        </OrderNotice>
                    ) : (
                        <OrderErrorAlert error={error} />
                    )}
                    {items && (
                        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                            {items.map((item) => (
                                <li
                                    key={`${item.trigger}-${item.locale}`}
                                    className="flex flex-wrap items-center justify-between gap-2 p-3"
                                >
                                    <div className="flex min-w-0 flex-col">
                                        <span className="text-body font-medium text-foreground">
                                            {triggerTitle(item.trigger, t)} · {t(`notifications.languages.${item.locale === 'en' ? 'en' : 'hi'}`)}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {item.template_name ?? '—'}
                                            {item.code ? ` · ${t(`notifications.templates.codes.${item.code}`, { defaultValue: item.code })}` : ''}
                                        </span>
                                    </div>
                                    <CommerceStatusChip kind="templateStatus" value={item.status} />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </MyDialog>
        </>
    );
}
