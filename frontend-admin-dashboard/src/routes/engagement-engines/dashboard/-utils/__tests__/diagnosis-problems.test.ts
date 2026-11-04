import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    buildProblemRows,
    capProblems,
    formatFigure,
    isKnownProblemCode,
    PROBLEM_CODES,
    PROBLEM_LIMIT,
    problemLink,
} from '../diagnosis-problems';
import { INBOX_PATH, makeReportLinks, OUTCOMES_PATH } from '../report-links';
import { DAY, initI18n, locale, makeCtx, problem } from './diagnosis-test-kit';

let t: TFunction;
beforeAll(async () => {
    t = await initI18n();
});

const rowOf = (p: ReturnType<typeof problem>) => {
    const ctx = makeCtx(t);
    const [row] = buildProblemRows([p], { t, links: ctx.links });
    if (!row) throw new Error('no row');
    return row;
};

describe('a problem as a row', () => {
    const whatsapp = problem({
        code: 'WHATSAPP_FAILED_HIGH',
        severity: 'critical',
        numbers: { failed: 40, tried: 120, rate: 0.33 },
        breakdown: [
            { key: 'OUTSIDE_24H_WINDOW', count: 2 },
            { key: 'NOT_ON_WHATSAPP', count: 35 },
            { key: 'OTHER', count: 3 },
            { key: 'RATE_LIMITED', count: 1 },
        ],
        link: { target: 'OUTCOMES', channel: 'WHATSAPP', outcome: 'failed', kind: null },
    });

    it('gives a title, the evidence from its numbers and the advice', () => {
        const row = rowOf(whatsapp);
        expect(row.known).toBe(true);
        expect(row.severity).toBe('critical');
        expect(row.stageLabel).toBe('WhatsApp');
        expect(row.title).toBe('WhatsApp messages are failing');
        expect(row.evidence).toBe('40 of 120 messages failed (33%).');
        expect(row.advice).toBe(
            'Act on the biggest reason shown: fix the list, the template or the billing.'
        );
    });

    it('lists the biggest breakdown entries first, worded, and no more than three', () => {
        const row = rowOf(whatsapp);
        expect(row.breakdown.map((b) => [b.label, b.count])).toEqual([
            ['Not on WhatsApp', '35'],
            ['Other', '3'],
            ['Outside the 24-hour window', '2'],
        ]);
    });

    it('links through the report helpers, with the engine and period of the page', () => {
        const row = rowOf(whatsapp);
        expect(row.link).toEqual({
            to: INBOX_PATH,
            // The Failed tab: a send Meta refused moves there, so that is what the count holds.
            search: { filter: 'failed', channel: 'WHATSAPP', date: DAY },
        });
        expect(row.linkLabel).toBe('See the messages');
    });

    it('has no link when the API sends none', () => {
        const row = rowOf(
            problem({ code: 'CALLS_NOT_GOING_OUT', numbers: { notDialled: 8, placed: 2 } })
        );
        expect(row.link).toBeNull();
        expect(row.linkLabel).toBeNull();
        expect(row.evidence).toBe('8 not dialled, 2 placed.');
    });

    it('words rates, hours and counts by what their key is', () => {
        expect(formatFigure('rate', 0.075)).toBe('7.5%');
        expect(formatFigure('overallRate', 0.5)).toBe('50%');
        expect(formatFigure('share', 0.4)).toBe('40%');
        expect(formatFigure('hour', 9)).toBe('09:00');
        expect(formatFigure('bestHour', 14)).toBe('14:00');
        expect(formatFigure('failed', 1200)).toBe('1,200');
        expect(formatFigure('failed', undefined)).toBe('—');
        expect(formatFigure('failed', Number.NaN)).toBe('—');
    });

    it('shows a dash for a number the API left out, never a raw placeholder', () => {
        const row = rowOf(problem({ code: 'EMAIL_BOUNCE_HIGH', numbers: { bounced: 4 } }));
        expect(row.evidence).toBe('4 of — emails bounced (—).');
        expect(row.evidence).not.toMatch(/\{\{/);
    });

    it('names the template, subject, source, hour and objection in the title', () => {
        expect(
            rowOf(
                problem({
                    code: 'TEMPLATE_UNDERPERFORMING',
                    names: ['intro_v2'],
                    numbers: { sent: 120, replyRate: 0.01, channelRate: 0.05 },
                })
            ).title
        ).toBe('WhatsApp template “intro_v2” gets few replies');
        expect(
            rowOf(
                problem({
                    code: 'CALL_HOUR_WEAK',
                    numbers: {
                        hour: 9,
                        placed: 25,
                        connectRate: 0.1,
                        overallRate: 0.3,
                        bestHour: 14,
                        bestRate: 0.4,
                    },
                })
            )
        ).toMatchObject({
            title: 'Calls at 09:00 are rarely answered',
            evidence: '10% of 25 calls were answered, against 30% overall. Best hour: 14:00, 40%.',
        });
        expect(
            rowOf(
                problem({
                    code: 'OBJECTION_RECURRING',
                    names: ['budget'],
                    numbers: { count: 8, analysed: 30 },
                })
            )
        ).toMatchObject({
            title: 'Callers keep raising “budget”',
            evidence: 'It came up in 8 of 30 analysed calls.',
        });
    });

    it('lists several agent names, then "and N more"', () => {
        const row = rowOf(
            problem({
                code: 'LEAD_AGENT_NOT_DELIVERING',
                stage: 'LEADS',
                names: ['Agent A', 'Agent B', 'Agent C', 'Agent D', 'Agent E'],
                numbers: { discovered: 12, rejected: 12, review: 0 },
            })
        );
        expect(row.evidence).toBe(
            'Agent A, Agent B, Agent C and 2 more: found 12, rejected 12, 0 waiting for review.'
        );
    });

    it('says one message or many', () => {
        expect(
            rowOf(problem({ code: 'SENT_AFTER_REPLY', stage: 'ENGINE', numbers: { sends: 1 } }))
                .evidence
        ).toBe('1 message was sent after the person had replied.');
        expect(
            rowOf(problem({ code: 'SENT_AFTER_REPLY', stage: 'ENGINE', numbers: { sends: 6 } }))
                .evidence
        ).toBe('6 messages were sent after the person had replied.');
    });

    it('says how long the credits last in the words the health banner uses', () => {
        expect(
            rowOf(problem({ code: 'CREDITS_LOW', stage: 'ENGINE', numbers: { runwayDays: 1.4 } }))
                .evidence
        ).toBe('At this pace they run out in about 1 day.');
        expect(
            rowOf(problem({ code: 'CREDITS_LOW', stage: 'ENGINE', numbers: { runwayDays: 0.5 } }))
                .evidence
        ).toBe('At this pace they run out in less than a day.');
    });

    it('cuts a long error message of a failing engine, and words a plain code', () => {
        const long = 'x'.repeat(200);
        const row = rowOf(
            problem({
                code: 'ENGINE_ACTIONS_FAILING',
                stage: 'ENGINE',
                numbers: { failed: 5, decisions: 10, rate: 0.5 },
                breakdown: [
                    { key: long, count: 4 },
                    { key: 'TIMEOUT', count: 1 },
                ],
            })
        );
        expect(row.breakdown[0]?.label).toHaveLength(80);
        expect(row.breakdown[1]?.label).toBe('Timeout');
    });
});

describe('a problem code the page does not know', () => {
    const unknown = problem({
        code: 'NEW_RULE_FROM_A_NEWER_BACKEND',
        stage: 'FUNNEL',
        severity: 'critical',
        numbers: { noPhone: 4, rate: 0.2 },
        breakdown: [{ key: 'SOME_REASON', count: 3 }],
        link: { target: 'OUTCOMES', channel: 'EMAIL', outcome: null, kind: null },
    });

    it('is a safe generic row, not an error', () => {
        const row = rowOf(unknown);
        expect(row.known).toBe(false);
        expect(isKnownProblemCode(unknown.code)).toBe(false);
        expect(row.title).toBe('Needs a look: New Rule From A Newer Backend');
        expect(row.evidence).toBe('No phone 4 · Rate 20%');
        expect(row.advice).toBe('Check the figures for this period to find out why.');
        expect(row.severity).toBe('critical');
        // A stage it does not know is worded from its code; a breakdown key likewise.
        expect(row.stageLabel).toBe('Funnel');
        expect(row.breakdown).toEqual([{ key: 'SOME_REASON', label: 'Some Reason', count: '3' }]);
    });

    it('still opens its link when the target is one the page knows', () => {
        expect(rowOf(unknown).link?.to).toBe(INBOX_PATH);
    });

    it('renders with no numbers at all', () => {
        const row = rowOf(problem({ code: 'ANOTHER_ONE' }));
        expect(row.evidence).toBe('');
        expect(row.title).toBe('Needs a look: Another One');
    });

    it('does not mistake a property of Object for a code', () => {
        expect(isKnownProblemCode('constructor')).toBe(false);
        expect(isKnownProblemCode('toString')).toBe(false);
        expect(rowOf(problem({ code: 'constructor' })).known).toBe(false);
    });
});

describe('where a problem leads', () => {
    const links = makeReportLinks('eng-1', { from: '2026-10-29', to: DAY });

    it('opens the messages or calls of a channel and what happened to them (OUTCOMES)', () => {
        expect(
            problemLink(
                problem({
                    code: 'CONNECT_RATE_LOW',
                    link: {
                        target: 'OUTCOMES',
                        channel: 'AI_CALL',
                        outcome: 'no_answer',
                        kind: null,
                    },
                }),
                links
            )
        ).toEqual({
            to: INBOX_PATH,
            search: {
                filter: 'sent',
                channel: 'AI_CALL',
                outcome: 'no_answer',
                engine: 'eng-1',
                from: '2026-10-29',
                to: DAY,
            },
        });
    });

    it('opens the people behind a number (ITEMS)', () => {
        expect(
            problemLink(
                problem({
                    code: 'LEADS_MISSING_CONTACT',
                    link: { target: 'ITEMS', channel: null, outcome: null, kind: 'LEADS_ADDED' },
                }),
                links
            )
        ).toEqual({
            to: OUTCOMES_PATH,
            search: { tab: 'leads', engine: 'eng-1', from: '2026-10-29', to: DAY },
        });
        expect(
            problemLink(
                problem({
                    code: 'X',
                    link: {
                        target: 'ITEMS',
                        channel: null,
                        outcome: null,
                        kind: 'DEMOS_SCHEDULED',
                    },
                }),
                links
            )?.search
        ).toMatchObject({ tab: 'demos', filter: 'scheduled' });
    });

    it('opens just the template or subject a problem names', () => {
        const link = { target: 'OUTCOMES', channel: 'WHATSAPP', outcome: null, kind: null };
        expect(
            problemLink(
                problem({ code: 'TEMPLATE_UNDERPERFORMING', names: ['intro_v2'], link }),
                links
            )?.search
        ).toMatchObject({ channel: 'WHATSAPP', template: 'intro_v2' });
        // A code that is not about one template opens the whole channel.
        expect(
            problemLink(problem({ code: 'WHATSAPP_FAILED_HIGH', names: ['intro_v2'], link }), links)
                ?.search
        ).not.toHaveProperty('template');
    });

    it('drops an outcome the inbox does not filter by, and makes no link for what it cannot open', () => {
        expect(
            problemLink(
                problem({
                    code: 'X',
                    link: { target: 'OUTCOMES', channel: 'EMAIL', outcome: 'exploded', kind: null },
                }),
                links
            )?.search
        ).not.toHaveProperty('outcome');
        expect(
            problemLink(
                problem({
                    code: 'X',
                    link: { target: 'ITEMS', channel: null, outcome: null, kind: 'NEW_KIND' },
                }),
                links
            )
        ).toBeNull();
        expect(
            problemLink(
                problem({
                    code: 'X',
                    link: { target: 'HOLOGRAM', channel: null, outcome: null, kind: null },
                }),
                links
            )
        ).toBeNull();
        expect(problemLink(problem({ code: 'X', link: null }), links)).toBeNull();
    });
});

describe('the wording of every code in the catalogue', () => {
    const copy = (locale.diagnosis as { problem: Record<string, Record<string, string>> }).problem;

    it('has a title, evidence and advice for each', () => {
        for (const [code, spec] of Object.entries(PROBLEM_CODES)) {
            const words = copy[code];
            expect(words, code).toBeDefined();
            expect(words?.title, `${code} title`).toBeTruthy();
            expect(words?.advice, `${code} advice`).toBeTruthy();
            if (spec.count) {
                expect(words?.evidence_one, `${code} evidence_one`).toBeTruthy();
                expect(words?.evidence_other, `${code} evidence_other`).toBeTruthy();
            } else {
                expect(words?.evidence, `${code} evidence`).toBeTruthy();
            }
        }
    });

    it('uses only numbers the code is known to carry', () => {
        for (const [code, spec] of Object.entries(PROBLEM_CODES)) {
            const words = copy[code] ?? {};
            const used = Object.entries(words)
                .filter(([part]) => part.startsWith('evidence'))
                .flatMap(([, text]) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
            for (const name of used) {
                expect(
                    [...spec.keys, 'name', 'runway', 'count'],
                    `${code} uses {{${name}}}`
                ).toContain(name);
            }
        }
    });

    it('matches the rule catalogue of the spec, when the spec is next to the code', () => {
        const specFile = path.resolve(
            __dirname,
            '../../../../../../../docs/engagement/ENGAGEMENT_DIAGNOSIS.md'
        );
        if (!existsSync(specFile)) return;
        const text = readFileSync(specFile, 'utf8');
        const rows = [...text.matchAll(/^\| `([A-Z_]+)` \|.*\| ([^|]+) \|$/gm)];
        expect(rows.length).toBeGreaterThanOrEqual(18);
        const plain = (s: string) => s.replace(/[’‘]/g, "'").trim();
        for (const [, code, advice] of rows) {
            if (!code || !advice) continue;
            expect(isKnownProblemCode(code), `${code} is in the page's catalogue`).toBe(true);
            expect(plain(copy[code]?.advice ?? ''), `${code} advice`).toBe(plain(advice));
        }
        expect(Object.keys(PROBLEM_CODES).sort()).toEqual(rows.map((r) => r[1]).sort());
    });
});

describe('how many problems are listed', () => {
    const rows = (n: number) =>
        buildProblemRows(
            Array.from({ length: n }, (_, i) => problem({ code: `RULE_${i}` })),
            { t, links: makeCtx(t).links }
        );

    it('lists at most 5 for a day and 10 for a week, in the order the API sent them', () => {
        expect(PROBLEM_LIMIT).toEqual({ DAILY: 5, WEEKLY: 10 });
        const day = capProblems(rows(7), 0, PROBLEM_LIMIT.DAILY);
        expect(day.problems.map((p) => p.code)).toEqual([
            'RULE_0',
            'RULE_1',
            'RULE_2',
            'RULE_3',
            'RULE_4',
        ]);
        expect(day.moreProblems).toBe(2);
        expect(capProblems(rows(12), 0, PROBLEM_LIMIT.WEEKLY).problems).toHaveLength(10);
    });

    it('adds what the API already cut to what this cuts', () => {
        expect(capProblems(rows(5), 3, 5)).toMatchObject({ moreProblems: 3 });
        expect(capProblems(rows(6), 3, 5)).toMatchObject({ moreProblems: 4 });
        expect(capProblems(rows(2), 0, 5)).toMatchObject({ moreProblems: 0 });
    });
});
