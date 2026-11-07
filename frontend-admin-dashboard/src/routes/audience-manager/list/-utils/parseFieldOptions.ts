/**
 * Option-list parsing for custom fields.
 *
 * A choice field's options live in `custom_fields.config`, and three shapes are
 * in the wild:
 *
 *   1. The current builder writes a JSON array: `[{"id":1,"value":"A","label":"A"}]`
 *   2. Older rows hold `{"coommaSepartedOptions":"A,B,C"}` (the misspelling is real
 *      and is what is stored — do not "fix" it without a data migration)
 *   3. The oldest rows hold a bare `"A,B,C"` string
 *
 * Naively comma-splitting shape 1 turns a 4-option question into a dozen
 * checkboxes labelled `[{"id":1`, `"value":"A"`, … — and, worse, re-saving the
 * form persists those fragments as the field's real options. Always parse
 * through here.
 */

/** Field types that carry an option list. Add new choice types here. */
export const OPTION_FIELD_TYPES = [
    'dropdown',
    'select',
    'radio',
    'multi_select',
    'multiselect',
] as const;

export const isOptionFieldType = (type?: string | null): boolean =>
    OPTION_FIELD_TYPES.includes(
        (type ?? '').toString().toLowerCase().trim() as (typeof OPTION_FIELD_TYPES)[number]
    );

const splitCsv = (value: string): string[] =>
    value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

const optionValueOf = (option: unknown): string => {
    if (typeof option === 'string' || typeof option === 'number') return String(option);
    if (option && typeof option === 'object') {
        const record = option as Record<string, unknown>;
        const value = record.value ?? record.label ?? record.name;
        return value === undefined || value === null ? '' : String(value);
    }
    return '';
};

const fromParsed = (parsed: unknown): string[] => {
    if (Array.isArray(parsed)) {
        return parsed
            .map(optionValueOf)
            .map((value) => value.trim())
            .filter(Boolean);
    }

    if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record.options)) return fromParsed(record.options);
        const legacy = record.coommaSepartedOptions ?? record.commaSeparatedOptions;
        if (typeof legacy === 'string') return splitCsv(legacy);
    }

    return [];
};

/** Every option label held in `config`, whichever of the three shapes it uses. */
export const parseFieldOptions = (config?: string | null): string[] => {
    if (!config) return [];
    const raw = typeof config === 'string' ? config.trim() : '';
    if (!raw) return [];

    try {
        return fromParsed(JSON.parse(raw));
    } catch {
        // Not JSON — the legacy bare "A,B,C" shape.
        return splitCsv(raw);
    }
};

/**
 * True when `config` is an option list rather than field settings
 * (`{"helpText":…}`, `{"maxSizeMB":5}`, …).
 *
 * Used when a field's type changes away from a choice type: the stale option
 * blob has to go, but a settings object belonging to the new type must not.
 */
export const configHoldsOptions = (config?: string | null): boolean => {
    if (!config) return false;
    const raw = typeof config === 'string' ? config.trim() : '';
    if (!raw) return false;

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return true;
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            return (
                Array.isArray(record.options) ||
                typeof record.coommaSepartedOptions === 'string' ||
                typeof record.commaSeparatedOptions === 'string'
            );
        }
        return false;
    } catch {
        return raw.includes(',');
    }
};

/**
 * Options with the parent value each one belongs to. A dependent (cascading)
 * dropdown stores `{"options":[{"value":"PDF Query","parent":"Banking"}, …],
 * "parentFieldKey":"…"}`; an option without `parent` shows for every parent
 * value. Every other shape carries no parents and reads exactly as
 * `parseFieldOptions` does.
 */
const parseOptionEntries = (config?: string | null): Array<{ value: string; parent?: string }> => {
    const raw = typeof config === 'string' ? config.trim() : '';
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === 'object' && Array.isArray(parsed.options)
              ? (parsed.options as unknown[])
              : null;
        if (list) {
            return list
                .map((option) => {
                    const parent =
                        option && typeof option === 'object'
                            ? (option as Record<string, unknown>).parent
                            : undefined;
                    return {
                        value: optionValueOf(option).trim(),
                        ...(typeof parent === 'string' && parent.trim()
                            ? { parent: parent.trim() }
                            : {}),
                    };
                })
                .filter((entry) => entry.value);
        }
    } catch {
        // Not JSON — handled by the legacy path below.
    }
    return parseFieldOptions(config).map((value) => ({ value }));
};

/** Options shaped for the campaign form's field array. */
export const parseFieldOptionsForForm = (
    config: string | null | undefined,
    idPrefix: string | number,
    disabled = true
): Array<{ id: string; value: string; parent?: string; disabled?: boolean }> | undefined => {
    const entries = parseOptionEntries(config);
    if (entries.length === 0) return undefined;
    return entries.map(({ value, parent }, index) => ({
        id: `${idPrefix}_opt_${index}`,
        value,
        ...(parent ? { parent } : {}),
        ...(disabled ? { disabled: true } : {}),
    }));
};
