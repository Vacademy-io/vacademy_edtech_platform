import type { TFunction } from 'i18next';
import type { DailyReportRoi, EngagementDailyReport } from '@/services/engagement-daily-report';
import { partFailed } from './report-errors';
import { DASH, formatCredits, formatMoney, formatNumber } from './report-format';

/*
 * The ROI hero: what the engines cost in money against the revenue that came back. Built from
 * the report's `roi` block; the stat block in report-tables.tsx carries the same figures to the
 * exports.
 */

const isNum = (n: number | null | undefined): n is number =>
    n !== null && n !== undefined && Number.isFinite(n);

/** A return multiple: 0.42 is "0.4×", 3.25 is "3.3×", 34.97 is "35×". */
export const formatMultiple = (n: number | null | undefined): string => {
    if (!isNum(n)) return DASH;
    const text =
        Math.abs(n) >= 10
            ? Math.round(n).toLocaleString('en-IN')
            : (Math.round(n * 10) / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 });
    return `${text}×`;
};

/**
 * ok: spend and revenue compare. noRate: no credit price is known, so the spend in money is not.
 * mismatch: the revenue is in another currency than the spend. failed: a query it needs failed.
 */
export type RoiState = 'ok' | 'noRate' | 'mismatch' | 'failed';

export type RoiTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface RoiBreakdownItem {
    key: 'decisions' | 'messages' | 'calls' | 'leadAgent' | 'whatsapp';
    label: string;
    /** Credits, or null for the WhatsApp charges (money only). */
    credits: number | null;
    /** The same in money (credits at the rate), or the WhatsApp amount. */
    money: string;
    /** WhatsApp in another currency is shown but not in the total. */
    excluded?: boolean;
}

export interface RoiHeroView {
    state: RoiState;
    spend: string;
    revenue: string;
    multiple: string;
    net: string;
    tone: RoiTone;
    payingLeads: string;
    payments: string;
    costPerPayingLead: string;
    /** "At your credit pack rate of ₹0.93 per credit" (or the list price), null when unknown. */
    rateHint: string | null;
    breakdown: RoiBreakdownItem[];
    /** Extra lines under the figures: payments in another currency, WhatsApp left out. */
    notes: string[];
}

/** Green from a 1× return, amber below it, red when nothing came back for a real spend. */
export const roiTone = (roi: DailyReportRoi): RoiTone => {
    if (!isNum(roi.roiMultiple)) return 'neutral';
    if (roi.roiMultiple >= 1) return 'success';
    if (roi.roiMultiple > 0) return 'warning';
    return isNum(roi.totalSpend) && roi.totalSpend > 0 ? 'danger' : 'neutral';
};

export const buildRoiHero = (data: EngagementDailyReport, t: TFunction): RoiHeroView | null => {
    const roi = data.roi;
    if (!roi) return null;
    const spendCurrency = roi.rateCurrency;
    const money = (n: number | null | undefined, currency: string | null) =>
        currency ? formatMoney(n, currency) : DASH;
    const state: RoiState = partFailed(data.errors, 'roi')
        ? 'failed'
        : !isNum(roi.creditRate)
          ? 'noRate'
          : roi.currencyMismatch
            ? 'mismatch'
            : 'ok';

    const c = data.costs?.credits;
    // Paise, like every other amount on the card: formatMoney keeps up to 4 decimals below 1 for
    // per-message rates, which made a small spend read "₹0.744" next to "₹4.65".
    const atRate = (credits: number) =>
        isNum(roi.creditRate)
            ? money(Math.round(credits * roi.creditRate * 100) / 100, spendCurrency)
            : DASH;
    const creditItem = (
        key: Exclude<RoiBreakdownItem['key'], 'whatsapp'>,
        credits: number | undefined
    ): RoiBreakdownItem => ({
        key,
        label: t(`roi.breakdown.${key}`),
        credits: credits ?? 0,
        money: atRate(credits ?? 0),
    });
    const breakdown: RoiBreakdownItem[] = c
        ? [
              creditItem('decisions', c.decisions),
              creditItem('messages', c.messages),
              creditItem('calls', c.calls),
              creditItem('leadAgent', c.leadAgent),
          ]
        : [];
    if (isNum(roi.whatsappSpend) && roi.whatsappSpend > 0) {
        const waCurrency = data.costs?.whatsapp.currency ?? null;
        breakdown.push({
            key: 'whatsapp',
            label: t('roi.breakdown.whatsapp'),
            credits: null,
            money: money(roi.whatsappSpend, waCurrency),
            excluded: !roi.whatsappIncluded,
        });
    }

    const notes: string[] = [];
    if (roi.otherCurrencyPayments > 0) {
        notes.push(
            t('roi.note.otherCurrency', {
                count: roi.otherCurrencyPayments,
                currency: roi.revenueCurrency,
            })
        );
    }
    if (breakdown.some((b) => b.excluded)) notes.push(t('roi.note.whatsappExcluded'));
    // Paying leads count who paid in the period; Conversions count who converted in it. A lead
    // that converted earlier and paid now is the first and not the second.
    const conversions = data.summary?.conversions;
    if (isNum(conversions) && roi.payingLeads > conversions) {
        notes.push(t('roi.note.payingVsConversions', { paying: roi.payingLeads, conversions }));
    }

    return {
        state,
        spend: money(roi.totalSpend, spendCurrency),
        revenue: formatMoney(roi.revenue, roi.revenueCurrency),
        multiple: state === 'ok' ? formatMultiple(roi.roiMultiple) : DASH,
        net: state === 'ok' ? money(roi.net, spendCurrency) : DASH,
        tone: state === 'ok' ? roiTone(roi) : 'neutral',
        payingLeads: formatNumber(roi.payingLeads),
        payments: formatNumber(roi.payments),
        costPerPayingLead: state === 'ok' ? money(roi.costPerPayingLead, spendCurrency) : DASH,
        rateHint:
            isNum(roi.creditRate) && spendCurrency
                ? t(roi.rateSource === 'PURCHASE' ? 'roi.rate.purchase' : 'roi.rate.catalog', {
                      rate: formatMoney(roi.creditRate, spendCurrency),
                      credits: formatCredits(roi.credits),
                  })
                : null,
        breakdown,
        notes,
    };
};
