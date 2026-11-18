import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import type { ScanSession } from '../-services/scan-station-services';
import { collectIssues, type ScanIssue } from '../-lib/review-model';
import type { DecideFn } from '../-hooks/useScanActions';
import { CopyReviewCard } from './CopyReviewCard';

/** Every copy of the session in physical order, optionally only those that need a look. */
export const CopyReviewList = ({
    session,
    decide,
    readOnly,
    onPairCheck,
}: {
    session: ScanSession;
    decide: DecideFn;
    readOnly: boolean;
    onPairCheck: (issue: ScanIssue) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const [onlyReview, setOnlyReview] = useState(false);
    // Once per session read, not once per card: a session can hold hundreds of copies.
    const issuesByCopy = useMemo(() => {
        const map = new Map<string, ScanIssue[]>();
        for (const issue of collectIssues(session)) {
            if (issue.scope !== 'COPY' || !issue.copy_key) continue;
            map.set(issue.copy_key, [...(map.get(issue.copy_key) ?? []), issue]);
        }
        return map;
    }, [session]);
    const copies = session.copies.map((copy, i) => ({ copy, number: i + 1 }));
    const shown = onlyReview
        ? copies.filter(({ copy }) => copy.needs_review && copy.decision === 'NONE')
        : copies;

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-subtitle font-semibold text-neutral-800">
                    {t('copies.title', { count: session.copies.length })}
                </h2>
                <label className="ms-auto flex items-center gap-2 text-caption text-neutral-700">
                    <Switch checked={onlyReview} onCheckedChange={setOnlyReview} />
                    {t('copies.onlyReview')}
                </label>
            </div>
            {session.copies.length === 0 ? (
                <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-body text-neutral-500">
                    {t('copies.empty')}
                </p>
            ) : shown.length === 0 ? (
                <p className="text-caption text-neutral-500">{t('copies.noneToReview')}</p>
            ) : (
                shown.map(({ copy, number }) => (
                    <CopyReviewCard
                        key={copy.copy_key}
                        session={session}
                        copy={copy}
                        number={number}
                        isFirst={number === 1}
                        issues={issuesByCopy.get(copy.copy_key) ?? []}
                        decide={decide}
                        readOnly={readOnly}
                        onPairCheck={onPairCheck}
                    />
                ))
            )}
        </section>
    );
};

export default CopyReviewList;
