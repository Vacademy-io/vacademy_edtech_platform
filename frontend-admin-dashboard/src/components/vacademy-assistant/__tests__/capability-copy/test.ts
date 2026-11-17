import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../../../../../public/locales/en/dashboardIndex.json';
import hi from '../../../../../public/locales/hi/dashboardIndex.json';
import fr from '../../../../../public/locales/fr/dashboardIndex.json';
import ar from '../../../../../public/locales/ar/dashboardIndex.json';
import { CRM_CAPABILITY_COPY_KEYS, capabilityCopyFor } from '../../VacademyAssistant';
import { STARTERS } from '../../launch-bar-starters';

const LOCALES = { en, hi, fr, ar } as const;

const i18n = createInstance();
void i18n.init({
    lng: 'en',
    resources: { en: { dashboardIndex: en } },
    interpolation: { escapeValue: false },
});
const t = (key: string) => i18n.t(key, { ns: 'dashboardIndex' });

function lookup(catalog: unknown, key: string): unknown {
    return key
        .split('.')
        .reduce<unknown>(
            (node, part) =>
                node && typeof node === 'object'
                    ? (node as Record<string, unknown>)[part]
                    : undefined,
            catalog
        );
}

describe('assistant panel copy for the CRM groups', () => {
    it('lists CRM blurbs and example prompts only for the CRM groups returned', () => {
        const { capabilityBlurbs, suggestions } = capabilityCopyFor(
            ['crm_leads', 'crm_reports', 'crm_collections'],
            t
        );
        expect(capabilityBlurbs).toEqual([
            'Leads and enquiries',
            'CRM reports',
            'Admissions, dues and collections',
        ]);
        expect(suggestions).toEqual([
            'How many leads came in this week?',
            'Which leads are waiting longest for first contact?',
            'Who owes fees this week?',
            'Admissions this month missing a fee plan',
        ]);
    });

    it('shows no CRM copy when no CRM group is returned', () => {
        const { capabilityBlurbs, suggestions } = capabilityCopyFor(
            ['search_help_knowledge', 'schedule'],
            t
        );
        expect(capabilityBlurbs).toEqual(['How-to guidance', 'Class schedules']);
        expect(suggestions.join(' ')).not.toMatch(/lead|owes|admission/i);
    });

    it('keeps at most five example prompts', () => {
        const { suggestions } = capabilityCopyFor(
            ['search_help_knowledge', 'learner_data', 'crm_reports', 'crm_collections'],
            t
        );
        expect(suggestions).toHaveLength(5);
    });

    it('has every CRM key in all four languages', () => {
        const keys = new Set<string>();
        Object.values(CRM_CAPABILITY_COPY_KEYS).forEach((copy) => {
            keys.add(copy.blurb);
            copy.suggestions.forEach((k) => keys.add(k));
        });
        STARTERS.filter((s) => s.key.startsWith('crm')).forEach((s) => {
            keys.add(`assistant.starters.${s.key}.label`);
            keys.add(`assistant.starters.${s.key}.prompt`);
        });
        Object.entries(LOCALES).forEach(([lng, catalog]) => {
            keys.forEach((key) => {
                const value = lookup(catalog, key);
                expect(typeof value === 'string' && value.trim().length > 0, `${lng} ${key}`).toBe(
                    true
                );
            });
        });
    });
});
