import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeDiagnosis, type EngagementDiagnosis } from '@/services/engagement-diagnosis';
import { buildWeeklyExportTables } from '../diagnosis-export';
import { flagVerdict, needsDataText, rowVerdict, verdictText } from '../diagnosis-verdict';
import { buildWeeklyModel, type WeeklyTracking } from '../diagnosis-weekly';
import { trackingOf } from '../use-diagnosis-view';
import { buildView, initI18n, makeCtx, NOT_OFF, weeklyFixture } from './diagnosis-test-kit';

let t: TFunction;
beforeAll(async () => {
    t = await initI18n();
});

describe('a row without enough data', () => {
    it('needs more data when the server says so', () => {
        expect(rowVerdict('NOT_ENOUGH_DATA', 500, 100)).toBe('NEEDS_DATA');
    });

    it('is never called best or worst when it is short of the minimum, whatever the server says', () => {
        expect(rowVerdict('BEST', 80, 100)).toBe('NEEDS_DATA');
        expect(rowVerdict('WORST', 99, 100)).toBe('NEEDS_DATA');
        expect(rowVerdict('OK', 10, 100)).toBe('NEEDS_DATA');
        expect(rowVerdict('BEST', 100, 100)).toBe('BEST');
    });

    it('marks best and worst when there is enough, and nothing for a verdict it does not know', () => {
        expect(rowVerdict('BEST', 120, 100)).toBe('BEST');
        expect(rowVerdict('WORST', 120, 100)).toBe('WORST');
        expect(rowVerdict('OK', 120, 100)).toBe('OK');
        expect(rowVerdict('MEDIOCRE', 120, 100)).toBe('NONE');
        expect(rowVerdict(undefined, 120, 100)).toBe('NONE');
        // With no minimum to check against, the server's verdict stands.
        expect(rowVerdict('BEST', 5, null)).toBe('BEST');
    });

    it('treats an `enough: false` flag as needing data, and a short row too', () => {
        expect(flagVerdict(false, 500, 30)).toBe('NEEDS_DATA');
        expect(flagVerdict(true, 29, 30)).toBe('NEEDS_DATA');
        expect(flagVerdict(true, 30, 30)).toBe('NONE');
        expect(flagVerdict(true, 5, null)).toBe('NONE');
    });

    it('says what it needs, in the unit of the row', () => {
        expect(needsDataText('sends', 100, t)).toBe('Needs 100 sends');
        expect(needsDataText('sends', 1, t)).toBe('Needs 1 send');
        expect(needsDataText('leads', 30, t)).toBe('Needs 30 leads');
        expect(needsDataText('calls', 20, t)).toBe('Needs 20 calls');
        expect(needsDataText('sends', null, t)).toBe('Needs more data');
    });

    it('words every verdict, and nothing for none', () => {
        expect(verdictText('BEST', 'sends', 100, t)).toBe('Best');
        expect(verdictText('WORST', 'sends', 100, t)).toBe('Worst');
        expect(verdictText('OK', 'sends', 100, t)).toBe('OK');
        expect(verdictText('WEAK', 'leads', 30, t)).toBe('Weak');
        expect(verdictText('NEEDS_DATA', 'sends', 100, t)).toBe('Needs 100 sends');
        expect(verdictText('NONE', 'sends', 100, t)).toBe('');
    });
});

// ─── the weekly tables ──────────────────────────────────────────────────────

const tracking: WeeklyTracking = NOT_OFF;

const build = (patch: Partial<EngagementDiagnosis> = {}, track: WeeklyTracking = tracking) => {
    const diagnosis = normalizeDiagnosis({ ...weeklyFixture(), ...patch });
    const ctx = makeCtx(t);
    const model = buildWeeklyModel(diagnosis.weekly!, ctx, {
        problems: diagnosis.problems,
        tracking: track,
        timezone: diagnosis.timezone,
        engineId: diagnosis.engineId,
    });
    return { diagnosis, ctx, model };
};

/** What each row of a table says in a column, as the page words it. */
const column = <R,>(
    spec: { columns: Array<{ id: string; text: (row: R) => string }>; rows: R[] },
    id: string
) => {
    const col = spec.columns.find((c) => c.id === id);
    if (!col) throw new Error(`no column ${id}`);
    return spec.rows.map((row) => col.text(row));
};

describe('the weekly tables', () => {
    it('marks best and worst only where there are enough sends, and says what the rest need', () => {
        const { model } = build();
        // "follow_up" has 40 sends: the server called it BEST, but it is short of 100.
        expect(column(model.whatsappTemplates, 'verdict')).toEqual([
            'Worst',
            'Best',
            'Needs 100 sends',
            'OK',
        ]);
        // The numbers of a short row are still there.
        expect(column(model.whatsappTemplates, 'sent')).toEqual(['120', '150', '40', '130']);
        expect(column(model.whatsappTemplates, 'replyRate')).toEqual(['5%', '20%', '23%', '10%']);
    });

    it('says a lead source needs more leads, and marks the weak one the diagnosis named', () => {
        const { model } = build();
        expect(column(model.sources, 'verdict')).toEqual(['Weak', '—', 'Needs 30 leads', '—']);
        expect(column(model.sources, 'leads')).toEqual(['40', '35', '6', '50']);
        expect(column(model.sources, 'source')).toEqual([
            'maps',
            'referral',
            'forms',
            'Other (not from a Lead Agent)',
        ]);
    });

    it('says an hour needs more calls, and marks the weak one', () => {
        const { model } = build();
        expect(column(model.callHours, 'hour')).toEqual(['09:00', '14:00', '20:00']);
        expect(column(model.callHours, 'verdict')).toEqual(['Weak', '—', 'Needs 20 calls']);
        expect(column(model.callHours, 'connectRate')).toEqual(['12%', '40%', '75%']);
    });

    it('shows how a version of the engine’s instructions did, and says when it is too early to tell', () => {
        const { model } = build();
        expect(column(model.promptChanges, 'version')).toEqual(['v4', 'v3']);
        expect(column(model.promptChanges, 'change')).toEqual([
            'Shorter opening',
            'Ask about budget',
        ]);
        expect(column(model.promptChanges, 'replyRate')).toEqual(['5%', '10%']);
        expect(column(model.promptChanges, 'verdict')).toEqual(['Needs 100 sends', '—']);
        expect(model.promptChanges.columns.map((c) => c.id)).toContain('engine');
    });

    it('shows a number the server could not read as a dash, never as 0', () => {
        const response = weeklyFixture();
        const weekly = response.weekly!;
        const { model } = build({
            weekly: {
                ...weekly,
                leadSources: [{ ...weekly.leadSources[0]!, responded: null, demosBooked: null }],
                emailSubjects: [{ ...weekly.emailSubjects[0]!, replied: null, replyRate: null }],
                promptChanges: [{ ...weekly.promptChanges[0]!, replies: null, demosBooked: null }],
                engineChecks: { doubleContact: null, sentAfterReply: 2, stuckMembers: null },
            },
        });
        expect(column(model.sources, 'responded')).toEqual(['—']);
        expect(column(model.sources, 'demosBooked')).toEqual(['—']);
        expect(column(model.emailSubjects, 'replied')).toEqual(['—']);
        expect(column(model.promptChanges, 'replies')).toEqual(['—']);
        expect(model.engineChecks?.stats.map((s) => s.text)).toEqual(['—', '2', '—']);
    });

    it('drops the engine column when one engine is picked', () => {
        const { model } = build({ engineId: 'e1' });
        expect(model.promptChanges.columns.map((c) => c.id)).not.toContain('engine');
    });

    it('says "Needs more data" when the server did not give a minimum', () => {
        const response = weeklyFixture();
        response.weekly!.minimums = undefined as never;
        // With no minimum to check against, only the server's own "not enough data" can say so.
        response.weekly!.whatsappTemplates![3]!.verdict = 'NOT_ENOUGH_DATA';
        const diagnosis = normalizeDiagnosis(response);
        const model = buildWeeklyModel(diagnosis.weekly!, makeCtx(t), {
            problems: [],
            tracking,
            timezone: 'Asia/Dubai',
            engineId: null,
        });
        expect(diagnosis.weekly?.minimums.sendsPerRow).toBeNull();
        expect(column(model.whatsappTemplates, 'verdict')).toEqual([
            'Worst',
            'Best',
            'Best',
            'Needs more data',
        ]);
    });

    it('words the WhatsApp failure reasons and keeps the raw code', () => {
        const { model } = build();
        expect(column(model.whatsappFailures, 'reason')).toEqual([
            'Not on WhatsApp',
            'Rejected before sending',
        ]);
        expect(column(model.whatsappFailures, 'code')).toEqual(['131026', '—']);
        expect(column(model.whatsappFailures, 'share')).toEqual(['88%', '13%']);
    });

    it('splits the call lengths by their share of answered calls', () => {
        const { model } = build();
        expect(column(model.callLengths!, 'length')).toEqual([
            'Under 20 seconds',
            '20 to 60 seconds',
            'Over 60 seconds',
        ]);
        expect(column(model.callLengths!, 'share')).toEqual(['44%', '36%', '20%']);
    });

    it('lists the call insights: sentiment, outcomes and objections', () => {
        const { model } = build();
        expect(model.callStats?.stats.map((s) => [s.label, s.text])).toEqual([
            ['Calls analysed', '30'],
            ['Positive', '5'],
            ['Neutral', '20'],
            ['Negative', '5'],
            ['Likely to convert', '3'],
        ]);
        expect(column(model.callOutcomes!, 'outcome')).toEqual(['Not Interested']);
        expect(column(model.objections!, 'objection')).toEqual(['budget']);
    });

    it('lists the engine checks without colouring any of them', () => {
        const { model } = build();
        expect(model.engineChecks?.stats.map((s) => [s.label, s.text])).toEqual([
            ['Messaged twice', '3'],
            ['Sent after a reply', '1'],
            ['No next step', '12'],
        ]);
        expect(model.engineChecks?.stats.every((s) => !s.tone)).toBe(true);
    });

    it('never reads an untracked figure as a real 0', () => {
        const off = build(
            {},
            { emailDeliveryOff: true, whatsappDeliveryOff: true, emailRepliesOff: true }
        );
        expect(column(off.model.emailSubjects, 'replied')).toEqual(['Not tracked']);
        expect(column(off.model.emailSubjects, 'bounced')).toEqual(['Not tracked']);
        expect(column(off.model.whatsappTemplates, 'delivered')).toEqual([
            'Not tracked',
            'Not tracked',
            'Not tracked',
            'Not tracked',
        ]);
        const on = build();
        expect(column(on.model.emailSubjects, 'replied')).toEqual(['0']);
    });

    it('reads what is untracked from the data gaps and the report', () => {
        const gaps = {
            dataGaps: [
                { code: 'EMAIL_TRACKING_OFF', names: [] },
                { code: 'WHATSAPP_TRACKING_OFF', names: [] },
            ],
        };
        expect(trackingOf(gaps, true)).toEqual({
            emailDeliveryOff: true,
            whatsappDeliveryOff: true,
            emailRepliesOff: false,
        });
        // Replies are masked only when the report says no sender's replies can be seen.
        expect(trackingOf({ dataGaps: [] }, false).emailRepliesOff).toBe(true);
        expect(trackingOf({ dataGaps: [] }, undefined).emailRepliesOff).toBe(false);
    });
});

describe('a week with a stage that could not be read', () => {
    it('leaves that stage’s tables out of the files and says it could not load', () => {
        const { diagnosis } = build();
        const view = buildView(t, diagnosis);
        const tables = buildWeeklyExportTables({ diagnosis, view, t });
        const sheets = tables.map((x) => x.sheetName);
        expect(sheets).toContain('Problems');
        expect(sheets).toContain('Steps');
        expect(sheets).toContain('Lead sources');
        expect(sheets).toContain('WhatsApp templates');
        // EMAIL is UNAVAILABLE: its subjects table is not in the file, its status line is.
        expect(sheets).not.toContain('Email subjects');
        const steps = tables.find((x) => x.sheetName === 'Steps');
        expect(steps?.body).toContainEqual(['Email', 'Couldn’t load']);
        const problems = tables.find((x) => x.sheetName === 'Problems');
        expect(problems?.body[0]?.[0]).toBe('Warning');
    });
});
