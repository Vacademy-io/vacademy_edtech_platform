import type { TFunction } from 'i18next';

/*
 * What a weekly row says in place of a verdict. A comparison needs volume: a row without enough
 * sends, calls or leads is shown with its numbers but never marked good or bad. This holds even
 * when the server's verdict says otherwise, because the page does not trust a ranking it cannot
 * check against the minimum it was given.
 */

/**
 * WEAK is not a ranking: it marks a lead source or an hour that the diagnosis itself flagged as
 * weak (a problem names it), and only ever on a row with enough data.
 */
export type RowVerdict = 'BEST' | 'WORST' | 'OK' | 'WEAK' | 'NEEDS_DATA' | 'NONE';

/**
 * The verdict of a row of templates or subjects.
 * @param verdict the server's: BEST | WORST | OK | NOT_ENOUGH_DATA
 * @param have the row's sends
 * @param need the least a row needs (`minimums.sendsPerRow`); null when the server did not say
 */
export const rowVerdict = (
    verdict: string | undefined,
    have: number,
    need: number | null
): RowVerdict => {
    if (verdict === 'NOT_ENOUGH_DATA') return 'NEEDS_DATA';
    if (need !== null && have < need) return 'NEEDS_DATA';
    if (verdict === 'BEST' || verdict === 'WORST' || verdict === 'OK') return verdict;
    // A verdict a newer backend added: no mark, so nothing is called good or bad by guesswork.
    return 'NONE';
};

/**
 * Rows with an `enough` flag instead of a verdict (lead sources, call hours, prompt versions).
 * A row short of the minimum needs data, whatever its flag says.
 */
export const flagVerdict = (enough: boolean, have: number, need: number | null): RowVerdict =>
    !enough || (need !== null && have < need) ? 'NEEDS_DATA' : 'NONE';

export type VerdictUnit = 'sends' | 'leads' | 'calls';

/** "Needs 100 sends", or "Needs more data" when the server gave no minimum. */
export const needsDataText = (unit: VerdictUnit, need: number | null, t: TFunction): string =>
    need === null ? t('diagnosis.needs.more') : t(`diagnosis.needs.${unit}`, { count: need });

/** The words for a verdict in a cell, a title and the exports; empty when there is nothing to say. */
export const verdictText = (
    verdict: RowVerdict,
    unit: VerdictUnit,
    need: number | null,
    t: TFunction
): string => {
    switch (verdict) {
        case 'BEST':
            return t('diagnosis.verdict.best');
        case 'WORST':
            return t('diagnosis.verdict.worst');
        case 'OK':
            return t('diagnosis.verdict.ok');
        case 'WEAK':
            return t('diagnosis.verdict.weak');
        case 'NEEDS_DATA':
            return needsDataText(unit, need, t);
        default:
            return '';
    }
};
