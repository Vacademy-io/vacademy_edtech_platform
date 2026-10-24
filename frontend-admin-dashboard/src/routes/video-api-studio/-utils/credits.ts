/**
 * Credit display utilities for the video-api-studio (Vimotion) surface.
 *
 * The video pipeline emits costs in USD because the source-of-truth pricing
 * tables (Veo's `_PRICE_PER_SECOND_USD`, ai_models per-token pricing) are
 * dollar-denominated. The user-facing UI shows credits exclusively. These
 * helpers convert USD → credits using the live rate from
 * `useCreditRate()` (V252's `credit_rate_config` table) and format the
 * result for display.
 *
 * Always pair `usdToCredits` with the rate from `useCreditRate()`/
 * `useEffectiveCreditRatio()` — do NOT hardcode the 150× constant: it's
 * admin-tunable now and may diverge from what was shipped at build time.
 */

import type { TFunction } from 'i18next';

/**
 * Namespace for this module's translated suffix words — see
 * src/locales/en/videoApiStudioCredits.json. Callers resolve keys against
 * this namespace explicitly (fully-qualified `${NS}:key` lookups) by adding
 * 'videoApiStudioCredits' to their own `useTranslation()` namespace array
 * and threading the resulting `t` in via `FormatCreditsOptions.t`.
 */
const NS = 'videoApiStudioCredits';

/** Default ratio matching V252's seed row (100 × 1.5 = 150).
 *  Used when callers don't have access to the React Query hook
 *  (non-component code paths). Components should prefer
 *  `useEffectiveCreditRatio()` directly. */
export const DEFAULT_EFFECTIVE_RATIO = 150;

export interface FormatCreditsOptions {
    /** Decimal places. Defaults vary by magnitude:
     *  - >= 100: 0 decimals ("225 credits")
     *  - >= 10:  1 decimal  ("12.4 credits")
     *  - <  10:  2 decimals ("4.20 credits")  */
    precision?: number;
    /** Suffix to append. Defaults to "credits" for full mode.
     *  Pass "cr" for compact mode (e.g. small chips). */
    suffix?: 'credits' | 'cr' | '';
    /** When true, append the singular form for n=1 ("1 credit"). */
    pluralAware?: boolean;
    /** i18next `t` bound to (or including) the 'videoApiStudioCredits'
     *  namespace, used to translate the suffix word. When omitted, falls
     *  back to the English literal so call sites that haven't been
     *  threaded through yet keep working exactly as before. */
    t?: TFunction;
}

const _pickDefaultPrecision = (credits: number): number => {
    const abs = Math.abs(credits);
    if (abs >= 100) return 0;
    if (abs >= 10) return 1;
    return 2;
};

/**
 * Format a credit amount for display. Accepts any number including
 * fractional values from per-second rates ("4.5 credits/sec").
 *
 * Pass `suffix: ''` to get just the number string (e.g. when rendering
 * inside a sentence that already says "credits" elsewhere).
 */
export const formatCredits = (credits: number, opts: FormatCreditsOptions = {}): string => {
    if (!Number.isFinite(credits)) return '—';
    const precision = opts.precision ?? _pickDefaultPrecision(credits);
    const suffix = opts.suffix ?? 'credits';
    const rounded = credits.toFixed(precision);
    const isOne = opts.pluralAware && Math.abs(parseFloat(rounded) - 1) < 0.0001;
    const { t } = opts;
    const suffixWord = (key: 'suffixSingular' | 'suffixFull' | 'suffixCompact', fallback: string) =>
        t ? t(`${NS}:${key}`) : fallback;
    const renderedSuffix = !suffix
        ? ''
        : suffix === 'credits' && isOne
          ? ` ${suffixWord('suffixSingular', 'credit')}`
          : suffix === 'credits'
            ? ` ${suffixWord('suffixFull', 'credits')}`
            : ` ${suffixWord('suffixCompact', 'cr')}`;
    return `${rounded}${renderedSuffix}`;
};

/**
 * Convert a USD value to credits using a supplied effective ratio.
 *
 * Pass `ratio` from `useEffectiveCreditRatio()`; this function is pure
 * and ratio-agnostic so it stays testable without React.
 */
export const usdToCredits = (usd: number, ratio: number): number => {
    if (!Number.isFinite(usd) || !Number.isFinite(ratio) || ratio <= 0) {
        return 0;
    }
    return usd * ratio;
};

/**
 * Helper combining the two: convert USD → credits and format in one call.
 * Most label sites can use this directly instead of doing the math inline.
 */
export const formatUsdAsCredits = (
    usd: number,
    ratio: number,
    opts: FormatCreditsOptions = {}
): string => formatCredits(usdToCredits(usd, ratio), opts);
