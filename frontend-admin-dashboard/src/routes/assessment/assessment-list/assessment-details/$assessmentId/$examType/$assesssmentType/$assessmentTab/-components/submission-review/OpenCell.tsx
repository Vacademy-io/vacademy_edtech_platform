import { useTranslation } from 'react-i18next';
import type { Row, Table } from '@tanstack/react-table';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { StudentTable } from '@/types/student-table-types';
import { Route } from '../..';
import { useOpenSubmission } from './use-attempt-marking';

type SubmissionRow = StudentTable & { attempt_id?: string };

/** The page's attempt ids in table order: what Prev / Next walk on the Submission page. */
export const pageAttemptIds = (table: Table<StudentTable>): string[] =>
    table
        .getRowModel()
        .rows.map((r) => (r.original as SubmissionRow).attempt_id)
        .filter((id): id is string => !!id);

/** Opens W2 for a row, with the page's rows as the Prev / Next list. */
export const useOpenRowSubmission = (table: Table<StudentTable>) => {
    const { assessmentId } = Route.useParams();
    const open = useOpenSubmission();
    return (attemptId: string) =>
        open(attemptId, { assessmentId, attemptIds: pageAttemptIds(table), source: 'list' });
};

/** W1 "Open" column. */
export const OpenCell = ({ row, table }: { row: Row<StudentTable>; table: Table<StudentTable> }) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const openRow = useOpenRowSubmission(table);
    const attemptId = (row.original as SubmissionRow).attempt_id;
    if (!attemptId) return null;
    return (
        <MyButton
            type="button"
            buttonType="secondary"
            scale="small"
            className="gap-1 sm:min-w-0"
            onClick={() => openRow(attemptId)}
        >
            <ArrowSquareOut size={14} />
            {t('open')}
        </MyButton>
    );
};

/** The Score cell opens the Submission (not the sidebar). Same "14 / 40" look as before. */
export const OpenScoreCell = ({ row, table }: { row: Row<StudentTable>; table: Table<StudentTable> }) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const openRow = useOpenRowSubmission(table);
    const attemptId = (row.original as SubmissionRow).attempt_id;
    const raw = String(row.getValue('score') ?? '');
    const separator = raw.indexOf(' / ');
    const content =
        separator === -1 ? (
            raw
        ) : (
            <>
                <span className={parseFloat(raw) > 0 ? 'font-semibold text-primary-500' : 'font-semibold text-neutral-700'}>
                    {raw.slice(0, separator)}
                </span>
                <span className="text-neutral-400">{raw.slice(separator)}</span>
            </>
        );
    if (!attemptId) return <span className="whitespace-nowrap">{content}</span>;
    return (
        <button
            type="button"
            title={t('openSubmission')}
            onClick={() => openRow(attemptId)}
            className="cursor-pointer whitespace-nowrap rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
        >
            {content}
        </button>
    );
};
