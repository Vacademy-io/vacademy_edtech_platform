import { describe, expect, it } from 'vitest';
import { evalezyPathFor, isEvalezyHost } from './evalezy-mode';

describe('isEvalezyHost', () => {
    it('is the evalezy host and nothing else', () => {
        expect(isEvalezyHost('evalezy.vacademy.io')).toBe(true);
        expect(isEvalezyHost('EVALEZY.vacademy.io')).toBe(true);
        expect(isEvalezyHost('dash.vacademy.io')).toBe(false);
        // a client whose own name merely contains the word is not Evalezy
        expect(isEvalezyHost('evalezyacademy.com')).toBe(false);
        expect(isEvalezyHost('admin.evalezy.com')).toBe(false);
    });
});

describe('evalezyPathFor', () => {
    it('lets the shell, login and a checked copy open as they are', () => {
        expect(evalezyPathFor('/evalezy')).toBeNull();
        expect(evalezyPathFor('/evalezy/abc')).toBeNull();
        expect(evalezyPathFor('/login')).toBeNull();
        expect(evalezyPathFor('/login/forgot-password')).toBeNull();
        expect(evalezyPathFor('/assessment/evaluation-ai/att-1/proc-1')).toBeNull();
    });

    it('takes the "copies checked" email link to the same assessment in the shell', () => {
        expect(
            evalezyPathFor(
                '/assessment/assessment-list/assessment-details/a-1/EXAM/PRIVATE/submissions',
                '?intake=batch-9'
            )
        ).toBe('/evalezy/a-1?intake=batch-9');
        expect(
            evalezyPathFor(
                '/assessment/assessment-list/assessment-details/a-1/EXAM/PRIVATE/overview'
            )
        ).toBe('/evalezy/a-1');
    });

    it('sends every other portal page home', () => {
        expect(evalezyPathFor('/dashboard')).toBe('/evalezy');
        expect(evalezyPathFor('/study-library/courses')).toBe('/evalezy');
        // a look-alike prefix is not the shell
        expect(evalezyPathFor('/evalezy-old')).toBe('/evalezy');
        expect(evalezyPathFor('/assessment/evaluation-aix')).toBe('/evalezy');
    });
});
