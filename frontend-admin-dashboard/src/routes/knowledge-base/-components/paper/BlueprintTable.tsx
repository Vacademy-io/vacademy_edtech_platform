import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Minus, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type {
    Blueprint,
    BlueprintRow,
    PaperDifficulty,
    PaperQuestionType,
} from '../../-types/paper';

// Doubles as the type picker's option list (see Object.keys below), so adding an
// entry here is all it takes to offer a new question type in the plan.
const buildTypeLabel = (t: TFunction): Record<PaperQuestionType, string> => ({
    MCQS: t('typeLabel.MCQS'),
    MCQM: t('typeLabel.MCQM'),
    TRUE_FALSE: t('typeLabel.TRUE_FALSE'),
    ONE_WORD: t('typeLabel.ONE_WORD'),
    LONG_ANSWER: t('typeLabel.LONG_ANSWER'),
    NUMERIC: t('typeLabel.NUMERIC'),
    PASSAGE: t('typeLabel.PASSAGE'),
    ASSERTION_REASON: t('typeLabel.ASSERTION_REASON'),
});

const buildDifficultyLabel = (t: TFunction): Record<PaperDifficulty, string> => ({
    EASY: t('difficultyLabel.EASY'),
    MEDIUM: t('difficultyLabel.MEDIUM'),
    HARD: t('difficultyLabel.HARD'),
});

interface BlueprintTableProps {
    blueprint: Blueprint;
    onChange: (next: Blueprint) => void;
    disabled?: boolean;
}

const recompute = (rows: BlueprintRow[]): Pick<Blueprint, 'total_questions' | 'total_marks'> => ({
    total_questions: rows.reduce((sum, r) => sum + (r.count || 0), 0),
    total_marks: rows.reduce((sum, r) => sum + (r.count || 0) * (r.marks_each || 0), 0),
});

/**
 * The plan, before any question exists.
 *
 * Everything here is cheap to change and expensive to get wrong later — which is
 * exactly why the teacher edits this rather than 60 finished questions. Totals
 * recompute locally on every keystroke so the marks arithmetic is visible while
 * they're deciding, not after generating.
 */
export const BlueprintTable = ({ blueprint, onChange, disabled }: BlueprintTableProps) => {
    const { t, i18n } = useTranslation('knowledgeBaseBlueprintTable');
    const TYPE_LABEL = buildTypeLabel(t);
    const DIFFICULTY_LABEL = buildDifficultyLabel(t);

    const patchRow = (rowId: string, patch: Partial<BlueprintRow>) => {
        const rows = blueprint.rows.map((r) => {
            if (r.id !== rowId) return r;
            const next = { ...r, ...patch };
            return { ...next, total_marks: (next.count || 0) * (next.marks_each || 0) };
        });
        onChange({ ...blueprint, rows, ...recompute(rows) });
    };

    const removeRow = (rowId: string) => {
        const rows = blueprint.rows.filter((r) => r.id !== rowId);
        onChange({ ...blueprint, rows, ...recompute(rows) });
    };

    return (
        <div className="flex flex-col gap-3">
            {blueprint.notes.length > 0 && (
                <Card className="flex flex-col gap-1 border-warning-200 bg-warning-50 p-3">
                    {blueprint.notes.map((note) => (
                        <p
                            key={note}
                            className="flex items-start gap-2 text-caption text-warning-700"
                        >
                            <WarningCircle className="mt-0.5 size-4 shrink-0" />
                            {note}
                        </p>
                    ))}
                </Card>
            )}

            <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                    {/* w-max lets the eight columns take the width they need instead
                        of crushing; min-w-full keeps it filling a wide container.
                        The wrapper scrolls horizontally on narrow screens. */}
                    <table className="w-max min-w-full border-collapse">
                        <thead>
                            <tr className="border-b border-neutral-200 bg-neutral-50">
                                <th className="px-3 py-2 text-start text-caption font-semibold text-neutral-600">
                                    {t('columns.section')}
                                </th>
                                <th className="px-3 py-2 text-start text-caption font-semibold text-neutral-600">
                                    {t('columns.whatItTests')}
                                </th>
                                <th className="px-3 py-2 text-start text-caption font-semibold text-neutral-600">
                                    {t('columns.type')}
                                </th>
                                <th className="px-3 py-2 text-center text-caption font-semibold text-neutral-600">
                                    {t('columns.questions')}
                                </th>
                                <th className="px-3 py-2 text-center text-caption font-semibold text-neutral-600">
                                    {t('columns.marksEach')}
                                </th>
                                <th className="px-3 py-2 text-start text-caption font-semibold text-neutral-600">
                                    {t('columns.difficulty')}
                                </th>
                                <th className="px-3 py-2 text-end text-caption font-semibold text-neutral-600">
                                    {t('columns.total')}
                                </th>
                                <th className="w-10 px-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {blueprint.rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className="border-b border-neutral-100 last:border-b-0"
                                >
                                    <td className="px-3 py-2 text-body text-neutral-700">
                                        {row.section}
                                    </td>
                                    <td className="px-3 py-2">
                                        <p className="max-w-xs break-words text-body text-neutral-700">
                                            {row.topic}
                                        </p>
                                        {row.page_start && (
                                            <p className="text-caption text-neutral-400">
                                                {t('pageRange', {
                                                    range:
                                                        row.page_end &&
                                                        row.page_end !== row.page_start
                                                            ? `${row.page_start}-${row.page_end}`
                                                            : row.page_start,
                                                })}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Select
                                            value={row.question_type}
                                            disabled={disabled}
                                            onValueChange={(v) =>
                                                patchRow(row.id, {
                                                    question_type: v as PaperQuestionType,
                                                })
                                            }
                                        >
                                            <SelectTrigger className="h-8 w-36 text-caption">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(
                                                    Object.keys(TYPE_LABEL) as PaperQuestionType[]
                                                ).map((t) => (
                                                    <SelectItem key={t} value={t}>
                                                        {TYPE_LABEL[t]}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-center gap-1">
                                            <MyButton
                                                buttonType="secondary"
                                                layoutVariant="icon"
                                                scale="small"
                                                disable={disabled || row.count <= 0}
                                                aria-label={t('aria.oneFewer', { topic: row.topic })}
                                                onClick={() =>
                                                    patchRow(row.id, {
                                                        count: Math.max(0, row.count - 1),
                                                    })
                                                }
                                            >
                                                <Minus className="size-3" />
                                            </MyButton>
                                            <span className="w-8 text-center text-body text-neutral-700">
                                                {row.count}
                                            </span>
                                            <MyButton
                                                buttonType="secondary"
                                                layoutVariant="icon"
                                                scale="small"
                                                disable={disabled}
                                                aria-label={t('aria.oneMore', { topic: row.topic })}
                                                onClick={() =>
                                                    patchRow(row.id, { count: row.count + 1 })
                                                }
                                            >
                                                <Plus className="size-3" />
                                            </MyButton>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.5}
                                            value={row.marks_each}
                                            disabled={disabled}
                                            aria-label={t('aria.marksPer', { topic: row.topic })}
                                            onChange={(e) =>
                                                patchRow(row.id, {
                                                    marks_each: Number(e.target.value) || 0,
                                                })
                                            }
                                            className="h-8 w-16 rounded-md border border-neutral-300 px-2 text-center text-body focus:border-primary-300 focus:outline-none"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <Select
                                            value={row.difficulty}
                                            disabled={disabled}
                                            onValueChange={(v) =>
                                                patchRow(row.id, {
                                                    difficulty: v as PaperDifficulty,
                                                })
                                            }
                                        >
                                            <SelectTrigger className="h-8 w-28 text-caption">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(
                                                    Object.keys(
                                                        DIFFICULTY_LABEL
                                                    ) as PaperDifficulty[]
                                                ).map((d) => (
                                                    <SelectItem key={d} value={d}>
                                                        {DIFFICULTY_LABEL[d]}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </td>
                                    <td className="px-3 py-2 text-end text-body text-neutral-600">
                                        {(row.count * row.marks_each).toLocaleString(i18n.language)}
                                    </td>
                                    <td className="p-2">
                                        <MyButton
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            disable={disabled}
                                            aria-label={t('aria.remove', { topic: row.topic })}
                                            onClick={() => removeRow(row.id)}
                                        >
                                            <Trash className="size-3 text-danger-600" />
                                        </MyButton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-neutral-200 bg-neutral-50">
                                <td
                                    colSpan={3}
                                    className="px-3 py-2 text-body font-semibold text-neutral-700"
                                >
                                    {t('footer.total')}
                                </td>
                                <td className="px-3 py-2 text-center text-body font-semibold text-neutral-700">
                                    {blueprint.total_questions}
                                </td>
                                <td />
                                <td />
                                <td className="px-3 py-2 text-end text-body font-semibold text-neutral-700">
                                    {blueprint.total_marks.toLocaleString(i18n.language)}
                                </td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </Card>
        </div>
    );
};
