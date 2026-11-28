import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { formatDateTime } from '@/lib/formatters';
import { getHistory } from '@/services/submission-review/api';
import { submissionKeys } from '@/services/submission-review/query-keys';
import type { QuestionRow } from '@/services/submission-review/types';
import { historyLine } from '../-utils/history';

const HISTORY_PAGE = 100;
const HISTORY_MAX = 500;

/**
 * W10: everything that happened to one question (plus submission-level events), or to the
 * whole submission. Append-only; an undo is a new edit back to the old value.
 */
export const HistoryDrawer = ({
    attemptId,
    learnerName,
    row,
    open,
    onOpenChange,
    questionNumbers,
}: {
    attemptId: string;
    learnerName: string;
    /** "sid:qid" → question number, to label events on the whole-submission view. */
    questionNumbers?: Record<string, number>;
    /** null = the whole submission. */
    row: QuestionRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    // Newest HISTORY_PAGE first; "Show older" asks for up to HISTORY_MAX (the server's cap),
    // so a long trail is never cut off without saying so.
    const [limit, setLimit] = useState(HISTORY_PAGE);
    useEffect(() => setLimit(HISTORY_PAGE), [attemptId, row?.key, open]);
    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: [...submissionKeys.history(attemptId, row?.section_id, row?.question_id), limit],
        queryFn: () => getHistory(attemptId, row?.section_id, row?.question_id, limit),
        enabled: open,
        staleTime: 0,
        placeholderData: (previous) => previous,
    });
    const capped = !!data && data.events.length >= limit;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>
                        {row
                            ? t('history.titleQuestion', { number: row.question_number, name: learnerName })
                            : t('history.titleAll', { name: learnerName })}
                    </SheetTitle>
                </SheetHeader>
                {isLoading ? (
                    <DashboardLoader />
                ) : isError || !data ? (
                    <p className="text-body text-danger-600">{t('history.loadFailed')}</p>
                ) : data.events.length === 0 && data.legacy_logs.length === 0 ? (
                    <p className="text-body text-neutral-500">{t('history.empty')}</p>
                ) : (
                    <ol className="flex flex-col divide-y divide-neutral-100" data-testid="history-list">
                        {data.events.map((e) => {
                            const line = historyLine(e);
                            const who = line.who ?? (line.whoKey ? t(line.whoKey) : '');
                            return (
                                <li key={e.id} className="flex flex-col gap-0.5 py-2.5">
                                    <span className="text-caption text-neutral-500">
                                        {formatDateTime(e.created_at)}
                                        {!row && e.question_id
                                            ? ` · ${t('history.questionNumber', {
                                                  number: questionNumbers?.[`${e.section_id}:${e.question_id}`] ?? '?',
                                              })}`
                                            : ''}
                                    </span>
                                    <span className="text-body text-neutral-800">
                                        <span className="font-semibold">{who}</span> {t(line.key, line.params)}
                                        {line.reason ? ` · “${line.reason}”` : ''}
                                    </span>
                                    {line.afterRelease && (
                                        <span className="w-fit rounded-full bg-warning-50 px-2 py-0.5 text-caption font-medium text-warning-700">
                                            {t('history.afterRelease')}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                        {data.legacy_logs.map((log, i) => (
                            <li key={`legacy-${i}`} className="flex flex-col gap-0.5 py-2.5">
                                <span className="text-caption text-neutral-500">{formatDateTime(log.created_at)}</span>
                                <span className="text-body text-neutral-600">
                                    {t(
                                        log.type === 'MARKS_OVERRIDE'
                                            ? 'history.legacyMarksOverride'
                                            : 'history.legacy',
                                        { who: log.author?.name || t('common.aTeacher') }
                                    )}
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
                {capped && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3 text-caption text-neutral-500">
                        <span>{t('history.showingLatest', { count: data?.events.length ?? 0 })}</span>
                        {limit < HISTORY_MAX && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disabled={isFetching}
                                onClick={() => setLimit(HISTORY_MAX)}
                            >
                                {t('history.showOlder')}
                            </MyButton>
                        )}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
};
