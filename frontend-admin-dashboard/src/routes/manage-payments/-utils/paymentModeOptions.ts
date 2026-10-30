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
    /** Sub-option code → label, in display order. */
    subs: Map<string, string>;
}

/**
 * Options for the Payment Mode filter: every active mode the institute set up in Settings (custom
 * ones included) in its Settings order, then any mode found on recorded payments that Settings no
 * longer offers — so a mode switched off or deleted later can still be filtered on. Each mode is
 * followed by its options ("UPI · PhonePe"), recorded-only options included. A mode option matches
 * all of its sub-options; a sub-option matches only itself.
 */
export function buildPaymentModeOptions(
    settings: OfflinePaymentModes | undefined,
    used: UsedPaymentMode[] | undefined
): SelectOption[] {
    const entries = new Map<string, ModeEntry>();
    // Labels of modes switched off in Settings, still the best name for their old payments.
    const settingsLabels = new Map<string, string>();

    for (const mode of settings?.modes ?? []) {
        if (!mode.code) continue;
        settingsLabels.set(mode.code, mode.label);
        if (!mode.active) continue;
        const subs = new Map<string, string>();
        for (const sub of mode.sub_modes ?? []) {
            if (sub.active && sub.code) subs.set(sub.code, sub.label);
        }
        entries.set(mode.code, { label: mode.label, subs });
    }

    for (const row of used ?? []) {
        if (!row.mode) continue;
        let entry = entries.get(row.mode);
        if (!entry) {
            entry = {
                label: settingsLabels.get(row.mode) ?? row.mode_label ?? humanizeCode(row.mode),
                subs: new Map(),
            };
            entries.set(row.mode, entry);
        }
        if (row.sub_mode && !entry.subs.has(row.sub_mode)) {
            entry.subs.set(row.sub_mode, row.sub_mode_label || humanizeCode(row.sub_mode));
        }
    }

    const options: SelectOption[] = [];
    for (const [code, entry] of entries) {
        options.push({ value: code, label: entry.label });
        for (const [subCode, subLabel] of entry.subs) {
            options.push({
                value: `${code}${PAYMENT_MODE_TOKEN_SEPARATOR}${subCode}`,
                label: `${entry.label} · ${subLabel}`,
            });
        }
    }
    return options;
}
