import { useTranslation } from 'react-i18next';
import { markedByLabel } from '@/services/submission-review/labels';
import type { QuestionRow } from '@/services/submission-review/types';
import { formatDateTime } from '@/lib/formatters';

/** "Marked by: AI, checked by Riya · 11 Nov, 9:12 am" (nothing for unmarked answers). */
export const MarkedByLabel = ({ row, className }: { row: QuestionRow; className?: string }) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const label = markedByLabel(row.marked_by_kind, row.marked_by?.name, t('common.aTeacher'));
    if (!label) return null;
    const when = row.marked_at ? formatDateTime(row.marked_at) : '';
    return (
        <span className={className ?? 'text-caption text-neutral-500'}>
            {t('markedBy.prefix', { who: t(label.key, label.params) })}
            {when ? ` · ${when}` : ''}
        </span>
    );
};

/** "MCQ (single)", "Long answer", "Spreadsheet & written response"… */
export const useTypeLabel = () => {
    const { t } = useTranslation('assessmentSubmissionReview');
    return (type: string | null | undefined) =>
        t(`type.${(type ?? '').toUpperCase()}`, { defaultValue: type ?? '' });
};
