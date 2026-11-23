import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Field, OrderErrorAlert, OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { triggerTitle } from './NotificationTriggerRow';
import { updateTrigger } from './notifications-api';
import {
    MAX_EMAIL_BODY,
    MAX_EMAIL_SUBJECT,
    NOTIFICATION_LOCALES,
    type NotificationLocale,
    type NotificationTrigger,
    TEMPLATE_NAME_PATTERN,
    type TriggerDraft,
    draftOf,
    hasChanges,
    insertVariable,
    keepTypedOnConflict,
    triggerUpdateBody,
} from './notifications-logic';

type Focused = { lang: NotificationLocale; field: 'subject' | 'body' };

/**
 * The trigger editor: per language (Hindi first) the WhatsApp template (its
 * approved text is read-only; a manager may point to another template) and
 * the email subject and body, with variables inserted at the cursor. Save
 * sends the version read and only what changed. When someone else saved in
 * between, the row is read again and the typed text is kept.
 */
export function NotificationTriggerEditor({
    open,
    onOpenChange,
    trigger,
    canEditTemplate,
    onSaved,
    onReload,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger: NotificationTrigger;
    canEditTemplate: boolean;
    onSaved: (fresh: NotificationTrigger) => void;
    onReload: () => Promise<NotificationTrigger | null>;
}) {
    const { t } = useTranslation('commerce');
    const [original, setOriginal] = useState<NotificationTrigger>(trigger);
    const [draft, setDraft] = useState<TriggerDraft>(() => draftOf(trigger));
    const [lang, setLang] = useState<NotificationLocale>('hi');
    const [error, setError] = useState<OrderError | null>(null);
    const [conflict, setConflict] = useState(false);
    const focused = useRef<Focused>({ lang: 'hi', field: 'body' });
    const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

    useEffect(() => {
        if (!open) return;
        setOriginal(trigger);
        setDraft(draftOf(trigger));
        setError(null);
        setConflict(false);
        // A fresh open only; a save keeps the editor's own state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, trigger.trigger]);

    const body = triggerUpdateBody(original, draft);
    const templateInvalid =
        draft.whatsapp_template_name.trim() !== '' && !TEMPLATE_NAME_PATTERN.test(draft.whatsapp_template_name.trim());
    const tooLong = NOTIFICATION_LOCALES.some(
        (l) =>
            !draft.reset[l] &&
            ((draft.subject[l] ?? '').length > MAX_EMAIL_SUBJECT || (draft.body[l] ?? '').length > MAX_EMAIL_BODY)
    );
    const editable = canEditTemplate;

    const setText = (l: NotificationLocale, field: 'subject' | 'body', value: string) =>
        setDraft((current) => ({
            ...current,
            [field]: { ...current[field], [l]: value },
            reset: { ...current.reset, [l]: false },
        }));

    const resetEmail = (l: NotificationLocale) =>
        setDraft((current) => ({ ...current, reset: { ...current.reset, [l]: true } }));

    const insert = (name: string) => {
        const target = focused.current;
        const element = fields.current[`${target.lang}-${target.field}`];
        const value = draft[target.field][target.lang] ?? '';
        const start = element?.selectionStart ?? value.length;
        const end = element?.selectionEnd ?? start;
        const next = insertVariable(value, name, start, end);
        setText(target.lang, target.field, next.value);
        requestAnimationFrame(() => {
            element?.focus();
            element?.setSelectionRange(next.cursor, next.cursor);
        });
    };

    const save = async () => {
        setError(null);
        if (!hasChanges(body) || templateInvalid || tooLong) return;
        try {
            const fresh = await updateTrigger(original.trigger, body);
            onSaved(fresh);
            toast.success(t('notifications.editor.saved'));
            onOpenChange(false);
        } catch (failure) {
            const read = readOrderError(failure);
            if (read.code === 'SETTING_VERSION_CONFLICT') {
                const fresh = await onReload();
                if (fresh) {
                    const kept = keepTypedOnConflict(fresh, draft);
                    setOriginal(kept.original);
                    setDraft(kept.draft);
                }
                setConflict(true);
                return;
            }
            setError(read);
        }
    };

    const isDefault = (l: NotificationLocale) => draft.reset[l] || (!original.email.overridden[l] &&
        (draft.subject[l] ?? '') === (original.email.subject[l] ?? '') &&
        (draft.body[l] ?? '') === (original.email.body[l] ?? ''));

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full max-w-full flex-col gap-4 overflow-y-auto sm:max-w-full md:max-w-2xl">
                <SheetHeader className="text-start">
                    <SheetTitle>{triggerTitle(original.trigger, t)}</SheetTitle>
                    <SheetDescription>{t('notifications.editor.description')}</SheetDescription>
                </SheetHeader>

                {conflict && <OrderNotice tone="warning">{t('orders.errors.SETTING_VERSION_CONFLICT')}</OrderNotice>}

                <Tabs value={lang} onValueChange={(value) => setLang(value as NotificationLocale)}>
                    <TabsList>
                        {NOTIFICATION_LOCALES.map((l) => (
                            <TabsTrigger key={l} value={l}>
                                {t(`notifications.languages.${l}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {NOTIFICATION_LOCALES.map((l) => (
                        <TabsContent key={l} value={l} className="mt-4 flex flex-col gap-5">
                            <section className="flex flex-col gap-3">
                                <h3 className="text-subtitle font-medium text-foreground">{t('notifications.whatsapp')}</h3>
                                <Field
                                    label={t('notifications.editor.templateName')}
                                    htmlFor={`template-${l}`}
                                    hint={t('notifications.editor.templateDefault', {
                                        name: original.whatsapp.default_template_name ?? '',
                                    })}
                                    error={templateInvalid ? t('notifications.editor.templateInvalid') : null}
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <MyInput
                                            id={`template-${l}`}
                                            input={draft.whatsapp_template_name}
                                            maxLength={100}
                                            disabled={!editable}
                                            inputPlaceholder={original.whatsapp.default_template_name ?? ''}
                                            onChangeFunction={(event) =>
                                                setDraft((current) => ({
                                                    ...current,
                                                    whatsapp_template_name: event.target.value,
                                                }))
                                            }
                                            className="sm:w-full"
                                        />
                                        {editable && draft.whatsapp_template_name !== '' && (
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() =>
                                                    setDraft((current) => ({ ...current, whatsapp_template_name: '' }))
                                                }
                                            >
                                                {t('notifications.editor.resetTemplate')}
                                            </MyButton>
                                        )}
                                    </div>
                                </Field>
                                <Field label={t('notifications.editor.templateText')}>
                                    <p className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-body text-foreground">
                                        {original.whatsapp.text[l] || '—'}
                                    </p>
                                </Field>
                            </section>

                            <section className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-subtitle font-medium text-foreground">{t('notifications.email')}</h3>
                                    {isDefault(l) ? (
                                        <span className="text-caption text-muted-foreground">
                                            {t('notifications.editor.usingDefault')}
                                        </span>
                                    ) : (
                                        editable && (
                                            <MyButton type="button" buttonType="text" scale="small" onClick={() => resetEmail(l)}>
                                                {t('notifications.editor.resetEmail')}
                                            </MyButton>
                                        )
                                    )}
                                </div>
                                <Field
                                    label={t('notifications.editor.subject')}
                                    htmlFor={`subject-${l}`}
                                    error={
                                        (draft.subject[l] ?? '').length > MAX_EMAIL_SUBJECT
                                            ? t('notifications.editor.tooLong', { max: MAX_EMAIL_SUBJECT })
                                            : null
                                    }
                                >
                                    <MyInput
                                        id={`subject-${l}`}
                                        ref={(element) => {
                                            fields.current[`${l}-subject`] = element;
                                        }}
                                        input={draft.reset[l] ? '' : (draft.subject[l] ?? '')}
                                        inputPlaceholder={draft.reset[l] ? t('notifications.editor.usingDefault') : ''}
                                        maxLength={MAX_EMAIL_SUBJECT}
                                        disabled={!editable}
                                        onFocus={() => {
                                            focused.current = { lang: l, field: 'subject' };
                                        }}
                                        onChangeFunction={(event) => setText(l, 'subject', event.target.value)}
                                        className="sm:w-full"
                                    />
                                </Field>
                                <Field
                                    label={t('notifications.editor.body')}
                                    htmlFor={`body-${l}`}
                                    error={
                                        (draft.body[l] ?? '').length > MAX_EMAIL_BODY
                                            ? t('notifications.editor.tooLong', { max: MAX_EMAIL_BODY })
                                            : null
                                    }
                                >
                                    <Textarea
                                        id={`body-${l}`}
                                        ref={(element) => {
                                            fields.current[`${l}-body`] = element;
                                        }}
                                        value={draft.reset[l] ? '' : (draft.body[l] ?? '')}
                                        placeholder={draft.reset[l] ? t('notifications.editor.usingDefault') : ''}
                                        maxLength={MAX_EMAIL_BODY}
                                        disabled={!editable}
                                        onFocus={() => {
                                            focused.current = { lang: l, field: 'body' };
                                        }}
                                        onChange={(event) => setText(l, 'body', event.target.value)}
                                        className="min-h-40 text-body"
                                    />
                                </Field>
                                {editable && original.variables.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className="text-caption text-muted-foreground">
                                            {t('notifications.editor.variables')}
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                            {original.variables.map((name) => (
                                                <button
                                                    key={name}
                                                    type="button"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => insert(name)}
                                                    className="rounded-full border border-border bg-card px-3 py-1 text-caption text-foreground hover:border-primary-500"
                                                >
                                                    {`{{${name}}}`}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </section>
                        </TabsContent>
                    ))}
                </Tabs>

                <OrderErrorAlert error={error} />

                <div className="mt-auto flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                        {editable ? t('common.cancel') : t('notifications.close')}
                    </MyButton>
                    {editable && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={!hasChanges(body) || templateInvalid || tooLong}
                            onAsyncClick={save}
                            loadingText={t('common.saving')}
                        >
                            {t('common.save')}
                        </MyButton>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
