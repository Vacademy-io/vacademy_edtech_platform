import { describe, expect, it } from 'vitest';
import {
    CARD_ID_PATTERN,
    FLASHCARD_ERRORS,
    detectSeparator,
    estimateFlashcardMinutes,
    extractLegacyDeck,
    findDuplicateFronts,
    flashcardsDeckSchema,
    mergeImportedCards,
    mintCardId,
    normalizeCardText,
    parseFlashcardsPayload,
    parseImport,
    serializeFlashcardsPayload,
    type FlashcardsDeck,
} from '../../-components/flashcards/flashcards-schema';

const card = (front: string, back: string, id = mintCardId()) => ({ id, front, back });

describe('mintCardId', () => {
    it('matches the server id pattern and never repeats a taken id', () => {
        const taken = new Set<string>();
        for (let i = 0; i < 500; i++) {
            const id = mintCardId(taken);
            expect(id).toMatch(CARD_ID_PATTERN);
            expect(id).toMatch(/^c_[a-z0-9]{6}$/);
            expect(taken.has(id)).toBe(false);
            taken.add(id);
        }
    });
});

describe('estimateFlashcardMinutes', () => {
    it('is about 12 s a card, never below a minute', () => {
        expect(estimateFlashcardMinutes(0)).toBe(1);
        expect(estimateFlashcardMinutes(1)).toBe(1);
        expect(estimateFlashcardMinutes(5)).toBe(1);
        expect(estimateFlashcardMinutes(6)).toBe(2);
        expect(estimateFlashcardMinutes(12)).toBe(3);
        expect(estimateFlashcardMinutes(50)).toBe(10);
    });
});

describe('CSV import', () => {
    it('splits on commas only, never on a delimiter Papa would guess', () => {
        expect(detectSeparator('Alpha; first letter\nBeta; second letter')).not.toBe('comma');
        const semi = parseImport('Alpha;first\nBeta;second', { separator: 'comma' });
        expect(semi.rows.map((r) => r.status)).toEqual(['missingBack', 'missingBack']);
    });
});

describe('normalizeCardText', () => {
    it('keeps markup-looking text verbatim and removes control characters but not newlines', () => {
        expect(normalizeCardText('  2 < x > 1 ')).toBe('2 < x > 1');
        expect(normalizeCardText('<b>x</b>')).toBe('<b>x</b>');
        expect(normalizeCardText('a\u0007b\r\nc\td')).toBe('ab\nc d');
        expect(normalizeCardText('a    b')).toBe('a b');
    });

    it('matches the server byte for byte (FlashcardsPayloadValidatorTest cases)', () => {
        expect(normalizeCardText('x   y')).toBe('x y');
        expect(normalizeCardText('a\u000Bb\fc\u00A0d\u2003e\u3000f\uFEFFg')).toBe('a b c d e f g');
        // Controls go before spaces collapse, so no double space is left behind.
        expect(normalizeCardText('\uFEFF a \u0007 b  ')).toBe('a b');
        // C1 controls (NEL, APC) are dropped, not kept.
        expect(normalizeCardText('a\u0085\u009Fb')).toBe('ab');
        // U+2028 is a space, not a line break, for the 12-line rule.
        expect(normalizeCardText('1\u20282\u20293')).toBe('1 2 3');
        expect(normalizeCardText('\u{1F469}\u200D\u{1F4BB}')).toBe('\u{1F469}\u200D\u{1F4BB}');
        expect(normalizeCardText(' line1 \r\nline2\rline3 ')).toBe('line1 \nline2\nline3');
    });
});

describe('flashcardsDeckSchema', () => {
    const deck = (cards: FlashcardsDeck['cards']): FlashcardsDeck => ({ cards, shuffle: true });
    const messages = (value: FlashcardsDeck) => {
        const result = flashcardsDeckSchema.safeParse(value);
        return result.success ? [] : result.error.issues.map((i) => i.message);
    };

    it('accepts 1 card and rejects 0 and 51', () => {
        expect(messages(deck([card('Front', 'Back')]))).toEqual([]);
        expect(messages(deck([]))).toContain(FLASHCARD_ERRORS.cardsMin);
        const many = Array.from({ length: 51 }, (_, i) => card(`F${i}`, `B${i}`));
        expect(messages(deck(many))).toContain(FLASHCARD_ERRORS.cardsMax);
    });

    it('rejects a blank back, an over-long face and a 13-line face', () => {
        expect(messages(deck([card('Front', '   ')]))).toContain(FLASHCARD_ERRORS.cardBack);
        expect(messages(deck([card('x'.repeat(201), 'Back')]))).toContain(
            FLASHCARD_ERRORS.cardTooLong
        );
        expect(messages(deck([card('x'.repeat(200), 'y'.repeat(500))]))).toEqual([]);
        const lines = Array.from({ length: 13 }, (_, i) => `line ${i}`).join('\n');
        expect(messages(deck([card('Front', lines)]))).toContain(FLASHCARD_ERRORS.cardTooManyLines);
    });

    it('rejects a bad or duplicate id', () => {
        expect(messages(deck([card('A', 'B', 'Bad Id')]))).toContain(FLASHCARD_ERRORS.cardId);
        expect(messages(deck([card('A', 'B', 'c_same'), card('C', 'D', 'c_same')]))).toContain(
            FLASHCARD_ERRORS.cardDuplicateId
        );
    });
});

describe('payload round trip', () => {
    it('serialises the v1 schema and reads it back', () => {
        const deck: FlashcardsDeck = {
            cards: [
                {
                    id: 'c_aaaaaa',
                    front: ' Impairment ',
                    back: 'A problem in body function',
                    hint: '',
                },
                { id: 'c_bbbbbb', front: '2 < x > 1', back: '<b>x</b>', hint: 'Body level' },
            ],
            shuffle: false,
        };
        const json = serializeFlashcardsPayload(deck);
        expect(JSON.parse(json)).toEqual({
            schema: 'flashcards/v1',
            cards: [
                { id: 'c_aaaaaa', front: 'Impairment', back: 'A problem in body function' },
                { id: 'c_bbbbbb', front: '2 < x > 1', back: '<b>x</b>', hint: 'Body level' },
            ],
            settings: { shuffle: false },
        });
        const back = parseFlashcardsPayload(json);
        expect(back?.shuffle).toBe(false);
        expect(back?.cards.map((c) => c.id)).toEqual(['c_aaaaaa', 'c_bbbbbb']);
        expect(serializeFlashcardsPayload(back!)).toBe(json);
    });

    it('mints ids for missing ones and defaults shuffle to true', () => {
        const parsed = parseFlashcardsPayload('{"cards":[{"front":"A","back":"B"}]}');
        expect(parsed?.shuffle).toBe(true);
        expect(parsed?.cards[0]?.id).toMatch(CARD_ID_PATTERN);
        expect(parseFlashcardsPayload('not json')).toBeNull();
        expect(parseFlashcardsPayload('{"prompt":"x"}')).toBeNull();
    });
});

describe('parseImport', () => {
    it('splits tab-separated rows, with an optional hint column', () => {
        const result = parseImport(
            'Impairment\tA problem in body function\tBody level\nActivity\tA task'
        );
        expect(result.separator).toBe('tab');
        expect(result.cards).toHaveLength(2);
        expect(result.cards[0]).toMatchObject({
            front: 'Impairment',
            back: 'A problem in body function',
            hint: 'Body level',
        });
        expect(result.cards[1]).not.toHaveProperty('hint');
        result.cards.forEach((c) => expect(c.id).toMatch(CARD_ID_PATTERN));
    });

    it('splits on a spaced en dash even when the back has a comma', () => {
        const text =
            'Osmosis – water moves across a membrane, slowly\nDiffusion – particles spread out';
        const result = parseImport(text);
        expect(result.separator).toBe('dash');
        expect(result.cards.map((c) => [c.front, c.back])).toEqual([
            ['Osmosis', 'water moves across a membrane, slowly'],
            ['Diffusion', 'particles spread out'],
        ]);
        // Hyphen and em dash are part of the family too.
        expect(parseImport('A - b\nC — d', { separator: 'dash' }).cards).toHaveLength(2);
    });

    it('parses CSV with quoted commas and skips a header row', () => {
        const text = [
            'front,back',
            '"Newton\'s first law","An object at rest, stays at rest"',
            '"F = ma","Force equals mass times acceleration"',
        ].join('\n');
        expect(detectSeparator(text)).toBe('comma');
        const result = parseImport(text, { header: true });
        expect(result.separator).toBe('comma');
        expect(result.cards.map((c) => [c.front, c.back])).toEqual([
            ["Newton's first law", 'An object at rest, stays at rest'],
            ['F = ma', 'Force equals mass times acceleration'],
        ]);
        // Without the header flag the header becomes a card.
        expect(parseImport(text).cards).toHaveLength(3);
    });

    it('ignores blank lines', () => {
        const result = parseImport('\n\nA\tB\n\n   \nC\tD\n\n');
        expect(result.rows).toHaveLength(2);
        expect(result.rows.map((r) => r.row)).toEqual([1, 2]);
        expect(result.cards).toHaveLength(2);
    });

    it('lists invalid rows but excludes them, and flags duplicate fronts without dropping them', () => {
        const text = [
            'Alpha\tFirst',
            'Beta',
            `Gamma\t${'x'.repeat(501)}`,
            'alpha\tAgain',
            '\tNo front',
        ].join('\n');
        const result = parseImport(text, { separator: 'tab' });
        expect(result.rows.map((r) => r.status)).toEqual([
            'ok',
            'missingBack',
            'tooLong',
            'duplicate',
            'missingFront',
        ]);
        expect(result.invalidCount).toBe(3);
        expect(result.cards.map((c) => c.front)).toEqual(['Alpha', 'alpha']);
    });

    it('flags a front that already exists in the deck', () => {
        const result = parseImport('Alpha\tFirst', { existingFronts: ['ALPHA'] });
        expect(result.rows[0]?.status).toBe('duplicate');
    });

    it('caps at 50 cards and reports how many were left out', () => {
        const text = Array.from({ length: 200 }, (_, i) => `Term ${i}\tDefinition ${i}`).join('\n');
        const result = parseImport(text);
        expect(result.cards).toHaveLength(50);
        expect(result.importableCount).toBe(200);
        expect(result.notImported).toBe(150);
        expect(new Set(result.cards.map((c) => c.id)).size).toBe(50);

        const appended = parseImport(text, { existingCount: 45 });
        expect(appended.cards).toHaveLength(5);
        expect(appended.notImported).toBe(195);
    });

    it('supports colon and custom separators', () => {
        expect(parseImport('Term: the definition: with colon').cards[0]).toMatchObject({
            front: 'Term',
            back: 'the definition: with colon',
        });
        expect(
            parseImport('Term => meaning', { separator: 'custom', custom: '=>' }).cards[0]
        ).toMatchObject({ front: 'Term', back: 'meaning' });
    });
});

describe('mergeImportedCards', () => {
    it('append gives every imported card a new id after the existing ones', () => {
        const existing = [card('A', '1', 'c_a00000')];
        const imported = [card('B', '2', 'c_a00000')];
        const { cards, dropped } = mergeImportedCards(existing, imported, 'append');
        expect(cards.map((c) => c.front)).toEqual(['A', 'B']);
        expect(cards[1]?.id).not.toBe('c_a00000');
        expect(dropped).toBe(0);
    });

    it('replace keeps the id of a card whose front matches exactly', () => {
        const existing = [card('Alpha', 'old', 'c_alpha0'), card('Beta', 'old', 'c_beta00')];
        const imported = [card('Beta', 'new'), card('Gamma', 'new')];
        const { cards } = mergeImportedCards(existing, imported, 'replace');
        expect(cards[0]).toMatchObject({ id: 'c_beta00', back: 'new' });
        expect(cards[1]?.id).not.toBe('c_alpha0');
        expect(cards[1]?.id).toMatch(CARD_ID_PATTERN);
    });

    it('caps a merge at 50', () => {
        const existing = Array.from({ length: 48 }, (_, i) => card(`E${i}`, 'x'));
        const imported = Array.from({ length: 5 }, (_, i) => card(`I${i}`, 'y'));
        const { cards, dropped } = mergeImportedCards(existing, imported, 'append');
        expect(cards).toHaveLength(50);
        expect(dropped).toBe(3);
    });
});

describe('findDuplicateFronts', () => {
    it('returns later repeats, ignoring case and spacing', () => {
        expect(
            findDuplicateFronts([{ front: 'Cell' }, { front: 'cell ' }, { front: 'Atom' }])
        ).toEqual([1]);
    });
});

describe('extractLegacyDeck', () => {
    it('reads the cards out of an AI flashcard GAME page and unescapes them', () => {
        const html =
            '<script>var cards=[{"front": "Mitochondria", "back": "The cell&#x27;s powerhouse"}, ' +
            '{"front": "2 &lt; 3", "back": "true [really]"}], i=0, known=0;</script>';
        const deck = extractLegacyDeck(html);
        expect(deck?.cards.map((c) => [c.front, c.back])).toEqual([
            ['Mitochondria', "The cell's powerhouse"],
            ['2 < 3', 'true [really]'],
        ]);
        deck?.cards.forEach((c) => expect(c.id).toMatch(CARD_ID_PATTERN));
        expect(extractLegacyDeck('<p>no deck here</p>')).toBeNull();
    });
});
