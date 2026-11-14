import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import type { TFunction } from 'i18next';
import type { DiagnosisProblem, EngagementDiagnosis } from '@/services/engagement-diagnosis';
import { buildProblemRows, capProblems, PROBLEM_LIMIT } from '../diagnosis-problems';
import { buildGapNotes, buildStageLines, panelState } from '../diagnosis-stages';
import { buildWeeklyModel, type WeeklyTracking } from '../diagnosis-weekly';
import { makeReportLinks } from '../report-links';
import type { ReportCtx } from '../report-tables';
import type { ReportTerms } from '../report-terms';
import type { DiagnosisViewModel } from '../use-diagnosis-view';

/** The real English copy, so a test reads what a person would read. */
export const localeFile = path.resolve(
    __dirname,
    '../../../../../../public/locales/en/engagementDailyReport.json'
);
export const locale = JSON.parse(readFileSync(localeFile, 'utf8')) as Record<string, unknown>;

export const initI18n = async (): Promise<TFunction> => {
    const instance = i18next.createInstance();
    await instance.init({
        lng: 'en',
        resources: { en: { report: locale } },
        ns: ['report'],
        defaultNS: 'report',
        interpolation: { escapeValue: false },
    });
    return instance.t.bind(instance) as unknown as TFunction;
};

export const terms = {
    list: 'List',
    lists: 'Lists',
    batch: 'Batch',
    learner: 'Learner',
    learners: 'Learners',
} as unknown as ReportTerms;

export const DAY = '2026-11-04';

export const makeCtx = (t: TFunction, engineId: string | null = null): ReportCtx => ({
    t,
    channelLabel: (c) => c,
    terms,
    links: makeReportLinks(engineId, DAY),
});

/** A problem as the API sends it; only what a test cares about needs naming. */
export const problem = (patch: Partial<DiagnosisProblem> & { code: string }): DiagnosisProblem => ({
    stage: 'WHATSAPP',
    severity: 'warning',
    affected: 10,
    numbers: {},
    breakdown: [],
    names: [],
    link: null,
    ...patch,
});

export const NOT_OFF: WeeklyTracking = {
    emailDeliveryOff: false,
    whatsappDeliveryOff: false,
    emailRepliesOff: false,
};

/** What useDiagnosisView builds, without React: the panel and the weekly page read this. */
export const buildView = (
    t: TFunction,
    diagnosis: EngagementDiagnosis,
    tracking: WeeklyTracking = NOT_OFF
): DiagnosisViewModel => {
    const ctx = makeCtx(t, diagnosis.engineId);
    return {
        state: panelState(diagnosis),
        ...capProblems(
            buildProblemRows(diagnosis.problems, { t, links: ctx.links }),
            diagnosis.moreProblems,
            PROBLEM_LIMIT[diagnosis.view]
        ),
        stages: buildStageLines(diagnosis.stages, diagnosis.problems, t),
        gaps: buildGapNotes(diagnosis.dataGaps, diagnosis.errors, t),
        weekly: diagnosis.weekly
            ? buildWeeklyModel(diagnosis.weekly, ctx, {
                  problems: diagnosis.problems,
                  tracking,
                  timezone: diagnosis.timezone,
                  engineId: diagnosis.engineId,
              })
            : null,
        ctx,
    };
};

/** A week as the API sends it: sources, hours, templates and versions, some short of data. */
export const weeklyFixture = (): Partial<EngagementDiagnosis> => ({
    view: 'WEEKLY',
    from: '2026-10-29',
    to: DAY,
    days: 7,
    timezone: 'Asia/Dubai',
    generatedAt: '2026-11-04T10:00:00Z',
    problems: [
        {
            code: 'LEAD_SOURCE_WEAK',
            stage: 'LEADS',
            severity: 'warning',
            affected: 40,
            numbers: { leads: 40, responseRate: 0.02, overallRate: 0.1 },
            breakdown: [],
            names: ['maps'],
            link: null,
        },
        {
            code: 'CALL_HOUR_WEAK',
            stage: 'CALLING',
            severity: 'warning',
            affected: 25,
            numbers: {
                hour: 9,
                placed: 25,
                connectRate: 0.1,
                overallRate: 0.3,
                bestHour: 14,
                bestRate: 0.4,
            },
            breakdown: [],
            names: [],
            link: null,
        },
    ],
    stages: [
        { stage: 'LEADS', status: 'PROBLEM' },
        { stage: 'CALLING', status: 'PROBLEM' },
        { stage: 'WHATSAPP', status: 'OK' },
        { stage: 'EMAIL', status: 'UNAVAILABLE' },
        { stage: 'ENGINE', status: 'NOT_ENOUGH_DATA' },
    ],
    dataGaps: [{ code: 'EMAIL_REPLIES_NOT_TRACKED', names: ['hello@example.com'] }],
    weekly: {
        minimums: { leadsPerSource: 30, callsPerHour: 20, sendsPerRow: 100 },
        leadSources: [
            {
                source: 'maps',
                leads: 40,
                contacted: 30,
                responded: 1,
                demosBooked: 0,
                contactRate: 0.75,
                responseRate: 0.025,
                enough: true,
            },
            {
                source: 'referral',
                leads: 35,
                contacted: 30,
                responded: 8,
                demosBooked: 2,
                contactRate: 0.86,
                responseRate: 0.23,
                enough: true,
            },
            {
                source: 'forms',
                leads: 6,
                contacted: 5,
                responded: 3,
                demosBooked: 1,
                contactRate: 0.83,
                responseRate: 0.5,
                enough: false,
            },
            {
                source: 'OTHER',
                leads: 50,
                contacted: 40,
                responded: 4,
                demosBooked: 0,
                contactRate: 0.8,
                responseRate: 0.08,
                enough: true,
            },
        ],
        callHours: [
            { hour: 9, placed: 25, connected: 3, connectRate: 0.12, enough: true },
            { hour: 14, placed: 30, connected: 12, connectRate: 0.4, enough: true },
            { hour: 20, placed: 4, connected: 3, connectRate: 0.75, enough: false },
        ],
        callLengths: { connected: 50, under20s: 22, s20to60: 18, over60: 10 },
        callInsights: {
            analysed: 30,
            sentiment: { POSITIVE: 5, NEUTRAL: 20, NEGATIVE: 5 },
            outcomes: [{ status: 'NOT_INTERESTED', count: 12 }],
            highLikelihood: 3,
            topObjections: [{ text: 'budget', count: 8 }],
        },
        whatsappFailures: [
            { reason: 'NOT_ON_WHATSAPP', code: '131026', count: 35 },
            { reason: 'REJECTED_AT_SEND', code: null, count: 5 },
        ],
        whatsappTemplates: [
            {
                name: 'intro_v2',
                sent: 120,
                delivered: 110,
                read: 80,
                replied: 6,
                replyRate: 0.05,
                verdict: 'WORST',
            },
            {
                name: 'intro_v3',
                sent: 150,
                delivered: 140,
                read: 100,
                replied: 30,
                replyRate: 0.2,
                verdict: 'BEST',
            },
            {
                name: 'follow_up',
                sent: 40,
                delivered: 38,
                read: 20,
                replied: 9,
                replyRate: 0.225,
                verdict: 'BEST',
            },
            {
                name: 'nudge',
                sent: 130,
                delivered: 120,
                read: 60,
                replied: 13,
                replyRate: 0.1,
                verdict: 'OK',
            },
        ],
        emailSubjects: [
            {
                name: 'Quick question',
                sent: 120,
                delivered: 110,
                clicked: 4,
                bounced: 2,
                replied: 0,
                clickRate: 0.03,
                replyRate: 0,
                verdict: 'OK',
            },
        ],
        promptChanges: [
            {
                engineId: 'e1',
                engineName: 'Main engine',
                version: 4,
                createdAt: '2026-11-02T06:00:00Z',
                source: 'ADMIN',
                change: 'Shorter opening',
                sends: 80,
                replies: 4,
                replyRate: 0.05,
                demosBooked: 1,
                enough: false,
            },
            {
                engineId: 'e1',
                engineName: 'Main engine',
                version: 3,
                createdAt: '2026-10-30T06:00:00Z',
                source: 'ADMIN',
                change: 'Ask about budget',
                sends: 400,
                replies: 40,
                replyRate: 0.1,
                demosBooked: 6,
                enough: true,
            },
        ],
        engineChecks: { doubleContact: 3, sentAfterReply: 1, stuckMembers: 12 },
    },
});
