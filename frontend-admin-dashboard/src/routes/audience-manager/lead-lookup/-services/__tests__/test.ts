import { describe, expect, it } from 'vitest';
import {
    isTermCompleteFor,
    lookupParamsFor,
    guessLookupMode,
} from '@/routes/audience-manager/lead-lookup/-services/lead-lookup';

/**
 * The three search modes. Phone and email keep the rules they always had; name
 * is the new one, and it is the only mode an institute has to switch on. The
 * backend matches a name in FULL, so "complete" here just means something was
 * actually typed — a first name will send, and correctly find nobody.
 */
describe('isTermCompleteFor', () => {
    // The box carries the dial code, so the check is country-aware (libphonenumber)
    // rather than a digit count.
    it('accepts a whole number, with or without separators', () => {
        expect(isTermCompleteFor('phone', '919876543210')).toBe(true);
        expect(isTermCompleteFor('phone', '+91 98765-43210')).toBe(true);
    });

    it('rejects a dial code on its own, or a few digits after it', () => {
        expect(isTermCompleteFor('phone', '91')).toBe(false);
        expect(isTermCompleteFor('phone', '98765')).toBe(false);
        expect(isTermCompleteFor('phone', '9199')).toBe(false);
    });

    // The widget always prefixes the dial code, so a bare national number no
    // longer reaches this check from the UI — and on its own it is ambiguous.
    it('does not accept a bare national number with no dial code', () => {
        expect(isTermCompleteFor('phone', '9876543210')).toBe(false);
    });

    it('accepts a number from another country, which the institute may well have', () => {
        expect(isTermCompleteFor('phone', '971508703934')).toBe(true);
        expect(isTermCompleteFor('phone', '447841061416')).toBe(true);
    });

    it('keeps the email rule: a fragment is not an address', () => {
        expect(isTermCompleteFor('email', 'ram@')).toBe(false);
        expect(isTermCompleteFor('email', 'ram@example.com')).toBe(true);
    });

    // A phone typed while the mode says email is the user's mistake to see, not
    // something to silently re-route — the modes are explicit now.
    it('does not re-interpret a value that suits another mode', () => {
        expect(isTermCompleteFor('email', '919876543210')).toBe(false);
        expect(isTermCompleteFor('phone', 'ram@example.com')).toBe(false);
    });

    it('accepts a name once it is more than a couple of letters', () => {
        expect(isTermCompleteFor('name', 'A')).toBe(false);
        expect(isTermCompleteFor('name', 'Asha Kulkarni')).toBe(true);
    });

    it.each(['phone', 'email', 'name'] as const)('rejects an empty box in %s mode', (mode) => {
        expect(isTermCompleteFor(mode, '')).toBe(false);
        expect(isTermCompleteFor(mode, '   ')).toBe(false);
    });
});

describe('lookupParamsFor', () => {
    it('sends the term under the key the chosen mode owns', () => {
        expect(lookupParamsFor('phone', ' 9876543210 ')).toEqual({ phone: '9876543210' });
        expect(lookupParamsFor('email', 'ram@example.com')).toEqual({ email: 'ram@example.com' });
        expect(lookupParamsFor('name', 'Asha Kulkarni')).toEqual({ name: 'Asha Kulkarni' });
    });

    it('sends nothing for an empty box, so the request is never made on a blank', () => {
        expect(lookupParamsFor('name', '   ')).toEqual({});
    });
});

describe('guessLookupMode', () => {
    it.each([
        ['ram@example.com', 'email'],
        ['9876543210', 'phone'],
        ['+91 98765-43210', 'phone'],
        ['Asha Kulkarni', 'name'],
    ])('reads %s as %s', (term, expected) => {
        expect(guessLookupMode(term)).toBe(expected);
    });

    it('has no opinion on an empty box', () => {
        expect(guessLookupMode('  ')).toBeNull();
    });
});

/**
 * Pasting the right thing into the wrong mode. The picker is explicit, but a
 * counsellor copying an address out of WhatsApp should not have to notice the
 * mode first — the paste switches to the mode the value plainly belongs to.
 */
describe('paste into the wrong mode', () => {
    it('an address pasted while the mode says name belongs to email', () => {
        expect(guessLookupMode('ram@example.com')).toBe('email');
    });

    it('a number pasted while the mode says email belongs to phone', () => {
        expect(guessLookupMode('+91 98765-43210')).toBe('phone');
    });

    // The guess must agree with the completeness check, or the mode flips and
    // the Check button stays dead with no explanation.
    it('a value it routes to phone is one the phone check also accepts', () => {
        const term = '919876543210';
        expect(guessLookupMode(term)).toBe('phone');
        expect(isTermCompleteFor('phone', term)).toBe(true);
    });

    it('a value it routes to email is one the email check also accepts', () => {
        const term = 'ram@example.com';
        expect(guessLookupMode(term)).toBe('email');
        expect(isTermCompleteFor('email', term)).toBe(true);
    });
});
