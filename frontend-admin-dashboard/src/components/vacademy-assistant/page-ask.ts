import { useAssistDock } from '@/components/assist-dock/store';
import type { AssistantCapabilities } from './types';

/**
 * Asking the assistant from the page in front of the user:
 * - the "Ask" button next to the page heading offers questions about that page;
 * - a tip after a manual export suggests the question that would have answered it;
 * - a first-visit welcome opens the panel once for a new admin.
 */

export type AskTopic = 'leads' | 'learners' | 'fees' | 'assessments';

export interface PageQuestion {
    /** i18n key under `assistant.pageAsk.questions` (dashboardIndex). */
    key: string;
    /** The tool the question needs; offered only when the caller has it. */
    tool: string;
}

/** Route prefixes per topic (a prefix matches itself and the pages under it). */
export const PAGE_TOPICS: ReadonlyArray<{ topic: AskTopic; prefixes: readonly string[] }> = [
    {
        topic: 'leads',
        prefixes: [
            '/audience-manager/recent-leads',
            '/audience-manager/list',
            '/audience-manager/lead-board',
            '/audience-manager/follow-ups',
        ],
    },
    { topic: 'learners', prefixes: ['/manage-students/students-list'] },
    {
        topic: 'fees',
        prefixes: ['/financial-management', '/manage-payments', '/payment-dashboard'],
    },
    { topic: 'assessments', prefixes: ['/assessment/assessment-list', '/evaluation/evaluations'] },
];

/** In order of usefulness; the first ones the caller can use are shown. */
export const PAGE_QUESTIONS: Readonly<Record<AskTopic, readonly PageQuestion[]>> = {
    leads: [
        { key: 'leadsNotContacted', tool: 'crm_reports' },
        { key: 'leadsBySource', tool: 'crm_reports' },
        { key: 'leadsOverdueFollowUps', tool: 'crm_reports' },
        { key: 'leadsNoActivity', tool: 'crm_reports' },
    ],
    learners: [
        { key: 'learnersRecent', tool: 'list_recent_enrollments' },
        { key: 'learnersOverdueFees', tool: 'search_fee_records' },
        { key: 'learnersInBatch', tool: 'list_batch_learners' },
    ],
    fees: [
        { key: 'feesOverdue30', tool: 'search_fee_records' },
        { key: 'feesCollectedMonth', tool: 'get_collections_summary' },
        { key: 'feesWhoOwesWeek', tool: 'crm_collections' },
        { key: 'feesOutstanding', tool: 'get_institute_overview' },
    ],
    assessments: [
        { key: 'assessmentsPending', tool: 'get_assessment_results' },
        { key: 'assessmentsToppers', tool: 'get_assessment_leaderboard' },
        { key: 'assessmentsNotAttempted', tool: 'get_assessment_results' },
    ],
};

export const MAX_PAGE_QUESTIONS = 3;

/** Questions a new admin is offered when the panel opens as a welcome (help articles). */
export const WELCOME_QUESTIONS = [
    'assistant.pageAsk.welcome.questions.firstSteps',
    'assistant.pageAsk.welcome.questions.createCourse',
    'assistant.pageAsk.welcome.questions.addLearners',
    'assistant.pageAsk.welcome.questions.inviteTeam',
];

export const questionKey = (key: string) => `assistant.pageAsk.questions.${key}`;

export function topicForPath(pathname: string): AskTopic | null {
    const path = pathname.replace(/\/+$/, '') || '/';
    for (const { topic, prefixes } of PAGE_TOPICS) {
        if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return topic;
    }
    return null;
}

/** The topic's questions whose tool the caller has, at most `max`. */
export function questionsFor(
    topic: AskTopic,
    capabilities: AssistantCapabilities | undefined,
    max = MAX_PAGE_QUESTIONS
): PageQuestion[] {
    const groups = Array.isArray(capabilities?.groups) ? capabilities.groups : [];
    const tools = new Set(groups.flatMap((g) => (Array.isArray(g.tools) ? g.tools : [])));
    return PAGE_QUESTIONS[topic].filter((q) => tools.has(q.tool)).slice(0, max);
}

export const isAskTopic = (value: string | null): value is AskTopic =>
    value !== null && value in PAGE_QUESTIONS;

// ---------------------------------------------------------------------------
// Tips: at most one a day, each topic at most TIP_LIMIT_PER_TOPIC times, and
// never again once the user turns them off.

const TIP_STATE_KEY = 'assistantTips';
export const TIP_GAP_MS = 24 * 60 * 60 * 1000;
export const TIP_LIMIT_PER_TOPIC = 3;

interface TipState {
    off?: boolean;
    lastShownAt?: number;
    shown?: Record<string, number>;
}

function readTipState(): TipState {
    try {
        const raw = localStorage.getItem(TIP_STATE_KEY);
        const parsed = raw ? (JSON.parse(raw) as TipState | null) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeTipState(state: TipState) {
    try {
        localStorage.setItem(TIP_STATE_KEY, JSON.stringify(state));
    } catch {
        // storage disabled: tips are simply not limited across reloads
    }
}

export function canShowTip(topic: AskTopic, now = Date.now()): boolean {
    const state = readTipState();
    if (state.off) return false;
    if (typeof state.lastShownAt === 'number' && now - state.lastShownAt < TIP_GAP_MS) {
        return false;
    }
    return (state.shown?.[topic] ?? 0) < TIP_LIMIT_PER_TOPIC;
}

export function recordTipShown(topic: AskTopic, now = Date.now()) {
    const state = readTipState();
    writeTipState({
        ...state,
        lastShownAt: now,
        shown: { ...state.shown, [topic]: (state.shown?.[topic] ?? 0) + 1 },
    });
}

export function turnTipsOff() {
    writeTipState({ ...readTipState(), off: true });
}

/**
 * Call after the user finishes a manual task the assistant could have answered
 * (an export, say). Shows a tip when the assistant is available, its panel is
 * closed and the tip limits allow it.
 */
export function nudgeAssistant(topic: AskTopic) {
    const dock = useAssistDock.getState();
    if (!dock.assistantFabEnabled || dock.panel !== 'none' || dock.tipTopic) return;
    if (!canShowTip(topic)) return;
    dock.showTip(topic);
}

// ---------------------------------------------------------------------------
// First-visit welcome: once per user and institute on this browser.

const WELCOME_KEY_PREFIX = 'assistantWelcomeSeen:';

export function welcomeSeen(scope: string): boolean {
    try {
        return localStorage.getItem(WELCOME_KEY_PREFIX + scope) === '1';
    } catch {
        // storage disabled: treat as seen, so it cannot open on every visit
        return true;
    }
}

export function markWelcomeSeen(scope: string) {
    try {
        localStorage.setItem(WELCOME_KEY_PREFIX + scope, '1');
    } catch {
        // nothing to do
    }
}
