import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Course',
}));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course' },
    SystemTerms: { Course: 'Course' },
}));

import { runPublishChecks } from './publish-checks';

/**
 * Pre-publish: a site that switched languages on is warned, by count only,
 * when a language still has untranslated texts. Sites without languages see
 * no change.
 */

const site = (i18n?: Record<string, unknown>) => ({
    globalSettings: { tracking: { ga4MeasurementId: 'G-1' }, ...(i18n ? { i18n } : {}) },
    pages: [
        {
            id: 'home',
            route: 'home',
            seo: { metaDescription: 'Already described' },
            components: [
                {
                    id: 'h',
                    type: 'heroSection',
                    enabled: true,
                    props: { title: 'Learn the Indian way', subtitle: 'Join now' },
                },
            ],
        },
    ],
});

const LOCALES = [
    { code: 'en', label: 'EN' },
    { code: 'hi', label: 'हिन्दी' },
];

describe('publish checks — site languages', () => {
    it('says nothing for a site without languages, or with the switch off', () => {
        expect(runPublishChecks(site())).toEqual([]);
        expect(runPublishChecks(site({ enabled: false, locales: LOCALES, strings: {} }))).toEqual(
            []
        );
    });

    it('warns once per language with the count of untranslated texts (page SEO included)', () => {
        const issues = runPublishChecks(
            site({ enabled: true, locales: LOCALES, strings: { hi: { 'Join now': 'अभी जुड़ें' } } })
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
            severity: 'warning',
            title: 'हिन्दी: 2 of 3 texts are not translated yet',
        });
        expect(issues[0]!.fix).toContain('see these in English');
    });

    it('is satisfied by full coverage, texts kept as English included', () => {
        const strings = {
            hi: {
                'Join now': 'अभी जुड़ें',
                'Already described': 'पहले से वर्णित',
                'Learn the Indian way': 'Learn the Indian way',
            },
        };
        expect(runPublishChecks(site({ enabled: true, locales: LOCALES, strings }))).toEqual([]);
    });
});
