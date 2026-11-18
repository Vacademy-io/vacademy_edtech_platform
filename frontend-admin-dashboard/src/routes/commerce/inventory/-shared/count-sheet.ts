import type {
    CountLine,
    CountLineBody,
    CountReview,
    ReviewLine,
    ReviewPiece,
    ReviewPieceGroup,
    UncountedChoice,
} from './inventory-types';
import { REVIEW_PIECE_GROUPS, UNCOUNTED_CHOICES } from './inventory-types';

/**
 * The count sheet (contract §7.6), pure and unit-tested. Every change is saved
 * at once, one line at a time: while a line's save is on its way, more changes
 * to that line wait here and go together in the next save (the latest SET
 * wins; ADDs add up into one ADD). A piece is counted once: a second scan of
 * the same code is refused on the screen, before any request.
 */

/** Why a scan was not taken on the count sheet; each has `inventory.countSheet.<code>`. */
export const COUNT_REFUSALS = ['alreadyCounted', 'scanPieceLabels', 'untracked', 'notFound'] as const;
export type CountRefusal = (typeof COUNT_REFUSALS)[number];

export type CountOp = { kind: 'SET'; quantity: number } | { kind: 'ADD'; quantity: number } | { kind: 'PIECE'; code: string };

/** `v:<package session>` for a quantity line, `p:<PIECE CODE>` for a piece. */
export const variantKey = (packageSessionId: string) => `v:${packageSessionId}`;
export const pieceKey = (code: string) => `p:${code.trim().toUpperCase()}`;
export const lineKey = (line: Pick<CountLine, 'package_session_id' | 'piece_code' | 'piece_id'>) =>
    line.piece_code ? pieceKey(line.piece_code) : line.piece_id ? `p:${line.piece_id}` : variantKey(line.package_session_id);

/** Adds a change to what waits for a line. */
export function queueOp(pending: CountOp | undefined, op: CountOp): CountOp {
    if (op.kind === 'PIECE' || !pending || pending.kind === 'PIECE') return op;
    if (op.kind === 'SET') return op;
    // ADD after a waiting SET or ADD: one change.
    return { kind: pending.kind, quantity: pending.quantity + op.quantity };
}

/** The quantity to show while changes are on their way. */
export function shownQuantity(saved: number | null, inFlight: CountOp | undefined, pending: CountOp | undefined): number {
    let value = saved ?? 0;
    for (const op of [inFlight, pending]) {
        if (!op) continue;
        if (op.kind === 'SET') value = op.quantity;
        else if (op.kind === 'ADD') value += op.quantity;
        else value = 1;
    }
    return value;
}

/** The request line for a change of one line. */
export function opBody(key: string, op: CountOp): CountLineBody {
    if (op.kind === 'PIECE') return { piece_code: op.code };
    return { package_session_id: key.slice(2), mode: op.kind, quantity: op.quantity };
}

/**
 * A piece scan: refused when the code is already on the sheet or waiting to
 * be saved (counted once).
 */
export function pieceScan(
    savedKeys: ReadonlySet<string>,
    waitingKeys: ReadonlySet<string>,
    code: string
): { key: string; refusal: CountRefusal | null } {
    const key = pieceKey(code);
    if (savedKeys.has(key) || waitingKeys.has(key)) return { key, refusal: 'alreadyCounted' };
    return { key, refusal: null };
}

/** The sheet's lines after a server answer: each answered line replaces its own. */
export function mergeLines(lines: CountLine[], answered: CountLine[]): CountLine[] {
    const byKey = new Map(lines.map((line) => [lineKey(line), line]));
    answered.forEach((line) => byKey.set(lineKey(line), line));
    return Array.from(byKey.values());
}

/** Post needs the uncounted choice: there is no default. */
export const canPost = (choice: string | null | undefined): choice is UncountedChoice =>
    !!choice && (UNCOUNTED_CHOICES as readonly string[]).includes(choice);

export type ReviewGroup =
    | { id: 'differences' | 'agreeing'; lines: ReviewLine[] }
    | { id: 'uncounted'; items: CountReview['uncounted'] }
    | { id: ReviewPieceGroup; pieces: ReviewPiece[] };

/** The review panel's groups, in reading order, empty ones left out. */
export function groupReview(review: CountReview): ReviewGroup[] {
    const groups: ReviewGroup[] = [];
    // Scanned piece lines come in `lines` too; the piece groups below show them, so the table keeps quantities.
    const quantityLines = review.lines.filter((l) => !l.piece_code);
    const differences = quantityLines.filter((l) => l.adjustment !== 0);
    const agreeing = quantityLines.filter((l) => l.adjustment === 0);
    if (differences.length) groups.push({ id: 'differences', lines: differences });
    if (review.uncounted.length) groups.push({ id: 'uncounted', items: review.uncounted });
    REVIEW_PIECE_GROUPS.forEach((group) => {
        const pieces = review.pieces[group];
        if (pieces.length) groups.push({ id: group, pieces });
    });
    if (agreeing.length) groups.push({ id: 'agreeing', lines: agreeing });
    return groups;
}
