import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDateTime, formatNumber } from '@/lib/formatters';
import { SectionCard, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceLoadingRows, CommerceStatusChip } from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { displayQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { cancelCount, deleteCountLine, postCount, saveCountLines } from '../-shared/inventory-api';
import {
    type CountOp,
    lineKey,
    mergeLines,
    opBody,
    pieceKey,
    pieceScan,
    queueOp,
    shownQuantity,
    variantKey,
} from '../-shared/count-sheet';
import { currentUserId, useCount, useInvalidateInventory, useInventoryAccess } from '../-shared/inventory-hooks';
import type { CountLine, CountView } from '../-shared/inventory-types';
import { type StockScan, useStockScan } from '../-shared/use-stock-scan';
import { CountReviewPanel } from './CountReviewPanel';
import { pickName } from './ItemPicker';
import {
    ConfirmDialog,
    InventoryErrorNotice,
    ItemCell,
    parseDisplayQuantity,
    Qty,
    SaveStateMark,
    TOUCH,
    useInventoryErrorText,
} from './inventory-ui';
import { PostCountDialog } from './PostCountDialog';
import { type ScanMessage, StockScanBox } from './StockScanBox';
import { useInventoryWrite } from './use-inventory-write';

/** What the sheet shows for a line before the server has answered for it. */
interface LineMeta {
    key: string;
    package_session_id: string | null;
    name: string | null;
    variant_name: string | null;
    sku: string | null;
    piece_code: string | null;
    unit: string | null;
    qty_scale: number;
}

const metaOf = (line: CountLine): LineMeta => ({
    key: lineKey(line),
    package_session_id: line.package_session_id,
    name: line.item_name ?? line.product_name,
    variant_name: line.variant_name,
    sku: line.sku,
    piece_code: line.piece_code,
    unit: line.unit,
    qty_scale: line.qty_scale,
});

/** What the person may do: the server's `next_actions`, else by status, kind and who started it. */
export function countActions(view: CountView, me: string | null, isManager: boolean): Set<string> {
    if (view.next_actions.length > 0) return new Set(view.next_actions);
    const out = new Set<string>();
    if (view.status !== 'OPEN') return out;
    out.add('COUNT');
    out.add('POST');
    if (view.kind === 'COUNT') out.add('REVIEW');
    if (isManager || view.started_by === me) out.add('CANCEL');
    return out;
}

/** I4 (contract §7.3): the count sheet — count, review, post; or a blind recount. */
export function CountSheetPage() {
    const { t } = useTranslation('commerce');
    const { countId } = useParams({ from: '/commerce/inventory/counts/$countId/' });
    const query = useCount(countId);
    const title = query.data
        ? `${query.data.count_number ?? ''} · ${t(`inventory.counts.kinds.${query.data.kind === 'RECOUNT' ? 'RECOUNT' : 'COUNT'}`)}`
        : t('inventory.counts.title');
    return (
        <CommercePage navId="commerce-inventory" title={title} backTo={{ to: '/commerce/inventory', label: t('inventory.title') }}>
            {query.isLoading && <CommerceLoadingRows rows={4} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.data && <CountSheet key={query.data.id} view={query.data} />}
        </CommercePage>
    );
}

export function CountSheet({ view }: { view: CountView }) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const navigate = useNavigate();
    const access = useInventoryAccess();
    const errorText = useInventoryErrorText();
    const invalidate = useInvalidateInventory();
    const write = useInventoryWrite('cnt');
    const me = currentUserId();
    const actions = countActions(view, me, access.isManager);
    const isRecount = view.kind === 'RECOUNT';
    const open = view.status === 'OPEN';
    const recountOpen = !isRecount && view.recount?.status === 'OPEN';

    const [lines, setLines] = useState<CountLine[]>(view.lines);
    const [order, setOrder] = useState<LineMeta[]>(() => view.lines.map(metaOf).reverse());
    const pending = useRef(new Map<string, CountOp>());
    const inFlight = useRef(new Map<string, CountOp>());
    const failed = useRef(new Map<string, CountOp>());
    const [, bump] = useReducer((n: number) => n + 1, 0);
    const [typed, setTyped] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<ScanMessage | null>(null);
    const [saveError, setSaveError] = useState<unknown>(null);
    const [reviewing, setReviewing] = useState(false);
    const [posting, setPosting] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const saved = useMemo(() => new Map(lines.map((l) => [lineKey(l), l])), [lines]);

    // ─── One save per line at a time; changes made meanwhile wait and go next. ───
    const send = useCallback(
        (key: string, op: CountOp) => {
            inFlight.current.set(key, op);
            bump();
            const body = { lines: [opBody(key, op)] };
            write
                .run({
                    scope: `line:${key}`,
                    body,
                    send: (id) => saveCountLines(view.id, { ...body, client_request_id: id }),
                    onDone: (answer) => {
                        inFlight.current.delete(key);
                        setLines((current) => mergeLines(current, answer.lines));
                        bump();
                        pump(key);
                    },
                })
                .catch((e) => {
                    inFlight.current.delete(key);
                    failed.current.set(key, op);
                    setSaveError(e);
                    bump();
                });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [view.id, write.run]
    );

    const pump = (key: string) => {
        if (inFlight.current.has(key) || failed.current.has(key)) return;
        const op = pending.current.get(key);
        if (!op) return;
        pending.current.delete(key);
        send(key, op);
    };

    const enqueue = (meta: LineMeta, op: CountOp) => {
        setOrder((current) => (current.some((m) => m.key === meta.key) ? current : [meta, ...current]));
        pending.current.set(meta.key, queueOp(pending.current.get(meta.key), op));
        bump();
        pump(meta.key);
    };

    const retry = (key: string) => {
        const op = failed.current.get(key);
        if (!op) return;
        failed.current.delete(key);
        setSaveError(null);
        send(key, op);
    };

    const waitingKeys = new Set([...pending.current.keys(), ...inFlight.current.keys(), ...failed.current.keys()]);
    const unsaved = waitingKeys.size > 0;

    const onScan = (result: StockScan) => {
        if (result.kind === 'PIECE' && result.result.piece) {
            const code = result.result.piece.code;
            const check = pieceScan(new Set(saved.keys()), waitingKeys, code);
            if (check.refusal) {
                scan.refuse();
                return setMessage({ tone: 'danger', text: t(`inventory.countSheet.${check.refusal}`) });
            }
            const v = result.result.variant;
            enqueue(
                { key: pieceKey(code), package_session_id: v.package_session_id, name: v.product_name, variant_name: v.variant_name, sku: v.sku, piece_code: code, unit: v.unit, qty_scale: v.qty_scale },
                { kind: 'PIECE', code }
            );
            setMessage({ tone: 'success', text: t('inventory.countSheet.counted', { item: code }) });
        } else if (result.kind === 'VARIANT') {
            const v = result.result.variant;
            if ((v.stock_mode ?? '').toUpperCase() === 'PIECE') {
                scan.refuse();
                return setMessage({ tone: 'danger', text: t('inventory.countSheet.scanPieceLabels') });
            }
            if ((v.stock_policy ?? '').toUpperCase() === 'UNTRACKED') {
                scan.refuse();
                return setMessage({ tone: 'danger', text: t('inventory.countSheet.untracked') });
            }
            enqueue(
                { key: variantKey(v.package_session_id), package_session_id: v.package_session_id, name: v.product_name, variant_name: v.variant_name, sku: v.sku, piece_code: null, unit: v.unit, qty_scale: v.qty_scale },
                { kind: 'ADD', quantity: 1 }
            );
            setTyped((current) => {
                const next = { ...current };
                delete next[variantKey(v.package_session_id)];
                return next;
            });
            setMessage({ tone: 'success', text: t('inventory.countSheet.counted', { item: v.product_name ?? v.sku ?? '' }) });
        } else if (result.kind === 'NOT_FOUND') {
            scan.setValue(result.code);
            setMessage({ tone: 'info', text: t('inventory.scan.notFound') });
        } else if (result.kind === 'ERROR') {
            setMessage({ tone: 'danger', text: errorText(result.error) });
        }
    };
    const scan = useStockScan(onScan, { paused: !open || posting || cancelling || write.pinOpen });

    const commitTyped = (meta: LineMeta) => {
        const text = typed[meta.key];
        if (text === undefined) return;
        const base = parseDisplayQuantity(text, meta.qty_scale);
        if (base === null || base > 10_000_000) {
            return setMessage({ tone: 'danger', text: t('inventory.transferLines.quantityRange') });
        }
        enqueue(meta, { kind: 'SET', quantity: base });
    };

    const remove = async (meta: LineMeta) => {
        const line = saved.get(meta.key);
        setError(null);
        try {
            if (line) await deleteCountLine(view.id, line.id);
            setLines((current) => current.filter((l) => lineKey(l) !== meta.key));
            setOrder((current) => current.filter((m) => m.key !== meta.key));
            pending.current.delete(meta.key);
            failed.current.delete(meta.key);
            bump();
        } catch (e) {
            setError(e);
        }
    };

    const finishRecount = async () => {
        setError(null);
        try {
            await write.run({
                scope: `post:${view.id}`,
                body: {},
                send: (id) => postCount(view.id, { client_request_id: id }),
                onDone: () => {
                    toast.success(t('inventory.counts.recountDone'));
                    void invalidate();
                },
            });
        } catch (e) {
            setError(e);
        }
    };

    const cancel = async () => {
        await write.run({
            scope: `cancel:${view.id}`,
            body: {},
            send: (id) => cancelCount(view.id, { client_request_id: id }),
            onDone: () => {
                void invalidate();
                void navigate({ to: '/commerce/inventory', search: { tab: 'counts' } });
            },
        });
    };

    const summary = view.summary;
    const agreement = isRecount ? (summary?.agreement as Record<string, unknown> | undefined) : view.recount?.agreement;

    return (
        <div className="flex flex-col gap-4">
            <OrderNotice tone="info">{t('inventory.counts.tradingNote')}</OrderNotice>
            <div className="flex flex-wrap items-center gap-2 text-body text-muted-foreground">
                <CommerceStatusChip kind="stockCount" value={view.status} />
                <span>{view.location?.name}</span>
                <span>· {view.scope_collection?.name ?? t('inventory.counts.wholePlace')}</span>
                {view.started_at && <span>· {formatDateTime(view.started_at)}</span>}
            </div>
            {isRecount && open && <OrderNotice tone="info">{t('inventory.counts.recountHelp')}</OrderNotice>}
            {recountOpen && <OrderNotice tone="warning">{t('inventory.counts.recountRunning')}</OrderNotice>}
            {agreement && <AgreementNotice agreement={agreement} />}
            {view.status === 'POSTED' && summary && !isRecount && <CountSummary summary={summary} />}

            {open && actions.has('COUNT') && (
                <SectionCard title={t('inventory.countSheet.title')}>
                    <StockScanBox
                        scan={scan}
                        message={message}
                        locationId={view.location?.id ?? null}
                        testId="count-scan"
                        onPick={(item) => {
                            if ((item.stock_mode ?? '').toUpperCase() === 'PIECE') {
                                return setMessage({ tone: 'danger', text: t('inventory.countSheet.scanPieceLabels') });
                            }
                            const key = variantKey(item.package_session_id);
                            setOrder((current) =>
                                current.some((m) => m.key === key)
                                    ? current
                                    : [
                                          {
                                              key,
                                              package_session_id: item.package_session_id,
                                              name: pickName(item, lang),
                                              variant_name: item.variant_name,
                                              sku: item.sku,
                                              piece_code: null,
                                              unit: item.unit,
                                              qty_scale: item.qty_scale,
                                          },
                                          ...current,
                                      ]
                            );
                            setTyped((current) => ({ ...current, [key]: current[key] ?? '' }));
                        }}
                    />
                </SectionCard>
            )}

            <SectionCard title={t('inventory.countSheet.lines', { count: order.length })}>
                {order.length === 0 && <p className="text-body text-muted-foreground">{t('inventory.countSheet.empty')}</p>}
                <ul className="flex flex-col divide-y divide-border" data-testid="count-lines">
                    {order.map((meta) => {
                        const line = saved.get(meta.key);
                        const state = inFlight.current.has(meta.key) || pending.current.has(meta.key)
                            ? 'saving'
                            : failed.current.has(meta.key)
                              ? 'failed'
                              : line
                                ? 'saved'
                                : null;
                        const shown = shownQuantity(
                            line?.counted_qty ?? null,
                            inFlight.current.get(meta.key) ?? failed.current.get(meta.key),
                            pending.current.get(meta.key)
                        );
                        return (
                            <li key={meta.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 flex-col gap-1">
                                    <ItemCell name={meta.name} variant={meta.variant_name} sku={meta.sku} code={meta.piece_code} />
                                    {line?.counted_at && (
                                        <span className="text-caption text-muted-foreground">
                                            {t('inventory.countSheet.countedAt', { time: formatDateTime(line.counted_at) })}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {meta.piece_code ? (
                                        <span className="text-body">{t('inventory.countSheet.pieceCounted')}</span>
                                    ) : open ? (
                                        <input
                                            aria-label={t('inventory.countSheet.counted', { item: meta.sku ?? '' })}
                                            data-testid={`count-qty-${meta.package_session_id}`}
                                            inputMode={meta.qty_scale > 1 ? 'decimal' : 'numeric'}
                                            value={typed[meta.key] ?? (state === null ? '' : String(displayQuantity(shown, meta.qty_scale)))}
                                            onChange={(event) => setTyped({ ...typed, [meta.key]: event.target.value })}
                                            onBlur={() => commitTyped(meta)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    commitTyped(meta);
                                                }
                                            }}
                                            className="h-12 w-28 rounded-md border border-neutral-300 bg-background px-3 text-end text-body tabular-nums text-foreground focus:border-primary-500 focus:outline-none"
                                        />
                                    ) : (
                                        <Qty qty={line?.counted_qty ?? 0} scale={meta.qty_scale} unit={meta.unit} />
                                    )}
                                    {state && <SaveStateMark state={state} onRetry={() => retry(meta.key)} />}
                                    {open && (
                                        <button
                                            type="button"
                                            aria-label={t('inventory.receive.remove')}
                                            onClick={() => void remove(meta)}
                                            className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
                                        >
                                            <Trash size={18} />
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
                <InventoryErrorNotice error={saveError} />
            </SectionCard>

            {reviewing && !isRecount && <CountReviewPanel countId={view.id} onClose={() => setReviewing(false)} />}
            <InventoryErrorNotice error={error} />
            {unsaved && <p className="text-caption text-warning-600">{t('inventory.countSheet.waitForSaves')}</p>}

            {open && (
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end sm:pe-24">
                    {actions.has('CANCEL') && (
                        <MyButton type="button" buttonType="text" scale="medium" className={TOUCH} onClick={() => setCancelling(true)}>
                            {t('inventory.counts.cancel')}
                        </MyButton>
                    )}
                    {!isRecount && actions.has('REVIEW') && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="large"
                            className={TOUCH}
                            onClick={() => setReviewing(true)}
                            data-testid="count-review"
                        >
                            {t('inventory.counts.review')}
                        </MyButton>
                    )}
                    {isRecount ? (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large"
                            className="h-14"
                            disable={unsaved ? true : undefined}
                            onAsyncClick={finishRecount}
                            data-testid="count-finish-recount"
                        >
                            {t('inventory.counts.finishRecount')}
                        </MyButton>
                    ) : (
                        actions.has('POST') && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="large"
                                className="h-14"
                                disable={unsaved || recountOpen ? true : undefined}
                                onClick={() => setPosting(true)}
                                data-testid="count-open-post"
                            >
                                {t('inventory.counts.post')}
                            </MyButton>
                        )
                    )}
                </div>
            )}
            {posting && <PostCountDialog open onOpenChange={setPosting} view={view} />}
            <ConfirmDialog
                open={cancelling}
                onOpenChange={setCancelling}
                heading={t('inventory.counts.cancel')}
                confirmLabel={t('inventory.counts.cancelConfirm')}
                onConfirm={cancel}
                danger
            >
                <p>{t('inventory.counts.cancelQuestion')}</p>
            </ConfirmDialog>
            {write.dialog}
        </div>
    );
}

/** "{{percent}}% of lines agree" and pass or fail at 98 %. */
function AgreementNotice({ agreement }: { agreement: { percent?: unknown; passes?: unknown } }) {
    const { t } = useTranslation('commerce');
    const percent = typeof agreement.percent === 'number' ? agreement.percent : Number(agreement.percent ?? 0);
    const passes = agreement.passes === true;
    return (
        <OrderNotice tone={passes ? 'success' : 'warning'}>
            <span data-testid="count-agreement">
                {t('inventory.counts.agreement', { percent: formatNumber(percent, { maximumFractionDigits: 1 }) })} ·{' '}
                {passes ? t('inventory.counts.agreementPass') : t('inventory.counts.agreementFail')}
            </span>
        </OrderNotice>
    );
}

const SUMMARY_KEYS = ['lines', 'lines_with_difference', 'units_up', 'units_down', 'missing', 'found', 'misplaced', 'uncounted'] as const;

function CountSummary({ summary }: { summary: Record<string, unknown> }) {
    const { t } = useTranslation('commerce');
    return (
        <SectionCard title={t('inventory.counts.summary')}>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {SUMMARY_KEYS.map((key) => (
                    <div key={key} className="flex flex-col">
                        <dt className="text-caption text-muted-foreground">{t(`inventory.counts.summaryKeys.${key}`)}</dt>
                        <dd className="text-subtitle tabular-nums">{formatNumber(Number(summary[key] ?? 0))}</dd>
                    </div>
                ))}
            </dl>
        </SectionCard>
    );
}
