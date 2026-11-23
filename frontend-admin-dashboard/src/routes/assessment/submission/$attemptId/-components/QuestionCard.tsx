import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getQuestionDetail } from '@/services/submission-review/api';
import { submissionKeys } from '@/services/submission-review/query-keys';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';
import { cardKindFor, firstAnswerPage } from '../-utils/filters';
import type { PaperQuestion } from '../-utils/paper';
import type { RowActions } from './actions';
import { ObjectiveCard } from './cards/ObjectiveCard';
import { LongAnswerCard } from './cards/LongAnswerCard';
import { CbeCard } from './cards/CbeCard';
import { CodingCard } from './cards/CodingCard';
import { HandwrittenCard } from './cards/HandwrittenCard';
import { OmrCard } from './cards/OmrCard';

/** One opened question: loads A1d on open and picks the W3 card for its type. */
export const QuestionCard = ({
    row,
    outline,
    paper,
    currentRubricVersion,
    pageIndexById,
    actions,
}: {
    row: QuestionRow;
    outline: SubmissionOutline;
    paper: PaperQuestion | null;
    currentRubricVersion?: number | null;
    pageIndexById?: Record<string, number>;
    actions: RowActions;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const { data: detail, isLoading, isError, refetch } = useQuery({
        queryKey: submissionKeys.card(outline.attempt_id, row.section_id, row.question_id),
        queryFn: () => getQuestionDetail(outline.attempt_id, row.section_id, row.question_id),
        staleTime: 30_000,
    });

    if (isLoading) {
        return (
            <div className="flex flex-col gap-2 p-4" aria-busy>
                <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-100" />
                <div className="h-20 animate-pulse rounded bg-neutral-100" />
            </div>
        );
    }
    if (isError || !detail) {
        return (
            <div className="flex items-center gap-2 p-4 text-body text-danger-600">
                {t('card.loadFailed')}
                <button type="button" className="underline" onClick={() => void refetch()}>
                    {t('common.retry')}
                </button>
            </div>
        );
    }

    const props = {
        row,
        detail,
        paper,
        outline,
        currentRubricVersion,
        onAcceptAi: () => actions.onAcceptAi(row),
        acceptingAi: actions.acceptingKey === row.key,
        onShowSheet: actions.onShowSheet,
        answerPage: firstAnswerPage(detail.ai?.page_ids, row.answer_pages, pageIndexById),
    };
    switch (cardKindFor(row, outline.kind)) {
        case 'objective':
            return <ObjectiveCard {...props} />;
        case 'coding':
            return <CodingCard {...props} />;
        case 'cbe':
            return <CbeCard {...props} />;
        case 'handwritten':
            return <HandwrittenCard {...props} />;
        case 'omr':
            return <OmrCard {...props} />;
        case 'long':
        default:
            return <LongAnswerCard {...props} />;
    }
};
