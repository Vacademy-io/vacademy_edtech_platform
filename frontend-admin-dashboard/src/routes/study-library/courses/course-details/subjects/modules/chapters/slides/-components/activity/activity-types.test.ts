import { describe, expect, it } from 'vitest';
import {
    createDefaultPollData,
    gameReportsScore,
    isActivityDocType,
    newPollOptionId,
    parseGameData,
    parsePollData,
    pollProblems,
    serializeGameData,
    serializePollData,
} from './activity-types';

describe('activity slide data', () => {
    it('knows its three document types', () => {
        expect(['FLASHCARDS', 'POLL', 'GAME'].every(isActivityDocType)).toBe(true);
        expect(isActivityDocType('DISCUSSION')).toBe(false);
        expect(isActivityDocType(undefined)).toBe(false);
    });

    it('round-trips a poll and falls back on bad input', () => {
        const poll = {
            question: 'Best time to study?',
            options: [
                { id: 'a', text: 'Morning' },
                { id: 'b', text: 'Night' },
            ],
            settings: { results: 'ALWAYS' as const, allowChange: true },
        };
        expect(parsePollData(serializePollData(poll))).toEqual(poll);
        expect(parsePollData('{bad')).toEqual(createDefaultPollData());
        expect(
            parsePollData(JSON.stringify({ settings: { results: 'NOPE' } })).settings.results
        ).toBe('AFTER_VOTE');
    });

    it('lists what blocks a poll from being ready', () => {
        expect(pollProblems(createDefaultPollData())).toEqual([
            'poll.errors.question',
            'poll.errors.options',
        ]);
        const dup = {
            ...createDefaultPollData(),
            question: 'Q',
            options: [
                { id: 'a', text: 'Yes' },
                { id: 'b', text: 'yes ' },
            ],
        };
        expect(pollProblems(dup)).toEqual(['poll.errors.duplicate']);
    });

    it('mints option ids that are not taken', () => {
        expect(newPollOptionId(['a', 'b'])).toBe('c');
        expect(newPollOptionId('abcdefghijklmnopqrstuvwxyz'.split(''))).toBe('o1');
    });

    it('caps the game max score and notices pages that never report', () => {
        expect(parseGameData(JSON.stringify({ html: 'x', maxScore: 5000 })).maxScore).toBe(1000);
        expect(parseGameData(JSON.stringify({ html: 'x', maxScore: 0 })).maxScore).toBeNull();
        const g = {
            html: '<script>postMessage({type:"vacademy:complete"})</script>',
            maxScore: 10,
            instructions: 'Go',
        };
        expect(parseGameData(serializeGameData(g))).toEqual(g);
        expect(gameReportsScore(g.html)).toBe(true);
        expect(gameReportsScore('<p>hi</p>')).toBe(false);
    });
});
