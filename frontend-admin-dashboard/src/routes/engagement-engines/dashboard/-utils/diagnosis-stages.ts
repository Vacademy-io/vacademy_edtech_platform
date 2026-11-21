import type { TFunction } from 'i18next';
import type { StatusType } from '@/components/design-system/status-chips';
import {
    DIAGNOSIS_STAGES,
    type DiagnosisDataGap,
    type DiagnosisProblem,
    type DiagnosisStageRow,
    type EngagementDiagnosis,
} from '@/services/engagement-diagnosis';
import { humanizeKey } from './report-format';

/*
 * One line per stage of the lead-to-demo chain, and the notes about what the report cannot see.
 * A stage that could not be read must never look fine, so UNAVAILABLE (and any status the page
 * does not know) is worded and coloured as a warning, never as "Normal".
 */

const KNOWN_STATUSES = ['PROBLEM', 'UNAVAILABLE', 'NO_ACTIVITY', 'NOT_ENOUGH_DATA', 'OK'] as const;
export type StageStatusKey = (typeof KNOWN_STATUSES)[number] | 'UNKNOWN';

export const stageStatusKey = (status: string): StageStatusKey =>
    (KNOWN_STATUSES as readonly string[]).includes(status) ? (status as StageStatusKey) : 'UNKNOWN';

/** How many of the listed problems belong to a stage. */
export const problemsInStage = (stage: string, problems: DiagnosisProblem[]): number =>
    problems.filter((p) => p.stage === stage).length;

/**
 * "Normal", "Nothing sent", "Not enough data yet", "Couldn't load", or for a stage with problems
 * "2 problems". A stage whose problem was cut by the cap says just "Needs attention".
 */
export const stageStatusLabel = (
    stage: string,
    status: string,
    problemCount: number,
    t: TFunction
): string => {
    const key = stageStatusKey(status);
    if (key === 'PROBLEM') {
        return problemCount > 0
            ? t('diagnosis.stageStatus.PROBLEM_count', { count: problemCount })
            : t('diagnosis.stageStatus.PROBLEM');
    }
    // "Nothing sent" reads wrong for the leads stage, so a stage may word it its own way.
    return t(`diagnosis.stageStatus.${key}`, { context: stage });
};

/** The chip for a status. Quiet statuses are grey, a failed read is a warning, OK is green. */
export const stageChip = (
    status: string,
    worst: 'critical' | 'warning' | null
): { type: StatusType; icon: boolean } => {
    switch (stageStatusKey(status)) {
        case 'OK':
            return { type: 'SUCCESS', icon: true };
        case 'PROBLEM':
            return { type: worst === 'critical' ? 'DANGER' : 'WARNING', icon: true };
        case 'NO_ACTIVITY':
        case 'NOT_ENOUGH_DATA':
            return { type: 'INFO', icon: false };
        default:
            // UNAVAILABLE and anything unknown: we could not see this stage.
            return { type: 'WARNING', icon: true };
    }
};

export interface StageLine {
    stage: string;
    label: string;
    status: StageStatusKey;
    statusLabel: string;
    chip: { type: StatusType; icon: boolean };
}

const stageOrder = (stage: string): number => {
    const at = (DIAGNOSIS_STAGES as readonly string[]).indexOf(stage);
    return at === -1 ? DIAGNOSIS_STAGES.length : at;
};

/** One line per stage the response has, in stage order; a stage the page does not know goes last. */
export const buildStageLines = (
    stages: DiagnosisStageRow[],
    problems: DiagnosisProblem[],
    t: TFunction
): StageLine[] =>
    [...stages]
        .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage))
        .map((row) => {
            const inStage = problems.filter((p) => p.stage === row.stage);
            const worst = inStage.some((p) => p.severity === 'critical')
                ? 'critical'
                : inStage.length > 0
                  ? 'warning'
                  : null;
            return {
                stage: row.stage,
                label: t(`diagnosis.stage.${row.stage}`, { defaultValue: humanizeKey(row.stage) }),
                status: stageStatusKey(row.status),
                statusLabel: stageStatusLabel(row.stage, row.status, inStage.length, t),
                chip: stageChip(row.status, worst),
            };
        });

/** The stage's row, if the response has one. */
export const stageRow = (
    stages: DiagnosisStageRow[],
    stage: string
): DiagnosisStageRow | undefined => stages.find((s) => s.stage === stage);

// ─── the panel's headline state ─────────────────────────────────────────────

/**
 * What the top of the daily panel says:
 * - problems: at least one problem fired.
 * - incomplete: none fired, but something could not be read, so "no problems" would be a guess.
 * - quiet: none fired, but nothing had enough activity to be judged.
 * - calm: none fired and at least one stage had enough activity to be sure.
 */
export type PanelState = 'problems' | 'incomplete' | 'quiet' | 'calm';

export const panelState = (
    d: Pick<EngagementDiagnosis, 'problems' | 'stages' | 'errors'>
): PanelState => {
    if (d.problems.length > 0) return 'problems';
    const statuses = d.stages.map((s) => stageStatusKey(s.status));
    const unread = statuses.some((s) => s === 'UNAVAILABLE' || s === 'UNKNOWN' || s === 'PROBLEM');
    if (unread || Object.keys(d.errors).length > 0) return 'incomplete';
    if (statuses.length > 0 && !statuses.includes('OK')) return 'quiet';
    return 'calm';
};

// ─── data gaps ──────────────────────────────────────────────────────────────

const KNOWN_GAPS = [
    'EMAIL_REPLIES_NOT_TRACKED',
    'EMAIL_TRACKING_OFF',
    'WHATSAPP_TRACKING_OFF',
    'CALL_ANALYSIS_EMPTY',
] as const;

const GAP_NAMES_SHOWN = 3;

/**
 * What could not be read this time. "too_many" isn't a failure, only more messages than delivery
 * can be read for, so it says so instead of a stage's "Couldn't load" standing alone.
 */
const errorNotes = (errors: Record<string, string>, t: TFunction): string[] => {
    const reasons = Object.values(errors);
    return [
        ...(reasons.includes('too_many') ? [t('diagnosis.gap.TOO_MANY')] : []),
        ...(reasons.some((r) => r !== 'too_many') ? [t('diagnosis.gap.PARTIAL')] : []),
    ];
};

/** A short note per gap, so a 0 that is really "can't see" is not read as a real 0. */
export const buildGapNotes = (
    gaps: DiagnosisDataGap[],
    errors: Record<string, string>,
    t: TFunction
): string[] => [
    ...errorNotes(errors, t),
    ...gaps.map((gap) => {
        if (!(KNOWN_GAPS as readonly string[]).includes(gap.code))
            return t('diagnosis.gap.unknown');
        const names = gap.names.map((n) => n.trim()).filter(Boolean);
        // Every sender is unseen when inbound email is off, and an older row names none.
        if (gap.code === 'EMAIL_REPLIES_NOT_TRACKED' && names.length === 0) {
            return t('diagnosis.gap.EMAIL_REPLIES_NOT_TRACKED_ALL');
        }
        const shown = names.slice(0, GAP_NAMES_SHOWN).join(', ');
        const more = names.length - GAP_NAMES_SHOWN;
        return t(`diagnosis.gap.${gap.code}`, {
            names: more > 0 ? t('diagnosis.names.more', { list: shown, count: more }) : shown,
            count: names.length,
        });
    }),
];
