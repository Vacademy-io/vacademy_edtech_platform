import type { TFunction } from 'i18next';

/**
 * i18next context for the wording of a range: a key such as `emptyDay.title` reads "No activity
 * on this day", and its sibling `emptyDay.title_range` "No activity in this period". A key with
 * no `_range` sibling reads the same for both.
 */
export const RANGE_CONTEXT = 'range';

/**
 * `t` that picks the range wording when the report covers more than one day. Everything it is
 * given (counts, values, default text) passes through unchanged.
 */
export const rangeT = (t: TFunction, range: boolean): TFunction => {
    if (!range) return t;
    const wrapped = (key: unknown, options?: unknown) => {
        const extra =
            typeof options === 'string'
                ? { defaultValue: options }
                : options && typeof options === 'object'
                  ? (options as Record<string, unknown>)
                  : {};
        return (t as (k: unknown, o: unknown) => unknown)(key, {
            context: RANGE_CONTEXT,
            ...extra,
        });
    };
    return wrapped as unknown as TFunction;
};
