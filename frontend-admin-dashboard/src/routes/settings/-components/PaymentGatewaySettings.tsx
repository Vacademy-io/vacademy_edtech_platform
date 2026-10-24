import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowsClockwise,
    CheckCircle,
    CircleNotch,
    Copy,
    CreditCard,
    Eye,
    EyeSlash,
    Info,
    PencilSimple,
    Plus,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { BACKEND_BASE_URL } from '@/config/baseUrl';
import { noAutofillProps } from '@/lib/no-autofill';
import {
    PaymentGatewayMapping,
    PaymentVendor,
    SECRET_MASK_PREFIX,
    createPaymentGateway,
    deactivatePaymentGateway,
    isMaskedSecret,
    listPaymentGateways,
    updatePaymentGateway,
} from '../-services/payment-gateway-service';
import { resolveGatewayBranding } from '../-constants/payment-gateway-branding';

// ─── Vendor schemas ──────────────────────────────────────────────────────────
// What the backend's per-vendor payment manager expects to find in
// `payment_gateway_specific_data`. The `secret` flag controls whether the
// field is rendered as a password input and whether masked values coming back
// from the server are treated as "leave unchanged" on submit.
//
// NOTE ON I18N: `label`, `description`, `placeholder`, `helper` and the
// `setupSteps` entries below hold i18next KEY PATHS (relative to the
// `settingsPaymentGateway` namespace) rather than literal English text — this
// is module-scope config, not a component, so it can't call `t()` reactively.
// Every call site resolves them with `t(...)` at render time.

interface VendorFieldSchema {
    key: string;
    label: string;
    placeholder?: string;
    secret?: boolean;
    required?: boolean;
    helper?: string;
}

interface VendorSchema {
    vendor: PaymentVendor;
    label: string;
    description: string;
    docsUrl?: string;
    /**
     * Optional ordered "where to find your keys" walkthrough shown above the
     * fields. Use for gateways whose credentials are buried in a dashboard.
     */
    setupSteps?: string[];
    fields: VendorFieldSchema[];
    /**
     * Returns the webhook URL the admin must paste into the vendor's dashboard.
     * Omit (undefined) for vendors that don't use webhooks (e.g. Eway, which polls).
     * Stripe and Razorpay don't need the instituteId in the URL because the
     * backend extracts it from the payload metadata.
     */
    webhookUrl?: (instituteId: string) => string;
}

const WEBHOOK_BASE = `${BACKEND_BASE_URL}/admin-core-service/payments/webhook/callback`;

const VENDOR_SCHEMAS: VendorSchema[] = [
    {
        vendor: 'STRIPE',
        label: 'vendors.stripe.label',
        description: 'vendors.stripe.description',
        docsUrl: 'https://dashboard.stripe.com/apikeys',
        fields: [
            {
                key: 'apiKey',
                label: 'vendors.stripe.fields.apiKey.label',
                placeholder: 'vendors.stripe.fields.apiKey.placeholder',
                secret: true,
                required: true,
                helper: 'vendors.stripe.fields.apiKey.helper',
            },
            {
                key: 'publishableKey',
                label: 'vendors.stripe.fields.publishableKey.label',
                placeholder: 'vendors.stripe.fields.publishableKey.placeholder',
                secret: true,
                required: true,
                helper: 'vendors.stripe.fields.publishableKey.helper',
            },
            {
                key: 'webhookSecret',
                label: 'vendors.stripe.fields.webhookSecret.label',
                placeholder: 'vendors.stripe.fields.webhookSecret.placeholder',
                secret: true,
                helper: 'vendors.stripe.fields.webhookSecret.helper',
            },
        ],
        webhookUrl: () => `${WEBHOOK_BASE}/stripe`,
    },
    {
        vendor: 'RAZORPAY',
        label: 'vendors.razorpay.label',
        description: 'vendors.razorpay.description',
        docsUrl: 'https://dashboard.razorpay.com/app/keys',
        fields: [
            {
                key: 'keyId',
                label: 'vendors.razorpay.fields.keyId.label',
                placeholder: 'vendors.razorpay.fields.keyId.placeholder',
                required: true,
                helper: 'vendors.razorpay.fields.keyId.helper',
            },
            {
                key: 'keySecret',
                label: 'vendors.razorpay.fields.keySecret.label',
                placeholder: 'vendors.razorpay.fields.keySecret.placeholder',
                secret: true,
                required: true,
            },
            {
                key: 'webhookSecret',
                label: 'vendors.razorpay.fields.webhookSecret.label',
                placeholder: 'vendors.razorpay.fields.webhookSecret.placeholder',
                secret: true,
                helper: 'vendors.razorpay.fields.webhookSecret.helper',
            },
        ],
        webhookUrl: () => `${WEBHOOK_BASE}/razorpay`,
    },
    {
        vendor: 'PHONEPE',
        label: 'vendors.phonepe.label',
        description: 'vendors.phonepe.description',
        docsUrl: 'https://business.phonepe.com/',
        setupSteps: [
            'vendors.phonepe.setupSteps.step1',
            'vendors.phonepe.setupSteps.step2',
            'vendors.phonepe.setupSteps.step3',
            'vendors.phonepe.setupSteps.step4',
            'vendors.phonepe.setupSteps.step5',
        ],
        fields: [
            {
                key: 'clientId',
                label: 'vendors.phonepe.fields.clientId.label',
                placeholder: 'vendors.phonepe.fields.clientId.placeholder',
                required: true,
                helper: 'vendors.phonepe.fields.clientId.helper',
            },
            {
                key: 'clientSecret',
                label: 'vendors.phonepe.fields.clientSecret.label',
                placeholder: 'vendors.phonepe.fields.clientSecret.placeholder',
                secret: true,
                required: true,
                helper: 'vendors.phonepe.fields.clientSecret.helper',
            },
            {
                key: 'clientVersion',
                label: 'vendors.phonepe.fields.clientVersion.label',
                placeholder: 'vendors.phonepe.fields.clientVersion.placeholder',
                helper: 'vendors.phonepe.fields.clientVersion.helper',
            },
            {
                key: 'baseUrl',
                label: 'vendors.phonepe.fields.baseUrl.label',
                placeholder: 'vendors.phonepe.fields.baseUrl.placeholder',
                required: true,
                helper: 'vendors.phonepe.fields.baseUrl.helper',
            },
            {
                key: 'webhookUsername',
                label: 'vendors.phonepe.fields.webhookUsername.label',
                placeholder: 'vendors.phonepe.fields.webhookUsername.placeholder',
                helper: 'vendors.phonepe.fields.webhookUsername.helper',
            },
            {
                key: 'webhookPassword',
                label: 'vendors.phonepe.fields.webhookPassword.label',
                placeholder: 'vendors.phonepe.fields.webhookPassword.placeholder',
                secret: true,
                helper: 'vendors.phonepe.fields.webhookPassword.helper',
            },
        ],
        webhookUrl: (instituteId) =>
            `${WEBHOOK_BASE}/phonepe?instituteId=${instituteId}`,
    },
    {
        vendor: 'CASHFREE',
        label: 'vendors.cashfree.label',
        description: 'vendors.cashfree.description',
        fields: [
            {
                key: 'clientId',
                label: 'vendors.cashfree.fields.clientId.label',
                placeholder: 'vendors.cashfree.fields.clientId.placeholder',
                required: true,
            },
            {
                key: 'clientSecret',
                label: 'vendors.cashfree.fields.clientSecret.label',
                secret: true,
                required: true,
            },
            {
                key: 'baseUrl',
                label: 'vendors.cashfree.fields.baseUrl.label',
                placeholder: 'vendors.cashfree.fields.baseUrl.placeholder',
                required: true,
            },
        ],
        webhookUrl: (instituteId) =>
            `${WEBHOOK_BASE}/cashfree?instituteId=${instituteId}`,
    },
    {
        vendor: 'EWAY',
        label: 'vendors.eway.label',
        description: 'vendors.eway.description',
        fields: [
            {
                key: 'apiKey',
                label: 'vendors.eway.fields.apiKey.label',
                secret: true,
                required: true,
            },
            {
                key: 'password',
                label: 'vendors.eway.fields.password.label',
                secret: true,
                required: true,
            },
            {
                key: 'publicKey',
                label: 'vendors.eway.fields.publicKey.label',
                helper: 'vendors.eway.fields.publicKey.helper',
            },
            {
                key: 'encryptionKey',
                label: 'vendors.eway.fields.encryptionKey.label',
                secret: true,
            },
            {
                key: 'baseUrl',
                label: 'vendors.eway.fields.baseUrl.label',
                placeholder: 'vendors.eway.fields.baseUrl.placeholder',
                required: true,
            },
        ],
    },
];

const findSchema = (vendor: string): VendorSchema | undefined =>
    VENDOR_SCHEMAS.find((s) => s.vendor === vendor);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Delegates to the shared gateway branding so the settings list and the payments screens render the
// same badge for a vendor (single source of truth in `payment-gateway-branding`).
const vendorBadgeClass = (vendor: string): string => resolveGatewayBranding(vendor).badgeClass;

const StatusBadge = ({ status }: { status: string }) => {
    const { t } = useTranslation('settingsPaymentGateway');
    return status === 'ACTIVE' ? (
        <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <CheckCircle className="size-3" />
            {t('status.active')}
        </Badge>
    ) : (
        <Badge variant="secondary" className="gap-1">
            <WarningCircle className="size-3" />
            {t('status.inactive')}
        </Badge>
    );
};

// ─── Add/Edit Dialog ─────────────────────────────────────────────────────────

interface GatewayDialogProps {
    open: boolean;
    mode: 'create' | 'edit';
    initial?: PaymentGatewayMapping;
    existingVendors: PaymentVendor[];
    onClose: () => void;
    onSaved: () => void;
}

const GatewayDialog = ({
    open,
    mode,
    initial,
    existingVendors,
    onClose,
    onSaved,
}: GatewayDialogProps) => {
    const { t } = useTranslation('settingsPaymentGateway');
    const instituteId = getInstituteId();
    const [vendor, setVendor] = useState<PaymentVendor | ''>('');
    const [values, setValues] = useState<Record<string, string>>({});
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});
    const [saving, setSaving] = useState(false);

    // Available vendors in the dropdown — hide ones already configured (on create only).
    const availableSchemas = useMemo(() => {
        if (mode === 'edit') return VENDOR_SCHEMAS;
        return VENDOR_SCHEMAS.filter((s) => !existingVendors.includes(s.vendor));
    }, [existingVendors, mode]);

    const schema = vendor ? findSchema(vendor) : undefined;

    useEffect(() => {
        if (!open) return;
        if (mode === 'edit' && initial) {
            setVendor(initial.vendor);
            // Pre-fill with whatever the backend returned (secrets come back masked).
            const next: Record<string, string> = {};
            const s = findSchema(initial.vendor);
            s?.fields.forEach((f) => {
                const raw = initial.payment_gateway_specific_data?.[f.key];
                next[f.key] = raw == null ? '' : String(raw);
            });
            setValues(next);
        } else {
            setVendor('');
            setValues({});
        }
        setRevealed({});
    }, [open, mode, initial]);

    const updateField = (key: string, value: string) => {
        setValues((prev) => ({ ...prev, [key]: value }));
    };

    const handleVendorChange = (next: PaymentVendor) => {
        setVendor(next);
        const blank: Record<string, string> = {};
        findSchema(next)?.fields.forEach((f) => {
            blank[f.key] = '';
        });
        setValues(blank);
        setRevealed({});
    };

    const handleSave = async () => {
        if (!instituteId) {
            toast.error(t('toast.noInstituteSelected'));
            return;
        }
        if (!schema) {
            toast.error(t('toast.selectVendor'));
            return;
        }

        // Validate required fields. For edit-mode, a masked value (••••1234)
        // counts as "field is filled" — the backend will preserve the secret.
        const missing = schema.fields
            .filter((f) => {
                if (!f.required) return false;
                const v = values[f.key] ?? '';
                if (v.trim() === '') return true;
                // Empty mask (no last-4) means no real secret was ever stored — reject.
                if (f.secret && v === SECRET_MASK_PREFIX) return true;
                return false;
            })
            .map((f) => t(f.label));
        if (missing.length > 0) {
            toast.error(t('toast.missingRequiredFields', { fields: missing.join(', ') }));
            return;
        }

        // Build the payload. On EDIT, any secret field still showing the
        // masked placeholder is dropped from the body so the backend keeps
        // the previously stored value.
        const data: Record<string, unknown> = {};
        for (const f of schema.fields) {
            const v = values[f.key];
            if (v == null || v === '') continue;
            if (mode === 'edit' && f.secret && isMaskedSecret(v)) continue;
            data[f.key] = v;
        }

        setSaving(true);
        try {
            if (mode === 'create') {
                await createPaymentGateway(instituteId, {
                    vendor: schema.vendor,
                    payment_gateway_specific_data: data,
                });
                toast.success(t('toast.gatewayConfigured', { vendor: t(schema.label) }));
            } else if (initial) {
                await updatePaymentGateway(instituteId, initial.id, {
                    payment_gateway_specific_data: data,
                });
                toast.success(t('toast.gatewayUpdated', { vendor: t(schema.label) }));
            }
            onSaved();
            onClose();
        } catch (err: unknown) {
            const fallback = t('toast.saveFailed');
            const errorMessage =
                (err as { response?: { data?: { message?: string } | string } })
                    ?.response?.data;
            const msg =
                typeof errorMessage === 'string'
                    ? errorMessage
                    : (errorMessage as { message?: string })?.message ?? fallback;
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-screen w-full overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {mode === 'create'
                            ? t('dialog.createTitle')
                            : t('dialog.editTitle', {
                                  vendor: schema?.label ? t(schema.label) : '',
                              })}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'create'
                            ? t('dialog.createDescription')
                            : t('dialog.editDescription')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Vendor picker */}
                    {mode === 'create' ? (
                        <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">{t('dialog.vendorLabel')}</Label>
                            <Select
                                value={vendor}
                                onValueChange={(v) => handleVendorChange(v as PaymentVendor)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('dialog.vendorPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableSchemas.length === 0 ? (
                                        <div className="px-3 py-2 text-sm text-slate-500">
                                            {t('dialog.allConfigured')}
                                        </div>
                                    ) : (
                                        availableSchemas.map((s) => (
                                            <SelectItem key={s.vendor} value={s.vendor}>
                                                {t(s.label)}
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className={vendorBadgeClass(vendor || '')}>
                                {schema && t(schema.label)}
                            </Badge>
                            <span className="text-xs text-slate-500">
                                {schema && t(schema.description)}
                            </span>
                        </div>
                    )}

                    {/* Helper text */}
                    {schema?.docsUrl && (
                        <Alert className="border-blue-100 bg-blue-50">
                            <Info className="size-4 text-blue-600" />
                            <AlertDescription className="text-sm text-blue-700">
                                {t('dialog.findValuesPrefix')}{' '}
                                <a
                                    href={schema.docsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline hover:no-underline"
                                >
                                    {t('dialog.dashboardLinkText', { vendor: t(schema.label) })}
                                </a>
                                {t('dialog.findValuesSuffix')}
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Where-to-find-your-keys walkthrough */}
                    {schema?.setupSteps && schema.setupSteps.length > 0 && (
                        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <Label className="text-caption font-medium text-slate-600">
                                {t('dialog.whereToFind')}
                            </Label>
                            <ol className="ml-4 list-decimal space-y-1.5 text-caption leading-relaxed text-slate-600">
                                {schema.setupSteps.map((step, i) => (
                                    <li key={i} className="pl-1">
                                        {t(step)}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {/* Webhook URL — paste into the vendor's webhooks page */}
                    {schema?.webhookUrl && instituteId && (
                        <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <Label className="text-caption font-medium text-slate-600">
                                    {t('dialog.webhookUrlLabel', { vendor: t(schema.label) })}
                                </Label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const url = schema.webhookUrl!(instituteId);
                                        navigator.clipboard.writeText(url);
                                        toast.success(t('toast.webhookUrlCopied'));
                                    }}
                                    className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                                    title={t('dialog.copyUrl')}
                                >
                                    <Copy className="size-4" />
                                </button>
                            </div>
                            <code className="block break-all rounded border border-slate-200 bg-white px-2 py-1.5 text-caption font-mono text-slate-700">
                                {schema.webhookUrl(instituteId)}
                            </code>
                        </div>
                    )}

                    {/* Dynamic fields */}
                    {schema?.fields.map((f) => {
                        const isSecret = !!f.secret;
                        const show = revealed[f.key] === true;
                        const value = values[f.key] ?? '';
                        return (
                            <div key={f.key} className="space-y-1">
                                <Label className="text-xs text-slate-500">
                                    {t(f.label)}
                                    {f.required && <span className="ml-0.5 text-red-500">*</span>}
                                </Label>
                                <div className="relative">
                                    <Input
                                        type={isSecret && !show ? 'password' : 'text'}
                                        value={value}
                                        onChange={(e) => updateField(f.key, e.target.value)}
                                        placeholder={f.placeholder ? t(f.placeholder) : undefined}
                                        className={isSecret ? 'pr-10' : undefined}
                                        // Gateway keys and the webhook username/password
                                        // are the PROVIDER's credentials — `off` alone
                                        // does not stop Chrome offering the admin's own.
                                        {...noAutofillProps(isSecret ? 'password' : 'text')}
                                    />
                                    {isSecret && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setRevealed((prev) => ({
                                                    ...prev,
                                                    [f.key]: !prev[f.key],
                                                }))
                                            }
                                            className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-400 hover:text-slate-600"
                                            title={show ? t('dialog.hide') : t('dialog.show')}
                                        >
                                            {show ? (
                                                <EyeSlash className="size-4" />
                                            ) : (
                                                <Eye className="size-4" />
                                            )}
                                        </button>
                                    )}
                                </div>
                                {f.helper && (
                                    <p className="text-caption text-slate-400">{t(f.helper)}</p>
                                )}
                                {mode === 'edit' && isSecret && isMaskedSecret(value) && (
                                    <p className="text-caption text-amber-600">
                                        {t('dialog.maskedValueNote')}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>

                <DialogFooter className="gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={onClose}
                        disable={saving}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={handleSave}
                        disable={saving || !schema}
                    >
                        {saving ? (
                            <>
                                <CircleNotch className="mr-2 size-4 animate-spin" />
                                {t('dialog.saving')}
                            </>
                        ) : mode === 'create' ? (
                            t('dialog.addGatewayButton')
                        ) : (
                            t('dialog.saveChanges')
                        )}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// ─── Mapping card (one row in the list) ───────────────────────────────────────

interface MappingCardProps {
    mapping: PaymentGatewayMapping;
    onEdit: () => void;
    onDelete: () => void;
}

const MappingCard = ({ mapping, onEdit, onDelete }: MappingCardProps) => {
    const { t } = useTranslation('settingsPaymentGateway');
    const schema = findSchema(mapping.vendor);
    const fields = schema?.fields ?? [];

    return (
        <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                    <Badge variant="outline" className={vendorBadgeClass(mapping.vendor)}>
                        {schema ? t(schema.label) : mapping.vendor}
                    </Badge>
                    <StatusBadge status={mapping.status} />
                    <span className="hidden truncate text-xs text-slate-500 sm:inline">
                        {schema && t(schema.description)}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={onEdit}
                        className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        title={t('mappingCard.editCredentials')}
                    >
                        <PencilSimple className="size-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title={t('mappingCard.deactivateGateway')}
                    >
                        <Trash className="size-4" />
                    </button>
                </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {fields.length === 0 ? (
                        <p className="text-xs italic text-slate-400">
                            {t('mappingCard.unknownVendor')}
                        </p>
                    ) : (
                        fields.map((f) => {
                            const raw = mapping.payment_gateway_specific_data?.[f.key];
                            const display =
                                raw == null || raw === ''
                                    ? <span className="italic text-slate-400">{t('mappingCard.notSet')}</span>
                                    : <span className="font-mono">{String(raw)}</span>;
                            return (
                                <div
                                    key={f.key}
                                    className="flex items-center justify-between gap-2 text-xs"
                                >
                                    <span className="shrink-0 text-slate-500">{t(f.label)}</span>
                                    <span className="truncate text-right text-slate-700">
                                        {display}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>

                {schema?.webhookUrl && (
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-caption font-medium text-slate-500">
                                {t('mappingCard.webhookUrlLabel')}
                            </p>
                            <code className="block truncate text-caption font-mono text-slate-700">
                                {schema.webhookUrl(mapping.institute_id)}
                            </code>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                navigator.clipboard.writeText(
                                    schema.webhookUrl!(mapping.institute_id)
                                );
                                toast.success(t('toast.webhookUrlCopied'));
                            }}
                            className="shrink-0 rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                            title={t('mappingCard.copyWebhookUrl')}
                        >
                            <Copy className="size-4" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PaymentGatewaySettings(_props: { isTab?: boolean }) {
    void _props;
    const { t } = useTranslation('settingsPaymentGateway');
    const instituteId = getInstituteId();
    const [mappings, setMappings] = useState<PaymentGatewayMapping[]>([]);
    const [loading, setLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
    const [editing, setEditing] = useState<PaymentGatewayMapping | undefined>();
    const [confirmDelete, setConfirmDelete] = useState<PaymentGatewayMapping | undefined>();
    const [deleting, setDeleting] = useState(false);

    const fetchMappings = async () => {
        if (!instituteId) return;
        setLoading(true);
        try {
            const data = await listPaymentGateways(instituteId);
            setMappings(data);
        } catch (err) {
            console.error('[PaymentGateways] Failed to load', err);
            toast.error(t('toast.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (instituteId) fetchMappings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instituteId]);

    const existingVendors = useMemo(
        () =>
            mappings
                .filter((m) => m.status === 'ACTIVE')
                .map((m) => m.vendor as PaymentVendor),
        [mappings]
    );

    const openCreate = () => {
        setDialogMode('create');
        setEditing(undefined);
        setDialogOpen(true);
    };

    const openEdit = (m: PaymentGatewayMapping) => {
        setDialogMode('edit');
        setEditing(m);
        setDialogOpen(true);
    };

    const handleDelete = async () => {
        if (!instituteId || !confirmDelete) return;
        setDeleting(true);
        try {
            await deactivatePaymentGateway(instituteId, confirmDelete.id);
            const vendorLabel = findSchema(confirmDelete.vendor)?.label;
            const vendorName = vendorLabel ? t(vendorLabel) : confirmDelete.vendor;
            toast.success(t('toast.gatewayDeactivated', { vendor: vendorName }));
            setConfirmDelete(undefined);
            fetchMappings();
        } catch (err) {
            console.error('[PaymentGateways] Failed to deactivate', err);
            toast.error(t('toast.deactivateFailed'));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="max-w-3xl space-y-6">
            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <CreditCard className="size-5 text-blue-600" />
                                {t('header.title')}
                            </CardTitle>
                            <CardDescription>{t('header.description')}</CardDescription>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={fetchMappings}
                                disabled={loading}
                                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                                title={t('header.refresh')}
                            >
                                <ArrowsClockwise className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={openCreate}
                            >
                                <Plus className="mr-1 size-4" />
                                {t('header.addGateway')}
                            </MyButton>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {/* List */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t('list.title')}</CardTitle>
                    <CardDescription>
                        {t('list.descriptionPre')} <strong>{t('list.descriptionEdit')}</strong>{' '}
                        {t('list.descriptionPost')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {loading && mappings.length === 0 ? (
                        <div className="flex items-center justify-center py-10 text-slate-400">
                            <CircleNotch className="mr-2 size-4 animate-spin" />
                            {t('list.loading')}
                        </div>
                    ) : mappings.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-4 py-10 text-center">
                            <CreditCard className="size-8 text-slate-300" />
                            <p className="text-sm font-medium text-slate-600">
                                {t('list.emptyTitle')}
                            </p>
                            <p className="max-w-md text-xs text-slate-500">
                                {t('list.emptyDescription')}
                            </p>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="default"
                                onClick={openCreate}
                            >
                                <Plus className="mr-1 size-4" />
                                {t('list.addFirstGateway')}
                            </MyButton>
                        </div>
                    ) : (
                        mappings.map((m) => (
                            <MappingCard
                                key={m.id}
                                mapping={m}
                                onEdit={() => openEdit(m)}
                                onDelete={() => setConfirmDelete(m)}
                            />
                        ))
                    )}
                </CardContent>
            </Card>

            {/* Add/Edit dialog */}
            <GatewayDialog
                open={dialogOpen}
                mode={dialogMode}
                initial={editing}
                existingVendors={existingVendors}
                onClose={() => setDialogOpen(false)}
                onSaved={fetchMappings}
            />

            {/* Delete confirm */}
            <Dialog
                open={!!confirmDelete}
                onOpenChange={(o) => !o && setConfirmDelete(undefined)}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
                        <DialogDescription>
                            {confirmDelete &&
                                t('deleteDialog.description', {
                                    vendor:
                                        (() => {
                                            const vendorLabel = findSchema(confirmDelete.vendor)?.label;
                                            return vendorLabel ? t(vendorLabel) : confirmDelete.vendor;
                                        })(),
                                })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            onClick={() => setConfirmDelete(undefined)}
                            disable={deleting}
                        >
                            {t('deleteDialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            onClick={handleDelete}
                            disable={deleting}
                        >
                            {deleting ? (
                                <>
                                    <CircleNotch className="mr-2 size-4 animate-spin" />
                                    {t('deleteDialog.deactivating')}
                                </>
                            ) : (
                                t('deleteDialog.deactivate')
                            )}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
