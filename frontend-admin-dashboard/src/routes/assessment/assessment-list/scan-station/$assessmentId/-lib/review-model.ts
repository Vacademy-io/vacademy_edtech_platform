import type {
    FrontsDirection,
    ScanCopy,
    ScanFlagSeverity,
    ScanLeftOutPage,
    ScanLoad,
    ScanPage,
    ScanRotation,
    ScanSession,
} from '../-services/scan-station-services';

/**
 * What the clerk still has to look at, and what each item lets them do. Pure:
 * the server owns the plan and the verdict; this only arranges the session it
 * returned for the review screen. canBuild / canStart mirror the server's rules
 * for button state only — the server refuses on its own.
 */

export type IssueScope = 'SESSION' | 'LOAD' | 'COPY';

export interface ScanIssue {
    /** Stable for one session read: scope, code, load, sheet / copy. */
    id: string;
    code: string;
    severity: ScanFlagSeverity;
    detail: string | null;
    scope: IssueScope;
    load_no: number | null;
    sheet_no: number | null;
    copy_key: string | null;
    /** Accepted by the clerk (load/session flags), or its copy is accepted. */
    accepted: boolean;
    /**
     * What an accept of this issue sends as expected_fingerprint: the copy's
     * fingerprint (COPY) or this load flag's own (LOAD), as this session read
     * showed them. The server keys a load flag's accept by it, so two flags with
     * the same code are accepted one at a time. Null for session flags, and when
     * the server sent none.
     */
    fingerprint: string | null;
}

export interface GroupedIssues {
    block: ScanIssue[];
    review: ScanIssue[];
    info: ScanIssue[];
}

/** The things the review screen can offer for an issue. */
export type ReviewAction =
    | 'ACCEPT_COPY'
    | 'ACCEPT_LOAD_FLAG'
    | 'SET_FRONTS_DIRECTION'
    | 'RESCAN_LOAD'
    | 'REMOVE_LOAD'
    | 'EXCLUDE_COPY'
    | 'SPLIT_BEFORE_SHEET'
    | 'MERGE_WITH_PREVIOUS'
    | 'OPEN_PAIR_CHECK'
    | 'OPEN_BLANKS';

/** BLOCK codes only a fresh scan of the load can fix. */
export const RESCAN_CODES: ReadonlySet<string> = new Set([
    'FILE_UNREADABLE',
    'COUNT_MISMATCH',
    'PAIR_SHIFT_DETECTED',
    'BACK_HAS_LABEL',
    'LOAD_TOO_LARGE',
    'NO_NAME_BOX_FOUND',
    'ANALYSIS_FAILED',
]);

const issueId = (
    scope: IssueScope,
    code: string,
    loadNo: number | null,
    at: string | number | null
) => `${scope}:${code}:${loadNo ?? '-'}:${at ?? '-'}`;

/** Copies still in play: an excluded copy's flags no longer count. */
const liveCopies = (session: Pick<ScanSession, 'copies'>): ScanCopy[] =>
    session.copies.filter((c) => c.decision !== 'EXCLUDED');

/**
 * Load flags that stay on the load even when they name a sheet. Mirrors the
 * server planner's LOAD_WIDE set: a shifted pairing or a sheet turned over makes
 * every pair after it suspect, so leaving one copy out cannot clear it and the
 * server keeps counting it whatever the clerk does to that copy.
 */
export const LOAD_WIDE_CODES: ReadonlySet<string> = new Set([
    'COUNT_MISMATCH',
    'LOAD_TOO_LARGE',
    'NO_NAME_BOX_FOUND',
    'PAIR_SHIFT_DETECTED',
    'BACK_HAS_LABEL',
    'ORDER_UNCERTAIN',
    'BLANK_RULE_SUSPECT',
]);

/**
 * Every flag of the session as one list: session flags, load flags, copy flags.
 * Scope follows where the server put the flag: the server moves a sheet flag
 * onto the copy that holds the sheet and leaves load-wide ones on the load, and
 * it counts every load flag towards the verdict. So a load flag is always shown
 * on the load, and never hidden because a copy was left out. The one exception:
 * a sheet flag the server also repeats on a live copy is shown once, on the copy.
 */
export const collectIssues = (session: ScanSession): ScanIssue[] => {
    const issues: ScanIssue[] = [];
    for (const f of session.session_flags) {
        issues.push({
            id: issueId('SESSION', f.code, null, null),
            code: f.code,
            severity: f.severity,
            detail: f.detail,
            scope: 'SESSION',
            load_no: null,
            sheet_no: null,
            copy_key: null,
            accepted: f.accepted,
            fingerprint: null,
        });
    }
    const onCopies = new Set<string>();
    const copyIssues: ScanIssue[] = [];
    for (const copy of liveCopies(session)) {
        for (const f of copy.flags) {
            // Copy flags carry no load number; a copy that runs on into the next
            // load can hold the same sheet number twice, so mark every match.
            const sheets = copy.sheets.filter((s) => s.sheet_no === f.sheet_no);
            for (const s of sheets) onCopies.add(`${f.code}:${s.load_no}:${f.sheet_no}`);
            const loadNo = sheets[0]?.load_no ?? copy.load_no;
            copyIssues.push({
                id: issueId('COPY', f.code, loadNo, `${copy.copy_key}:${f.sheet_no ?? '-'}`),
                code: f.code,
                severity: f.severity,
                detail: f.detail,
                scope: 'COPY',
                load_no: loadNo,
                sheet_no: f.sheet_no ?? copy.first_sheet_no,
                copy_key: copy.copy_key,
                accepted: copy.decision === 'ACCEPTED',
                fingerprint: copy.fingerprint ?? null,
            });
        }
    }
    for (const load of session.loads) {
        // Two flags of one code on the same sheet (or both load-wide) are still
        // two issues, each accepted on its own: keep their ids apart.
        const seen = new Map<string, number>();
        for (const f of load.flags) {
            const sheetNo = f.sheet_no ?? null;
            if (
                sheetNo !== null &&
                !LOAD_WIDE_CODES.has(f.code) &&
                onCopies.has(`${f.code}:${load.load_no}:${sheetNo}`)
            ) {
                continue;
            }
            const base = issueId('LOAD', f.code, load.load_no, sheetNo);
            const n = seen.get(base) ?? 0;
            seen.set(base, n + 1);
            issues.push({
                id: n === 0 ? base : `${base}#${n}`,
                code: f.code,
                severity: f.severity,
                detail: f.detail,
                scope: 'LOAD',
                load_no: load.load_no,
                sheet_no: sheetNo,
                copy_key: null,
                accepted: f.accepted,
                fingerprint: f.fingerprint ?? null,
            });
        }
    }
    return [...issues, ...copyIssues];
};

/** Session first, then by load, then by sheet. */
const byPosition = (a: ScanIssue, b: ScanIssue) =>
    (a.load_no ?? -1) - (b.load_no ?? -1) ||
    (a.sheet_no ?? -1) - (b.sheet_no ?? -1) ||
    a.id.localeCompare(b.id, 'en');

export const groupFlags = (session: ScanSession): GroupedIssues => {
    const all = collectIssues(session).sort(byPosition);
    return {
        block: all.filter((i) => i.severity === 'BLOCK'),
        review: all.filter((i) => i.severity === 'REVIEW'),
        info: all.filter((i) => i.severity === 'INFO'),
    };
};

/** BLOCK flags always; REVIEW flags until accepted. INFO never needs a look. */
export const isOpen = (issue: ScanIssue) =>
    issue.severity === 'BLOCK' || (issue.severity === 'REVIEW' && !issue.accepted);

export const openIssues = (session: ScanSession): ScanIssue[] =>
    collectIssues(session).filter(isOpen).sort(byPosition);

/** The open issue after `currentId` (wrapping), or the first one. */
export const nextIssue = (session: ScanSession, currentId: string | null): ScanIssue | null => {
    const open = openIssues(session);
    if (open.length === 0) return null;
    const at = currentId ? open.findIndex((i) => i.id === currentId) : -1;
    return open[(at + 1) % open.length] ?? null;
};

/** What the screen may offer for an issue. A BLOCK flag is never accepted. */
export const actionsFor = (
    issue: Pick<ScanIssue, 'code' | 'severity' | 'scope'>
): ReviewAction[] => {
    const { code, severity, scope } = issue;
    if (severity === 'INFO') return [];
    if (severity === 'BLOCK') {
        // An unlabelled first sheet most often means the pile was scanned the
        // other way round: offer the other order first, before cutting or
        // leaving anything out.
        if (code === 'FIRST_SHEET_NO_LABEL') {
            return ['SET_FRONTS_DIRECTION', 'SPLIT_BEFORE_SHEET', 'EXCLUDE_COPY'];
        }
        if (code === 'TOO_MANY_COPIES') return ['REMOVE_LOAD'];
        const actions: ReviewAction[] = ['RESCAN_LOAD', 'REMOVE_LOAD'];
        // A sheet-level block on a copy goes away when that copy is left out;
        // a load-wide one does not, whatever sheet it names.
        if (scope === 'COPY' && !LOAD_WIDE_CODES.has(code)) actions.push('EXCLUDE_COPY');
        return actions;
    }
    // REVIEW
    if (code === 'FRONT_ORDER_UNCERTAIN') return ['SET_FRONTS_DIRECTION'];
    // Confirmed only from the grid, next to the pages being left out: the clerk
    // has to see every page that is dropped (a light-pencil back looks blank).
    if (code === 'BLANKS_TO_CONFIRM') return ['OPEN_BLANKS'];
    if (code === 'PAIR_NOT_ROW_MAX' || code === 'ORDER_UNCERTAIN') {
        return [
            'OPEN_PAIR_CHECK',
            scope === 'COPY' ? 'ACCEPT_COPY' : 'ACCEPT_LOAD_FLAG',
            'RESCAN_LOAD',
        ];
    }
    if (scope === 'COPY') {
        const actions: ReviewAction[] = ['ACCEPT_COPY', 'EXCLUDE_COPY'];
        if (code === 'COPY_UNUSUALLY_LONG' || code === 'SAME_NAME' || code === 'TOO_MANY_PAGES') {
            actions.push('SPLIT_BEFORE_SHEET');
        }
        if (code === 'LOAD_STARTS_MID_COPY') actions.push('SPLIT_BEFORE_SHEET');
        return actions;
    }
    const actions: ReviewAction[] = ['ACCEPT_LOAD_FLAG'];
    if (code === 'DPI_LOW' || code === 'MTIME_DISAGREES') actions.push('RESCAN_LOAD');
    return actions;
};

/** DOM id an issue scrolls to. */
export const issueAnchor = (issue: Pick<ScanIssue, 'scope' | 'load_no' | 'copy_key'>) =>
    issue.scope === 'COPY' && issue.copy_key
        ? `scan-copy-${issue.copy_key}`
        : issue.scope === 'LOAD' && issue.load_no !== null
          ? `scan-load-${issue.load_no}`
          : 'scan-session-flags';

/** "Make copies" is only offered on READY, from OPEN or a failed build. */
export const canBuild = (session: Pick<ScanSession, 'status' | 'verdict'>) =>
    session.verdict === 'READY' && (session.status === 'OPEN' || session.status === 'FAILED');

/** "Start checking" needs the built copies and a plan that is still READY. */
export const canStart = (session: Pick<ScanSession, 'status' | 'verdict' | 'built'>) =>
    session.status === 'BUILT' && session.verdict === 'READY' && (session.built?.length ?? 0) > 0;

/** The order SET_FRONTS_DIRECTION would switch to. */
export const otherDirection = (d: FrontsDirection): FrontsDirection =>
    d === 'FORWARD' ? 'REVERSED' : 'FORWARD';

export interface BuildProgress {
    /** Copies made so far (the server's `built` list grows during a build). */
    done: number;
    /** Copies being made: every copy not left out. */
    total: number;
    /**
     * The build is waiting for a busy AI service. The server keeps the status
     * BUILDING and says so in error_message; it is a wait, never a failure.
     */
    waiting: boolean;
}

/** Where a BUILDING session's build stands, for the progress line. */
export const buildProgress = (
    session: Pick<ScanSession, 'status' | 'built' | 'copies' | 'error_message'>
): BuildProgress => {
    const total = liveCopies(session).length;
    const done = Math.min(session.built?.length ?? 0, total);
    return {
        done,
        total,
        waiting: session.status === 'BUILDING' && !!session.error_message?.trim(),
    };
};

/** Decisions and load changes are only taken while the session is OPEN. */
export const canEdit = (session: Pick<ScanSession, 'status'>) => session.status === 'OPEN';

/** A load the server has not finished reading. */
const isReading = (load: Pick<ScanLoad, 'status'>) =>
    load.status === 'PENDING' || load.status === 'ANALYSING';

/**
 * The server is still working: poll. Loads are checked on their own because a
 * BLOCKED verdict outranks ANALYSING on the server, so a block on one load must
 * not stop the page from seeing the others finish.
 */
export const isBusy = (
    session: Pick<ScanSession, 'status' | 'verdict'> & { loads?: Pick<ScanLoad, 'status'>[] }
) =>
    session.verdict === 'ANALYSING' ||
    session.status === 'BUILDING' ||
    session.status === 'STARTING' ||
    (session.loads ?? []).some(isReading);

/**
 * Why a BLOCKED session is blocked when no listed flag explains it (e.g.
 * NO_COPIES: every copy left out). One entry per code.
 */
export const unlistedBlockReasons = (session: ScanSession): ScanSession['verdict_reasons'] => {
    if (session.verdict !== 'BLOCKED') return [];
    if (openIssues(session).some((i) => i.severity === 'BLOCK')) return [];
    const seen = new Set<string>();
    return session.verdict_reasons.filter((r) => {
        if (r.code === 'ANALYSING' || seen.has(r.code)) return false;
        seen.add(r.code);
        return true;
    });
};

/**
 * Pages in the copies that will be built (or were), for the cost quote. The
 * built list counts only once the build is done: while BUILDING (and after a
 * FAILED build) it holds just the copies made so far.
 */
export const plannedPages = (session: Pick<ScanSession, 'status' | 'built' | 'copies'>): number =>
    session.built &&
    (session.status === 'BUILT' || session.status === 'STARTING' || session.status === 'STARTED')
        ? session.built.reduce((sum, b) => sum + b.page_count, 0)
        : liveCopies(session).reduce((sum, c) => sum + c.page_count, 0);

/** A load's page by its "p{pass}.{index}" ref. */
export const pageByRef = (
    load: ScanLoad | undefined,
    ref: string | null | undefined
): ScanPage | null => (ref && load?.pages.find((p) => p.ref === ref)) || null;

/** How a page of this load is turned in the built copy (fronts and backs per pass). */
export const rotationOfPage = (
    load: ScanLoad | undefined,
    page: Pick<ScanPage, 'pass_no'>
): ScanRotation => {
    const layout = load?.layout;
    if (!layout) return 0;
    return page.pass_no === layout.fronts_pass
        ? layout.fronts_rotation
        : layout.backs_rotation ?? 0;
};

/** Backs of this load about to be left out as blank, across every copy. */
export const leftOutOfLoad = (session: ScanSession, loadNo: number): ScanLeftOutPage[] =>
    session.copies.flatMap((c) => c.left_out.filter((p) => p.load_no === loadNo));

/** The open BLANKS_TO_CONFIRM-style flag of a load, if any. */
export const loadFlag = (load: ScanLoad, code: string) =>
    load.flags.find((f) => f.code === code && (f.sheet_no === null || f.sheet_no === undefined)) ??
    null;
