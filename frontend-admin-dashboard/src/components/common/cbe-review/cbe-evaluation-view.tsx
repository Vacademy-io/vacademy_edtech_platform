import { useTranslation } from 'react-i18next';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { CbeEvaluation } from '@/routes/assessment/question-papers/-utils/cbe-question';
import { cn } from '@/lib/utils';

const fmt = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? String(Number(n.toFixed(2))) : '—';

/** The AI check of a CBE question-slide attempt: marks, line-by-line breakdown, feedback. */
export function CbeEvaluationView({
    evaluation,
    error,
    className,
}: {
    evaluation: CbeEvaluation | null;
    error?: string | null;
    className?: string;
}) {
    const { t } = useTranslation('cbeReview');
    if (!evaluation) {
        return (
            <p className={cn('text-body italic text-neutral-500', className)}>
                {error === 'NO_CREDITS'
                    ? t('evaluation.noCredits')
                    : error
                      ? t('evaluation.failed')
                      : t('evaluation.pending')}
            </p>
        );
    }
    const criteria = evaluation.criteria_breakdown ?? [];
    return (
        <div className={cn('flex w-full flex-col gap-3', className)}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-primary-50 px-2 py-1 text-body font-semibold text-primary-500">
                    {t('evaluation.marks', {
                        marks: fmt(evaluation.marks_awarded),
                        max: fmt(evaluation.max_marks),
                    })}
                </span>
                {evaluation.verdict && (
                    <span className="rounded-md bg-neutral-100 px-2 py-1 text-caption text-neutral-700">
                        {evaluation.verdict}
                    </span>
                )}
            </div>
            {evaluation.feedback && (
                <p className="rounded-md bg-neutral-50 p-3 text-body text-neutral-700">
                    {evaluation.feedback}
                </p>
            )}
            {criteria.length > 0 && (
                <div className="w-full overflow-x-auto rounded-md border border-neutral-200">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('evaluation.criteria')}</TableHead>
                                <TableHead>{t('evaluation.reason')}</TableHead>
                                <TableHead className="text-right">
                                    {t('evaluation.lineMarks')}
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {criteria.map((c, i) => (
                                <TableRow key={`${c.criteria_name ?? ''}-${i}`}>
                                    <TableCell className="font-medium">
                                        {c.criteria_name ?? '—'}
                                    </TableCell>
                                    <TableCell className="text-neutral-600">
                                        {c.reason ?? '—'}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-right">
                                        {fmt(c.marks)}
                                        {typeof c.max_marks === 'number' &&
                                            ` / ${fmt(c.max_marks)}`}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
