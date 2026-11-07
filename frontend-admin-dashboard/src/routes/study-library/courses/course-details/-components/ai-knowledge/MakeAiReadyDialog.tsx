import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
    CheckCircle,
    CircleNotch,
    Coins,
    FilePdf,
    Info,
    Presentation,
    Sparkle,
    VideoCamera,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import {
    SeePlansButton,
    plansToastAction,
    useStorefrontVisible,
} from '@/components/common/ai-credits/PlanEntryPoints';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useAiCreditsQuery } from '@/services/ai-credits/get-ai-credits';
import {
    courseKnowledgeErrorDetail,
    type CourseKnowledgeStatus,
} from '@/services/course-knowledge-settings';
import {
    courseKnowledgeErrorMessage,
    courseKnowledgeErrorStatus,
    formatCredits,
    useStartCourseProcess,
    useStartCourseScan,
    type CourseActiveRun,
    type CourseCoverage,
    type CourseQuote,
    type CourseQuoteItem,
    type CourseQuoteKind,
    type CourseRun,
} from '@/services/course-knowledge';

const NAMESPACE = 'courseAiKnowledge';

const ITEM_ICON: Record<CourseQuoteKind, typeof FilePdf> = {
    ocr_pages: FilePdf,
    transcribe_minutes: VideoCamera,
    deck_images: Presentation,
};

/** 250 → "4 h 10 min"; 34 → "34 min"; 120 → "2 h". */
const formatMinutes = (t: TFunction, minutes: number) => {
    const whole = Math.max(0, Math.round(minutes));
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    if (hours === 0) return t('dialog.duration.minutes', { minutes: formatNumber(rest) });
    if (rest === 0) return t('dialog.duration.hours', { hours: formatNumber(hours) });
    return t('dialog.duration.hoursMinutes', {
        hours: formatNumber(hours),
        minutes: formatNumber(rest),
    });
};

const itemLine = (t: TFunction, item: CourseQuoteItem) => {
    const credits = formatCredits(item.credits);
    if (item.kind === 'transcribe_minutes') {
        return t('dialog.step2.items.transcribe_minutes', {
            duration: formatMinutes(t, item.units),
            credits,
        });
    }
    return t(`dialog.step2.items.${item.kind}`, { units: formatNumber(item.units), credits });
};

type ProcessError =
    | { kind: 'quoteChanged' | 'limit' | 'paidOff' | 'generic'; message: string }
    | { kind: 'insufficient'; message: string };

interface MakeAiReadyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    packageId: string;
    status: CourseKnowledgeStatus;
    coverage: CourseCoverage;
    /** The course's running (or just started) run, if any. */
    run: CourseRun | CourseActiveRun | null;
    onRunStarted: (runId: string) => void;
    onRefreshCoverage: () => Promise<unknown>;
}

/**
 * Make course AI-ready. Step 1 reads the free text of every lesson (a SCAN
 * run, free); step 2 shows the exact quote for scanned pages, media and slide
 * images, and an admin can accept it (a PROCESS run capped at that amount).
 * The quote is the one GET coverage returns; the server re-checks it.
 */
export const MakeAiReadyDialog = ({
    open,
    onOpenChange,
    packageId,
    status,
    coverage,
    run,
    onRunStarted,
    onRefreshCoverage,
}: MakeAiReadyDialogProps) => {
    const { t } = useTranslation(NAMESPACE);
    const { t: tPlans } = useTranslation('aiPlans');
    const scan = useStartCourseScan(packageId);
    const process = useStartCourseProcess(packageId);
    const creditsQuery = useAiCreditsQuery(open);

    const [scanRequested, setScanRequested] = useState(false);
    const [scanNote, setScanNote] = useState<string | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [processError, setProcessError] = useState<ProcessError | null>(null);
    const autoScanTried = useRef(false);

    const { totals, quote } = coverage;
    const quoteCredits = Number(quote.credits) || 0;
    const running = run?.status === 'RUNNING';
    const scanRunning = running && run?.kind === 'SCAN';
    const processRunning = running && run?.kind === 'PROCESS';
    const needsScan = totals.not_scanned > 0;
    const showStep1 = needsScan || scanRunning || scanRequested;

    const storefront = useStorefrontVisible(
        getCurrentInstituteId(),
        open && processError?.kind === 'insufficient'
    );

    // Every opening starts clean.
    useEffect(() => {
        if (!open) return;
        setScanRequested(false);
        setScanNote(null);
        setScanError(null);
        setProcessError(null);
        autoScanTried.current = false;
    }, [open]);

    const startScan = async () => {
        setScanError(null);
        setScanNote(null);
        try {
            const result = await scan.mutateAsync();
            setScanRequested(true);
            if (result.run_id) onRunStarted(result.run_id);
            else setScanNote(t('dialog.step1.nothing'));
        } catch (error) {
            const code = courseKnowledgeErrorStatus(error);
            const detail = courseKnowledgeErrorDetail(error);
            if (
                code === 409 &&
                detail?.code === 'scan_running' &&
                typeof detail.run_id === 'string'
            ) {
                setScanRequested(true);
                onRunStarted(detail.run_id);
                return;
            }
            if (code === 429) {
                setScanError(detail?.message ?? t('dialog.step1.rateLimited'));
                return;
            }
            if (code === 409 && detail?.code === 'not_enabled') {
                setScanError(t('errors.notEnabled'));
                return;
            }
            setScanError(courseKnowledgeErrorMessage(error) ?? t('errors.generic'));
        }
    };

    // Step 1 starts by itself: reading lessons is free and nothing else can
    // happen until it is done.
    useEffect(() => {
        if (!open || autoScanTried.current || !needsScan || running) return;
        autoScanTried.current = true;
        void startScan();
        // startScan is recreated every render; the guard ref makes this run once per opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, needsScan, running]);

    const startProcess = async () => {
        setProcessError(null);
        try {
            const result = await process.mutateAsync(quoteCredits);
            if (result.run_id) {
                onRunStarted(result.run_id);
                toast.success(t('dialog.step2.started'));
            } else {
                toast.success(result.message ?? t('dialog.step2.nothing'));
                onOpenChange(false);
            }
        } catch (error) {
            const code = courseKnowledgeErrorStatus(error);
            const detail = courseKnowledgeErrorDetail(error);
            if (code === 409 && detail?.code === 'QUOTE_CHANGED') {
                const changed = (detail.quote as CourseQuote | undefined)?.credits;
                await onRefreshCoverage();
                setProcessError({
                    kind: 'quoteChanged',
                    message: t('dialog.step2.quoteChanged', {
                        credits: formatCredits(changed ?? quoteCredits),
                    }),
                });
                return;
            }
            if (code === 409 && detail?.code === 'process_running') {
                if (typeof detail.run_id === 'string') onRunStarted(detail.run_id);
                return;
            }
            if (code === 402) {
                const message =
                    detail?.message ??
                    t('dialog.step2.insufficient', { credits: formatCredits(quoteCredits) });
                setProcessError({ kind: 'insufficient', message });
                toast.error(t('dialog.step2.insufficientTitle'), {
                    description: message,
                    // Admins with the AI plan storefront on also get "See AI plans".
                    action: plansToastAction(tPlans('entry.seePlans')),
                });
                return;
            }
            if (code === 429) {
                // The AI usage-limit modal also opens from the axios interceptor.
                setProcessError({
                    kind: 'limit',
                    message: courseKnowledgeErrorMessage(error) ?? t('errors.limit'),
                });
                return;
            }
            if (code === 403 && detail?.code === 'paid_not_available') {
                setProcessError({ kind: 'paidOff', message: t('dialog.step2.paidUnavailable') });
                return;
            }
            if (code === 409 && detail?.code === 'not_enabled') {
                setProcessError({ kind: 'generic', message: t('errors.notEnabled') });
                return;
            }
            setProcessError({
                kind: 'generic',
                message: courseKnowledgeErrorMessage(error) ?? t('errors.generic'),
            });
        }
    };

    // Balance before and after: the wallet the credits popover shows, else
    // the balance coverage computed with the quote. Unknown → no line.
    const walletBalance = Number(creditsQuery.data?.current_balance);
    const before = Number.isFinite(walletBalance)
        ? walletBalance
        : coverage.balance.current_balance;
    const after = before === null || before === undefined ? null : before - quoteCredits;

    const canProcess = status.can_manage && status.paid_available;
    const showQuote = !scanRunning && quoteCredits > 0;
    const showProcessButton = canProcess && showQuote && !processRunning;

    const footer = (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                {showQuote && !processRunning ? t('dialog.step2.keepFree') : t('dialog.close')}
            </MyButton>
            {showProcessButton && (
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onAsyncClick={startProcess}
                    loadingText={t('dialog.step2.starting')}
                >
                    <Sparkle className="size-4" />
                    {t('dialog.step2.process', { credits: formatCredits(quoteCredits) })}
                </MyButton>
            )}
        </div>
    );

    const runProgress = run && run.total > 0 ? Math.round((run.done * 100) / run.total) : 0;

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('dialog.title')}
            footer={footer}
            dialogWidth="max-w-xl"
        >
            <div className="flex flex-col gap-5 p-4">
                {showStep1 && (
                    <section className="flex flex-col gap-2">
                        <h4 className="text-subtitle font-semibold text-neutral-800">
                            {t('dialog.step1.title')}
                        </h4>
                        <p className="text-body text-neutral-600">{t('dialog.step1.body')}</p>
                        {scanRunning && run ? (
                            <div className="flex flex-col gap-1.5">
                                <Progress
                                    value={runProgress}
                                    aria-label={t('run.progressAria')}
                                    className="h-2 border border-neutral-200"
                                />
                                <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                    <CircleNotch className="size-3.5 animate-spin" />
                                    {t('dialog.step1.progress', {
                                        done: formatNumber(run.done),
                                        total: formatNumber(run.total),
                                    })}
                                </p>
                            </div>
                        ) : scan.isPending ? (
                            <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                <CircleNotch className="size-3.5 animate-spin" />
                                {t('dialog.step1.starting')}
                            </p>
                        ) : scanError ? (
                            <div className="flex flex-col items-start gap-2">
                                <p className="flex items-center gap-1.5 text-body text-warning-700">
                                    <WarningCircle className="size-4 shrink-0" />
                                    {scanError}
                                </p>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onAsyncClick={startScan}
                                >
                                    {t('dialog.step1.start')}
                                </MyButton>
                            </div>
                        ) : scanNote ? (
                            <p className="text-body text-neutral-500">{scanNote}</p>
                        ) : needsScan ? (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                className="self-start"
                                onAsyncClick={startScan}
                            >
                                {t('dialog.step1.start')}
                            </MyButton>
                        ) : (
                            <p className="flex items-center gap-1.5 text-body text-success-700">
                                <CheckCircle className="size-4 shrink-0" weight="fill" />
                                {t('dialog.step1.done')}
                            </p>
                        )}
                    </section>
                )}

                <section className="flex flex-col gap-3">
                    <h4 className="text-subtitle font-semibold text-neutral-800">
                        {t('dialog.step2.title')}
                    </h4>

                    {scanRunning ? (
                        <p className="text-body text-neutral-500">{t('dialog.step2.waiting')}</p>
                    ) : processRunning && run ? (
                        <div className="flex flex-col gap-1.5">
                            <Progress
                                value={runProgress}
                                aria-label={t('run.progressAria')}
                                className="h-2 border border-neutral-200"
                            />
                            <p className="flex flex-wrap items-center gap-1.5 text-caption text-neutral-500">
                                <CircleNotch className="size-3.5 animate-spin" />
                                {t('dialog.step2.running', {
                                    done: formatNumber(run.done),
                                    total: formatNumber(run.total),
                                })}
                                {'charged_credits' in run && (
                                    <span>
                                        ·{' '}
                                        {t('run.credits', {
                                            charged: formatCredits(run.charged_credits),
                                            quoted: formatCredits(run.quoted_credits),
                                        })}
                                    </span>
                                )}
                            </p>
                        </div>
                    ) : quoteCredits <= 0 ? (
                        <p className="flex items-center gap-1.5 text-body text-success-700">
                            <CheckCircle className="size-4 shrink-0" weight="fill" />
                            {t('dialog.step2.nothing')}
                        </p>
                    ) : null}

                    {showQuote && !processRunning && (
                        <QuoteDetails quote={quote} before={before} after={after} t={t} />
                    )}

                    {showQuote && !processRunning && !status.paid_available && (
                        <Notice tone="info">{t('dialog.step2.paidUnavailable')}</Notice>
                    )}
                    {showQuote &&
                        !processRunning &&
                        status.paid_available &&
                        !status.can_manage && (
                            <Notice tone="info">{t('dialog.step2.askAdmin')}</Notice>
                        )}

                    {processError?.kind === 'insufficient' ? (
                        <Notice tone="danger" title={t('dialog.step2.insufficientTitle')}>
                            {processError.message}
                            {storefront && <SeePlansButton className="mt-1" />}
                        </Notice>
                    ) : processError ? (
                        <Notice tone={processError.kind === 'quoteChanged' ? 'warning' : 'danger'}>
                            {processError.message}
                        </Notice>
                    ) : null}
                </section>
            </div>
        </MyDialog>
    );
};

const QuoteDetails = ({
    quote,
    before,
    after,
    t,
}: {
    quote: CourseQuote;
    before: number | null;
    after: number | null;
    t: TFunction;
}) => (
    <div className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {quote.items.map((item) => {
                const Icon = ITEM_ICON[item.kind] ?? Coins;
                return (
                    <li key={item.kind} className="flex items-start gap-3 px-3 py-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-primary-500" />
                        <div className="flex flex-1 flex-col">
                            <span className="text-body text-neutral-800">{itemLine(t, item)}</span>
                            <span className="text-caption text-neutral-500">
                                {t('dialog.step2.lessons', { count: item.lessons })}
                            </span>
                        </div>
                    </li>
                );
            })}
            <li className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-body font-semibold text-neutral-800">
                    {t('dialog.step2.total')}
                </span>
                <span className="text-body font-semibold text-neutral-800">
                    {t('dialog.step2.totalCredits', { credits: formatCredits(quote.credits) })}
                </span>
            </li>
        </ul>

        {before !== null && after !== null && (
            <p
                className={cn(
                    'flex items-center gap-1.5 text-body',
                    after < 0 ? 'text-danger-600' : 'text-neutral-600'
                )}
            >
                <Coins className="size-4 shrink-0" />
                {t('dialog.step2.balance', {
                    before: formatCredits(before),
                    after: formatCredits(after),
                })}
            </p>
        )}

        <p className="text-caption text-neutral-500">
            {t('dialog.step2.promise', { credits: formatCredits(quote.credits) })}
        </p>
        {quote.approx && (
            <p className="text-caption text-neutral-500">{t('dialog.step2.approx')}</p>
        )}
    </div>
);

const NOTICE_TONE = {
    info: 'border-neutral-200 bg-neutral-50 text-neutral-600',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
} as const;

const Notice = ({
    tone,
    title,
    children,
}: {
    tone: keyof typeof NOTICE_TONE;
    title?: string;
    children: React.ReactNode;
}) => (
    <div
        role={tone === 'info' ? 'status' : 'alert'}
        className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-body',
            NOTICE_TONE[tone]
        )}
    >
        {tone === 'info' ? (
            <Info className="mt-0.5 size-4 shrink-0" />
        ) : (
            <WarningCircle className="mt-0.5 size-4 shrink-0" />
        )}
        <div className="flex flex-col items-start gap-0.5">
            {title && <span className="font-semibold">{title}</span>}
            <div className="flex flex-col items-start">{children}</div>
        </div>
    </div>
);
