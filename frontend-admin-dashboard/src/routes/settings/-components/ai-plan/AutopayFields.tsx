/**
 * Autopay method (UPI Autopay or card) and the payer mobile number that the
 * mandate registration needs. Shared by checkout and "Set up autopay".
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { AutopayMethod } from '@/services/ai-plans/storefront';

const METHODS: AutopayMethod[] = ['UPI', 'CARD'];

export function AutopayFields({
    method,
    onMethod,
    contact,
    onContact,
    error,
    disabled = false,
}: {
    method: AutopayMethod;
    onMethod: (m: AutopayMethod) => void;
    contact: string;
    onContact: (v: string) => void;
    error?: string | null;
    disabled?: boolean;
}) {
    const { t } = useTranslation('aiPlans');
    return (
        <div className="mt-3 space-y-3">
            <div
                role="radiogroup"
                aria-label={t('autopay.methodLabel')}
                className="flex flex-wrap gap-2"
            >
                {METHODS.map((m) => (
                    <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={method === m}
                        disabled={disabled}
                        onClick={() => onMethod(m)}
                        className={cn(
                            'rounded-md border px-3 py-1.5 text-caption font-medium transition-colors disabled:opacity-60',
                            method === m
                                ? 'border-primary-400 bg-primary-50 text-primary-600'
                                : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
                        )}
                    >
                        {t(`autopay.method.${m}`)}
                    </button>
                ))}
            </div>
            <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-700">
                    {t('autopay.mobile')}
                </span>
                <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={contact}
                    disabled={disabled}
                    onChange={(e) => onContact(e.target.value.slice(0, 16))}
                    placeholder="98765 43210"
                    aria-invalid={!!error}
                    className={cn(
                        'h-9 w-full rounded-md border bg-white px-3 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 sm:w-64',
                        error ? 'border-danger-300' : 'border-neutral-200'
                    )}
                />
                <span className="mt-1 block text-2xs text-neutral-500">
                    {t('autopay.mobileHint')}
                </span>
            </label>
            {error && (
                <p role="alert" className="text-xs text-danger-600">
                    {error}
                </p>
            )}
        </div>
    );
}
