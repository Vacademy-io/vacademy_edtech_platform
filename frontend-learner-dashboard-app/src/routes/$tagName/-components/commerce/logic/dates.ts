/**
 * Dates a seller types into a section, and dates shown to a shopper. The window test lives in
 * date-window.ts (no imports), so the banner's first-paint box can use it outside the shop chunk.
 */
export { endOfDate, startOfDate, withinDates } from './date-window';

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_HI = ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'];

/**
 * "15 Nov 2026" / "15 नव 2026" in the shopper's own time zone, Latin digits in both languages.
 * Written by hand, like the money format, so it does not depend on the browser's ICU data.
 * "" for a missing or unreadable instant.
 */
export const formatDate = (iso: string | null | undefined, locale: string): string => {
    const time = iso ? Date.parse(iso) : Number.NaN;
    if (!Number.isFinite(time)) return '';
    const date = new Date(time);
    const months = (locale || '').toLowerCase().startsWith('hi') ? MONTHS_HI : MONTHS_EN;
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
};
