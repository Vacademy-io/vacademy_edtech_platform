import { describe, expect, it } from 'vitest';
import { fallbackDescription, splitDescriptionParts } from './ActivityLogTable';

/**
 * The audit table bolds the *names* inside each sentence by matching the
 * description against an ordered list of patterns whose capture groups
 * alternate connective / name. Two things go wrong silently there:
 *
 *  - a looser pattern placed before a specific one swallows the specific case,
 *    so "assigned 5 lead(s) to Riya" bolds the wrong half;
 *  - a pattern with an even number of groups shifts the alternation and bolds
 *    the connective text instead of the name.
 *
 * Neither is a type error and neither makes a render fail — the row just reads
 * wrong. So the split is asserted directly.
 */
describe('splitDescriptionParts', () => {
    const nameParts = (description: string): string[] => {
        const parts = splitDescriptionParts(description);
        expect(parts, `no pattern matched: "${description}"`).not.toBeNull();
        // Odd indexes are the emphasised fragments.
        return (parts as string[]).filter((_, index) => index % 2 === 1);
    };

    it('bolds the assessment name on assessment actions reported by assessment_service', () => {
        expect(nameParts('created assessment Class X Science - Part Test 2')).toEqual([
            'Class X Science - Part Test 2',
        ]);
        expect(nameParts('published assessment Weekly Quiz 4')).toEqual(['Weekly Quiz 4']);
        expect(nameParts('deleted assessment Weekly Quiz 4')).toEqual(['Weekly Quiz 4']);
        expect(nameParts('updated sections and questions of assessment Weekly Quiz 4')).toEqual([
            'Weekly Quiz 4',
        ]);
        expect(nameParts('edited 1 question of assessment Weekly Quiz 4')).toEqual([
            'Weekly Quiz 4',
        ]);
        expect(nameParts('edited 3 questions of assessment Weekly Quiz 4')).toEqual([
            'Weekly Quiz 4',
        ]);
    });

    it('bolds the plan name on payment and fee plan actions', () => {
        expect(nameParts('created payment plan Annual Membership')).toEqual(['Annual Membership']);
        expect(nameParts('updated payment plan Annual Membership')).toEqual(['Annual Membership']);
        expect(nameParts('deleted payment plan Annual Membership')).toEqual(['Annual Membership']);
        expect(nameParts('created fee plan Grade 10 Tuition 2026')).toEqual([
            'Grade 10 Tuition 2026',
        ]);
        expect(nameParts('approved fee plan Grade 10 Tuition 2026')).toEqual([
            'Grade 10 Tuition 2026',
        ]);
        expect(nameParts('updated fee type Admission Fee')).toEqual(['Admission Fee']);
        // The trailing clause stays plain; only the plan name is emphasised.
        expect(nameParts('made payment plan Annual Membership the default')).toEqual([
            'Annual Membership',
        ]);
    });

    it('leaves a bulk plan delete unemphasised — there is no single name to bold', () => {
        expect(splitDescriptionParts('deleted 3 payment plan(s)')).toBeNull();
    });

    it('bolds the learner name on progress report generation', () => {
        expect(
            nameParts('generated progress report for Anmol Agarwal (2026-04-01 to 2026-09-29)')
        ).toEqual(['Anmol Agarwal']);
    });

    it('bolds the material and its chapter on live-session class material actions', () => {
        expect(
            nameParts('added class material Revision Class for all chapter to Lecture PDF, Notes')
        ).toEqual(['Revision Class for all chapter', 'Lecture PDF, Notes']);
        expect(nameParts('added recording Maths Live 3 Oct to Recordings')).toEqual([
            'Maths Live 3 Oct',
            'Recordings',
        ]);
        expect(nameParts('removed class material Intro to Algebra from Lecture PDF')).toEqual([
            'Intro to Algebra',
            'Lecture PDF',
        ]);
        expect(nameParts('renamed class material Old Notes to Chapter 3 Revision')).toEqual([
            'Old Notes',
            'Chapter 3 Revision',
        ]);
        // Chapter could not be resolved — still bold the material.
        expect(nameParts('added class material Revision Class')).toEqual(['Revision Class']);
    });

    it('bolds the invite name on invite link actions', () => {
        expect(nameParts('created invite link Summer Batch 2026')).toEqual(['Summer Batch 2026']);
        expect(nameParts('updated invite link Summer Batch 2026')).toEqual(['Summer Batch 2026']);
        expect(nameParts('deleted invite link Summer Batch 2026')).toEqual(['Summer Batch 2026']);
        // Both the invite and the course it now fronts are emphasised; the
        // connective "the default for" stays plain.
        expect(nameParts('made invite link Early Bird the default for Physics 201')).toEqual([
            'Early Bird',
            'Physics 201',
        ]);
        expect(nameParts('assigned fee plan to invite link Early Bird for Physics 201')).toEqual([
            'Early Bird',
            'Physics 201',
        ]);
        expect(nameParts('updated payment plans of invite link Early Bird')).toEqual([
            'Early Bird',
        ]);
    });

    it('leaves a bulk invite delete unemphasised', () => {
        expect(splitDescriptionParts('deleted 3 invite link(s)')).toBeNull();
    });

    it('bolds the audience name on campaign actions', () => {
        expect(nameParts('created audience Winter Admissions 2026')).toEqual([
            'Winter Admissions 2026',
        ]);
        expect(nameParts('deleted audience Winter Admissions 2026')).toEqual([
            'Winter Admissions 2026',
        ]);
        expect(nameParts('sent a message to audience Winter Admissions 2026')).toEqual([
            'Winter Admissions 2026',
        ]);
    });

    it('bolds both the lead and the counsellor on an assignment', () => {
        expect(nameParts('assigned lead Amit Kumar to Riya Sharma')).toEqual([
            'Amit Kumar',
            'Riya Sharma',
        ]);
        expect(nameParts('unassigned counsellor from lead Amit Kumar')).toEqual(['Amit Kumar']);
    });

    it('bolds the count on bulk lead actions, with and without a target', () => {
        expect(nameParts('assigned 12 lead(s) to Riya Sharma')).toEqual([
            '12 lead(s)',
            'Riya Sharma',
        ]);
        expect(nameParts('reassigned 12 lead(s) from Riya Sharma')).toEqual([
            '12 lead(s)',
            'Riya Sharma',
        ]);
        expect(nameParts('assigned 12 lead(s)')).toEqual(['12 lead(s)']);
        expect(nameParts('imported 340 lead(s) into Winter Admissions 2026')).toEqual([
            '340 lead(s)',
            'Winter Admissions 2026',
        ]);
    });

    it('bolds the lead and the new value on status, tier and score changes', () => {
        expect(nameParts('changed lead status of Amit Kumar to Interested')).toEqual([
            'Amit Kumar',
            'Interested',
        ]);
        expect(nameParts('changed lead tier of Amit Kumar to HOT')).toEqual(['Amit Kumar', 'HOT']);
        expect(nameParts('changed lead score of Amit Kumar to 75')).toEqual(['Amit Kumar', '75']);
    });

    it('handles the remaining CRM sentences the backend emits', () => {
        expect(nameParts('added lead Sneha Rao')).toEqual(['Sneha Rao']);
        expect(nameParts('registered walk-in lead Sneha Rao')).toEqual(['Sneha Rao']);
        expect(nameParts('marked lead Sneha Rao as converted')).toEqual(['Sneha Rao']);
        expect(nameParts('scheduled a follow-up for lead Sneha Rao')).toEqual(['Sneha Rao']);
        expect(nameParts('closed a follow-up for lead Sneha Rao')).toEqual(['Sneha Rao']);
        expect(nameParts('created lead status Interested')).toEqual(['Interested']);
        expect(nameParts('tagged 48 contact(s) with Hot Leads')).toEqual([
            '48 contact(s)',
            'Hot Leads',
        ]);
        expect(nameParts('removed tags from 48 contact(s)')).toEqual(['48 contact(s)']);
        expect(nameParts('created tag Hot Leads')).toEqual(['Hot Leads']);
        expect(nameParts('created automation Fee reminder')).toEqual(['Fee reminder']);
        expect(nameParts('created engagement engine Winback')).toEqual(['Winback']);
        expect(
            nameParts('connected Meta lead form Admissions Enquiry to audience Winter Admissions')
        ).toEqual(['Admissions Enquiry', 'Winter Admissions']);
        expect(nameParts('changed the status of 6 enquiry(s) to CLOSED')).toEqual([
            '6 enquiry(s)',
            'CLOSED',
        ]);
    });

    it('still bolds the learning-side sentences that shipped first', () => {
        expect(nameParts('created course Mathematics 101')).toEqual(['Mathematics 101']);
        expect(nameParts('scheduled live session Demo')).toEqual(['Demo']);
        expect(nameParts('enrolled learner Amit Kumar in Physics 201')).toEqual([
            'Amit Kumar',
            'Physics 201',
        ]);
        expect(nameParts('terminated Amit Kumar from Physics 201')).toEqual([
            'Amit Kumar',
            'Physics 201',
        ]);
        expect(nameParts('moved Amit Kumar from Batch A to Batch B')).toEqual([
            'Amit Kumar',
            'Batch A',
            'Batch B',
        ]);
    });

    it('leaves a sentence it does not recognise entirely unstyled', () => {
        expect(splitDescriptionParts('updated TAT and follow-up SLA settings')).toBeNull();
        expect(splitDescriptionParts('disconnected a lead connector')).toBeNull();
        expect(splitDescriptionParts('deleted a counsellor pool')).toBeNull();
    });

    it('every emphasised fragment sits at an odd index', () => {
        const parts = splitDescriptionParts('assigned lead Amit Kumar to Riya Sharma');
        expect(parts).toEqual(['assigned lead ', 'Amit Kumar', ' to ', 'Riya Sharma']);
    });
});

describe('fallbackDescription', () => {
    it('reads as a sentence when the backend stored no description', () => {
        expect(fallbackDescription({ action: 'CREATE', entity_type: 'LEAD_FOLLOWUP' })).toBe(
            'created a lead followup'
        );
    });
});
