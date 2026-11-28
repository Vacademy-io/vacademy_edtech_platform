import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CaretDown,
    CaretRight,
    ListChecks,
    PencilSimpleLine,
    TextAlignLeft,
} from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { PaperQuestionType, TypePlanEntry } from '../../-types/paper';

interface SubtypeDef {
    key: string;
    question_type: PaperQuestionType;
    defaultMarks: number;
    /** i18n keys under `subtypes.<key>` */
}

interface CategoryDef {
    key: 'objective' | 'short' | 'long';
    icon: typeof ListChecks;
    subtypes: SubtypeDef[];
}

/**
 * The catalogue a teacher picks from, in paper order (objective first).
 *
 * Short / long / very long answers are all the platform's LONG_ANSWER type —
 * what differs is the marks and the length instruction printed under the
 * section, which is exactly how a board paper distinguishes them.
 */
const CATALOGUE: CategoryDef[] = [
    {
        key: 'objective',
        icon: ListChecks,
        subtypes: [
            { key: 'mcq_single', question_type: 'MCQS', defaultMarks: 1 },
            { key: 'mcq_multi', question_type: 'MCQM', defaultMarks: 2 },
            { key: 'assertion_reason', question_type: 'ASSERTION_REASON', defaultMarks: 1 },
            { key: 'case_based', question_type: 'PASSAGE', defaultMarks: 1 },
            { key: 'true_false', question_type: 'TRUE_FALSE', defaultMarks: 1 },
        ],
    },
    {
        key: 'short',
        icon: PencilSimpleLine,
        subtypes: [
            { key: 'one_word', question_type: 'ONE_WORD', defaultMarks: 1 },
            { key: 'numerical_short', question_type: 'NUMERIC', defaultMarks: 2 },
            { key: 'short_answer', question_type: 'LONG_ANSWER', defaultMarks: 2 },
        ],
    },
    {
        key: 'long',
        icon: TextAlignLeft,
        subtypes: [
            { key: 'long_answer', question_type: 'LONG_ANSWER', defaultMarks: 5 },
            { key: 'very_long_answer', question_type: 'LONG_ANSWER', defaultMarks: 8 },
            { key: 'numerical_long', question_type: 'NUMERIC', defaultMarks: 5 },
        ],
    },
];

const ORDER = CATALOGUE.flatMap((c) => c.subtypes.map((s) => s.key));

/** Entries in catalogue (paper) order, whatever order they were ticked in. */
export const sortTypePlan = (plan: TypePlanEntry[]): TypePlanEntry[] =>
    [...plan].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));

/** The wire shape: the `key` is a UI handle the server does not need. */
export const toSpecTypePlan = (plan: TypePlanEntry[]) =>
    sortTypePlan(plan).map((entry) => ({
        question_type: entry.question_type,
        count: entry.count,
        marks_each: entry.marks_each,
        label: entry.label,
        instruction: entry.instruction,
    }));

export const planTotals = (plan: TypePlanEntry[]) => ({
    questions: plan.reduce((n, e) => n + (e.count || 0), 0),
    marks: plan.reduce((n, e) => n + (e.count || 0) * (e.marks_each || 0), 0),
});

const buildEntry = (sub: SubtypeDef, t: TFunction): TypePlanEntry => ({
    key: sub.key,
    question_type: sub.question_type,
    count: 1,
    marks_each: sub.defaultMarks,
    label: t(`subtypes.${sub.key}.label`),
    instruction: t(`subtypes.${sub.key}.instruction`),
});

interface QuestionTypesStepProps {
    value: TypePlanEntry[];
    onChange: (next: TypePlanEntry[]) => void;
    disabled?: boolean;
}

/**
 * "Configure question types and marks" — the teacher fixes the mix before a
 * single question is written: tick a subtype, say how many and how many marks
 * each, watch the totals in the header. The planner then only decides which
 * material each group draws on; the counts and marks are enforced server-side.
 */
export const QuestionTypesStep = ({
    value,
    onChange,
    disabled = false,
}: QuestionTypesStepProps) => {
    const { t } = useTranslation('knowledgeBaseQuestionTypes');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const byKey = useMemo(() => new Map(value.map((e) => [e.key, e])), [value]);
    const totals = planTotals(value);

    const toggle = (sub: SubtypeDef, on: boolean) => {
        if (on) onChange(sortTypePlan([...value, buildEntry(sub, t)]));
        else onChange(value.filter((e) => e.key !== sub.key));
    };
    const update = (key: string, patch: Partial<TypePlanEntry>) =>
        onChange(value.map((e) => (e.key === key ? { ...e, ...patch } : e)));

    const allCollapsed = CATALOGUE.every((c) => collapsed.has(c.key));

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2">
                <p className="text-caption text-neutral-500">
                    {t('summary.types', { count: value.length })}
                </p>
                <p className="text-body font-semibold text-neutral-700">
                    {t('summary.totals', { questions: totals.questions, marks: totals.marks })}
                </p>
            </div>
            <div className="flex items-center gap-1">
                <MyButton
                    buttonType="text"
                    scale="medium"
                    onClick={() =>
                        setCollapsed(
                            allCollapsed ? new Set() : new Set(CATALOGUE.map((c) => c.key))
                        )
                    }
                >
                    {allCollapsed ? t('actions.expandAll') : t('actions.collapseAll')}
                </MyButton>
                <MyButton
                    buttonType="text"
                    scale="medium"
                    disable={disabled || value.length === 0}
                    onClick={() => onChange([])}
                >
                    {t('actions.clearAll')}
                </MyButton>
            </div>

            <div className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
                {CATALOGUE.map((cat) => {
                    const Icon = cat.icon;
                    const isCollapsed = collapsed.has(cat.key);
                    const picked = cat.subtypes.filter((s) => byKey.has(s.key));
                    const catTotals = planTotals(picked.map((s) => byKey.get(s.key)!));
                    return (
                        <div key={cat.key} className="bg-white">
                            <button
                                type="button"
                                onClick={() =>
                                    setCollapsed((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(cat.key)) next.delete(cat.key);
                                        else next.add(cat.key);
                                        return next;
                                    })
                                }
                                className="flex w-full items-center gap-2 p-3 text-left"
                            >
                                {isCollapsed ? (
                                    <CaretRight className="size-3.5 shrink-0 text-neutral-400" />
                                ) : (
                                    <CaretDown className="size-3.5 shrink-0 text-neutral-400" />
                                )}
                                <Icon className="size-4 shrink-0 text-neutral-500" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-body font-medium text-neutral-700">
                                        {t(`categories.${cat.key}`)}
                                    </span>
                                    <span className="block text-caption text-neutral-400">
                                        {t('subtypesCount', { count: cat.subtypes.length })}
                                    </span>
                                </span>
                                {picked.length > 0 && (
                                    <span className="flex shrink-0 items-center gap-1">
                                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-600">
                                            {t('chips.questions', { count: catTotals.questions })}
                                        </span>
                                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-600">
                                            {t('chips.marks', { count: catTotals.marks })}
                                        </span>
                                    </span>
                                )}
                            </button>

                            {!isCollapsed && (
                                <div className="flex flex-col gap-1 border-t border-neutral-100 bg-neutral-50 px-3 py-2 pl-9">
                                    {cat.subtypes.map((sub) => {
                                        const entry = byKey.get(sub.key);
                                        const on = Boolean(entry);
                                        return (
                                            <div
                                                key={sub.key}
                                                className={cn(
                                                    'rounded-md p-2',
                                                    on && 'bg-white ring-1 ring-primary-100'
                                                )}
                                            >
                                                <label className="flex cursor-pointer items-start gap-2">
                                                    <Checkbox
                                                        checked={on}
                                                        disabled={disabled}
                                                        onCheckedChange={(v) =>
                                                            toggle(sub, Boolean(v))
                                                        }
                                                        className="mt-0.5"
                                                    />
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-body text-neutral-700">
                                                            {t(`subtypes.${sub.key}.label`)}
                                                        </span>
                                                        <span className="block text-caption text-neutral-400">
                                                            {t(`subtypes.${sub.key}.hint`)}
                                                        </span>
                                                    </span>
                                                    {on && entry && (
                                                        <span className="flex shrink-0 items-center gap-1">
                                                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption text-primary-600">
                                                                {t('chips.questions', {
                                                                    count: entry.count,
                                                                })}
                                                            </span>
                                                            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption text-primary-600">
                                                                {t('chips.marks', {
                                                                    count:
                                                                        entry.count *
                                                                        entry.marks_each,
                                                                })}
                                                            </span>
                                                        </span>
                                                    )}
                                                </label>
                                                {on && entry && (
                                                    <div className="mt-2 flex flex-wrap items-end gap-3 pl-6">
                                                        <label className="flex flex-col gap-1 text-caption text-neutral-500">
                                                            {t('fields.count')}
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={100}
                                                                value={entry.count}
                                                                disabled={disabled}
                                                                onChange={(e) =>
                                                                    update(sub.key, {
                                                                        count: Math.max(
                                                                            1,
                                                                            Math.min(
                                                                                100,
                                                                                Number(
                                                                                    e.target.value
                                                                                ) || 1
                                                                            )
                                                                        ),
                                                                    })
                                                                }
                                                                className="w-20 rounded-md border border-neutral-200 px-2 py-1.5 text-body text-neutral-700 focus:border-primary-500 focus:outline-none"
                                                            />
                                                        </label>
                                                        <span className="pb-2 text-neutral-400">
                                                            ×
                                                        </span>
                                                        <label className="flex flex-col gap-1 text-caption text-neutral-500">
                                                            {t('fields.marksEach')}
                                                            <input
                                                                type="number"
                                                                min={0.5}
                                                                step={0.5}
                                                                max={50}
                                                                value={entry.marks_each}
                                                                disabled={disabled}
                                                                onChange={(e) =>
                                                                    update(sub.key, {
                                                                        marks_each: Math.max(
                                                                            0.5,
                                                                            Math.min(
                                                                                50,
                                                                                Number(
                                                                                    e.target.value
                                                                                ) || 1
                                                                            )
                                                                        ),
                                                                    })
                                                                }
                                                                className="w-20 rounded-md border border-neutral-200 px-2 py-1.5 text-body text-neutral-700 focus:border-primary-500 focus:outline-none"
                                                            />
                                                        </label>
                                                        <span className="pb-2 text-caption text-neutral-500">
                                                            ={' '}
                                                            {t('chips.marks', {
                                                                count:
                                                                    entry.count * entry.marks_each,
                                                            })}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
