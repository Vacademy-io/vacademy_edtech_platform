/**
 * Question-type catalogue + preset bundles for the
 * Create-Assessment-from-Recording wizard.
 *
 * The backend's AiPublishAssessmentService currently only persists MCQS,
 * so until the LLM + persistence are extended (Phase 3 of the wizard
 * plan), selections here travel in the request body and the backend may
 * still produce MCQs. The picker UX is still useful — teachers see what
 * mix is coming, and we have a hook to plug richer generation into.
 */
import type { TFunction } from 'i18next';

// This module is not a component/hook, so the caller's `t` is threaded in
// here rather than calling useTranslation() directly. Labels are looked up
// in the liveSessionQuestionTypePresets namespace via an explicit `ns`
// override so the caller can keep its own default namespace.
const NAMESPACE = 'liveSessionQuestionTypePresets';

export type QuestionTypeCode =
    | 'MCQS' // Multiple choice — single correct
    | 'MCQM' // Multiple choice — multiple correct
    | 'TRUE_FALSE'
    | 'ONE_WORD'
    | 'LONG_ANSWER';

export interface QuestionTypeMeta {
    code: QuestionTypeCode;
    label: string;
    /** One-liner shown under the label in the picker. */
    hint: string;
    /** Hex color for the type pill. Kept simple — no full Tailwind theme yet. */
    accent: 'sky' | 'violet' | 'emerald' | 'amber' | 'rose';
}

/** Build the question-type catalogue with translated labels/hints. */
export const buildQuestionTypes = (t: TFunction): QuestionTypeMeta[] => [
    {
        code: 'MCQS',
        label: t('questionTypes.mcqs.label', { ns: NAMESPACE }),
        hint: t('questionTypes.mcqs.hint', { ns: NAMESPACE }),
        accent: 'sky',
    },
    {
        code: 'MCQM',
        label: t('questionTypes.mcqm.label', { ns: NAMESPACE }),
        hint: t('questionTypes.mcqm.hint', { ns: NAMESPACE }),
        accent: 'violet',
    },
    {
        code: 'TRUE_FALSE',
        label: t('questionTypes.trueFalse.label', { ns: NAMESPACE }),
        hint: t('questionTypes.trueFalse.hint', { ns: NAMESPACE }),
        accent: 'emerald',
    },
    {
        code: 'ONE_WORD',
        label: t('questionTypes.oneWord.label', { ns: NAMESPACE }),
        hint: t('questionTypes.oneWord.hint', { ns: NAMESPACE }),
        accent: 'amber',
    },
    {
        code: 'LONG_ANSWER',
        label: t('questionTypes.longAnswer.label', { ns: NAMESPACE }),
        hint: t('questionTypes.longAnswer.hint', { ns: NAMESPACE }),
        accent: 'rose',
    },
];

export interface QuestionTypePreset {
    id: string;
    label: string;
    description: string;
    types: QuestionTypeCode[];
}

/** Build the preset bundles with translated labels/descriptions. */
export const buildQuestionTypePresets = (t: TFunction): QuestionTypePreset[] => [
    {
        id: 'mcq-only',
        label: t('presets.mcqOnly.label', { ns: NAMESPACE }),
        description: t('presets.mcqOnly.description', { ns: NAMESPACE }),
        types: ['MCQS'],
    },
    {
        id: 'mcq-tf',
        label: t('presets.mcqTf.label', { ns: NAMESPACE }),
        description: t('presets.mcqTf.description', { ns: NAMESPACE }),
        types: ['MCQS', 'TRUE_FALSE'],
    },
    {
        id: 'mcq-oneword',
        label: t('presets.mcqOneword.label', { ns: NAMESPACE }),
        description: t('presets.mcqOneword.description', { ns: NAMESPACE }),
        types: ['MCQS', 'ONE_WORD'],
    },
    {
        id: 'mixed-all',
        label: t('presets.mixedAll.label', { ns: NAMESPACE }),
        description: t('presets.mixedAll.description', { ns: NAMESPACE }),
        types: ['MCQS', 'MCQM', 'TRUE_FALSE', 'ONE_WORD', 'LONG_ANSWER'],
    },
    {
        id: 'subjective-objective',
        label: t('presets.subjectiveObjective.label', { ns: NAMESPACE }),
        description: t('presets.subjectiveObjective.description', { ns: NAMESPACE }),
        types: ['MCQS', 'LONG_ANSWER'],
    },
];

export const presetMatching = (
    selected: QuestionTypeCode[],
    presets: QuestionTypePreset[],
): QuestionTypePreset | undefined => {
    const key = [...selected].sort().join(',');
    return presets.find(
        (p) => [...p.types].sort().join(',') === key,
    );
};
