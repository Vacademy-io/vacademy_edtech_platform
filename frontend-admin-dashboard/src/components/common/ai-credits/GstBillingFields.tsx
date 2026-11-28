/**
 * GST identity for a platform tax invoice: GSTIN (optional; its first two
 * digits fix the state), state / place of supply, and — for AI plans — the
 * legal name, address and billing email. Shared by the credit top-up modal
 * (GSTIN + state only, exactly as before) and the plan checkout dialog.
 *
 * Validation stays with the caller; this component only edits the values.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Receipt } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { INDIAN_GST_STATES, isValidGstin } from '@/services/ai-credits/credit-pack-services';

export interface GstBillingValue {
    gstin: string;
    stateCode: string;
    legalName: string;
    address: string;
    email: string;
}

export const EMPTY_GST_BILLING: GstBillingValue = {
    gstin: '',
    stateCode: '',
    legalName: '',
    address: '',
    email: '',
};

/** Upper-case, alphanumerics only, at most 15 characters. */
export function normalizeGstinInput(raw: string): string {
    return raw
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .slice(0, 15);
}

/** The GST state a GSTIN prefix fixes, or null while too short / unknown. */
export function stateFromGstin(gstin: string): string | null {
    if (gstin.length < 2) return null;
    const code = gstin.slice(0, 2);
    return INDIAN_GST_STATES.some((s) => s.code === code) ? code : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type GstBillingError =
    | 'gstinInvalid'
    | 'stateRequired'
    | 'legalNameRequired'
    | 'emailInvalid';

/** Plan checkout rules: valid GSTIN when given, state always, legal name always, email when given. */
export function validatePlanBilling(v: GstBillingValue): GstBillingError | null {
    const gstin = v.gstin.trim();
    if (gstin && !isValidGstin(gstin)) return 'gstinInvalid';
    if (!v.stateCode) return 'stateRequired';
    if (!v.legalName.trim()) return 'legalNameRequired';
    if (v.email.trim() && !EMAIL_RE.test(v.email.trim())) return 'emailInvalid';
    return null;
}

interface GstBillingFieldsProps {
    value: GstBillingValue;
    onChange: (patch: Partial<GstBillingValue>) => void;
    /** Message shown under the fields (already translated). */
    error?: string | null;
    /** Show legal name, address and billing email (AI plans). */
    showIdentity?: boolean;
    /** Mark the state as required (AI plans: always). */
    stateRequired?: boolean;
    /** Quiet line under the fields, e.g. "Saved from your last purchase". */
    hint?: ReactNode;
    disabled?: boolean;
}

const inputClass =
    'h-9 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-100 disabled:text-neutral-500';

export function GstBillingFields({
    value,
    onChange,
    error,
    showIdentity = false,
    stateRequired = false,
    hint,
    disabled = false,
}: GstBillingFieldsProps) {
    const { t } = useTranslation('aiPlans');

    const handleGstin = (raw: string) => {
        const gstin = normalizeGstinInput(raw);
        const state = stateFromGstin(gstin);
        onChange(state ? { gstin, stateCode: state } : { gstin });
    };

    return (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-neutral-900">{t('billing.title')}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">{t('billing.description')}</p>
                </div>
                <Receipt className="mt-0.5 size-5 shrink-0 text-neutral-400" />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {showIdentity && (
                    <label className="block sm:col-span-2">
                        <span className="mb-1 block text-xs font-medium text-neutral-700">
                            {t('billing.legalName')}
                        </span>
                        <input
                            type="text"
                            value={value.legalName}
                            disabled={disabled}
                            onChange={(e) => onChange({ legalName: e.target.value })}
                            placeholder={t('billing.legalNamePlaceholder')}
                            maxLength={200}
                            autoComplete="organization"
                            className={cn(inputClass, 'border-neutral-200')}
                        />
                    </label>
                )}
                <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-700">
                        {t('billing.gstin')}{' '}
                        <span className="font-normal text-neutral-400">
                            {t('billing.optional')}
                        </span>
                    </span>
                    <input
                        type="text"
                        inputMode="text"
                        autoCapitalize="characters"
                        spellCheck={false}
                        value={value.gstin}
                        disabled={disabled}
                        onChange={(e) => handleGstin(e.target.value)}
                        placeholder="27AAAAA0000A1Z5"
                        maxLength={15}
                        aria-invalid={!!error}
                        className={cn(
                            inputClass,
                            'font-mono tracking-wide placeholder:font-sans placeholder:tracking-normal',
                            error ? 'border-danger-300' : 'border-neutral-200'
                        )}
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-700">
                        {t('billing.state')}{' '}
                        <span className="font-normal text-neutral-400">
                            {stateRequired
                                ? t('billing.placeOfSupplyRequired')
                                : t('billing.placeOfSupply')}
                        </span>
                    </span>
                    <select
                        value={value.stateCode}
                        disabled={disabled || value.gstin.length >= 2}
                        required={stateRequired}
                        onChange={(e) => onChange({ stateCode: e.target.value })}
                        className={cn(inputClass, 'border-neutral-200 px-2.5')}
                    >
                        <option value="">{t('billing.selectState')}</option>
                        {INDIAN_GST_STATES.map((s) => (
                            <option key={s.code} value={s.code}>
                                {s.name} ({s.code})
                            </option>
                        ))}
                    </select>
                </label>
                {showIdentity && (
                    <>
                        <label className="block sm:col-span-2">
                            <span className="mb-1 block text-xs font-medium text-neutral-700">
                                {t('billing.address')}{' '}
                                <span className="font-normal text-neutral-400">
                                    {t('billing.optional')}
                                </span>
                            </span>
                            <textarea
                                value={value.address}
                                disabled={disabled}
                                onChange={(e) => onChange({ address: e.target.value })}
                                rows={2}
                                maxLength={500}
                                autoComplete="street-address"
                                className={cn(inputClass, 'h-auto border-neutral-200 py-2')}
                            />
                        </label>
                        <label className="block sm:col-span-2">
                            <span className="mb-1 block text-xs font-medium text-neutral-700">
                                {t('billing.email')}{' '}
                                <span className="font-normal text-neutral-400">
                                    {t('billing.optional')}
                                </span>
                            </span>
                            <input
                                type="email"
                                value={value.email}
                                disabled={disabled}
                                onChange={(e) => onChange({ email: e.target.value })}
                                placeholder={t('billing.emailPlaceholder')}
                                maxLength={254}
                                autoComplete="email"
                                className={cn(inputClass, 'border-neutral-200')}
                            />
                        </label>
                    </>
                )}
            </div>
            {error && (
                <p role="alert" className="mt-2 text-xs text-danger-600">
                    {error}
                </p>
            )}
            {!error && hint && <p className="mt-2 text-2xs text-neutral-400">{hint}</p>}
        </div>
    );
}
