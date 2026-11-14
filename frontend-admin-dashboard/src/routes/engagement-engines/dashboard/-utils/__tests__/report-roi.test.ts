import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    normalizeDailyReport,
    type DailyReportRoi,
    type EngagementDailyReport,
} from '@/services/engagement-daily-report';
import { buildRoiHero, formatMultiple, roiTone } from '../report-roi';

const file = path.resolve(
    __dirname,
    '../../../../../../public/locales/en/engagementDailyReport.json'
);
const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

const ROI: DailyReportRoi = {
    credits: 100,
    creditRate: 0.93,
    rateCurrency: 'INR',
    rateSource: 'PURCHASE',
    creditSpend: 93,
    whatsappSpend: 50,
    whatsappIncluded: true,
    totalSpend: 143,
    revenue: 5000,
    revenueCurrency: 'INR',
    payments: 2,
    payingLeads: 1,
    otherCurrencyPayments: 0,
    roiMultiple: 34.97,
    net: 4857,
    costPerPayingLead: 143,
    currencyMismatch: false,
};

const report = (
    roi: Partial<DailyReportRoi> | null,
    errors: Record<string, string> = {},
    conversions = 1
) =>
    normalizeDailyReport({
        date: '2026-11-02',
        days: 1,
        summary: { conversions } as EngagementDailyReport['summary'],
        roi: roi === null ? null : { ...ROI, ...roi },
        costs: {
            credits: { messages: 60, decisions: 30, calls: 10, leadAgent: 0, total: 100 },
            whatsapp: {
                amount: 50,
                currency: 'INR',
                billableMessages: 40,
                estimatedMessages: 0,
                missingRate: 0,
            },
        },
        errors,
    } as Partial<EngagementDailyReport>);

describe('ROI hero', () => {
    let t: TFunction;
    beforeAll(async () => {
        await i18next.init({
            lng: 'en',
            resources: { en: { report: json } },
            ns: ['report'],
            defaultNS: 'report',
        });
        t = i18next.t.bind(i18next) as unknown as TFunction;
    });

    it('formats the multiple with fewer digits as it grows', () => {
        expect(formatMultiple(0.42)).toBe('0.4×');
        expect(formatMultiple(3.25)).toBe('3.3×');
        expect(formatMultiple(34.97)).toBe('35×');
        expect(formatMultiple(null)).toBe('—');
    });

    it('colours a return above 1× green, below amber, nothing back red', () => {
        expect(roiTone(ROI)).toBe('success');
        expect(roiTone({ ...ROI, roiMultiple: 0.5 })).toBe('warning');
        expect(roiTone({ ...ROI, roiMultiple: 0 })).toBe('danger');
        expect(roiTone({ ...ROI, roiMultiple: null })).toBe('neutral');
    });

    it('shows spend, revenue, the multiple and where the credits went', () => {
        const hero = buildRoiHero(report({}), t);
        expect(hero?.state).toBe('ok');
        expect(hero?.spend).toBe('₹143.00');
        expect(hero?.revenue).toBe('₹5,000.00');
        expect(hero?.multiple).toBe('35×');
        expect(hero?.rateHint).toBe('100 credits at your credit pack price of ₹0.93 per credit');
        expect(hero?.breakdown.map((b) => b.key)).toEqual([
            'decisions',
            'messages',
            'calls',
            'leadAgent',
            'whatsapp',
        ]);
        expect(hero?.breakdown[0]?.money).toBe('₹27.90');
        expect(hero?.notes).toEqual([]);
    });

    it('says why there is no multiple instead of showing a false 0', () => {
        expect(buildRoiHero(report({ creditRate: null, totalSpend: null }), t)?.state).toBe(
            'noRate'
        );
        const mismatch = buildRoiHero(report({ currencyMismatch: true, roiMultiple: null }), t);
        expect(mismatch?.state).toBe('mismatch');
        expect(mismatch?.multiple).toBe('—');
        expect(buildRoiHero(report({}, { revenue: 'unavailable' }), t)?.state).toBe('failed');
        expect(buildRoiHero(report(null), t)).toBeNull();
    });

    it('shows the spend breakdown in paise, like every other amount', () => {
        const tiny = normalizeDailyReport({
            ...report({ creditRate: 0.93 }),
            costs: {
                credits: { messages: 5, decisions: 0.8, calls: 0, leadAgent: 0, total: 5.8 },
                whatsapp: {
                    amount: 0,
                    currency: 'INR',
                    billableMessages: 0,
                    estimatedMessages: 0,
                    missingRate: 0,
                },
            },
        } as Partial<EngagementDailyReport>);
        const hero = buildRoiHero(tiny, t);
        expect(hero?.breakdown.find((b) => b.key === 'decisions')?.money).toBe('₹0.74');
        expect(hero?.breakdown.find((b) => b.key === 'messages')?.money).toBe('₹4.65');
    });

    it('explains more paying leads than conversions', () => {
        const hero = buildRoiHero(report({ payingLeads: 1 }, {}, 0), t);
        expect(hero?.notes).toHaveLength(1);
        expect(hero?.notes[0]).toMatch(/1 paying leads but 0 conversions/);
        expect(buildRoiHero(report({ payingLeads: 1 }, {}, 1), t)?.notes).toEqual([]);
    });

    it('notes WhatsApp in another currency and payments left out', () => {
        const hero = buildRoiHero(report({ whatsappIncluded: false, otherCurrencyPayments: 2 }), t);
        expect(hero?.breakdown.find((b) => b.key === 'whatsapp')?.excluded).toBe(true);
        expect(hero?.notes).toHaveLength(2);
        expect(hero?.notes[0]).toMatch(/2 payments in other currencies/);
    });
});
