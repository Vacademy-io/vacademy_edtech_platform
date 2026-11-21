import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import TipTapEditor from '@/components/tiptap/TipTapEditor';
import LatexRenderer from '@/routes/assessment/evaluation-ai/-components/latex-renderer';
import { formatCriterionMarks } from '@/routes/assessment/evaluation-ai/$attemptId/$processId/-utils/criteria-marks';
import { RubricChangedBadge } from '@/routes/assessment/evaluation-ai/$attemptId/$processId/-components/RubricChangedBadge';
import { formatMark } from '@/services/submission-review/marks';
import type { QuestionDetail, QuestionRow, SubmissionOutline } from '@/services/submission-review/types';
import type { PaperQuestion } from '../../-utils/paper';

/** Everything a W3 card renders from. */
export interface CardProps {
    row: QuestionRow;
    detail: QuestionDetail;
    paper: PaperQuestion | null;
    outline: SubmissionOutline;
    /** The rubric version the AI run is on now (for the "scheme changed" badge). */
    currentRubricVersion?: number | null;
    /** A4 for this one question (shown on AI drafts). */
    onAcceptAi?: () => void;
    acceptingAi?: boolean;
    /** Opens the answer sheet beside the marks, at a page when known (1-based). */
    onShowSheet?: (page: number | null) => void;
    /** First page this answer is on (AI reading or the teacher's tag). */
    answerPage?: number | null;
}

export const Heading = ({ children }: { children: ReactNode }) => (
    <h4 className="mb-2 text-caption font-semibold uppercase tracking-wide text-neutral-500">{children}</h4>
);

/** Rich text from the paper (HTML) read-only; plain/LaTeX text through the LaTeX renderer. */
export const RichText = ({ content, className }: { content: string | null | undefined; className?: string }) => {
    if (!content) return null;
    if (/<[a-z][\s\S]*>/i.test(content)) {
        return <TipTapEditor value={content} onChange={() => {}} editable={false} />;
    }
    return <LatexRenderer content={content} className={className ?? 'text-body'} />;
};

export const QuestionText = ({ paper }: { paper: PaperQuestion | null }) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    if (!paper?.question?.content && !paper?.parent_rich_text?.content) return null;
    return (
        <div className="flex flex-col gap-3">
            {paper?.parent_rich_text?.content && (
                <div>
                    <Heading>{t('card.scenario')}</Heading>
                    <RichText content={paper.parent_rich_text.content} />
                </div>
            )}
            {paper?.question?.content && (
                <div>
                    <Heading>{t('card.question')}</Heading>
                    <RichText content={paper.question.content} />
                </div>
            )}
        </div>
    );
};

/** A section that starts folded ("Model answer ▸"). */
export const Foldable = ({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="rounded-md border border-neutral-200">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-start text-body font-medium text-neutral-700 hover:bg-neutral-50"
            >
                {open ? <CaretDown size={14} /> : <CaretRight size={14} className="rtl:rotate-180" />}
                {title}
            </button>
            {open && <div className="border-t border-neutral-200 p-3">{children}</div>}
        </div>
    );
};

export const FeedbackBlock = ({ feedback }: { feedback: string | null | undefined }) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    if (!feedback?.trim()) return null;
    return (
        <div>
            <Heading>{t('card.feedback')}</Heading>
            <p className="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-body text-neutral-700">{feedback}</p>
        </div>
    );
};

/**
 * The AI's marking-scheme breakdown with its reasons (W3b/W3e), and the note when a
 * teacher changed the total after the AI marked it.
 */
export const CriteriaTable = ({
    detail,
    row,
    learnerName,
    currentRubricVersion,
}: {
    detail: QuestionDetail;
    row: QuestionRow;
    learnerName: string;
    currentRubricVersion?: number | null;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const ai = detail.ai;
    if (!ai || ai.criteria_breakdown.length === 0) return null;
    const editor = row.marked_by?.name || t('common.aTeacher');
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <Heading>
                    {ai.rubric_version != null
                        ? t('card.schemeVersion', { version: ai.rubric_version })
                        : t('card.scheme')}
                </Heading>
                <RubricChangedBadge evaluationVersion={ai.rubric_version} currentVersion={currentRubricVersion} />
            </div>
            <div className="overflow-x-auto rounded-md border border-neutral-200">
                <table className="w-full min-w-96">
                    <thead className="bg-neutral-100">
                        <tr>
                            <th className="p-2.5 text-start text-caption font-semibold text-neutral-600">{t('card.point')}</th>
                            <th className="w-24 p-2.5 text-end text-caption font-semibold text-neutral-600">{t('card.marks')}</th>
                            <th className="p-2.5 text-start text-caption font-semibold text-neutral-600">{t('card.aiReason')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                        {ai.criteria_breakdown.map((c, i) => (
                            <tr key={`${c.criteria_name}-${i}`}>
                                <td className="p-2.5 text-body font-medium text-neutral-800">{c.criteria_name}</td>
                                <td className="whitespace-nowrap p-2.5 text-end text-body font-semibold tabular-nums text-neutral-900">
                                    {formatCriterionMarks(c)}
                                </td>
                                <td className="p-2.5 text-body text-neutral-600">{c.reason}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {ai.teacher_changed_total && (
                <p className="text-caption text-neutral-600">
                    {t('card.teacherChangedTotal', {
                        ai: formatMark(ai.marks_awarded),
                        max: formatMark(ai.max_marks ?? row.max_marks),
                        name: editor,
                        marks: formatMark(row.marks),
                        learner: learnerName,
                    })}
                </p>
            )}
        </div>
    );
};

/** The answer the AI read / the learner typed, when the card has nothing richer. */
export const AnswerText = ({ title, text }: { title: string; text: string | null | undefined }) => {
    if (!text?.trim()) return null;
    return (
        <div>
            <Heading>{title}</Heading>
            <div className="rounded-md border border-neutral-200 bg-white p-3">
                <LatexRenderer content={text} className="text-body" />
            </div>
        </div>
    );
};
