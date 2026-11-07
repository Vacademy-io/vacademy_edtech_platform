import { describe, expect, it } from 'vitest';
import { stripSharedPrefix } from './CourseFinderEditor';

/**
 * The label guess behind "One button per course". It only has to produce
 * something a human would keep or lightly edit — but it must never produce
 * labels that are indistinguishable from each other, which is what trimming a
 * character-exact common prefix does.
 */

describe('stripSharedPrefix', () => {
    it('cuts at the separator, not mid-word', () => {
        // Shiksha Nation's real course names. A character-exact common prefix
        // is "UnlockX Scholarship Test - Class ", which would leave "6" / "7".
        const names = [
            'UnlockX Scholarship Test - Class 6',
            'UnlockX Scholarship Test - Class 7',
            'UnlockX Scholarship Test - Class 11 JEE',
            'UnlockX Scholarship Test - Class 12 NEET',
        ];
        const label = stripSharedPrefix(names);
        expect(names.map(label)).toEqual([
            'Class 6',
            'Class 7',
            'Class 11 JEE',
            'Class 12 NEET',
        ]);
    });

    it('handles a colon separator', () => {
        const names = ['NEET 2027: Physics', 'NEET 2027: Chemistry'];
        expect(names.map(stripSharedPrefix(names))).toEqual(['Physics', 'Chemistry']);
    });

    it('keeps whole names when they share no separator-terminated prefix', () => {
        const names = ['Physics Crash Course', 'Chemistry Crash Course'];
        expect(names.map(stripSharedPrefix(names))).toEqual([
            'Physics Crash Course',
            'Chemistry Crash Course',
        ]);
    });

    it('keeps the whole name for a single course', () => {
        const names = ['UnlockX Scholarship Test - Class 6'];
        expect(names.map(stripSharedPrefix(names))).toEqual([
            'UnlockX Scholarship Test - Class 6',
        ]);
    });

    it('leaves a name that does not carry the shared prefix intact', () => {
        // One course renamed out of the family must not be truncated by an
        // accidental partial match.
        const names = [
            'UnlockX Scholarship Test - Class 6',
            'UnlockX Scholarship Test - Class 7',
            'Foundation Batch 2027',
        ];
        expect(names.map(stripSharedPrefix(names))).toEqual(names);
    });

    it('ignores blank names when computing the prefix', () => {
        const names = ['', 'Test Series - Class 9', 'Test Series - Class 10'];
        expect(names.map(stripSharedPrefix(names))).toEqual(['', 'Class 9', 'Class 10']);
    });
});
