/**
 * Dates a seller types into a section ("2026-11-20"). A bare date means that day in the
 * shopper's own time: it starts at 00:00 and ends at the end of the day, not at 05:30 IST as
 * Date.parse (UTC midnight) would have it.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const startOfDate = (value: string): number => {
    const match = DATE_ONLY.exec(value.trim());
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0).getTime();
    return Date.parse(value);
};

export const endOfDate = (value: string): number => {
    const match = DATE_ONLY.exec(value.trim());
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999).getTime();
    return Date.parse(value);
};

/** True while `now` is inside the window; a missing or unreadable bound is open. */
export const withinDates = (now: number, startDate: string, endDate: string): boolean => {
    const start = startDate ? startOfDate(startDate) : Number.NaN;
    const end = endDate ? endOfDate(endDate) : Number.NaN;
    if (Number.isFinite(start) && now < start) return false;
    if (Number.isFinite(end) && now > end) return false;
    return true;
};

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
