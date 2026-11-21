import { useTranslation } from 'react-i18next';
import {
    ArrowDown,
    CheckCircle,
    CircleNotch,
    Hourglass,
    Info,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { ScanSession, ScanVerdict } from '../-services/scan-station-services';
import {
    buildProgress,
    canBuild,
    canEdit,
    canStart,
    openIssues,
    plannedPages,
    unlistedBlockReasons,
} from '../-lib/review-model';
import { flagCopy } from '../-lib/flag-copy';
import { FlagChip } from './FlagChip';

const TONE: Record<ScanVerdict, string> = {
    EMPTY: 'border-neutral-200 bg-white text-neutral-700',
    ANALYSING: 'border-info-200 bg-info-50 text-info-700',
    BLOCKED: 'border-danger-200 bg-danger-50 text-danger-700',
    NEEDS_REVIEW: 'border-warning-200 bg-warning-50 text-warning-700',
    READY: 'border-success-200 bg-success-50 text-success-700',
};

/**
 * Always in view: where the session stands, the way to the next thing to look
 * at, and the one next step (make copies, start checking, change something).
 */
export const ScanVerdictBar = ({
    session,
    busy,
    onNext,
    onBuild,
    onReopen,
    onStart,
    onOpenChecks,
}: {
    session: ScanSession;
    /** A build / reopen call is on its way. */
    busy: boolean;
    onNext: () => void;
    onBuild: () => void;
    onReopen: () => void;
    onStart: () => void;
    onOpenChecks: () => void;
}) => {
    const { t } = useTranslation('scanStation');
    const open = openIssues(session);
    const blocking = open.filter((i) => i.severity === 'BLOCK').length;
    const reviewing = open.length - blocking;
    const live = session.copies.filter((c) => c.decision !== 'EXCLUDED').length;
    // A block no listed flag explains (e.g. every copy left out): say why here.
    const unlisted = unlistedBlockReasons(session);
    const { verdict, status } = session;
    const progress = buildProgress(session);

    const Icon =
        verdict === 'READY'
            ? CheckCircle
            : verdict === 'BLOCKED'
              ? WarningCircle
              : verdict === 'NEEDS_REVIEW'
                ? Warning
                : verdict === 'ANALYSING'
                  ? CircleNotch
                  : Info;
    const text =
        verdict === 'BLOCKED'
            ? t('verdict.BLOCKED', { count: Math.max(blocking + unlisted.length, 1) })
            : verdict === 'NEEDS_REVIEW'
              ? t('verdict.NEEDS_REVIEW', { count: Math.max(reviewing, 1) })
              : verdict === 'READY'
                ? t('verdict.READY', { copies: live, pages: plannedPages(session) })
                : t(`verdict.${verdict}`);

    return (
        <div
            className={cn(
                'sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border p-3 shadow-sm',
                TONE[verdict]
            )}
        >
            <span className="flex min-w-0 flex-1 items-center gap-2 text-body font-medium">
                <Icon
                    size={18}
                    className={cn('shrink-0', verdict === 'ANALYSING' && 'animate-spin')}
                />
                <span className="min-w-0">{text}</span>
            </span>
            <span className="text-caption opacity-80">
                {t('bar.totals', {
                    loads: session.totals.loads,
                    sheets: session.totals.sheets,
                    copies: session.totals.copies,
                })}
            </span>
            {unlisted.length > 0 && (
                <ul className="flex basis-full flex-col gap-1">
                    {unlisted.map((r) => (
                        <li key={r.code} className="flex flex-wrap items-center gap-2">
                            <FlagChip code={r.code} severity={r.severity} />
                            <span className="text-caption">
                                {t(flagCopy(r.code, r.severity).helpKey)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {open.length > 0 && canEdit(session) && (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="gap-1"
                    onClick={onNext}
                >
                    <ArrowDown size={14} />
                    {t('bar.next')}
                </MyButton>
            )}
            {status === 'OPEN' && (
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disabled={!canBuild(session) || busy}
                    onClick={onBuild}
                >
                    {t('bar.build')}
                </MyButton>
            )}
            {status === 'BUILDING' && (
                <span className="flex items-center gap-2 text-caption" aria-live="polite">
                    <CircleNotch size={14} className="animate-spin" />
                    {progress.done > 0
                        ? t('bar.buildingProgress', {
                              done: progress.done,
                              total: progress.total,
                          })
                        : t('bar.building', { count: live })}
                </span>
            )}
            {status === 'BUILDING' && progress.waiting && (
                // The server's own words are for logs; the clerk gets ours. This
                // is a wait for the AI service, not a failure: nothing to do.
                <span className="flex basis-full items-center gap-2 text-caption text-neutral-700">
                    <Hourglass size={14} className="shrink-0" />
                    {t('bar.aiBusy')}
                </span>
            )}
            {status === 'BUILT' && (
                <>
                    <span className="text-caption">
                        {t('bar.built', { count: session.built?.length ?? 0 })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={busy}
                        onClick={onReopen}
                    >
                        {t('bar.change')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!canStart(session) || busy}
                        onClick={onStart}
                    >
                        {t('bar.start')}
                    </MyButton>
                </>
            )}
            {status === 'FAILED' && (
                <>
                    <span className="basis-full text-caption">
                        {t('bar.failed', { message: session.error_message ?? '' })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={busy}
                        onClick={onReopen}
                    >
                        {t('bar.change')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!canBuild(session) || busy}
                        onClick={onBuild}
                    >
                        {t('bar.retry')}
                    </MyButton>
                </>
            )}
            {status === 'STARTING' && (
                <span className="flex items-center gap-2 text-caption">
                    <CircleNotch size={14} className="animate-spin" />
                    {t('bar.starting')}
                </span>
            )}
            {status === 'STARTED' && (
                <MyButton type="button" buttonType="primary" scale="medium" onClick={onOpenChecks}>
                    {t('bar.openChecks')}
                </MyButton>
            )}
        </div>
    );
};

export default ScanVerdictBar;
