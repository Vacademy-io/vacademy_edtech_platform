import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Coins,
    ListChecks,
    PencilSimple,
    Sparkle,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { cn } from '@/lib/utils';
import type { ChoicePolicy, DigitisedPaper } from '@/services/paper-digitise';
import { MathHtml } from '@/routes/knowledge-base/-components/paper/MathHtml';
import { AddEditCriteriaDialog } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AddEditCriteriaDialog';
import type { CriteriaJson } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/criteria-services';
import {
    CopyCheckSettingsFields,
    type CopyCheckSettingsValue,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';
import { toEditableCriteria } from '@/services/copy-check-criteria';

/** One question the teacher has accepted, with the marks the checker will use. */
export interface ReviewedQuestion {
    /** Index into `paper.questions` / `paper.raw_questions`. */
    index: number;
    marks: number;
    /** Set only when the teacher changed this question's evaluation criteria here. */
    criteria?: CriteriaJson;
}

/** "Answer any FOUR of these five", as the teacher confirmed it: positions in `paper.questions`. */
export interface ReviewedChoice {
    label: string;
    indexes: number[];
    attempt: number;
    policy: ChoicePolicy;
}

interface RowState {
    index: number;
    marks: string;
    removed: boolean;
    /** The teacher's own criteria for this question, once edited here. */
    criteria?: CriteriaJson;
}

interface ChoiceState {
    label: string;
    indexes: number[];
    attempt: string;
    policy: ChoicePolicy;
    removed: boolean;
}

/**
 * The choices that still describe a real choice once rows are removed: at least two
 * questions left and fewer to answer than there are.
 */
const liveChoices = (choices: ChoiceState[], keptIndexes: Set<number>): ReviewedChoice[] =>
    choices
        .filter((c) => !c.removed)
        .map((c) => ({
            label: c.label,
            indexes: c.indexes.filter((i) => keptIndexes.has(i)),
            attempt: parseInt(c.attempt, 10),
            policy: c.policy,
        }))
        .filter((c) => c.indexes.length >= 2 && c.attempt >= 1 && c.attempt < c.indexes.length);

const parseJson = (json: string | null | undefined): unknown => {
    if (!json) return null;
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
};

const fmtMarks = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const stripHtml = (html: string | null | undefined): string => {
    if (!html) return '';
    if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, ' ');
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
};

/** Types the checker marks against a key; without one it has to judge alone. */
const KEYED_TYPES = new Set(['MCQS', 'MCQM', 'TRUE_FALSE', 'ONE_WORD', 'NUMERIC']);

const TYPE_LABEL: Record<string, string> = {
    MCQS: 'MCQ',
    MCQM: 'MCQ (multi)',
    TRUE_FALSE: 'True / False',
    ONE_WORD: 'One word',
    NUMERIC: 'Numeric',
    LONG_ANSWER: 'Written',
};

/**
 * What the model read out of the attached paper, before it becomes the test.
 *
 * The marks column is the point of this screen: every number here is the AI
 * checker's maximum for that question, so the teacher sees them all at once,
 * fixes the ones the paper did not print, and drops anything that is not a
 * question (an instruction line read as one). Also the moment the credits
 * already spent, and the per-sheet checking cost to come, are stated plainly.
 */
export const PaperDigitiseReviewDialog = ({
    open,
    paper,
    expectedTotal,
    busy,
    onConfirm,
    onCreateWithoutAi,
    onClose,
    secondaryLabel,
    primaryLabel,
    aiSettings,
    onAiSettingsChange,
}: {
    open: boolean;
    paper: DigitisedPaper | null;
    /** The total the teacher typed in the form, if any. */
    expectedTotal: number | null;
    busy: boolean;
    /** `choices` is passed only when the paper has an internal choice. */
    onConfirm: (questions: ReviewedQuestion[], choices?: ReviewedChoice[]) => void;
    onCreateWithoutAi: () => void;
    onClose: () => void;
    /** The secondary action's label; defaults to "Create without AI checking". */
    secondaryLabel?: string;
    /** The primary action's label; defaults to "Create test with N questions". */
    primaryLabel?: (count: number) => string;
    /** How the AI checks the sheets (subject, marking scheme, grammar); shown when given. */
    aiSettings?: CopyCheckSettingsValue;
    onAiSettingsChange?: (value: CopyCheckSettingsValue) => void;
}) => {
    const { t } = useTranslation('studyLibraryAssessmentCreateForm');
    const [rows, setRows] = useState<RowState[]>([]);
    const [choices, setChoices] = useState<ChoiceState[]>([]);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);

    useEffect(() => {
        if (!paper) return;
        setRows(
            paper.raw_questions.map((raw, index) => ({
                index,
                marks: raw.marks != null ? String(raw.marks) : '',
                removed: false,
            }))
        );
        setChoices(
            (paper.choice_groups ?? []).map((g) => ({
                label: g.label,
                indexes: g.question_indexes,
                attempt: String(g.attempt),
                policy: g.policy === 'first' ? 'first' : 'best',
                removed: false,
            }))
        );
    }, [paper]);

    const kept = rows.filter((row) => !row.removed);
    const invalid = kept.filter((row) => !(parseFloat(row.marks) > 0));
    const marksOf = (index: number) =>
        parseFloat(rows.find((row) => row.index === index)?.marks ?? '') || 0;
    const live = liveChoices(choices, new Set(kept.map((row) => row.index)));
    const choiceOf = new Map<number, ReviewedChoice>();
    live.forEach((c) => c.indexes.forEach((i) => choiceOf.set(i, c)));
    // Every kept question added up - and what the paper is out of under its choices:
    // "any FOUR of five 3-mark questions" adds 12, not 15.
    const allMarks = useMemo(
        () => kept.reduce((sum, row) => sum + (parseFloat(row.marks) || 0), 0),
        [kept]
    );
    const total =
        kept
            .filter((row) => !choiceOf.has(row.index))
            .reduce((sum, row) => sum + (parseFloat(row.marks) || 0), 0) +
        live.reduce(
            (sum, c) =>
                sum +
                c.indexes
                    .map(marksOf)
                    .sort((a, b) => b - a)
                    .slice(0, c.attempt)
                    .reduce((x, y) => x + y, 0),
            0
        );
    const totalMismatch = expectedTotal != null && Math.abs(total - expectedTotal) > 0.001;

    if (!paper) return null;

    const setMarks = (index: number, marks: string) =>
        setRows((prev) => prev.map((row) => (row.index === index ? { ...row, marks } : row)));
    const remove = (index: number) =>
        setRows((prev) => prev.map((row) => (row.index === index ? { ...row, removed: true } : row)));
    const restore = (index: number) =>
        setRows((prev) => prev.map((row) => (row.index === index ? { ...row, removed: false } : row)));

    /** The criteria the AI will mark this question by: the teacher's edit, else the paper read's. */
    const criteriaOf = (row: RowState): CriteriaJson | undefined =>
        row.criteria ??
        toEditableCriteria(
            parseJson(paper.questions[row.index]?.evaluation_criteria_json),
            parseFloat(row.marks) || 0
        );
    const setCriteria = (index: number, criteria: CriteriaJson) =>
        setRows((prev) => prev.map((row) => (row.index === index ? { ...row, criteria } : row)));
    const editingRow = editingIndex == null ? null : rows.find((row) => row.index === editingIndex);

    const setChoice = (label: string, patch: Partial<ChoiceState>) =>
        setChoices((prev) => prev.map((c) => (c.label === label ? { ...c, ...patch } : c)));

    const confirm = () => {
        const accepted = kept.map((row) => ({
            index: row.index,
            marks: parseFloat(row.marks),
            ...(row.criteria ? { criteria: row.criteria } : {}),
        }));
        if (live.length > 0) onConfirm(accepted, live);
        else onConfirm(accepted);
    };

    return (
        <MyDialog
            heading={t('review.heading', { count: kept.length })}
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
            dialogWidth="max-w-4xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={busy}
                        onClick={onCreateWithoutAi}
                    >
                        {secondaryLabel ?? t('review.createWithoutAi')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={busy || kept.length === 0 || invalid.length > 0}
                        onClick={confirm}
                    >
                        {busy
                            ? t('review.creating')
                            : primaryLabel
                              ? primaryLabel(kept.length)
                              : t('review.createWithQuestions', { count: kept.length })}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {/* Credits: what was just spent, and what each sheet will cost */}
                <div className="flex flex-col gap-2 rounded-lg border border-primary-100 bg-primary-50 p-4 text-sm text-neutral-700">
                    <div className="flex items-center gap-2 font-medium text-neutral-800">
                        <Coins className="size-4 text-primary-500" weight="bold" />
                        {paper.billed && paper.credits_charged != null
                            ? t('review.creditsCharged', {
                                  credits: paper.credits_charged,
                                  count: paper.pages,
                              })
                            : t('review.creditsChargedUnknown', {
                                  credits: paper.estimate.estimated_credits,
                              })}
                        {paper.balance_after != null && (
                            <span className="text-neutral-500">
                                · {t('review.balanceNow', { balance: paper.balance_after })}
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-neutral-600">
                        {t('review.perSheetCost', { count: kept.length })}
                    </p>
                </div>

                {/* Totals */}
                <div
                    className={cn(
                        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm',
                        totalMismatch
                            ? 'border-warning-200 bg-warning-50 text-warning-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    <span className="font-medium">
                        {t('review.totalLine', { count: kept.length, total })}
                    </span>
                    {live.length > 0 && Math.abs(allMarks - total) > 0.001 && (
                        <span>{t('review.allQuestionsAddUp', { total: allMarks })}</span>
                    )}
                    {paper.total_marks != null && (
                        <span>{t('review.paperStates', { total: paper.total_marks })}</span>
                    )}
                    {totalMismatch && (
                        <span>{t('review.youEntered', { total: expectedTotal })}</span>
                    )}
                    {paper.duration_minutes != null && (
                        <span>{t('review.paperDuration', { count: paper.duration_minutes })}</span>
                    )}
                </div>

                {aiSettings && onAiSettingsChange && (
                    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
                        <div className="flex flex-col">
                            <p className="text-sm font-medium text-neutral-800">
                                {t('review.ai.title')}
                            </p>
                            <p className="text-caption text-neutral-500">{t('review.ai.hint')}</p>
                        </div>
                        <CopyCheckSettingsFields
                            value={aiSettings}
                            onChange={onAiSettingsChange}
                            disabled={busy}
                        />
                    </div>
                )}

                {paper.warnings.length > 0 && (
                    <ul className="flex flex-col gap-1 rounded-lg border border-warning-200 bg-warning-50 p-3">
                        {paper.warnings.map((warning) => (
                            <li
                                key={warning}
                                className="flex items-start gap-2 text-caption text-warning-700"
                            >
                                <WarningCircle className="mt-0.5 size-4 shrink-0" />
                                {warning}
                            </li>
                        ))}
                    </ul>
                )}

                {/* Internal choice: "Answer any FOUR of these five" */}
                {choices.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-lg border border-info-200 bg-info-50 p-3">
                        <p className="text-sm font-medium text-neutral-800">
                            {t('review.choice.title')}
                        </p>
                        <p className="text-caption text-neutral-600">{t('review.choice.hint')}</p>
                        {choices.map((c) => {
                            const members = c.indexes.filter((i) =>
                                kept.some((row) => row.index === i)
                            );
                            const attempt = parseInt(c.attempt, 10);
                            const valid = attempt >= 1 && attempt < members.length;
                            return (
                                <div
                                    key={c.label}
                                    className={cn(
                                        'flex flex-wrap items-center gap-2 rounded-md bg-white p-2 text-sm text-neutral-700',
                                        c.removed && 'opacity-60'
                                    )}
                                >
                                    <span className="font-medium">{c.label}</span>
                                    {c.removed ? (
                                        <>
                                            <span>{t('review.choice.allCompulsory')}</span>
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                disable={busy}
                                                onClick={() =>
                                                    setChoice(c.label, { removed: false })
                                                }
                                            >
                                                {t('review.restore')}
                                            </MyButton>
                                        </>
                                    ) : (
                                        <>
                                            <span>{t('review.choice.answerAny')}</span>
                                            <MyInput
                                                inputType="number"
                                                input={c.attempt}
                                                onChangeFunction={(e) =>
                                                    setChoice(c.label, { attempt: e.target.value })
                                                }
                                                size="small"
                                                className="w-16 sm:w-16"
                                                min={1}
                                                step={1}
                                                onWheel={(e) => e.currentTarget.blur()}
                                            />
                                            <span>
                                                {t('review.choice.ofCount', {
                                                    count: members.length,
                                                })}
                                            </span>
                                            <span className="text-neutral-400">·</span>
                                            <span>{t('review.choice.counting')}</span>
                                            {(['best', 'first'] as const).map((policy) => (
                                                <MyButton
                                                    key={policy}
                                                    buttonType={
                                                        c.policy === policy
                                                            ? 'primary'
                                                            : 'secondary'
                                                    }
                                                    scale="small"
                                                    disable={busy}
                                                    onClick={() => setChoice(c.label, { policy })}
                                                >
                                                    {t(`review.choice.policy.${policy}`)}
                                                </MyButton>
                                            ))}
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                disable={busy}
                                                onClick={() =>
                                                    setChoice(c.label, { removed: true })
                                                }
                                            >
                                                {t('review.choice.makeCompulsory')}
                                            </MyButton>
                                            {!valid && (
                                                <span className="basis-full text-caption text-danger-600">
                                                    {t('review.choice.invalid', {
                                                        count: members.length,
                                                    })}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {invalid.length > 0 && (
                    <p className="text-caption text-danger-600">
                        {t('review.marksRequired', { count: invalid.length })}
                    </p>
                )}

                {/* Questions */}
                <ol className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {rows.map((row) => {
                        const raw = paper.raw_questions[row.index];
                        const dto = paper.questions[row.index];
                        if (!raw || !dto) return null;
                        const type = String(dto.question_type || raw.question_type || '');
                        const guessed = raw.marks_source === 'split' || raw.marks_source === 'default';
                        return (
                            <li
                                key={row.index}
                                className={cn(
                                    'flex items-start gap-3 p-3',
                                    row.removed && 'bg-neutral-50 opacity-60'
                                )}
                            >
                                <span className="w-12 shrink-0 pt-2 text-caption font-semibold text-neutral-500">
                                    Q{String(raw.question_number ?? row.index + 1)}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    {stripHtml(dto.text?.content) ? (
                                        // Typeset, not the LaTeX source: a maths
                                        // paper reads as "$2 \mathrm{x}-5
                                        // \mathrm{y}=7$" otherwise.
                                        <MathHtml
                                            html={dto.text?.content ?? ''}
                                            className={cn(
                                                'line-clamp-2 text-body text-neutral-800 [&_p]:inline',
                                                row.removed && 'line-through'
                                            )}
                                        />
                                    ) : (
                                        <p
                                            className={cn(
                                                'line-clamp-2 text-body text-neutral-800',
                                                row.removed && 'line-through'
                                            )}
                                        >
                                            {t('review.unreadableQuestion')}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                                            {TYPE_LABEL[type] ?? type}
                                        </span>
                                        {raw.section && (
                                            <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600">
                                                {raw.section}
                                            </span>
                                        )}
                                        {!row.removed && choiceOf.has(row.index) && (
                                            <span className="rounded-md bg-info-50 px-2 py-0.5 text-caption text-info-700">
                                                {t('review.choice.chip', {
                                                    attempt: choiceOf.get(row.index)!.attempt,
                                                    count: choiceOf.get(row.index)!.indexes.length,
                                                })}
                                            </span>
                                        )}
                                        {raw.answer_source === 'model' && (
                                            <span className="flex items-center gap-1 rounded-md bg-info-50 px-2 py-0.5 text-caption text-info-700">
                                                <Sparkle className="size-3" />
                                                {t('review.aiSuggestedAnswer')}
                                            </span>
                                        )}
                                        {guessed && !row.removed && (
                                            <span className="rounded-md bg-warning-50 px-2 py-0.5 text-caption text-warning-700">
                                                {t('review.marksGuessed')}
                                            </span>
                                        )}
                                        {KEYED_TYPES.has(type) && raw.answer_source === 'none' && !row.removed && (
                                            <span className="rounded-md bg-danger-50 px-2 py-0.5 text-caption text-danger-700">
                                                {t('review.noAnswer')}
                                            </span>
                                        )}
                                    </div>
                                    {!row.removed && (
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-neutral-500">
                                            <ListChecks className="size-4 shrink-0 text-primary-400" />
                                            <span>
                                                {(() => {
                                                    const criteria = criteriaOf(row);
                                                    return criteria && criteria.criteria.length > 0
                                                        ? criteria.criteria
                                                              .map(
                                                                  (c) =>
                                                                      `${c.name} (${fmtMarks(Number(c.max_marks) || 0)})`
                                                              )
                                                              .join(' · ')
                                                        : t('review.criteria.none');
                                                })()}
                                            </span>
                                            {row.criteria && (
                                                <span className="rounded-md bg-success-50 px-2 py-0.5 text-success-700">
                                                    {t('review.criteria.edited')}
                                                </span>
                                            )}
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                disable={busy || !(parseFloat(row.marks) > 0)}
                                                onClick={() => setEditingIndex(row.index)}
                                            >
                                                <PencilSimple className="size-3.5" />
                                                {t('review.criteria.edit')}
                                            </MyButton>
                                        </div>
                                    )}
                                </div>
                                {row.removed ? (
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        onClick={() => restore(row.index)}
                                        disable={busy}
                                    >
                                        {t('review.restore')}
                                    </MyButton>
                                ) : (
                                    <>
                                        <MyInput
                                            inputType="number"
                                            input={row.marks}
                                            onChangeFunction={(e) => setMarks(row.index, e.target.value)}
                                            size="small"
                                            className="w-20 sm:w-20"
                                            min={0.5}
                                            step={0.5}
                                            error={
                                                parseFloat(row.marks) > 0
                                                    ? undefined
                                                    : t('review.marksInvalid')
                                            }
                                            onWheel={(e) => e.currentTarget.blur()}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => remove(row.index)}
                                            disabled={busy}
                                            aria-label={t('review.removeQuestion')}
                                            className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-danger-50 hover:text-danger-500"
                                        >
                                            <Trash className="size-4" />
                                        </button>
                                    </>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </div>
            {editingRow && (
                <AddEditCriteriaDialog
                    open
                    question={{
                        text: stripHtml(paper.questions[editingRow.index]?.text?.content),
                        question_type: String(
                            paper.questions[editingRow.index]?.question_type ||
                                paper.raw_questions[editingRow.index]?.question_type ||
                                'LONG_ANSWER'
                        ),
                        max_marks: parseFloat(editingRow.marks) || 0,
                        subject: aiSettings?.subject || undefined,
                    }}
                    existingCriteria={criteriaOf(editingRow)}
                    onSave={(criteria) => setCriteria(editingRow.index, criteria)}
                    onClose={() => setEditingIndex(null)}
                />
            )}
        </MyDialog>
    );
};
