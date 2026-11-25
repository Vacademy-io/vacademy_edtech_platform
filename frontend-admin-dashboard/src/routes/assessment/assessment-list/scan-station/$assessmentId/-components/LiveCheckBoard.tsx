import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowClockwise,
    CheckCircle,
    CircleNotch,
    Printer,
    Scan,
    UserCircleDashed,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    getCopyIntakeBatch,
    listCheckedCopies,
    type CopyIntakeCheckedCopy,
    type CopyIntakeItem,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';
import { detectHelper } from '../-lib/scan-helper-client';
import { useScanHelperStatus } from '../-hooks/useScanHelperStatus';
import { usePrintChecked, type PrintState } from '../-hooks/usePrintChecked';

const POLL_MS = 3000;

type Stage = 'reading' | 'waiting' | 'checking' | 'checked' | 'needsYou' | 'failed' | 'skipped';

const stageOf = (item: CopyIntakeItem): Stage => {
    switch (item.status) {
        case 'PENDING':
        case 'IDENTIFYING':
            return 'reading';
        case 'MATCHED':
        case 'QUEUED':
            return 'waiting';
        case 'EVALUATING':
            return 'checking';
        case 'COMPLETED':
            return 'checked';
        case 'AMBIGUOUS':
        case 'UNMATCHED':
            return 'needsYou';
        case 'FAILED':
            return 'failed';
        default:
            return 'skipped';
    }
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The hands-free view of a started pile: one card per copy moving from
 * "reading the name" to its marks, and (with a printer) to "printed". Big
 * enough to read from a few steps away; the copies print as they become ready.
 */
export const LiveCheckBoard = ({
    batchId,
    instituteId,
    print,
    onNextPile,
    nextPilePending = false,
}: {
    batchId: string;
    instituteId: string;
    /** Print each checked copy through the scan helper. */
    print: boolean;
    onNextPile: () => void;
    nextPilePending?: boolean;
}) => {
    const { t } = useTranslation('scanStation');
    const batch = useQuery({
        queryKey: ['SCAN_STATION_LIVE_BATCH', batchId, instituteId],
        queryFn: () => getCopyIntakeBatch(batchId, instituteId),
        refetchInterval: (q) =>
            q.state.data &&
            (q.state.data.status === 'COMPLETED' || q.state.data.status === 'FAILED')
                ? false
                : POLL_MS,
    });
    const evaluated = batch.data?.evaluated ?? 0;
    const checked = useQuery({
        queryKey: ['SCAN_STATION_LIVE_CHECKED', batchId, instituteId, evaluated],
        queryFn: () => listCheckedCopies(batchId, instituteId),
        enabled: evaluated > 0,
        placeholderData: (prev) => prev,
    });
    const copies = useMemo<CopyIntakeCheckedCopy[]>(() => checked.data ?? [], [checked.data]);
    const byItem = useMemo(() => new Map(copies.map((c) => [c.item_id, c])), [copies]);

    const status = useScanHelperStatus(print);
    const detection = detectHelper(status, false);
    const printer = detection.kind === 'ready' ? detection.printer : null;
    const { stateOf, reprint } = usePrintChecked({
        batchId,
        copies,
        printer,
        enabled: print && !!printer,
    });

    const items = batch.data?.items ?? [];
    const total = batch.data?.total_items ?? items.length;
    const printedCount = items.filter((i) => stateOf(i.id) === 'done').length;
    const needsYou = items.filter((i) => stageOf(i) === 'needsYou').length;
    const allDone =
        !!batch.data && (batch.data.status === 'COMPLETED' || batch.data.in_progress === 0);

    return (
        <section
            className="flex flex-col gap-4 rounded-lg border border-primary-200 bg-white p-4"
            aria-live="polite"
        >
            <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                    {allDone ? (
                        <CheckCircle size={22} />
                    ) : (
                        <CircleNotch size={22} className="animate-spin" />
                    )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                    <h2 className="text-h3 font-semibold text-neutral-800">
                        {allDone ? t('board.doneTitle') : t('board.title')}
                    </h2>
                    <p className="text-body text-neutral-600">
                        {t('board.counts', { total, checked: evaluated })}
                        {print && printer
                            ? ` · ${t('board.printedCount', { count: printedCount })}`
                            : ''}
                    </p>
                </div>
                <MyButton
                    type="button"
                    buttonType={allDone ? 'primary' : 'secondary'}
                    scale="medium"
                    className="gap-1"
                    disabled={nextPilePending}
                    onClick={onNextPile}
                >
                    <Scan size={16} />
                    {t('board.nextPile')}
                </MyButton>
            </div>

            {print && !printer && (
                <p className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700">
                    <WarningCircle size={18} className="mt-px shrink-0" />
                    {t('board.noPrinter')}
                </p>
            )}
            {needsYou > 0 && (
                <p className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-body text-warning-700">
                    <UserCircleDashed size={18} className="mt-px shrink-0" />
                    {t('board.needsYou', { count: needsYou })}
                </p>
            )}

            {batch.isLoading ? (
                <p className="flex items-center gap-2 text-body text-neutral-600">
                    <CircleNotch size={16} className="animate-spin" />
                    {t('board.loading')}
                </p>
            ) : (
                <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((item, i) => {
                        const copy = byItem.get(item.id);
                        return (
                            <CopyCard
                                key={item.id}
                                position={i + 1}
                                item={item}
                                copy={copy}
                                print={print && !!printer}
                                printState={stateOf(item.id)}
                                onReprint={copy ? () => reprint(copy) : undefined}
                            />
                        );
                    })}
                </ol>
            )}
        </section>
    );
};

const CopyCard = ({
    position,
    item,
    copy,
    print,
    printState,
    onReprint,
}: {
    position: number;
    item: CopyIntakeItem;
    copy: CopyIntakeCheckedCopy | undefined;
    print: boolean;
    printState: PrintState | null;
    onReprint?: () => void;
}) => {
    const { t } = useTranslation('scanStation');
    const stage = stageOf(item);
    const name = item.matched_name || item.extracted_name || t('board.copyN', { n: position });
    const marks = copy?.marks;
    const max = copy?.max_marks;

    return (
        <li
            className={cn(
                'flex flex-col gap-2 rounded-md border p-3',
                stage === 'checked'
                    ? 'border-success-200 bg-success-50'
                    : stage === 'needsYou' || stage === 'failed'
                      ? 'border-warning-200 bg-warning-50'
                      : 'border-neutral-200 bg-neutral-50'
            )}
        >
            <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-subtitle font-semibold text-neutral-800">
                    {name}
                </span>
                {stage === 'checked' && typeof marks === 'number' && (
                    <span className="shrink-0 text-h3 font-semibold text-success-700">
                        {fmt(marks)}
                        {typeof max === 'number' && (
                            <span className="text-body font-normal text-neutral-600">
                                {' '}
                                / {fmt(max)}
                            </span>
                        )}
                    </span>
                )}
            </div>
            <p className="flex items-center gap-2 text-body text-neutral-700">
                {stage === 'checked' ? (
                    <CheckCircle size={16} className="shrink-0 text-success-600" />
                ) : stage === 'needsYou' || stage === 'failed' ? (
                    <WarningCircle size={16} className="shrink-0 text-warning-600" />
                ) : stage === 'skipped' ? null : (
                    <CircleNotch size={16} className="shrink-0 animate-spin text-primary-500" />
                )}
                {stage === 'checking' && item.questions_total
                    ? t('board.stage.checkingQ', {
                          done: item.questions_completed ?? 0,
                          total: item.questions_total,
                      })
                    : t(`board.stage.${stage}`)}
            </p>
            {print && stage === 'checked' && (
                <p className="flex items-center gap-2 text-caption text-neutral-600">
                    <Printer size={14} className="shrink-0" />
                    {t(`board.print.${printState ?? 'waiting'}`)}
                    {printState === 'failed' && onReprint && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="gap-1"
                            onClick={onReprint}
                        >
                            <ArrowClockwise size={12} />
                            {t('board.print.retry')}
                        </MyButton>
                    )}
                </p>
            )}
        </li>
    );
};

export default LiveCheckBoard;
