import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import type { CbeConfig } from '@/components/cbe/types';
import type { parseCbeSlideResponse } from '@/routes/assessment/question-papers/-utils/cbe-question';
import { CbeAnswerView } from './cbe-answer-view';
import { CbeEvaluationView } from './cbe-evaluation-view';

export type CbeSlideAttemptRow = {
    key: string;
    attemptNumber?: number | string | null;
    activityDate?: string;
    responseStatus?: string | null;
    attempt: NonNullable<ReturnType<typeof parseCbeSlideResponse>>;
};

/** Spreadsheet & Written Response question-slide attempts: the answer read-only + its AI check. */
export function CbeSlideAttempts({
    rows,
    config,
}: {
    rows: CbeSlideAttemptRow[];
    /** The slide's (learner-safe) config, for part labels. */
    config?: CbeConfig | null;
}) {
    const { t } = useTranslation('cbeReview');
    if (rows.length === 0) return null;
    return (
        <div className="mt-6 flex flex-col gap-4">
            <h4 className="text-subtitle font-semibold text-neutral-700">{t('slide.heading')}</h4>
            {rows.map((row) => (
                <Card key={row.key} className="flex flex-col gap-4 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-body text-neutral-600">
                        <span className="font-semibold text-neutral-700">
                            {t('slide.attempt', { number: row.attemptNumber ?? '—' })}
                        </span>
                        {row.activityDate && <span>· {row.activityDate}</span>}
                        {row.responseStatus && <span>· {row.responseStatus}</span>}
                    </div>
                    <CbeAnswerView answer={row.attempt.answer} config={config} />
                    <div className="flex flex-col gap-2">
                        <h5 className="text-body font-semibold text-neutral-700">
                            {t('slide.evaluation')}
                        </h5>
                        <CbeEvaluationView
                            evaluation={row.attempt.evaluation}
                            error={row.attempt.error}
                        />
                    </div>
                </Card>
            ))}
        </div>
    );
}
