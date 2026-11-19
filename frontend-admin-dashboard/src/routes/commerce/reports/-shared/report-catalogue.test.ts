/**
 * WP-51 contract §7.3: every catalogue id has its title (and help) in both
 * locale files, and the reports home offers the cards each role may open
 * (§3.5): manager and ADMIN all, an accountant without the tax reports only
 * sales, money and the audit log, cashier and warehouse none.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMERCE_FEATURE, COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import {
    canSeeReport,
    REPORT_CATALOGUE,
    REPORT_IDS,
    reportEntry,
    reportHelpKey,
    reportTitleKey,
    visibleReportGroups,
} from './report-catalogue';

const LOCALES = path.resolve(__dirname, '../../../../../public/locales');
type Tree = { [key: string]: Tree | string };
const lookup = (lng: string, key: string): unknown =>
    key
        .split('.')
        .reduce<unknown>(
            (node, part) => (node && typeof node === 'object' ? (node as Tree)[part] : undefined),
            JSON.parse(fs.readFileSync(path.join(LOCALES, lng, 'commerce.json'), 'utf8')) as Tree
        );

const accessOf = (roles: string[], featuresOn: string[]) =>
    resolveCommerceAccess({ roles, isFeatureOn: (key) => featuresOn.includes(key) });

const ALL_FEATURES = Object.values(COMMERCE_FEATURE);
const NO_TAX = ALL_FEATURES.filter((f) => f !== COMMERCE_FEATURE.TAX_REPORTS);
const ids = (groups: ReturnType<typeof visibleReportGroups>) => groups.flatMap((g) => g.entries.map((e) => e.id));

describe('report catalogue', () => {
    it('every catalogue id has a title and a help line in English and Hindi', () => {
        expect(REPORT_CATALOGUE.map((e) => e.id)).toEqual([...REPORT_IDS]);
        REPORT_IDS.forEach((id) => {
            ['en', 'hi'].forEach((lng) => {
                expect(lookup(lng, reportTitleKey(id)), `${lng} ${id} title`).toEqual(expect.any(String));
                expect(lookup(lng, reportHelpKey(id)), `${lng} ${id} help`).toEqual(expect.any(String));
            });
        });
        expect(lookup('hi', reportTitleKey('salesRegister'))).toBe('बिक्री रजिस्टर');
        expect(lookup('hi', reportTitleKey('audit'))).toBe('बदलावों का रिकॉर्ड');
    });

    it('a store manager sees every card, in the five groups', () => {
        const groups = visibleReportGroups(accessOf([COMMERCE_ROLE.STORE_MANAGER], ALL_FEATURES));
        expect(groups.map((g) => g.group)).toEqual(['gst', 'sales', 'money', 'counter', 'audit']);
        expect(ids(groups)).toEqual([...REPORT_IDS]);
    });

    it('an accountant with the tax reports off sees sales, money and the audit log only', () => {
        const groups = visibleReportGroups(accessOf([COMMERCE_ROLE.ACCOUNTANT], NO_TAX));
        expect(groups.map((g) => g.group)).toEqual(['sales', 'money', 'audit']);
        expect(ids(groups)).toEqual(['sales', 'products', 'paymentModes', 'codOutstanding', 'customerDues', 'audit']);
    });

    it('an accountant with only the tax reports sees the GST pack, the counter reports and the audit log', () => {
        const groups = visibleReportGroups(accessOf([COMMERCE_ROLE.ACCOUNTANT], [COMMERCE_FEATURE.TAX_REPORTS]));
        expect(groups.map((g) => g.group)).toEqual(['gst', 'counter', 'audit']);
    });

    it('an institute ADMIN sees every card', () => {
        expect(ids(visibleReportGroups(accessOf(['ADMIN'], ALL_FEATURES)))).toEqual([...REPORT_IDS]);
    });

    it('a cashier and warehouse staff see none', () => {
        expect(visibleReportGroups(accessOf([COMMERCE_ROLE.POS_CASHIER], ALL_FEATURES))).toEqual([]);
        expect(visibleReportGroups(accessOf([COMMERCE_ROLE.WAREHOUSE_STAFF], ALL_FEATURES))).toEqual([]);
    });

    it('the feature split follows the contract: GST and counter on tax reports, sales and money on orders', () => {
        const manager = accessOf([COMMERCE_ROLE.STORE_MANAGER], [COMMERCE_FEATURE.ORDERS]);
        expect(canSeeReport(reportEntry('dayBook')!, manager)).toBe(false);
        expect(canSeeReport(reportEntry('posSessions')!, manager)).toBe(false);
        expect(canSeeReport(reportEntry('gstr1')!, manager)).toBe(false);
        expect(canSeeReport(reportEntry('customerDues')!, manager)).toBe(true);
        expect(canSeeReport(reportEntry('audit')!, manager)).toBe(true);
        expect(reportEntry('gstPack')?.formats).toEqual(['xlsx']);
        expect(reportEntry('dayBook')?.maxDays).toBe(31);
        expect(reportEntry('nope')).toBeUndefined();
    });
});
