import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DiagnosisStageRow } from '@/services/engagement-diagnosis';
import {
    buildGapNotes,
    buildStageLines,
    panelState,
    stageChip,
    stageStatusKey,
    stageStatusLabel,
} from '../diagnosis-stages';
import { initI18n, problem } from './diagnosis-test-kit';

let t: TFunction;
beforeAll(async () => {
    t = await initI18n();
});

const stages = (...statuses: string[]): DiagnosisStageRow[] =>
    ['LEADS', 'CALLING', 'WHATSAPP', 'EMAIL', 'ENGINE'].map((stage, i) => ({
        stage,
        status: statuses[i] ?? 'OK',
    }));

describe('what a stage says', () => {
    it('says Normal, Nothing sent, Not enough data yet and Couldn’t load', () => {
        expect(stageStatusLabel('WHATSAPP', 'OK', 0, t)).toBe('Normal');
        expect(stageStatusLabel('WHATSAPP', 'NO_ACTIVITY', 0, t)).toBe('Nothing sent');
        expect(stageStatusLabel('EMAIL', 'NO_ACTIVITY', 0, t)).toBe('Nothing sent');
        expect(stageStatusLabel('WHATSAPP', 'NOT_ENOUGH_DATA', 0, t)).toBe('Not enough data yet');
        expect(stageStatusLabel('WHATSAPP', 'UNAVAILABLE', 0, t)).toBe('Couldn’t load');
    });

    it('words a quiet stage in its own way where "nothing sent" would be wrong', () => {
        expect(stageStatusLabel('LEADS', 'NO_ACTIVITY', 0, t)).toBe('No leads added');
        expect(stageStatusLabel('CALLING', 'NO_ACTIVITY', 0, t)).toBe('No calls placed');
        expect(stageStatusLabel('ENGINE', 'NO_ACTIVITY', 0, t)).toBe('No activity');
        // Only the quiet wording is stage-specific.
        expect(stageStatusLabel('LEADS', 'OK', 0, t)).toBe('Normal');
    });

    it('counts the problems of a stage, and says just "Needs attention" when the cap cut them', () => {
        expect(stageStatusLabel('EMAIL', 'PROBLEM', 1, t)).toBe('1 problem');
        expect(stageStatusLabel('EMAIL', 'PROBLEM', 3, t)).toBe('3 problems');
        expect(stageStatusLabel('EMAIL', 'PROBLEM', 0, t)).toBe('Needs attention');
    });

    it('never lets UNAVAILABLE, or a status it does not know, look like OK', () => {
        expect(stageChip('OK', null)).toEqual({ type: 'SUCCESS', icon: true });
        expect(stageChip('UNAVAILABLE', null).type).toBe('WARNING');
        expect(stageChip('UNAVAILABLE', null).type).not.toBe('SUCCESS');
        expect(stageChip('SOMETHING_NEW', null).type).toBe('WARNING');
        expect(stageStatusKey('SOMETHING_NEW')).toBe('UNKNOWN');
        expect(stageStatusLabel('LEADS', 'SOMETHING_NEW', 0, t)).toBe('Status unknown');
        // Quiet is grey, with no tick that would read as a pass.
        expect(stageChip('NO_ACTIVITY', null)).toEqual({ type: 'INFO', icon: false });
        expect(stageChip('NOT_ENOUGH_DATA', null)).toEqual({ type: 'INFO', icon: false });
    });

    it('colours a stage with problems by its worst one', () => {
        expect(stageChip('PROBLEM', 'critical').type).toBe('DANGER');
        expect(stageChip('PROBLEM', 'warning').type).toBe('WARNING');
    });
});

describe('one line per stage', () => {
    it('lists the stages in order, each with its own status and problem count', () => {
        const lines = buildStageLines(
            [...stages('OK', 'UNAVAILABLE', 'PROBLEM', 'NO_ACTIVITY', 'NOT_ENOUGH_DATA')].reverse(),
            [
                problem({ code: 'WHATSAPP_FAILED_HIGH', stage: 'WHATSAPP', severity: 'critical' }),
                problem({ code: 'TEMPLATE_UNDERPERFORMING', stage: 'WHATSAPP' }),
            ],
            t
        );
        expect(lines.map((l) => [l.label, l.statusLabel])).toEqual([
            ['Leads', 'Normal'],
            ['Calling', 'Couldn’t load'],
            ['WhatsApp', '2 problems'],
            ['Email', 'Nothing sent'],
            ['Engine', 'Not enough data yet'],
        ]);
        expect(lines[2]?.chip.type).toBe('DANGER');
        expect(lines[1]?.chip.type).toBe('WARNING');
    });

    it('puts a stage it does not know last, worded from its code', () => {
        const lines = buildStageLines([{ stage: 'BILLING', status: 'OK' }, ...stages()], [], t);
        expect(lines.at(-1)?.label).toBe('Billing');
    });
});

describe('what the top of the panel says', () => {
    const none = { problems: [], errors: {} };

    it('lists problems when there are some', () => {
        expect(
            panelState({
                problems: [problem({ code: 'X' })],
                stages: stages('PROBLEM'),
                errors: {},
            })
        ).toBe('problems');
    });

    it('is calm only when nothing fired and something was checked', () => {
        expect(panelState({ ...none, stages: stages() })).toBe('calm');
        expect(
            panelState({ ...none, stages: stages('OK', 'NO_ACTIVITY', 'NOT_ENOUGH_DATA') })
        ).toBe('calm');
    });

    it('is quiet when nothing had enough activity to be judged', () => {
        expect(
            panelState({
                ...none,
                stages: stages(
                    'NO_ACTIVITY',
                    'NO_ACTIVITY',
                    'NOT_ENOUGH_DATA',
                    'NO_ACTIVITY',
                    'NO_ACTIVITY'
                ),
            })
        ).toBe('quiet');
    });

    it('is never a clean bill when a stage could not be read, or a section failed', () => {
        expect(panelState({ ...none, stages: stages('OK', 'UNAVAILABLE') })).toBe('incomplete');
        expect(panelState({ ...none, stages: stages('OK', 'WHO_KNOWS') })).toBe('incomplete');
        expect(
            panelState({ ...none, stages: stages('OK'), errors: { calls: 'unavailable' } })
        ).toBe('incomplete');
        // A stage that says PROBLEM with no problem to list cannot be called fine either.
        expect(panelState({ ...none, stages: stages('OK', 'PROBLEM') })).toBe('incomplete');
    });
});

describe('what the report cannot see', () => {
    it('says replies are not tracked for these senders, so a 0 is not read as real', () => {
        const [note] = buildGapNotes(
            [
                {
                    code: 'EMAIL_REPLIES_NOT_TRACKED',
                    names: ['hello@example.com', 'team@example.org'],
                },
            ],
            {},
            t
        );
        expect(note).toBe(
            'Email replies can’t be seen for hello@example.com, team@example.org, so a reply count of 0 may not be real.'
        );
    });

    it('shortens a long list of senders', () => {
        const [note] = buildGapNotes(
            [
                {
                    code: 'EMAIL_REPLIES_NOT_TRACKED',
                    names: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
                },
            ],
            {},
            t
        );
        expect(note).toContain('a@example.com, b@example.com, c@example.com and 1 more');
    });

    it('has a note for each known gap and a safe one for an unknown gap', () => {
        const notes = buildGapNotes(
            [
                { code: 'EMAIL_TRACKING_OFF', names: [] },
                { code: 'WHATSAPP_TRACKING_OFF', names: [] },
                { code: 'CALL_ANALYSIS_EMPTY', names: [] },
                { code: 'A_NEW_GAP', names: [] },
            ],
            {},
            t
        );
        expect(notes).toEqual([
            'Email delivery isn’t tracked for your sender, so bounces and spam complaints can’t be seen.',
            'WhatsApp delivery isn’t tracked for your provider, so failures after sending can’t be seen.',
            'Calls were answered but none have been analysed yet, so call insights are empty.',
            'Some figures may be incomplete.',
        ]);
    });

    it('still reads as a sentence when no sender can be named', () => {
        expect(buildGapNotes([{ code: 'EMAIL_REPLIES_NOT_TRACKED', names: [] }], {}, t)).toEqual([
            'Email replies can’t be seen for these emails, so a reply count of 0 may not be real.',
        ]);
    });

    it('says why a part is missing: too many messages is not the same as a failed read', () => {
        expect(buildGapNotes([], { delivery: 'too_many', replies: 'too_many' }, t)).toEqual([
            'This period has too many messages to read delivery and replies for, so those parts can’t be judged. Try one engine.',
        ]);
        expect(buildGapNotes([], { calls: 'unavailable' }, t)).toEqual([
            'Some parts of this report couldn’t be read. They’re marked, and they aren’t counted as zero.',
        ]);
        expect(buildGapNotes([], {}, t)).toEqual([]);
    });
});
