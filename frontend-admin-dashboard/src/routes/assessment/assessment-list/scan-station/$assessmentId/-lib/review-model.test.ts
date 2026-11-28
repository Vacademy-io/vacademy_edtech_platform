import { describe, expect, it } from 'vitest';
import type { ScanCopy, ScanLoad, ScanSession } from '../-services/scan-station-services';
import { CODE_SEVERITY } from './flag-copy';
import {
    actionsFor,
    buildProgress,
    canBuild,
    canStart,
    collectIssues,
    groupFlags,
    isBusy,
    nextIssue,
    openIssues,
    otherDirection,
    plannedPages,
    unlistedBlockReasons,
    type IssueScope,
} from './review-model';

const load = (load_no: number, flags: ScanLoad['flags'] = []): ScanLoad => ({
    load_no,
    status: 'DONE',
    attempts: 1,
    error_message: null,
    passes: [],
    layout: null,
    pages: [],
    sheets: [],
    flags,
});

const copy = (
    copy_key: string,
    load_no: number,
    first_sheet_no: number,
    flags: ScanCopy['flags'] = [],
    decision: ScanCopy['decision'] = 'NONE'
): ScanCopy => ({
    copy_key,
    load_no,
    first_sheet_no,
    sheets: [{ load_no, sheet_no: first_sheet_no }],
    pages: [],
    left_out: [],
    page_count: 2,
    name_text: null,
    flags,
    decision,
    needs_review: flags.length > 0,
});

const session = (over: Partial<ScanSession> = {}): ScanSession => ({
    id: 's1',
    assessment_id: 'a1',
    status: 'OPEN',
    verdict: 'NEEDS_REVIEW',
    verdict_reasons: [],
    fronts_direction: 'FORWARD',
    fronts_direction_source: 'DEFAULT',
    session_flags: [],
    loads: [],
    copies: [],
    built: null,
    intake_batch_id: null,
    error_message: null,
    totals: { loads: 0, sheets: 0, pages: 0, copies: 0, blank_left_out: 0, excluded: 0 },
    ...over,
});

const review = (code: string, sheet_no: number | null = null) => ({
    code,
    severity: 'REVIEW' as const,
    sheet_no,
    detail: null,
});

describe('actionsFor', () => {
    const scopes: IssueScope[] = ['SESSION', 'LOAD', 'COPY'];

    it('never offers to accept a BLOCK flag, whatever its code or scope', () => {
        for (const code of Object.keys(CODE_SEVERITY)) {
            for (const scope of scopes) {
                const actions = actionsFor({ code, severity: 'BLOCK', scope });
                expect(actions).not.toContain('ACCEPT_COPY');
                expect(actions).not.toContain('ACCEPT_LOAD_FLAG');
                // Turning the order round re-plans; it does not accept the block
                // (an unlabelled first sheet stays blocked in either order).
                if (code !== 'FIRST_SHEET_NO_LABEL') {
                    expect(actions).not.toContain('SET_FRONTS_DIRECTION');
                }
            }
        }
    });

    it.each(['FILE_UNREADABLE', 'COUNT_MISMATCH', 'PAIR_SHIFT_DETECTED', 'BACK_HAS_LABEL'])(
        '%s offers "Rescan this load"',
        (code) => {
            expect(actionsFor({ code, severity: 'BLOCK', scope: 'LOAD' })).toContain('RESCAN_LOAD');
        }
    );

    it('lets a block on one copy be cleared by leaving that copy out', () => {
        expect(actionsFor({ code: 'FILE_UNREADABLE', severity: 'BLOCK', scope: 'COPY' })).toContain(
            'EXCLUDE_COPY'
        );
        expect(
            actionsFor({ code: 'FIRST_SHEET_NO_LABEL', severity: 'BLOCK', scope: 'COPY' })
        ).toContain('EXCLUDE_COPY');
    });

    it('offers the other fronts order first for an unlabelled first sheet, leaving out last', () => {
        const actions = actionsFor({
            code: 'FIRST_SHEET_NO_LABEL',
            severity: 'BLOCK',
            scope: 'COPY',
        });
        expect(actions).toEqual(['SET_FRONTS_DIRECTION', 'SPLIT_BEFORE_SHEET', 'EXCLUDE_COPY']);
        expect(actions.indexOf('SET_FRONTS_DIRECTION')).toBeLessThan(
            actions.indexOf('EXCLUDE_COPY')
        );
        expect(otherDirection('FORWARD')).toBe('REVERSED');
        expect(otherDirection('REVERSED')).toBe('FORWARD');
    });

    it.each(['PAIR_SHIFT_DETECTED', 'BACK_HAS_LABEL', 'COUNT_MISMATCH', 'NO_NAME_BOX_FOUND'])(
        'never offers to leave a copy out for the load-wide block %s',
        (code) => {
            for (const scope of scopes) {
                expect(actionsFor({ code, severity: 'BLOCK', scope })).toEqual([
                    'RESCAN_LOAD',
                    'REMOVE_LOAD',
                ]);
            }
        }
    );

    it('gives every REVIEW code a way to clear it', () => {
        const reviewCodes = Object.entries(CODE_SEVERITY)
            .filter(([, s]) => s === 'REVIEW')
            .map(([c]) => c);
        for (const code of reviewCodes) {
            const scope: IssueScope =
                code === 'FRONT_ORDER_UNCERTAIN'
                    ? 'SESSION'
                    : [
                            'BLANKS_TO_CONFIRM',
                            'ORDER_UNCERTAIN',
                            'DPI_LOW',
                            'MTIME_DISAGREES',
                        ].includes(code)
                      ? 'LOAD'
                      : 'COPY';
            const actions = actionsFor({ code, severity: 'REVIEW', scope });
            // OPEN_BLANKS: the blanks grid holds the only confirm button.
            const clears = [
                'ACCEPT_COPY',
                'ACCEPT_LOAD_FLAG',
                'SET_FRONTS_DIRECTION',
                'OPEN_BLANKS',
            ];
            expect(actions.some((a) => clears.includes(a))).toBe(true);
        }
    });

    it('maps the special review flags to their screens', () => {
        expect(
            actionsFor({ code: 'FRONT_ORDER_UNCERTAIN', severity: 'REVIEW', scope: 'SESSION' })
        ).toEqual(['SET_FRONTS_DIRECTION']);
        expect(
            actionsFor({ code: 'BLANKS_TO_CONFIRM', severity: 'REVIEW', scope: 'LOAD' })
        ).toEqual(['OPEN_BLANKS']);
        expect(actionsFor({ code: 'PAIR_NOT_ROW_MAX', severity: 'REVIEW', scope: 'COPY' })).toEqual(
            ['OPEN_PAIR_CHECK', 'ACCEPT_COPY', 'RESCAN_LOAD']
        );
        expect(actionsFor({ code: 'ORDER_UNCERTAIN', severity: 'REVIEW', scope: 'LOAD' })).toEqual([
            'OPEN_PAIR_CHECK',
            'ACCEPT_LOAD_FLAG',
            'RESCAN_LOAD',
        ]);
        expect(
            actionsFor({ code: 'COPY_UNUSUALLY_LONG', severity: 'REVIEW', scope: 'COPY' })
        ).toContain('SPLIT_BEFORE_SHEET');
    });

    it('offers nothing for INFO flags', () => {
        expect(actionsFor({ code: 'UNSURE_KEPT', severity: 'INFO', scope: 'LOAD' })).toEqual([]);
    });
});

describe('groupFlags / nextIssue', () => {
    const s = session({
        session_flags: [
            { code: 'FRONT_ORDER_UNCERTAIN', severity: 'REVIEW', detail: null, accepted: false },
        ],
        loads: [
            load(2, [
                {
                    code: 'BLANKS_TO_CONFIRM',
                    severity: 'REVIEW',
                    sheet_no: null,
                    detail: null,
                    accepted: false,
                },
            ]),
            load(1, [
                {
                    code: 'DPI_ASSUMED',
                    severity: 'INFO',
                    sheet_no: null,
                    detail: null,
                    accepted: false,
                },
                // Also on copy L1-S3: shown once, on the copy.
                {
                    code: 'PAIR_NOT_ROW_MAX',
                    severity: 'REVIEW',
                    sheet_no: 3,
                    detail: null,
                    accepted: false,
                },
            ]),
        ],
        copies: [
            copy('L2-S0', 2, 0, [review('SAME_NAME', 0)]),
            copy('L1-S3', 1, 3, [review('PAIR_NOT_ROW_MAX', 3)]),
            copy('L1-S0', 1, 0, [
                { code: 'BACK_HAS_LABEL', severity: 'BLOCK', sheet_no: 1, detail: null },
            ]),
            copy('L1-S5', 1, 5, [review('LABEL_NO_VALUE', 5)], 'ACCEPTED'),
            copy('L1-S7', 1, 7, [review('SAME_NAME', 7)], 'EXCLUDED'),
        ],
    });

    it('splits flags by severity and shows a sheet flag once', () => {
        const g = groupFlags(s);
        expect(g.block.map((i) => i.code)).toEqual(['BACK_HAS_LABEL']);
        expect(g.info.map((i) => i.code)).toEqual(['DPI_ASSUMED']);
        expect(g.review.filter((i) => i.code === 'PAIR_NOT_ROW_MAX')).toHaveLength(1);
        // An excluded copy's flags do not count.
        expect(g.review.some((i) => i.copy_key === 'L1-S7')).toBe(false);
    });

    it('treats an accepted copy as looked at', () => {
        expect(openIssues(s).some((i) => i.copy_key === 'L1-S5')).toBe(false);
    });

    it('walks open issues session first, then by load, then by sheet, and wraps', () => {
        const order: string[] = [];
        let current: string | null = null;
        for (let i = 0; i < 6; i += 1) {
            const next = nextIssue(s, current);
            if (!next) break;
            order.push(`${next.load_no ?? '-'}:${next.sheet_no ?? '-'}:${next.code}`);
            current = next.id;
        }
        expect(order).toEqual([
            '-:-:FRONT_ORDER_UNCERTAIN',
            '1:1:BACK_HAS_LABEL',
            '1:3:PAIR_NOT_ROW_MAX',
            '2:-:BLANKS_TO_CONFIRM',
            '2:0:SAME_NAME',
            '-:-:FRONT_ORDER_UNCERTAIN',
        ]);
    });

    it('has no next issue when nothing is open', () => {
        expect(nextIssue(session(), null)).toBeNull();
    });
});

describe('load-wide flags', () => {
    const blockAt = (code: string, sheet_no: number) => ({
        code,
        severity: 'BLOCK' as const,
        sheet_no,
        detail: null,
        accepted: false,
    });

    it.each(['PAIR_SHIFT_DETECTED', 'BACK_HAS_LABEL'])(
        '%s naming a sheet stays on the load and offers no copy exclusion',
        (code) => {
            const s = session({
                verdict: 'BLOCKED',
                loads: [load(1, [blockAt(code, 2)])],
                copies: [copy('L1-S0', 1, 0), copy('L1-S2', 1, 2)],
            });
            const [issue] = collectIssues(s).filter((i) => i.code === code);
            expect(issue?.scope).toBe('LOAD');
            expect(issue?.copy_key).toBeNull();
            expect(issue?.sheet_no).toBe(2);
            expect(actionsFor(issue!)).not.toContain('EXCLUDE_COPY');
        }
    );

    it('keeps a load flag listed after the copy holding its sheet is left out', () => {
        const s = session({
            verdict: 'BLOCKED',
            loads: [load(1, [blockAt('PAIR_SHIFT_DETECTED', 2)])],
            copies: [copy('L1-S0', 1, 0), copy('L1-S2', 1, 2, [], 'EXCLUDED')],
        });
        const open = openIssues(s);
        expect(open.map((i) => `${i.scope}:${i.code}`)).toEqual(['LOAD:PAIR_SHIFT_DETECTED']);
        expect(unlistedBlockReasons(s)).toEqual([]);
    });
});

describe('isBusy', () => {
    const doneLoad = load(1);
    const readingLoad = { ...load(2), status: 'ANALYSING' as const };
    const pendingLoad = { ...load(3), status: 'PENDING' as const };

    it('polls while the verdict is ANALYSING or a build / start is running', () => {
        expect(isBusy(session({ verdict: 'ANALYSING' }))).toBe(true);
        expect(isBusy(session({ status: 'BUILDING', verdict: 'READY' }))).toBe(true);
        expect(isBusy(session({ status: 'STARTING', verdict: 'READY' }))).toBe(true);
    });

    it('keeps polling a BLOCKED session while other loads are still being read', () => {
        expect(isBusy(session({ verdict: 'BLOCKED', loads: [doneLoad, readingLoad] }))).toBe(true);
        expect(isBusy(session({ verdict: 'BLOCKED', loads: [doneLoad, pendingLoad] }))).toBe(true);
    });

    it('stops once every load is read and nothing is running', () => {
        expect(isBusy(session({ verdict: 'BLOCKED', loads: [doneLoad] }))).toBe(false);
        expect(isBusy(session({ verdict: 'NEEDS_REVIEW', loads: [doneLoad] }))).toBe(false);
    });
});

describe('unlistedBlockReasons', () => {
    it('explains a BLOCKED verdict that no flag accounts for (every copy left out)', () => {
        const s = session({
            verdict: 'BLOCKED',
            verdict_reasons: [
                { code: 'NO_COPIES', severity: 'BLOCK', load_no: null, copy_key: null },
            ],
            loads: [load(1)],
            copies: [copy('L1-S0', 1, 0, [], 'EXCLUDED')],
        });
        expect(openIssues(s)).toEqual([]);
        expect(unlistedBlockReasons(s).map((r) => r.code)).toEqual(['NO_COPIES']);
    });

    it('says nothing extra when a listed block explains the verdict, or when not BLOCKED', () => {
        const blocked = session({
            verdict: 'BLOCKED',
            verdict_reasons: [
                { code: 'FILE_UNREADABLE', severity: 'BLOCK', load_no: 1, copy_key: null },
            ],
            loads: [
                load(1, [
                    {
                        code: 'FILE_UNREADABLE',
                        severity: 'BLOCK',
                        sheet_no: null,
                        detail: null,
                        accepted: false,
                    },
                ]),
            ],
        });
        expect(unlistedBlockReasons(blocked)).toEqual([]);
        expect(unlistedBlockReasons(session({ verdict: 'READY' }))).toEqual([]);
    });
});

describe('canBuild / canStart', () => {
    it('allows building only on READY, from OPEN or FAILED', () => {
        expect(canBuild({ status: 'OPEN', verdict: 'READY' })).toBe(true);
        expect(canBuild({ status: 'FAILED', verdict: 'READY' })).toBe(true);
        for (const verdict of ['EMPTY', 'ANALYSING', 'NEEDS_REVIEW', 'BLOCKED'] as const) {
            expect(canBuild({ status: 'OPEN', verdict })).toBe(false);
        }
        expect(canBuild({ status: 'BUILT', verdict: 'READY' })).toBe(false);
    });

    it('allows starting only once built and still READY', () => {
        const built = [{ copy_key: 'L1-S0', file_id: 'f', page_count: 2 }];
        expect(canStart({ status: 'BUILT', verdict: 'READY', built })).toBe(true);
        expect(canStart({ status: 'BUILT', verdict: 'NEEDS_REVIEW', built })).toBe(false);
        expect(canStart({ status: 'OPEN', verdict: 'READY', built })).toBe(false);
        expect(canStart({ status: 'BUILT', verdict: 'READY', built: [] })).toBe(false);
    });
});

describe('accept fingerprints', () => {
    const flag = (
        code: string,
        fingerprint: string | undefined,
        sheet_no: number | null = null
    ) => ({
        code,
        severity: 'REVIEW' as const,
        sheet_no,
        detail: null,
        accepted: false,
        fingerprint,
    });

    it('carries the copy fingerprint on copy issues and the load flag one on load issues', () => {
        const s = session({
            session_flags: [
                {
                    code: 'FRONT_ORDER_UNCERTAIN',
                    severity: 'REVIEW',
                    detail: null,
                    accepted: false,
                },
            ],
            loads: [load(1, [flag('DPI_LOW', 'fp-dpi')])],
            copies: [{ ...copy('L1-S0', 1, 0, [review('SAME_NAME', 0)]), fingerprint: 'fp-copy' }],
        });
        const byScope = Object.fromEntries(collectIssues(s).map((i) => [i.scope, i.fingerprint]));
        expect(byScope).toEqual({ SESSION: null, LOAD: 'fp-dpi', COPY: 'fp-copy' });
    });

    it('sends null when the server sent no fingerprint (older server: no check asked for)', () => {
        const s = session({
            loads: [load(1, [flag('DPI_LOW', undefined)])],
            copies: [copy('L1-S0', 1, 0, [review('SAME_NAME', 0)])],
        });
        expect(collectIssues(s).map((i) => i.fingerprint)).toEqual([null, null]);
    });

    it('gives each load flag its own fingerprint, even two flags with one code', () => {
        const l = load(1, [flag('ORDER_UNCERTAIN', 'fp-a', 0), flag('ORDER_UNCERTAIN', 'fp-b', 3)]);
        const issues = collectIssues(session({ loads: [l] }));
        expect(issues.map((i) => i.fingerprint)).toEqual(['fp-a', 'fp-b']);
    });

    it('keeps two same-code flags apart: their own ids and their own accepted state', () => {
        const l = load(1, [
            { ...flag('ORDER_UNCERTAIN', 'fp-a'), accepted: true },
            flag('ORDER_UNCERTAIN', 'fp-b'),
        ]);
        const issues = collectIssues(session({ loads: [l] }));
        expect(new Set(issues.map((i) => i.id)).size).toBe(2);
        expect(issues.map((i) => [i.fingerprint, i.accepted])).toEqual([
            ['fp-a', true],
            ['fp-b', false],
        ]);
        // Only the one not yet accepted is still open.
        expect(openIssues(session({ loads: [l] })).map((i) => i.fingerprint)).toEqual(['fp-b']);
    });
});

describe('buildProgress', () => {
    const built = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
            copy_key: `c${i}`,
            file_id: `f${i}`,
            page_count: 2,
        }));
    const copies = [
        copy('L1-S0', 1, 0),
        copy('L1-S2', 1, 2),
        copy('L1-S4', 1, 4),
        copy('L1-S6', 1, 6, [], 'EXCLUDED'),
    ];

    it('counts the copies made so far against the copies not left out', () => {
        expect(
            buildProgress({ status: 'BUILDING', built: null, copies, error_message: null })
        ).toEqual({
            done: 0,
            total: 3,
            waiting: false,
        });
        expect(
            buildProgress({ status: 'BUILDING', built: built(2), copies, error_message: null })
        ).toEqual({ done: 2, total: 3, waiting: false });
    });

    it('reads a BUILDING session with a message as waiting for the AI service, not failed', () => {
        const busy = {
            status: 'BUILDING' as const,
            built: built(1),
            copies,
            error_message: 'The AI service is busy; the copies will be made as soon as it is free',
        };
        expect(buildProgress(busy)).toEqual({ done: 1, total: 3, waiting: true });
        // A busy build is still the server working: keep polling.
        expect(isBusy({ status: 'BUILDING', verdict: 'READY', loads: [] })).toBe(true);
        expect(buildProgress({ ...busy, status: 'FAILED' }).waiting).toBe(false);
    });

    it('quotes pages from the plan until the build is done, not from the copies made so far', () => {
        const partial = { built: built(1), copies };
        // copy() pages: 2 each, three copies not left out.
        expect(plannedPages({ ...partial, status: 'BUILDING' })).toBe(6);
        expect(plannedPages({ ...partial, status: 'FAILED' })).toBe(6);
        expect(plannedPages({ built: built(3), copies, status: 'BUILT' })).toBe(6);
        expect(plannedPages({ built: built(1), copies, status: 'BUILT' })).toBe(2);
    });

    it('never reports more made than there are copies', () => {
        expect(
            buildProgress({ status: 'BUILDING', built: built(5), copies, error_message: null }).done
        ).toBe(3);
    });
});
