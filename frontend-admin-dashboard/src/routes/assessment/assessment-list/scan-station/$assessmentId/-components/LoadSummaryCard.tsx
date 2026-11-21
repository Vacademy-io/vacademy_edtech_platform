import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowCounterClockwise,
    CaretDown,
    CaretUp,
    CircleNotch,
    Trash,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { ScanLoad, ScanLoadStatus, ScanSession } from '../-services/scan-station-services';
import { actionsFor, collectIssues, leftOutOfLoad, type ScanIssue } from '../-lib/review-model';
import type { DecideFn } from '../-hooks/useScanActions';
import { FlagChip } from './FlagChip';
import { BlankPagesGrid } from './BlankPagesGrid';

const STATUS_CLASS: Record<ScanLoadStatus, string> = {
    PENDING: 'border-neutral-200 bg-neutral-50 text-neutral-600',
    ANALYSING: 'border-info-200 bg-info-50 text-info-700',
    DONE: 'border-success-200 bg-success-50 text-success-700',
    FAILED: 'border-danger-200 bg-danger-50 text-danger-700',
};

/** One load: what was read, the layout in words, its own flags and actions. */
export const LoadSummaryCard = ({
    session,
    load,
    decide,
    readOnly,
    onRescan,
    onRemove,
    onPairCheck,
}: {
    session: ScanSession;
    load: ScanLoad;
    decide: DecideFn;
    readOnly: boolean;
    onRescan: (loadNo: number) => void;
    onRemove: (loadNo: number) => void;
    onPairCheck: (issue: ScanIssue) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const [blanksOpen, setBlanksOpen] = useState(false);
    const leftOut = leftOutOfLoad(session, load.load_no).length;
    const issues = collectIssues(session).filter(
        (i) => i.scope === 'LOAD' && i.load_no === load.load_no
    );
    const layout = load.layout;
    const pages = load.passes.map((p) => p.page_count);
    const reading = load.status === 'PENDING' || load.status === 'ANALYSING';
    const layoutWords = layout
        ? [
              t('load.layout.frontsPass', { pass: layout.fronts_pass }),
              layout.fronts_rotation === 180 ? t('load.layout.frontsTurned') : null,
              layout.backs_order === 'REVERSED' ? t('load.layout.backsReversed') : null,
              layout.backs_rotation === 180 ? t('load.layout.backsTurned') : null,
          ].filter(Boolean)
        : [];

    return (
        <section
            id={`scan-load-${load.load_no}`}
            className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4"
        >
            <header className="flex flex-wrap items-center gap-2">
                <h3 className="text-subtitle font-semibold text-neutral-800">
                    {t('load.title', { load: load.load_no })}
                </h3>
                <span
                    className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-caption',
                        STATUS_CLASS[load.status]
                    )}
                >
                    {reading && <CircleNotch size={12} className="animate-spin" />}
                    {t(`load.status.${load.status}`)}
                </span>
                <span className="text-caption text-neutral-500">
                    {t('load.files', { first: pages[0] ?? 0, second: pages[1] ?? 0 })}
                </span>
                <div className="ms-auto flex flex-wrap gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1"
                        disabled={readOnly}
                        onClick={() => onRescan(load.load_no)}
                    >
                        <ArrowCounterClockwise size={14} />
                        {t('load.rescan')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        className="gap-1"
                        disabled={readOnly}
                        onClick={() => onRemove(load.load_no)}
                    >
                        <Trash size={14} />
                        {t('load.remove')}
                    </MyButton>
                </div>
            </header>

            {reading && <p className="text-caption text-neutral-600">{t('load.reading')}</p>}
            {load.status === 'FAILED' && (
                <p className="text-caption text-danger-700">
                    {t('load.failed', { message: load.error_message ?? '' })}
                </p>
            )}

            {load.status === 'DONE' && (
                <div className="flex flex-col gap-1 text-caption text-neutral-700">
                    <p>
                        {t('load.sheets', { count: load.sheets.length })}
                        {' · '}
                        {t('load.blankLeftOut', { count: leftOut })}
                        {leftOut > 0 && (
                            <>
                                {' '}
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 font-medium text-primary-500 hover:underline"
                                    onClick={() => setBlanksOpen((v) => !v)}
                                >
                                    {t('load.checkThem')}
                                    {blanksOpen ? <CaretUp size={12} /> : <CaretDown size={12} />}
                                </button>
                            </>
                        )}
                    </p>
                    {layoutWords.length > 0 && (
                        <p className="text-neutral-500">{layoutWords.join('; ')}</p>
                    )}
                </div>
            )}

            {issues.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {issues.map((issue) => (
                        <li key={issue.id} className="flex flex-wrap items-center gap-2">
                            <FlagChip
                                code={issue.code}
                                severity={issue.severity}
                                accepted={issue.severity === 'REVIEW' && issue.accepted}
                            />
                            {issue.detail && (
                                <span className="text-caption text-neutral-500">
                                    {issue.detail}
                                </span>
                            )}
                            {!(issue.severity === 'REVIEW' && issue.accepted) &&
                                actionsFor(issue).map((action) => {
                                    if (action === 'ACCEPT_LOAD_FLAG') {
                                        return (
                                            <MyButton
                                                key={action}
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                disabled={readOnly}
                                                onClick={() =>
                                                    decide('ACCEPT_LOAD_FLAG', {
                                                        load_no: load.load_no,
                                                        code: issue.code,
                                                        expected_fingerprint: issue.fingerprint,
                                                    })
                                                }
                                            >
                                                {t('actions.accept')}
                                            </MyButton>
                                        );
                                    }
                                    if (action === 'OPEN_BLANKS') {
                                        return (
                                            <MyButton
                                                key={action}
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => setBlanksOpen(true)}
                                            >
                                                {t('actions.openBlanks')}
                                            </MyButton>
                                        );
                                    }
                                    if (action === 'OPEN_PAIR_CHECK') {
                                        return (
                                            <MyButton
                                                key={action}
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => onPairCheck(issue)}
                                            >
                                                {t('actions.openPair')}
                                            </MyButton>
                                        );
                                    }
                                    return null;
                                })}
                        </li>
                    ))}
                </ul>
            )}

            {blanksOpen && load.status === 'DONE' && (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <p className="mb-2 text-body font-medium text-neutral-800">
                        {t('blanks.title', { load: load.load_no })}
                    </p>
                    <BlankPagesGrid
                        session={session}
                        load={load}
                        decide={decide}
                        readOnly={readOnly}
                    />
                </div>
            )}
        </section>
    );
};

export default LoadSummaryCard;
