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
    gstClosedToPlaces,
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

    it('M6: a reader limited to some places does not get the GST cards (the server would refuse each one)', () => {
        const manager = accessOf([COMMERCE_ROLE.STORE_MANAGER], ALL_FEATURES);
        const limited = visibleReportGroups(manager, false);
        expect(limited.map((g) => g.group)).toEqual(['sales', 'money', 'counter', 'audit']);
        expect(gstClosedToPlaces(manager, false)).toBe(true);
        // Every place, or not known yet: the cards stay (the server still checks).
        expect(ids(visibleReportGroups(manager, true))).toEqual([...REPORT_IDS]);
        expect(ids(visibleReportGroups(manager, null))).toEqual([...REPORT_IDS]);
        // An institute ADMIN reads every place whatever the answer says.
        expect(ids(visibleReportGroups(accessOf(['ADMIN'], ALL_FEATURES), false))).toEqual([...REPORT_IDS]);
    });

    it('M6: the server\'s gst_reports wins over all_places when it is sent', () => {
        const manager = accessOf([COMMERCE_ROLE.STORE_MANAGER], ALL_FEATURES);
        const admin = accessOf(['ADMIN'], ALL_FEATURES);
        // Every place but the server says no (tax reports off there): no GST cards, even for ADMIN.
        expect(gstClosedToPlaces(manager, true, false)).toBe(true);
        expect(gstClosedToPlaces(admin, true, false)).toBe(true);
        expect(visibleReportGroups(admin, true, false).map((g) => g.group)).not.toContain('gst');
        // The server says yes: the cards stay whatever all_places says.
        expect(gstClosedToPlaces(manager, false, true)).toBe(false);
        expect(ids(visibleReportGroups(manager, false, true))).toEqual([...REPORT_IDS]);
        // Not sent: all_places decides, as before.
        expect(gstClosedToPlaces(manager, false, null)).toBe(true);
        expect(gstClosedToPlaces(manager, true, null)).toBe(false);
    });

    it('N9: the sales register offers the bill status; GSTR-1 and the GST pack the B2C large limit', () => {
        expect(reportEntry('salesRegister')?.filters).toContain('status');
        expect(reportEntry('gstr1')?.filters).toContain('b2clLimit');
        expect(reportEntry('gstPack')?.filters).toContain('b2clLimit');
    });
});
