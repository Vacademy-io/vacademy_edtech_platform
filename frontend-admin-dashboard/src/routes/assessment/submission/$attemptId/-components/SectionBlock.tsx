import { useTranslation } from 'react-i18next';
import { formatMarkOutOf } from '@/services/submission-review/marks';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';
import { paperQuestion, type Paper } from '../-utils/paper';
import type { RowActions } from './actions';
import { QuestionRowLine } from './QuestionRow';

type Section = SubmissionOutline['sections'][number];

/** A section header "Section A · 10 / 16" and its rows. */
export const SectionBlock = ({
    section,
    rows,
    outline,
    paper,
    openKeys,
    onToggle,
    duplicatedQuestionIds,
    currentRubricVersion,
    pageIndexById,
    actions,
}: {
    section: Section;
    rows: QuestionRow[];
    outline: SubmissionOutline;
    paper: Paper | null | undefined;
    openKeys: Set<string>;
    onToggle: (key: string) => void;
    duplicatedQuestionIds: Set<string>;
    currentRubricVersion?: number | null;
    pageIndexById?: Record<string, number>;
    actions: RowActions;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    return (
        <section className="flex flex-col gap-2" aria-label={section.name}>
            <div className="flex items-center justify-between gap-3 px-1">
                <h3 className="text-subtitle font-semibold text-neutral-800">
                    {section.name || t('section.untitled', { number: section.order + 1 })}
                </h3>
                <span className="whitespace-nowrap text-body font-semibold tabular-nums text-neutral-700">
                    {formatMarkOutOf(section.total, section.max)}
                </span>
            </div>
            {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-body text-neutral-500">
                    {t('section.empty')}
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {rows.map((row) => (
                        <QuestionRowLine
                            key={row.key}
                            row={row}
                            outline={outline}
                            paper={paperQuestion(paper, row.section_id, row.question_id)}
                            sectionName={section.name}
                            showSection={duplicatedQuestionIds.has(row.question_id)}
                            open={openKeys.has(row.key)}
                            onToggle={() => onToggle(row.key)}
                            currentRubricVersion={currentRubricVersion}
                            pageIndexById={pageIndexById}
                            actions={actions}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
};
