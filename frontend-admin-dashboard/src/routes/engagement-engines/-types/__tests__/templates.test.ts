import { describe, expect, it } from 'vitest';
import { isCompleteSource, joinSource, splitSource } from '../templates';

describe('variable sources', () => {
    it('round-trips every kind', () => {
        for (const s of ['profile.firstName', 'profile.name', 'ai', 'form.course name', 'research.fitSignal', 'brief.link.2', 'static:Team EE']) {
            const { kind, value } = splitSource(s);
            expect(joinSource(kind, value)).toBe(s);
        }
    });

    it('keeps the kind while the typed part is empty', () => {
        expect(splitSource(joinSource('form', '')).kind).toBe('form');
        expect(splitSource(joinSource('brief.link', '')).kind).toBe('brief.link');
        expect(splitSource(joinSource('static', '')).kind).toBe('static');
    });

    it('accepts only what the backend accepts', () => {
        expect(isCompleteSource('profile.firstName')).toBe(true);
        expect(isCompleteSource('brief.link.1')).toBe(true);
        expect(isCompleteSource('static:6 PM')).toBe(true);
        expect(isCompleteSource('form.')).toBe(false);
        expect(isCompleteSource('brief.link.')).toBe(false);
        expect(isCompleteSource('brief.link.0')).toBe(false);
        expect(isCompleteSource('static:')).toBe(false);
        expect(isCompleteSource('db.password')).toBe(false);
        expect(isCompleteSource('')).toBe(false);
    });
});
