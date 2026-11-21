import { describe, expect, it } from 'vitest';
import en from '../../../../../public/locales/en/dashboardIndex.json';
import hi from '../../../../../public/locales/hi/dashboardIndex.json';
import fr from '../../../../../public/locales/fr/dashboardIndex.json';
import ar from '../../../../../public/locales/ar/dashboardIndex.json';
import {
    CAPABILITY_COPY,
    CAPABILITY_ICONS,
    CRM_CAPABILITY_COPY_KEYS,
} from '../../VacademyAssistant';
import { formatChatTime, formatMessageTime, firstNameOf } from '../../assistant-format';

const LOCALES = { hi, fr, ar } as const;

function leaves(node: unknown, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (typeof v === 'string') out.set(key, v);
            else leaves(v, key).forEach((val, kk) => out.set(kk, val));
        }
    }
    return out;
}

describe('assistant panel copy', () => {
    const panelKeys = leaves(en.assistant.panel, 'assistant.panel');
    const capabilityKeys = leaves(en.assistant.capabilityCopy, 'assistant.capabilityCopy');

    it('has every panel and capability string in all four languages', () => {
        const english = new Map([...panelKeys, ...capabilityKeys]);
        Object.entries(LOCALES).forEach(([lng, catalog]) => {
            const translated = new Map([
                ...leaves(catalog.assistant.panel, 'assistant.panel'),
                ...leaves(catalog.assistant.capabilityCopy, 'assistant.capabilityCopy'),
            ]);
            english.forEach((value, key) => {
                const other = translated.get(key);
                expect(typeof other === 'string' && other.trim().length > 0, `${lng} ${key}`).toBe(
                    true
                );
                // placeholders survive translation
                const vars = value.match(/{{\w+}}/g) ?? [];
                vars.forEach((v) => expect(other, `${lng} ${key}`).toContain(v));
            });
        });
    });

    it('uses curly apostrophes in the English copy', () => {
        [...panelKeys.values(), ...capabilityKeys.values()].forEach((value) =>
            expect(value, value).not.toContain("'")
        );
    });

    it('points every capability group at copy that exists, with an icon', () => {
        const english = leaves(en);
        Object.entries({ ...CAPABILITY_COPY, ...CRM_CAPABILITY_COPY_KEYS }).forEach(
            ([group, copy]) => {
                expect(english.has(copy.blurb), copy.blurb).toBe(true);
                copy.suggestions.forEach((k) => expect(english.has(k), k).toBe(true));
                expect(CAPABILITY_ICONS[group], group).toBeTruthy();
            }
        );
    });
});

describe('assistant panel formatting', () => {
    const now = new Date(2026, 10, 18, 15, 30);

    it('shows the time today and the date before that', () => {
        expect(formatMessageTime(new Date(2026, 10, 18, 9, 5).toISOString(), 'en', now)).toMatch(
            /9:05/
        );
        expect(formatMessageTime(new Date(2026, 10, 2, 9, 5).toISOString(), 'en', now)).toMatch(
            /Nov/
        );
        expect(formatChatTime(new Date(2025, 0, 2).toISOString(), 'en', now)).toMatch(/2025/);
        expect(formatMessageTime(undefined, 'en', now)).toBe('');
        expect(formatChatTime('not a date', 'en', now)).toBe('');
    });

    it('takes the first name', () => {
        expect(firstNameOf('  Asha   Rao ')).toBe('Asha');
        expect(firstNameOf(undefined)).toBe('');
    });
});
