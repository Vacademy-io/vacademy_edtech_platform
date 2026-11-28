import { forwardRef, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CircleNotch, Eye, EyeSlash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { noAutofillProps } from '@/lib/no-autofill';
import {
    createZoomAccount,
    updateZoomAccount,
    testZoomConnection,
    type ZoomAccountSummary,
} from '@/services/zoom-accounts';

/**
 * Add/Edit dialog for a Zoom integration account.
 *
 * On edit, the existing summary is passed in; secret fields default to blank
 * and only the secrets the admin actually re-types are sent back (the backend
 * preserves existing encrypted values for empty fields).
 */

type Mode = 'create' | 'edit';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: Mode;
    /** Required when mode === 'edit'. */
    account?: ZoomAccountSummary | null;
    onSaved: (account: ZoomAccountSummary) => void;
}

// Two schemas — required-secrets on create, optional on edit.
const buildCreateSchema = (t: TFunction) =>
    z.object({
        label: z.string().trim().min(1, t('validation.required')),
        zoomAccountId: z.string().trim().min(1, t('validation.required')),
        s2sClientId: z.string().trim().min(1, t('validation.required')),
        s2sClientSecret: z.string().trim().min(1, t('validation.required')),
        // SDK credentials are optional — leave blank to use the platform-owned Meeting SDK app.
        sdkClientKey: z.string().trim().optional(),
        sdkClientSecret: z.string().trim().optional(),
        webhookVerificationToken: z.string().trim().optional(),
        setAsDefault: z.boolean().optional(),
    });
const buildEditSchema = (t: TFunction) =>
    buildCreateSchema(t).extend({
        s2sClientSecret: z.string().trim().optional(),
        sdkClientSecret: z.string().trim().optional(),
    });

type FormValues = z.infer<ReturnType<typeof buildCreateSchema>>;

export function AddZoomAccountDialog({ open, onOpenChange, mode, account, onSaved }: Props) {
    const { t } = useTranslation('settingsAddZoomAccount');
    const [submitting, setSubmitting] = useState(false);
    const [showS2sSecret, setShowS2sSecret] = useState(false);
    const [showSdkSecret, setShowSdkSecret] = useState(false);
    const [showWebhookToken, setShowWebhookToken] = useState(false);

    const createSchema = useMemo(() => buildCreateSchema(t), [t]);
    const editSchema = useMemo(() => buildEditSchema(t), [t]);

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(mode === 'create' ? createSchema : editSchema),
        defaultValues: {
            label: '',
            zoomAccountId: '',
            s2sClientId: '',
            s2sClientSecret: '',
            sdkClientKey: '',
            sdkClientSecret: '',
            webhookVerificationToken: '',
            setAsDefault: false,
        },
    });

    // Reset when the dialog opens or the target account changes.
    useEffect(() => {
        if (!open) return;
        if (mode === 'edit' && account) {
            reset({
                label: account.label,
                // Masked values aren't editable identifiers; admin must re-enter to change.
                zoomAccountId: '',
                s2sClientId: '',
                s2sClientSecret: '',
                sdkClientKey: '',
                sdkClientSecret: '',
                webhookVerificationToken: '',
                setAsDefault: account.isDefault,
            });
        } else {
            reset({
                label: '',
                zoomAccountId: '',
                s2sClientId: '',
                s2sClientSecret: '',
                sdkClientKey: '',
                sdkClientSecret: '',
                webhookVerificationToken: '',
                setAsDefault: false,
            });
        }
        setShowS2sSecret(false);
        setShowSdkSecret(false);
        setShowWebhookToken(false);
    }, [open, mode, account, reset]);

    const setAsDefault = watch('setAsDefault');

    const onSubmit = async (values: FormValues) => {
        setSubmitting(true);
        try {
            const payload = sanitize(values, mode);
            const saved =
                mode === 'create'
                    ? await createZoomAccount(payload)
                    : await updateZoomAccount(account!.id, payload);
            toast.success(
                mode === 'create' ? t('toasts.accountAdded') : t('toasts.accountUpdated')
            );
            onSaved(saved);
            onOpenChange(false);
        } catch (err: unknown) {
            console.error(err);
            toast.error(extractError(err) ?? t('toasts.saveFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    // "Test connection" on a CREATE flow requires saving first.
    const onTestConnection = async () => {
        if (mode !== 'edit' || !account) return;
        setSubmitting(true);
        try {
            const result = await testZoomConnection(account.id);
            if (result.ok) {
                const email = result.accountEmail ?? t('toasts.unknownAccount');
                toast.success(
                    result.planType
                        ? t('toasts.connectedWithPlan', { email, planType: result.planType })
                        : t('toasts.connected', { email })
                );
            } else {
                toast.error(result.error ?? t('toasts.connectionFailed'));
            }
        } catch (err) {
            toast.error(extractError(err) ?? t('toasts.connectionTestFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* Cap dialog height at 90vh and stack vertically so the form body
                scrolls while the header + footer stay pinned. */}
            <DialogContent className="flex max-h-dialog-tall w-dialog-md flex-col gap-0 p-0 sm:w-full">
                <DialogHeader className="shrink-0 border-b border-neutral-100 px-6 pb-4 pt-6">
                    <DialogTitle>
                        {mode === 'create' ? t('dialog.titleCreate') : t('dialog.titleEdit')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.description')}{' '}
                        {mode === 'edit' && (
                            <span className="text-amber-600">{t('dialog.editWarning')}</span>
                        )}
                    </DialogDescription>
                </DialogHeader>

                <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="flex min-h-0 flex-1 flex-col"
                >
                    <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-4">
                    <Field
                        label={t('fields.label.label')}
                        id="label"
                        placeholder={t('fields.label.placeholder')}
                        error={errors.label?.message}
                        {...register('label')}
                    />

                    <Section title={t('sections.s2sCredentials.title')}>
                        <Field
                            label={t('fields.zoomAccountId.label')}
                            id="zoomAccountId"
                            placeholder={mode === 'edit' && account ? account.zoomAccountIdMasked : ''}
                            error={errors.zoomAccountId?.message}
                            {...register('zoomAccountId')}
                        />
                        <Field
                            label={t('fields.s2sClientId.label')}
                            id="s2sClientId"
                            placeholder={mode === 'edit' && account ? account.s2sClientIdMasked : ''}
                            error={errors.s2sClientId?.message}
                            {...register('s2sClientId')}
                        />
                        <SecretField
                            label={t('fields.s2sClientSecret.label')}
                            id="s2sClientSecret"
                            visible={showS2sSecret}
                            onToggle={() => setShowS2sSecret((v) => !v)}
                            error={errors.s2sClientSecret?.message}
                            placeholder={mode === 'edit' ? t('fields.common.leaveBlankToKeepExisting') : ''}
                            {...register('s2sClientSecret')}
                        />
                    </Section>

                    <Section title={t('sections.sdkCredentials.title')}>
                        <p className="text-xs text-neutral-500">
                            {t('sections.sdkCredentials.description')}
                        </p>
                        <Field
                            label={t('fields.sdkClientKey.label')}
                            id="sdkClientKey"
                            placeholder={mode === 'edit' && account ? (account.sdkClientKeyMasked ?? '') : ''}
                            error={errors.sdkClientKey?.message}
                            {...register('sdkClientKey')}
                        />
                        <SecretField
                            label={t('fields.sdkClientSecret.label')}
                            id="sdkClientSecret"
                            visible={showSdkSecret}
                            onToggle={() => setShowSdkSecret((v) => !v)}
                            error={errors.sdkClientSecret?.message}
                            placeholder={mode === 'edit' ? t('fields.common.leaveBlankToKeepExisting') : ''}
                            {...register('sdkClientSecret')}
                        />
                    </Section>

                    <Section title={t('sections.webhook.title')}>
                        <SecretField
                            label={t('fields.webhookToken.label')}
                            id="webhookVerificationToken"
                            visible={showWebhookToken}
                            onToggle={() => setShowWebhookToken((v) => !v)}
                            error={errors.webhookVerificationToken?.message}
                            placeholder={t('fields.webhookToken.placeholder')}
                            {...register('webhookVerificationToken')}
                        />
                    </Section>

                    <div className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2.5">
                        <div>
                            <div className="text-sm font-medium text-neutral-800">
                                {t('setDefault.title')}
                            </div>
                            <div className="text-xs text-neutral-500">
                                {t('setDefault.description')}
                            </div>
                        </div>
                        <Switch
                            checked={Boolean(setAsDefault)}
                            onCheckedChange={(v) => setValue('setAsDefault', v, { shouldDirty: true })}
                        />
                    </div>
                    </div>

                    <DialogFooter className="shrink-0 flex-row gap-2 border-t border-neutral-100 bg-white px-6 py-4 sm:justify-between">
                        <div>
                            {mode === 'edit' && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={submitting}
                                    onClick={onTestConnection}
                                >
                                    {t('footer.testConnection')}
                                </Button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={submitting}
                                onClick={() => onOpenChange(false)}
                            >
                                {t('footer.cancel')}
                            </Button>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={submitting}
                                className="bg-primary-500 hover:bg-primary-600"
                            >
                                {submitting && (
                                    <CircleNotch className="me-2 size-4 animate-spin" />
                                )}
                                {mode === 'create' ? t('footer.addAccount') : t('footer.saveChanges')}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ── Small layout helpers (kept local — not worth promoting to design-system) ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-md border border-neutral-200 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {title}
            </div>
            <div className="grid gap-3">{children}</div>
        </div>
    );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    error?: string;
}

// forwardRef so {...register('foo')} from react-hook-form actually attaches its
// ref to the underlying input — without this the ref is dropped by React and
// RHF can't read the input's value on submit (validation always reports empty).
const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(props, ref) {
    const { label, error, id, ...rest } = props;
    return (
        <div>
            <Label htmlFor={id} className="text-xs text-neutral-600">
                {label}
            </Label>
            <Input id={id} ref={ref} {...rest} className="mt-1 h-9" />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    );
});

interface SecretFieldProps extends FieldProps {
    visible: boolean;
    onToggle: () => void;
}

const SecretField = forwardRef<HTMLInputElement, SecretFieldProps>(function SecretField(
    props,
    ref
) {
    const { t } = useTranslation('settingsAddZoomAccount');
    const { label, error, id, visible, onToggle, ...rest } = props;
    return (
        <div>
            <Label htmlFor={id} className="text-xs text-neutral-600">
                {label}
            </Label>
            <div className="relative mt-1">
                <Input
                    id={id}
                    ref={ref}
                    type={visible ? 'text' : 'password'}
                    {...noAutofillProps('password')}
                    {...rest}
                    className="h-9 pr-9"
                />
                <button
                    type="button"
                    aria-label={visible ? t('common.hide') : t('common.show')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"
                    onClick={onToggle}
                >
                    {visible ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
            </div>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    );
});

// ── Helpers ──

function sanitize(values: FormValues, mode: Mode) {
    const trimmed = (s?: string) => (s == null ? undefined : s.trim());
    const payload: Record<string, unknown> = {
        label: trimmed(values.label),
        zoomAccountId: trimmed(values.zoomAccountId),
        s2sClientId: trimmed(values.s2sClientId),
        sdkClientKey: trimmed(values.sdkClientKey),
        setAsDefault: Boolean(values.setAsDefault),
    };
    // S2S secret: required on create; omit when blank on edit (preserves existing value).
    const s2s = trimmed(values.s2sClientSecret);
    if (s2s || mode === 'create') payload.s2sClientSecret = s2s ?? '';
    // SDK secret is optional (platform-owned SDK fallback) — include only when provided, so a
    // blank value leaves the account without per-institute SDK creds (and keeps existing on edit).
    const sdk = trimmed(values.sdkClientSecret);
    if (sdk) payload.sdkClientSecret = sdk;
    // Webhook token: explicit "" means "clear it" on edit; undefined leaves alone.
    if (values.webhookVerificationToken !== undefined) {
        payload.webhookVerificationToken = trimmed(values.webhookVerificationToken) ?? '';
    }
    return payload as unknown as Parameters<typeof createZoomAccount>[0];
}

function extractError(err: unknown): string | undefined {
    if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { data?: { message?: string } } }).response;
        return resp?.data?.message;
    }
    return undefined;
}
