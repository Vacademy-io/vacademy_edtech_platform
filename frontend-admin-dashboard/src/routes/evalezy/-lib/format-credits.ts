/** A credit balance for people: the API sends a decimal string, and tenths are enough to read. */
export const formatCredits = (value: string | number | null | undefined): string => {
    const credits = Number(value);
    return (Number.isFinite(credits) ? credits : 0).toLocaleString('en-IN', {
        maximumFractionDigits: 1,
    });
};

const SHORT_UNITS = [
    { size: 10000000, suffix: 'Cr' },
    { size: 100000, suffix: 'L' },
    { size: 1000, suffix: 'K' },
];

/**
 * For the header, where every character counts: 88, 99.9K, 12.5L. Rounded down, so
 * it never promises more credits than there are.
 */
export const formatCreditsShort = (value: string | number | null | undefined): string => {
    const credits = Number(value);
    if (!Number.isFinite(credits) || credits <= 0) return '0';
    const unit = SHORT_UNITS.find(({ size }) => credits >= size);
    if (!unit) return String(Math.floor(credits));
    return `${Math.floor((credits / unit.size) * 10) / 10}${unit.suffix}`;
};
