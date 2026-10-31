import Papa from 'papaparse';
import { z } from 'zod';
import { FLASHCARDS_SCHEMA, type FlashcardCard, type FlashcardsPayload } from '../../-types/types';

/**
 * FLASHCARDS authoring rules, identical to the server's FlashcardsPayloadValidator
 * (flashcards spec B1). The server is authoritative; this copy exists so the editor
 * can show every problem inline before a save, instead of one server message at a time.
 *
 * - 1–50 cards. Faces are plain text, never HTML, and are never stripped of tags.
 * - Lengths are UTF-16 units after normalising: front 1–200, back 1–500, hint 0–150.
 * - A face with more than 12 lines is rejected, never truncated.
 * - Card ids match ^[a-z0-9_-]{1,24}$ and are unique. The client mints them
 *   (`c_` + 6 base36) when a row is created; they survive edits.
 * - Settings: only `shuffle` (default true). Unknown keys are dropped.
 *
 * Zod messages are i18n keys in the `engagement` namespace (`t(error.message)`).
 */

export const FLASHCARD_LIMITS = {
    minCards: 1,
    maxCards: 50,
    front: 200,
    back: 500,
    hint: 150,
    lines: 12,
} as const;

export const CARD_ID_PATTERN = /^[a-z0-9_-]{1,24}$/;

/** i18n keys (namespace `engagement`) used as zod messages and import row statuses. */
export const FLASHCARD_ERRORS = {
    cardsMin: 'composer.errors.cardsMin',
    cardsMax: 'composer.errors.cardsMax',
    cardFront: 'composer.errors.cardFront',
    cardBack: 'composer.errors.cardBack',
    cardTooLong: 'composer.errors.cardTooLong',
    cardTooManyLines: 'composer.errors.cardTooManyLines',
    cardId: 'composer.errors.cardId',
    cardDuplicateId: 'composer.errors.cardDuplicateId',
} as const;

/** What the composer edits for one deck (payload minus the schema tag). */
export interface FlashcardsDeck {
    cards: FlashcardCard[];
    shuffle: boolean;
}

// ── Text normalisation ───────────────────────────────────────────────────────

/** Every character JS `\s` matches except LF: these become one space. */
const HORIZONTAL_SPACE = /[^\S\n]/;

/**
 * The server's normalisation (FlashcardsPayloadValidator.normalise), step for step:
 * CRLF and lone CR → LF; every other whitespace character (tab, VT, FF, NBSP, U+2028,
 * BOM…) → a space; the remaining control characters (C0, DEL, C1) are dropped; THEN
 * runs of spaces collapse to one and the face is trimmed. Dropping controls before the
 * collapse matters: "a \u0007 b" is "a b" on both sides, not "a  b". Tags are left
 * alone, so `2 < x > 1` and `<b>` stay verbatim.
 */
export function normalizeCardText(raw: string | null | undefined): string {
    if (!raw) return '';
    const lines = raw.replace(/\r\n?/g, '\n');
    let out = '';
    for (const ch of lines) {
        if (ch === '\n') {
            out += ch;
            continue;
        }
        if (HORIZONTAL_SPACE.test(ch)) {
            out += ' ';
            continue;
        }
        const code = ch.charCodeAt(0);
        const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
        if (!isControl) out += ch;
    }
    return out.replace(/ {2,}/g, ' ').trim();
}

export function lineCount(text: string): number {
    return text === '' ? 0 : text.split('\n').length;
}

/** Key for duplicate-front checks: normalised and case-folded. */
export function frontKey(front: string): string {
    return normalizeCardText(front).toLocaleLowerCase('en');
}

// ── Schema ───────────────────────────────────────────────────────────────────

function face(max: number, requiredKey?: string) {
    return z.string().superRefine((raw, ctx) => {
        const value = normalizeCardText(raw);
        if (requiredKey && value.length === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: requiredKey });
        } else if (value.length > max) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FLASHCARD_ERRORS.cardTooLong,
                params: { max },
            });
        } else if (lineCount(value) > FLASHCARD_LIMITS.lines) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: FLASHCARD_ERRORS.cardTooManyLines,
                params: { max: FLASHCARD_LIMITS.lines },
            });
        }
    });
}

export const flashcardSchema = z.object({
    id: z.string().regex(CARD_ID_PATTERN, FLASHCARD_ERRORS.cardId),
    front: face(FLASHCARD_LIMITS.front, FLASHCARD_ERRORS.cardFront),
    back: face(FLASHCARD_LIMITS.back, FLASHCARD_ERRORS.cardBack),
    hint: face(FLASHCARD_LIMITS.hint).optional(),
});

const cardsSchema = z
    .array(flashcardSchema)
    .min(FLASHCARD_LIMITS.minCards, FLASHCARD_ERRORS.cardsMin)
    .max(FLASHCARD_LIMITS.maxCards, FLASHCARD_ERRORS.cardsMax)
    .superRefine((cards, ctx) => {
        const seen = new Set<string>();
        cards.forEach((card, index) => {
            if (seen.has(card.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: FLASHCARD_ERRORS.cardDuplicateId,
                    path: [index, 'id'],
                });
            }
            seen.add(card.id);
        });
    });

/** The deck as the composer edits it (`item.flashcards`). */
export const flashcardsDeckSchema = z.object({
    cards: cardsSchema,
    shuffle: z.boolean(),
});

/** The stored v1 payload. */
export const flashcardsPayloadSchema = z.object({
    schema: z.literal(FLASHCARDS_SCHEMA),
    cards: cardsSchema,
    settings: z.object({ shuffle: z.boolean() }),
});

// ── Ids, cards, estimates ────────────────────────────────────────────────────

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBase36(length: number): string {
    const values = new Uint32Array(length);
    try {
        globalThis.crypto.getRandomValues(values);
    } catch {
        for (let i = 0; i < length; i++) values[i] = Math.floor(Math.random() * 2 ** 32);
    }
    let out = '';
    for (const v of values) out += BASE36[v % 36];
    return out;
}

/** A fresh card id, `c_` plus 6 base36 characters, never one of `taken`. */
export function mintCardId(taken?: Iterable<string>): string {
    const used = taken instanceof Set ? (taken as Set<string>) : new Set(taken ?? []);
    for (;;) {
        const id = `c_${randomBase36(6)}`;
        if (!used.has(id)) return id;
    }
}

/** An empty card with a fresh id. */
export function newFlashcard(taken?: Iterable<string>): FlashcardCard {
    return { id: mintCardId(taken), front: '', back: '' };
}

/** An empty deck with one card, shuffle on. */
export function newFlashcardsDeck(): FlashcardsDeck {
    return { cards: [newFlashcard()], shuffle: true };
}

/** Minutes a learner needs for a deck: about 12 s a card, at least 1. */
export function estimateFlashcardMinutes(cardCount: number): number {
    return Math.max(1, Math.ceil((Math.max(0, cardCount) * 12) / 60));
}

/** Indexes of cards whose front repeats an earlier card's (a warning, never a block). */
export function findDuplicateFronts(cards: Pick<FlashcardCard, 'front'>[]): number[] {
    const seen = new Set<string>();
    const out: number[] = [];
    cards.forEach((card, index) => {
        const key = frontKey(card.front);
        if (!key) return;
        if (seen.has(key)) out.push(index);
        seen.add(key);
    });
    return out;
}

// ── Payload in and out ───────────────────────────────────────────────────────

/**
 * Read a stored payload into a deck. Tolerant, like the server's readTrusted: a card
 * with a missing or invalid id gets a fresh one, and a missing `shuffle` is true.
 * Returns null when the JSON has no card list at all.
 */
export function parseFlashcardsPayload(json: string | null | undefined): FlashcardsDeck | null {
    if (!json) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const body = raw as { cards?: unknown; settings?: { shuffle?: unknown } };
    if (!Array.isArray(body.cards)) return null;
    const taken = new Set<string>();
    const cards: FlashcardCard[] = [];
    for (const entry of body.cards) {
        if (!entry || typeof entry !== 'object') continue;
        const c = entry as Record<string, unknown>;
        const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
        let id = typeof c.id === 'string' ? c.id : '';
        if (!CARD_ID_PATTERN.test(id) || taken.has(id)) id = mintCardId(taken);
        taken.add(id);
        const hint = text(c.hint);
        cards.push({ id, front: text(c.front), back: text(c.back), ...(hint ? { hint } : {}) });
    }
    const shuffle = body.settings?.shuffle;
    return { cards, shuffle: typeof shuffle === 'boolean' ? shuffle : true };
}

/**
 * The canonical v1 payload for a deck: faces normalised, a blank hint left out, a
 * missing or repeated id replaced. Validate with {@link flashcardsDeckSchema} first;
 * this never throws.
 */
export function toFlashcardsPayload(deck: FlashcardsDeck): FlashcardsPayload {
    const taken = new Set<string>();
    const cards = deck.cards.map((card) => {
        let id = card.id;
        if (!CARD_ID_PATTERN.test(id ?? '') || taken.has(id)) id = mintCardId(taken);
        taken.add(id);
        const hint = normalizeCardText(card.hint);
        return {
            id,
            front: normalizeCardText(card.front),
            back: normalizeCardText(card.back),
            ...(hint ? { hint } : {}),
        };
    });
    return { schema: FLASHCARDS_SCHEMA, cards, settings: { shuffle: deck.shuffle } };
}

export function serializeFlashcardsPayload(deck: FlashcardsDeck): string {
    return JSON.stringify(toFlashcardsPayload(deck));
}

/** True when two decks would store the same payload (used to keep an unchanged task unchanged). */
export function sameDeck(a: FlashcardsDeck, b: FlashcardsDeck): boolean {
    return serializeFlashcardsPayload(a) === serializeFlashcardsPayload(b);
}

/**
 * Pull the cards out of a legacy AI deck stored as a GAME page (`var cards=[…]` with
 * HTML-escaped faces), so it can be opened in the card editor. Null when the HTML isn't
 * one of those decks.
 */
export function extractLegacyDeck(contentHtml: string | null | undefined): FlashcardsDeck | null {
    if (!contentHtml) return null;
    const marker = /var\s+cards\s*=\s*\[/.exec(contentHtml);
    if (!marker) return null;
    const start = marker.index + marker[0].length - 1;
    const end = matchingBracket(contentHtml, start);
    if (end < 0) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(contentHtml.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;
    const taken = new Set<string>();
    const cards: FlashcardCard[] = [];
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const c = entry as { front?: unknown; back?: unknown };
        const front = typeof c.front === 'string' ? unescapeHtml(c.front) : '';
        const back = typeof c.back === 'string' ? unescapeHtml(c.back) : '';
        if (!front.trim() || !back.trim()) continue;
        const id = mintCardId(taken);
        taken.add(id);
        cards.push({ id, front, back });
    }
    return cards.length > 0 ? { cards, shuffle: true } : null;
}

function matchingBracket(text: string, open: number): number {
    let depth = 0;
    let inString = false;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function unescapeHtml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

// ── Import ───────────────────────────────────────────────────────────────────

export type ImportSeparator = 'auto' | 'tab' | 'dash' | 'colon' | 'comma' | 'custom';
export type ResolvedSeparator = Exclude<ImportSeparator, 'auto'>;

export type ImportRowStatus =
    | 'ok'
    /** Importable; the front repeats an earlier row or an existing card. */
    | 'duplicate'
    | 'missingFront'
    | 'missingBack'
    | 'tooLong'
    | 'tooManyLines';

export interface ImportRow {
    /** 1-based position of the record in the paste (after blank lines are skipped). */
    row: number;
    front: string;
    back: string;
    hint?: string;
    status: ImportRowStatus;
    /** ok and duplicate rows import; the rest are excluded. */
    importable: boolean;
}

export interface ParseImportOptions {
    separator?: ImportSeparator;
    /** The separator text when `separator` is 'custom'. */
    custom?: string;
    /** Skip the first record. */
    header?: boolean;
    /** Cards already in the deck (append mode), so the 50-card cap counts them. */
    existingCount?: number;
    /** Fronts already in the deck, so a repeat is flagged as a duplicate. */
    existingFronts?: string[];
}

export interface ParseImportResult {
    /** The separator used (the detected one for 'auto'). */
    separator: ResolvedSeparator;
    rows: ImportRow[];
    /** Importable cards within the cap, with fresh ids. */
    cards: FlashcardCard[];
    /** Importable rows (before the cap). */
    importableCount: number;
    /** Importable rows left out because the deck would pass 50 cards. */
    notImported: number;
    /** Rows excluded for a problem (missing face, too long, too many lines). */
    invalidCount: number;
}

/**
 * CSV with the delimiter pinned to a comma. Papa would otherwise guess one (semicolon,
 * pipe, tab…), and "Comma (CSV)" would silently split on something else.
 */
function parseCsv(text: string): string[][] {
    return Papa.parse<string[]>(text, { delimiter: ',', skipEmptyLines: 'greedy' }).data;
}

/** " – ", " - " or " — " with whitespace on both sides. */
const DASH_SEPARATOR = /\s[–—-]\s/;

function nonBlankLines(text: string): string[] {
    return text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');
}

/**
 * Auto-detect in the spec's order (tab, CSV, the dash family, then the first colon),
 * with one refinement: when most lines carry a spaced dash and nothing is quoted, the
 * dash wins over CSV, so "Osmosis – water moves, slowly" isn't split at its comma.
 */
export function detectSeparator(text: string): ResolvedSeparator {
    const lines = nonBlankLines(text);
    if (lines.length === 0) return 'tab';
    const share = (test: (line: string) => boolean) => lines.filter(test).length / lines.length;
    if (share((line) => line.includes('\t')) >= 0.5) return 'tab';
    const dashShare = share((line) => DASH_SEPARATOR.test(line));
    const quoted = lines.some((line) => line.trimStart().startsWith('"'));
    const csv = parseCsv(text);
    const csvShare =
        csv.length === 0
            ? 0
            : csv.filter((cells) => cells.length >= 2 && (cells[1] ?? '').trim() !== '').length /
              csv.length;
    if (csvShare >= 0.5 && (quoted || dashShare < 0.5)) return 'comma';
    if (dashShare >= 0.5) return 'dash';
    if (share((line) => line.includes(':')) >= 0.5) return 'colon';
    return 'tab';
}

function splitAt(line: string, index: number, width: number): string[] {
    return index < 0 ? [line] : [line.slice(0, index), line.slice(index + width)];
}

function splitRecords(text: string, separator: ResolvedSeparator, custom?: string): string[][] {
    if (separator === 'comma') {
        return parseCsv(text);
    }
    return nonBlankLines(text).map((line) => {
        switch (separator) {
            case 'tab':
                return line.split('\t');
            case 'dash': {
                const m = DASH_SEPARATOR.exec(line);
                return m ? splitAt(line, m.index, m[0].length) : [line];
            }
            case 'colon':
                return splitAt(line, line.indexOf(':'), 1);
            case 'custom':
                return custom ? splitAt(line, line.indexOf(custom), custom.length) : [line];
            default:
                return [line];
        }
    });
}

function rowStatus(front: string, back: string, hint: string): ImportRowStatus {
    if (!front) return 'missingFront';
    if (!back) return 'missingBack';
    if (
        front.length > FLASHCARD_LIMITS.front ||
        back.length > FLASHCARD_LIMITS.back ||
        hint.length > FLASHCARD_LIMITS.hint
    ) {
        return 'tooLong';
    }
    if (
        lineCount(front) > FLASHCARD_LIMITS.lines ||
        lineCount(back) > FLASHCARD_LIMITS.lines ||
        lineCount(hint) > FLASHCARD_LIMITS.lines
    ) {
        return 'tooManyLines';
    }
    return 'ok';
}

/**
 * Turn a paste into cards: one card per line (or CSV record) as front, back and an
 * optional third column as the hint. Blank lines are skipped, invalid rows are listed
 * but excluded, repeated fronts are flagged but kept, and nothing past the 50-card cap
 * is imported.
 */
export function parseImport(text: string, options: ParseImportOptions = {}): ParseImportResult {
    const requested = options.separator ?? 'auto';
    const separator: ResolvedSeparator = requested === 'auto' ? detectSeparator(text) : requested;
    let records = splitRecords(text, separator, options.custom).filter((cells) =>
        cells.some((cell) => (cell ?? '').trim() !== '')
    );
    if (options.header) records = records.slice(1);

    const seenFronts = new Set((options.existingFronts ?? []).map(frontKey).filter(Boolean));
    const rows: ImportRow[] = records.map((cells, index) => {
        const front = normalizeCardText(cells[0]);
        const back = normalizeCardText(cells[1]);
        const hint = normalizeCardText(cells[2]);
        let status = rowStatus(front, back, hint);
        if (status === 'ok') {
            const key = frontKey(front);
            if (seenFronts.has(key)) status = 'duplicate';
            seenFronts.add(key);
        }
        return {
            row: index + 1,
            front,
            back,
            ...(hint ? { hint } : {}),
            status,
            importable: status === 'ok' || status === 'duplicate',
        };
    });

    const importable = rows.filter((row) => row.importable);
    const capacity = Math.max(0, FLASHCARD_LIMITS.maxCards - (options.existingCount ?? 0));
    const taken = new Set<string>();
    const cards = importable.slice(0, capacity).map((row) => {
        const id = mintCardId(taken);
        taken.add(id);
        return { id, front: row.front, back: row.back, ...(row.hint ? { hint: row.hint } : {}) };
    });

    return {
        separator,
        rows,
        cards,
        importableCount: importable.length,
        notImported: Math.max(0, importable.length - capacity),
        invalidCount: rows.length - importable.length,
    };
}

/**
 * Put imported cards into a deck.
 * - append: after the existing cards, each with a new id.
 * - replace: the imported cards only; a card whose front exactly matches an existing
 *   card's keeps that card's id, so its stats carry over.
 * Either way the result is capped at 50; `dropped` counts what didn't fit.
 */
export function mergeImportedCards(
    existing: FlashcardCard[],
    imported: FlashcardCard[],
    mode: 'append' | 'replace'
): { cards: FlashcardCard[]; dropped: number } {
    const max = FLASHCARD_LIMITS.maxCards;
    if (mode === 'append') {
        const taken = new Set(existing.map((card) => card.id));
        const room = Math.max(0, max - existing.length);
        const added = imported.slice(0, room).map((card) => {
            const id = mintCardId(taken);
            taken.add(id);
            return { ...card, id };
        });
        return { cards: [...existing, ...added], dropped: imported.length - added.length };
    }

    const idsByFront = new Map<string, string[]>();
    for (const card of existing) {
        const key = normalizeCardText(card.front);
        idsByFront.set(key, [...(idsByFront.get(key) ?? []), card.id]);
    }
    const kept = imported.slice(0, max);
    // A fresh id must not collide with any id the deck has ever shown in this edit,
    // or a removed card's stats would be credited to a different card.
    const taken = new Set(existing.map((card) => card.id));
    const matched = kept.map((card) => idsByFront.get(normalizeCardText(card.front))?.shift());
    const cards = kept.map((card, index) => {
        const id = matched[index] ?? mintCardId(taken);
        taken.add(id);
        return { ...card, id };
    });
    return { cards, dropped: imported.length - kept.length };
}
