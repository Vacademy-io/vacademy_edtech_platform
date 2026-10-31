import type { SelectOption } from '@/components/design-system/SelectChips';
import type { OfflinePaymentModes } from '@/services/offline-payment-modes';
import type { UsedPaymentMode } from '@/services/payment-logs';

/** Joins a mode and one of its options into the filter token the API matches on. */
export const PAYMENT_MODE_TOKEN_SEPARATOR = '|';

/** "BANK_TRANSFER" → "Bank Transfer", for a mode no label was ever stored for. */
const humanizeCode = (code: string) =>
    code
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

interface ModeEntry {
    label: string;
    /** What the mode's options are called in Settings ("Account"); null = not named. */
    subLabel: string | null;
    /** Sub-option code → label, in display order. */
    subs: Map<string, string>;
}

/** One mode for the Payment Mode filter, with the options picked in the field shown after it. */
export interface PaymentModeGroup {
    /** The mode's filter token (its code) and name. */
    value: string;
    label: string;
    /** What the options are called ("Account"), from Settings; null = not named. */
    subLabel: string | null;
    /** The mode's options; `value` is the "MODE|OPTION" token the API matches on. */
    subs: { value: string; label: string }[];
}

/**
 * Modes for the Payment Mode filter: every active mode the institute set up in Settings (custom
 * ones included) in its Settings order, then any mode found on recorded payments that Settings no
 * longer offers — so a mode switched off or deleted later can still be filtered on. Each mode is
 * followed by its options ("UPI · PhonePe"), recorded-only options included. A mode option matches
 * all of its sub-options; a sub-option matches only itself.
 */
export function buildPaymentModeGroups(
    settings: OfflinePaymentModes | undefined,
    used: UsedPaymentMode[] | undefined
): PaymentModeGroup[] {
    const entries = new Map<string, ModeEntry>();
    // Labels of modes switched off in Settings, still the best name for their old payments.
    const settingsLabels = new Map<string, string>();
    const settingsSubLabels = new Map<string, string>();

    for (const mode of settings?.modes ?? []) {
        if (!mode.code) continue;
        settingsLabels.set(mode.code, mode.label);
        if (mode.sub_mode_label?.trim())
            settingsSubLabels.set(mode.code, mode.sub_mode_label.trim());
        if (!mode.active) continue;
        const subs = new Map<string, string>();
        for (const sub of mode.sub_modes ?? []) {
            if (sub.active && sub.code) subs.set(sub.code, sub.label);
        }
        entries.set(mode.code, {
            label: mode.label,
            subLabel: settingsSubLabels.get(mode.code) ?? null,
            subs,
        });
    }

    for (const row of used ?? []) {
        if (!row.mode) continue;
        let entry = entries.get(row.mode);
        if (!entry) {
            entry = {
                label: settingsLabels.get(row.mode) ?? row.mode_label ?? humanizeCode(row.mode),
                subLabel: settingsSubLabels.get(row.mode) ?? null,
                subs: new Map(),
            };
            entries.set(row.mode, entry);
        }
        if (row.sub_mode && !entry.subs.has(row.sub_mode)) {
            entry.subs.set(row.sub_mode, row.sub_mode_label || humanizeCode(row.sub_mode));
        }
    }

    return [...entries].map(([code, entry]) => ({
        value: code,
        label: entry.label,
        subLabel: entry.subLabel,
        subs: [...entry.subs].map(([subCode, subLabel]) => ({
            value: `${code}${PAYMENT_MODE_TOKEN_SEPARATOR}${subCode}`,
            label: subLabel,
        })),
    }));
}

/** Every mode and option as one flat list ("UPI", "UPI · PhonePe"), for labelling chips. */
export function buildPaymentModeOptions(
    settings: OfflinePaymentModes | undefined,
    used: UsedPaymentMode[] | undefined
): SelectOption[] {
    return flattenPaymentModeGroups(buildPaymentModeGroups(settings, used));
}

export const flattenPaymentModeGroups = (groups: PaymentModeGroup[]): SelectOption[] =>
    groups.flatMap((group) => [
        { value: group.value, label: group.label },
        ...group.subs.map((sub) => ({ value: sub.value, label: `${group.label} · ${sub.label}` })),
    ]);

export const isPaymentModeOptionToken = (token: string) =>
    token.includes(PAYMENT_MODE_TOKEN_SEPARATOR);

/**
 * What the API is sent. A mode matches all its options, so once any option of a mode is picked the
 * mode's own token is dropped — otherwise picking "Account: Pune" would still match every account.
 */
export function paymentModeFilterTokens(selected: string[]): string[] {
    const modesWithOption = new Set(
        selected
            .filter(isPaymentModeOptionToken)
            .map((token) => token.split(PAYMENT_MODE_TOKEN_SEPARATOR)[0])
    );
    return selected.filter(
        (token) => isPaymentModeOptionToken(token) || !modesWithOption.has(token)
    );
}
