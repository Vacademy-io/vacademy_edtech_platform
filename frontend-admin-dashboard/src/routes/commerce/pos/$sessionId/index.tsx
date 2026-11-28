import { createFileRoute } from '@tanstack/react-router';

/**
 * An exchange started on the returns screen arrives here with the return's
 * credit; the bill counts it first (contract §7.3 P4).
 */
export interface PosSellSearch {
    exchange?: string;
    exchangeNumber?: string;
    exchangeCredit?: number;
}

const text = (value: unknown, max = 64): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;

export const Route = createFileRoute('/commerce/pos/$sessionId/')({
    validateSearch: (search: Record<string, unknown>): PosSellSearch => {
        const credit = Number(search.exchangeCredit);
        return {
            exchange: text(search.exchange),
            exchangeNumber: text(search.exchangeNumber),
            exchangeCredit: Number.isFinite(credit) && credit > 0 ? credit : undefined,
        };
    },
});
