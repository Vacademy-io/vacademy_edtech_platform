import { useTranslation } from 'react-i18next';
import { CaretDown, Check, ClockCounterClockwise, DotsThree, PencilSimple } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { formatMarkOutOf, isObjectiveType } from '@/services/submission-review/marks';
import type { QuestionRow as QuestionRowData, SubmissionOutline } from '@/services/submission-review/types';
import type { PaperQuestion } from '../-utils/paper';
import { cardKindFor } from '../-utils/filters';
import { canEditMarks, type RowActions } from './actions';
import { MarkedByLabel, useTypeLabel } from './MarkedByLabel';
import { QuestionCard } from './QuestionCard';
import { StateBadge } from './StateBadge';

/**
 * One question: a one-line row (number · type · mark / max · state / marked by · ⋯) that
 * opens into its card. Objective rows are one line until opened (W3a collapsed).
 */
export const QuestionRowLine = ({
    row,
    outline,
    paper,
    sectionName,
    showSection,
    open,
    onToggle,
    currentRubricVersion,
    pageIndexById,
    actions,
}: {
    row: QuestionRowData;
    outline: SubmissionOutline;
    paper: PaperQuestion | null;
    sectionName: string;
    /** "Q3 (Section B)" when the same question sits in two sections (spec §15.1). */
    showSection: boolean;
    open: boolean;
    onToggle: () => void;
    currentRubricVersion?: number | null;
    pageIndexById?: Record<string, number>;
    actions: RowActions;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const typeLabel = useTypeLabel();
    const editable = canEditMarks(outline);
    const objective = isObjectiveType(row.question_type);
    const marked = row.state === 'MARKED' || row.state === 'AI_DRAFT';
    // "AI mark looks right" for any AI draft (typed long answers, spreadsheets); the
    // handwritten card has its own "Looks right" beside the sheet.
    const acceptHere = editable && row.state === 'AI_DRAFT' && cardKindFor(row, outline.kind) !== 'handwritten';

    return (
        <li
            id={`q-${row.key}`}
            className={cn(
                'scroll-mt-24 rounded-lg border bg-white',
                row.state === 'NEEDS_MARKING' ? 'border-warning-200' : 'border-neutral-200'
            )}
        >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    <span className="w-12 shrink-0 font-semibold text-neutral-800">
                        {showSection
                            ? t('row.numberInSection', { number: row.question_number, section: sectionName })
                            : t('row.number', { number: row.question_number })}
                    </span>
                    <span className="min-w-0 truncate text-body text-neutral-600">{typeLabel(row.question_type)}</span>
                    <span
                        className={cn(
                            'shrink-0 whitespace-nowrap text-body font-semibold tabular-nums',
                            row.state === 'NEEDS_MARKING' ? 'text-neutral-500' : 'text-neutral-900'
                        )}
                    >
                        {formatMarkOutOf(row.marks, row.max_marks)}
                    </span>
                    <StateBadge row={row} hideMarked={marked} />
                    {marked && <MarkedByLabel row={row} />}
                </button>
                <div className="flex shrink-0 items-center gap-1">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1 sm:min-w-0"
                        aria-expanded={open}
                        onClick={onToggle}
                    >
                        {open ? t('row.close') : t('row.open')}
                        <CaretDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
                    </MyButton>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                aria-label={t('row.more', { number: row.question_number })}
                            >
                                <DotsThree size={16} />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {editable && row.state === 'AI_DRAFT' && (
                                <DropdownMenuItem className="cursor-pointer" onClick={() => actions.onAcceptAi(row)}>
                                    {t('actions.aiLooksRight')}
                                </DropdownMenuItem>
                            )}
                            {editable && (
                                <DropdownMenuItem className="cursor-pointer" onClick={() => actions.onEdit(row)}>
                                    {t('actions.editMarks')}
                                </DropdownMenuItem>
                            )}
                            {editable && objective && (
                                <DropdownMenuItem className="cursor-pointer" onClick={() => actions.onRemark(row)}>
                                    {t('actions.remarkWithKey')}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="cursor-pointer" onClick={() => actions.onHistory(row)}>
                                {t('actions.historyCount', { count: row.history_count })}
                            </DropdownMenuItem>
                            {editable && row.state !== 'NOT_ANSWERED' && (
                                <DropdownMenuItem className="cursor-pointer" onClick={() => actions.onNotAnswered(row)}>
                                    {t('actions.markNotAnswered')}
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {open && (
                <div className="flex flex-col gap-4 border-t border-neutral-200 p-4">
                    <QuestionCard
                        row={row}
                        outline={outline}
                        paper={paper}
                        currentRubricVersion={currentRubricVersion}
                        pageIndexById={pageIndexById}
                        actions={actions}
                    />
                    <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
                        {acceptHere && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="small"
                                className="gap-1"
                                disabled={actions.acceptingKey === row.key}
                                onClick={() => actions.onAcceptAi(row)}
                            >
                                <Check size={14} weight="bold" />
                                {t('actions.aiLooksRight')}
                            </MyButton>
                        )}
                        {editable && (
                            <MyButton
                                type="button"
                                buttonType={row.state === 'NEEDS_MARKING' ? 'primary' : 'secondary'}
                                scale="small"
                                className="gap-1"
                                onClick={() => actions.onEdit(row)}
                            >
                                <PencilSimple size={14} />
                                {row.state === 'NEEDS_MARKING' ? t('actions.markItMyself') : t('actions.editMarks')}
                            </MyButton>
                        )}
                        {editable && objective && (
                            <MyButton type="button" buttonType="secondary" scale="small" onClick={() => actions.onRemark(row)}>
                                {t('actions.remarkWithKey')}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="gap-1"
                            onClick={() => actions.onHistory(row)}
                        >
                            <ClockCounterClockwise size={14} />
                            {t('actions.historyCount', { count: row.history_count })}
                        </MyButton>
                        {!editable && (
                            <span className="text-caption text-neutral-500">
                                {outline.release.status === 'RELEASED' ? t('row.readOnlyReleased') : t('row.readOnly')}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </li>
    );
};
