import { describe, expect, it } from 'vitest';
import {
    EMPTY_REPORT_PAGES_FORM,
    appendToken,
    assetKeyFromName,
    detailKey,
    movePage,
    readScholarshipRule,
    reportPageValues,
    reportPagesFormFromResponse,
    reportPagesPreviewBody,
    reportPagesWireFromForm,
    writeScholarshipRule,
    type ReportPagesForm,
} from '@/types/assessments/report-pages';

const SCHOLARSHIP_RULE = {
    scholarship_percent: {
        max: 100,
        bands: [
            { to: 40, from: -1000, value: 0 },
            { to: 100, from: 40, value: 'percentage' },
        ],
        basis: 'percentage',
        round: 'DOWN',
    },
};

describe('report pages', () => {
    it('reads a test with its own (shared) pages', () => {
        const form = reportPagesFormFromResponse({
            mode: 'CUSTOM',
            profile: {
                id: 'p1',
                name: 'Scholarship 2026 pages',
                institute_default: false,
                config: { before: [{ type: 'TEMPLATE', html: '<p>x</p>' }], qr_url: 'https://a.b' },
            },
            shared_with: 9,
            institute_default: null,
            sample_attempt_id: 't1',
        });
        expect(form).toMatchObject({ loaded: true, dirty: false, mode: 'CUSTOM', profileId: 'p1', sharedWith: 9 });
        expect(form.config.after).toEqual([]);
        expect(form.config.qr_url).toBe('https://a.b');
    });

    it('sends nothing until the section is loaded and changed', () => {
        expect(reportPagesWireFromForm(undefined)).toBeUndefined();
        expect(reportPagesWireFromForm(EMPTY_REPORT_PAGES_FORM)).toBeUndefined();
        expect(reportPagesWireFromForm({ ...EMPTY_REPORT_PAGES_FORM, loaded: true })).toBeUndefined();
        expect(reportPagesWireFromForm({ ...EMPTY_REPORT_PAGES_FORM, loaded: true, dirty: true, mode: 'NONE' })).toEqual({
            mode: 'NONE',
        });
    });

    it('sends custom pages with the profile they started from', () => {
        const form: ReportPagesForm = {
            ...EMPTY_REPORT_PAGES_FORM,
            loaded: true,
            dirty: true,
            mode: 'CUSTOM',
            profileId: 'p1',
            config: { before: [], after: [{ type: 'PDF', file_id: 'f1' }] },
        };
        expect(reportPagesWireFromForm(form)).toEqual({
            mode: 'CUSTOM',
            profile_id: 'p1',
            config: { before: [], after: [{ type: 'PDF', file_id: 'f1' }] },
        });
        expect(reportPagesWireFromForm({ ...form, profileId: null })).not.toHaveProperty('profile_id');
        expect(reportPagesPreviewBody(form)).toEqual({ mode: 'CUSTOM', config: form.config });
        expect(reportPagesPreviewBody({ ...form, mode: 'DEFAULT' })).toEqual({ mode: 'DEFAULT' });
    });

    it('reads and writes the simple scholarship rule (0% below 40%, else the percentage)', () => {
        expect(readScholarshipRule({ variables: SCHOLARSHIP_RULE })).toEqual({ kind: 'simple', minPercent: 40 });
        expect(readScholarshipRule({})).toEqual({ kind: 'none' });
        expect(
            readScholarshipRule({
                variables: { scholarship_percent: { bands: [{ from: 0, to: 50, value: 10 }, { from: 50, to: 100, value: 50 }] } },
            })
        ).toEqual({ kind: 'custom' });

        const written = writeScholarshipRule({ variables: { other: 1 } }, 35);
        expect(readScholarshipRule(written)).toEqual({ kind: 'simple', minPercent: 35 });
        expect(written.variables).toHaveProperty('other', 1);
        expect(writeScholarshipRule(written, null).variables).toEqual({ other: 1 });
        expect(readScholarshipRule(writeScholarshipRule({}, 140))).toEqual({ kind: 'simple', minPercent: 100 });
    });

    it('builds detail keys exactly like the server', () => {
        // ReportComposer.detailKey: lower case, every run of non letters/digits -> "_", trimmed.
        expect(detailKey('Student Roll Number')).toBe('student_roll_number');
        expect(detailKey('School / College')).toBe('school_college');
        expect(detailKey(' Branch-of Engg. ')).toBe('branch_of_engg');
    });

    it('offers values for the settings in use', () => {
        const base = reportPageValues({ config: {}, studentFields: [] }).map((v) => v.token);
        expect(base).toContain('{{student_name}}');
        expect(base).toContain('{{{sections_table}}}');
        expect(base).not.toContain('{{scholarship_percent}}');
        expect(base).not.toContain('{{{qr_svg}}}');

        const all = reportPageValues({
            config: { variables: SCHOLARSHIP_RULE, qr_url: 'https://a.b', assets: { signature: 'data:image/png;base64,AA' } },
            studentFields: ['Student Roll Number'],
        }).map((v) => v.token);
        expect(all).toEqual(
            expect.arrayContaining([
                '{{scholarship_percent}}',
                '{{{qr_svg}}}',
                '{{detail.student_roll_number}}',
                '{{{asset_img.signature}}}',
            ])
        );
    });

    it('adds a value inside the last paragraph', () => {
        expect(appendToken('<p>Dear</p>', '{{student_name}}')).toBe('<p>Dear {{student_name}}</p>');
        expect(appendToken('', '{{score}}')).toBe('<p>{{score}}</p>');
    });

    it('moves pages and names images safely', () => {
        const pages = [{ type: 'PDF' as const, name: 'a' }, { type: 'PDF' as const, name: 'b' }];
        expect(movePage(pages, 1, -1).map((p) => p.name)).toEqual(['b', 'a']);
        expect(movePage(pages, 0, -1)).toBe(pages);
        expect(assetKeyFromName("Principal's Signature.PNG")).toBe('principal_s_signature');
        expect(assetKeyFromName('logo.png', ['logo'])).toBe('logo_2');
        expect(assetKeyFromName('###.png')).toBe('image');
    });
});
