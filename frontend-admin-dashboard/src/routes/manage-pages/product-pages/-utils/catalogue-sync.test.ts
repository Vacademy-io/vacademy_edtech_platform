import { describe, expect, it } from 'vitest';
import {
    describeSyncReason,
    groupSyncItemsByReason,
    listCourseNames,
    parseSyncResponse,
    syncCourseName,
    syncSummaryLine,
} from './catalogue-sync';

const page = { id: 'pp-1', name: 'Store', code: 'store', mappings: [{ id: 'm1' }] };

/** Every code admin_core's CatalogueSyncPlanner sends (skipped + switched off). */
const SERVER_CODES = [
    'no_active_invite',
    'invite_inactive',
    'invite_not_started',
    'invite_expired',
    'payment_option_inactive',
    'cpo_not_supported',
    'no_active_plan',
    'non_default_invite',
    'currency_mismatch',
    'vendor_mismatch',
    'left_catalogue',
    'bridge_inactive',
    'plan_inactive',
    'plan_missing',
];

describe('parseSyncResponse', () => {
    it('reads the server shape: page fields spread with the summary, course names kept', () => {
        const r = parseSyncResponse({
            ...page,
            added: 3,
            deactivated: 1,
            skipped: [{ package_session_id: 'ps-9', reason: 'cpo_not_supported', package_name: 'Yoga', level_name: 'Hindi' }],
            warnings: ['Mixed currencies: INR, USD'],
            added_package_session_ids: ['ps-1', 'ps-2', 'ps-3'],
            deactivated_mappings: [
                { mapping_id: 'm7', package_session_id: 'ps-7', reason: 'left_catalogue', package_name: 'Summer batch' },
            ],
        });
        expect(r.added).toBe(3);
        expect(r.deactivated).toBe(1);
        expect(r.skipped).toEqual([
            { package_session_id: 'ps-9', reason: 'cpo_not_supported', package_name: 'Yoga', level_name: 'Hindi' },
        ]);
        expect(r.deactivatedMappings).toEqual([
            { mapping_id: 'm7', package_session_id: 'ps-7', reason: 'left_catalogue', package_name: 'Summer batch' },
        ]);
        expect(r.warnings).toEqual(['Mixed currencies: INR, USD']);
    });

    it('returns the page as GET /{id} would — no summary fields — so it can be cached as is', () => {
        const r = parseSyncResponse({
            ...page,
            added: 1,
            deactivated: 0,
            skipped: [],
            warnings: [],
            added_package_session_ids: ['ps-1'],
            deactivated_mappings: [],
        });
        expect(r.page).toEqual(page);
    });

    it('reads a nested page and list-shaped figures', () => {
        const r = parseSyncResponse({ page, added: [{}, {}], deactivated: [{}], skipped: [], warnings: [] });
        expect(r.page).toEqual(page);
        expect(r.added).toBe(2);
        expect(r.deactivated).toBe(1);
    });

    it('counts from the lists when the server sends no figures', () => {
        const r = parseSyncResponse({
            added_package_session_ids: ['a', 'b'],
            deactivated_mappings: [{ mapping_id: 'm1', reason: 'plan_missing' }],
        });
        expect(r.added).toBe(2);
        expect(r.deactivated).toBe(1);
    });

    it('never crashes on junk and returns no page when none is usable', () => {
        for (const junk of [null, undefined, 'x', 42, [], { added: -4, skipped: 'nope', warnings: [{}, 7] }]) {
            const r = parseSyncResponse(junk);
            expect(r.page).toBeNull();
            expect(r.added).toBe(0);
            expect(r.skipped).toEqual([]);
            expect(r.deactivatedMappings).toEqual([]);
            expect(r.warnings).toEqual([]);
        }
    });

    it('accepts camelCase fields and message objects, and keeps a missing reason empty', () => {
        const r = parseSyncResponse({
            skipped: [{ packageSessionId: 'ps-1', packageName: ' Gita ', levelName: '' }, null],
            warnings: [{ message: 'Two gateways' }, '  '],
        });
        expect(r.skipped).toEqual([{ package_session_id: 'ps-1', reason: '', package_name: 'Gita' }]);
        expect(r.warnings).toEqual(['Two gateways']);
    });
});

describe('describeSyncReason', () => {
    it('puts every server code into plain words — never the code itself', () => {
        for (const code of SERVER_CODES) {
            const { label } = describeSyncReason(code);
            expect(label).not.toContain('_');
            expect(label).not.toBe(code);
            expect(label.length).toBeGreaterThan(10);
        }
    });

    it('says what to do next where there is something to do', () => {
        expect(describeSyncReason('cpo_not_supported')).toEqual({
            label: 'Instalment (CPO) plans cannot be sold through the cart',
            hint: 'Sell these courses from their own course page or invite link instead.',
        });
        expect(describeSyncReason('left_catalogue').label).toMatch(/never were/);
        expect(describeSyncReason('INVITE_NOT_STARTED').label).toBe('Its invite link has not opened yet');
    });

    it('points a closed link at the course’s default invite link, never at reopening a promo link', () => {
        for (const code of ['invite_expired', 'invite_inactive']) {
            const { hint } = describeSyncReason(code);
            expect(hint).toMatch(/default invite link/);
            expect(hint).not.toMatch(/extend|end date|back on/i);
        }
    });

    it('explains the courses a store page cannot take: other invite link, currency or gateway', () => {
        expect(describeSyncReason('non_default_invite')).toEqual({
            label: 'Only a non-default invite link sells this course',
            hint: 'Add it by hand if that price is intended.',
        });
        expect(describeSyncReason('currency_mismatch')).toEqual({
            label: 'Priced in a different currency from this store page, or its invite link and payment plan name different currencies',
            hint: 'If its invite link and payment plan name different currencies, give them the same one, then sync again. Otherwise sell it from its own product page.',
        });
        expect(describeSyncReason('vendor_mismatch')).toEqual({
            label: 'Paid through a different payment gateway from this store page',
            hint: 'Sell it from its own product page.',
        });
    });

    it('also explains currency_mismatch for a course whose invite link and plan disagree — its own page would not fix that', () => {
        // The planner sends this code before comparing with the page's currency,
        // even on an empty page, when a course's invite and plan currencies differ.
        const { label, hint } = describeSyncReason('currency_mismatch');
        expect(label).toMatch(/invite link and payment plan name different currencies/);
        expect(hint).toMatch(/^If its invite link and payment plan name different currencies, give them the same one/);
        expect(hint).not.toMatch(/^Sell it from its own product page/);
    });

    it('humanises an unknown code and passes a sentence through', () => {
        expect(describeSyncReason('some_new_code')).toEqual({ label: 'Some new code' });
        expect(describeSyncReason('Instalment plan (CPO)')).toEqual({ label: 'Instalment plan (CPO)' });
        expect(describeSyncReason('')).toEqual({ label: 'No reason given' });
        expect(describeSyncReason(undefined)).toEqual({ label: 'No reason given' });
    });
});

describe('grouping and summaries', () => {
    it('names a course with its level, dropping placeholder levels', () => {
        expect(syncCourseName({ package_name: 'Yoga', level_name: 'Hindi' })).toBe('Yoga (Hindi)');
        expect(syncCourseName({ package_name: 'Vedas', level_name: 'DEFAULT' })).toBe('Vedas');
        expect(syncCourseName({ level_name: 'Hindi' })).toBe('');
    });

    it('groups by reason, most common first, with each course named once', () => {
        expect(
            groupSyncItemsByReason([
                { reason: 'cpo_not_supported', package_name: 'Gita' },
                { reason: 'invite_expired', package_name: 'Yoga', level_name: 'Hindi' },
                { reason: 'invite_expired', package_name: 'Yoga', level_name: 'Hindi' },
                { reason: 'invite_expired', package_name: 'Vedas' },
                { reason: 'invite_expired' },
            ])
        ).toEqual([
            { reason: 'invite_expired', count: 4, names: ['Yoga (Hindi)', 'Vedas'] },
            { reason: 'cpo_not_supported', count: 1, names: ['Gita'] },
        ]);
    });

    it('lists a few names and counts the rest', () => {
        expect(listCourseNames(['A', 'B'])).toBe('A, B');
        expect(listCourseNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
    });

    it('writes one plain line', () => {
        expect(
            syncSummaryLine({ added: 12, deactivated: 2, skipped: [{ package_session_id: 'x', reason: 'no_active_plan' }] })
        ).toBe('Added 12 course versions · switched off 2 · 1 not added');
        expect(syncSummaryLine({ added: 1, deactivated: 0, skipped: [] })).toBe('Added 1 course version');
        expect(syncSummaryLine({ added: 0, deactivated: 0, skipped: [] })).toBe('Nothing new to add');
    });
});
