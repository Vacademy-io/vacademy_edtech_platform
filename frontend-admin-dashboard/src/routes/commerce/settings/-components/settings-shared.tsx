import { Info } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { GST_STATE_CODES } from '@/routes/commerce/-shared/gstin';
import type { CommerceSelectOption } from '@/routes/commerce/-components/CommerceFormFields';

/** "08 · Rajasthan" options for a GST state select, in the current language. */
export const stateOptions = (t: TFunction): CommerceSelectOption[] =>
    GST_STATE_CODES.map((code) => ({
        value: code,
        label: `${code} · ${t(`states.${code}`)}`,
    }));

/**
 * The standing note on every tax screen (setup checklist item 4): rates, HSN
 * codes and the slab basis come from the seller's CA; nothing is pre-filled.
 */
export const CaBanner = ({ text }: { text: string }) => (
    <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-neutral-600">
        <Info size={16} className="mt-0.5 shrink-0 text-warning-600" />
        <span>{text}</span>
    </div>
);

export const settingsBackLink = (t: TFunction) => ({
    to: '/commerce/settings',
    label: t('settings.back'),
});
