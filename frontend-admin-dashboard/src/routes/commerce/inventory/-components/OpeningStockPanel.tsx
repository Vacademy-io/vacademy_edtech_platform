import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { formatMoney } from '@/components/design-system/money-cell';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceLoadingRows } from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { useOpeningReadiness } from '../-shared/inventory-hooks';
import type { InventoryTab, OpeningBlocker, OpeningReadiness, OpeningStatus } from '../-shared/inventory-types';
import { InventoryErrorNotice, TOUCH } from './inventory-ui';

/** The tabs the panel links to; Receive opens with the source Opening stock chosen. */
export type OpeningLink = Extract<InventoryTab, 'receive' | 'labels' | 'counts'>;

const STATUS_TONE: Record<OpeningStatus, StatusType> = {
    NOT_STARTED: 'INFO',
    RECEIVING: 'INFO',
    COUNTING: 'WARNING',
    RECOUNT_FAILED: 'DANGER',
    PASSED: 'SUCCESS',
};

/** How many SKUs or receipt numbers a warning names before it stops. */
const NAMED = 5;

/**
 * Opening stock of the chosen place (WP-53, `GET /stock/opening/readiness`): a card above the
 * inventory tabs, only when the institute has the switch-over feature and one place is chosen.
 * Status, item costs, opening receipts, the latest blind recount and what still blocks the
 * place, with links to Receive (source Opening stock), Labels and Counts. Warehouse staff see
 * no money: the server leaves the value out for them.
 *
 * Strings live in their own namespace (`commerceOpeningStock`); the translator is named `tr`
 * so the commerce-namespace key scan does not read these keys as `commerce` keys.
 */
export function OpeningStockPanel({
    locationId,
    onGo,
}: {
    locationId: string | null;
    onGo: (tab: OpeningLink) => void;
}) {
    const access = useCommerceAccess();
    const featureOn = access.isResolved && access.isFeatureOn(COMMERCE_FEATURE.MIGRATION);
    const query = useOpeningReadiness(featureOn ? locationId : null);
    if (!featureOn || !locationId) return null;
    return (
        <OpeningCard>
            {query.isLoading && <CommerceLoadingRows rows={2} />}
            {query.isError && <InventoryErrorNotice error={query.error} />}
            {query.data && <OpeningBody data={query.data} onGo={onGo} />}
        </OpeningCard>
    );
}

function OpeningCard({ children }: { children: ReactNode }) {
    const { t: tr } = useTranslation('commerceOpeningStock');
    return (
        <section data-testid="opening-stock-panel">
            <SectionCard title={tr('title')} description={tr('description')}>
                {children}
            </SectionCard>
        </section>
    );
}

function OpeningBody({ data, onGo }: { data: OpeningReadiness; onGo: (tab: OpeningLink) => void }) {
    const { t: tr, i18n } = useTranslation('commerceOpeningStock');
    const number = new Intl.NumberFormat(i18n.language || 'en', { maximumFractionDigits: 1 });
    const n = (value: number) => number.format(value);
    const recount = data.recount;
    const showValue = data.sees_cost && data.receipts.value !== null;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span data-testid="opening-status">
                    <StatusChip
                        text={tr(`status.${data.status}`)}
                        status={STATUS_TONE[data.status]}
                        textSize="text-caption"
                        showIcon={false}
                    />
                </span>
                <p className="text-body text-muted-foreground">{tr(`statusHelp.${data.status}`)}</p>
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure
                    label={tr('figures.costs')}
                    value={tr('figures.costsValue', { withCost: n(data.items.with_cost), tracked: n(data.items.tracked) })}
                />
                <Figure
                    label={tr('figures.receipts')}
                    value={tr('figures.receiptsValue', { receipts: n(data.receipts.count), units: n(data.receipts.units) })}
                />
                <Figure
                    label={tr('figures.unitsCosted')}
                    value={tr('figures.unitsCostedValue', {
                        costed: n(data.receipts.units_costed),
                        units: n(data.receipts.units),
                    })}
                />
                {showValue && (
                    <Figure
                        testId="opening-value"
                        label={tr('figures.value')}
                        value={formatMoney(data.receipts.value, 'INR')}
                    />
                )}
                <Figure
                    label={tr('figures.recount')}
                    value={
                        recount
                            ? tr('figures.recountValue', {
                                  compared: n(recount.compared),
                                  lines: n(recount.main_lines),
                                  sample: n(recount.sample_percent),
                              })
                            : tr('figures.recountNone')
                    }
                />
                {recount && (
                    <Figure
                        label={tr('figures.agreement')}
                        value={tr('figures.agreementValue', { percent: n(recount.percent) })}
                    />
                )}
            </dl>

            {(data.items.institute_without_cost ?? 0) > data.items.without_cost && (
                <p className="text-caption text-muted-foreground" data-testid="opening-other-without-cost">
                    {tr('otherWithoutCost', {
                        items: n((data.items.institute_without_cost ?? 0) - data.items.without_cost),
                    })}
                </p>
            )}

            {data.blockers.length > 0 && (
                <OrderNotice tone={data.status === 'RECOUNT_FAILED' ? 'danger' : 'warning'}>
                    <ul className="flex flex-col gap-1" data-testid="opening-blockers">
                        {data.blockers.map((blocker) => (
                            <li key={blocker}>
                                <p>{blockerText(blocker, data, tr, n)}</p>
                                {blocker === 'COSTS_MISSING' && data.items.without_cost_skus.length > 0 && (
                                    <p className="text-caption text-muted-foreground">
                                        {tr('withoutCost', { skus: named(data.items.without_cost_skus, data.items.without_cost) })}
                                    </p>
                                )}
                                {blocker === 'UNCOSTED_OPENING_RECEIPT' && (
                                    <p className="text-caption text-muted-foreground">
                                        {tr('uncostedReceipts', {
                                            numbers: named(
                                                data.receipts.uncosted_receipts.map((r) => r.receipt_number ?? r.id),
                                                data.receipts.uncosted_receipts.length
                                            ),
                                        })}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                </OrderNotice>
            )}

            <div className="flex flex-wrap gap-2">
                <MyButton type="button" buttonType="primary" scale="medium" className={TOUCH} onClick={() => onGo('receive')}>
                    {tr('actions.receive')}
                </MyButton>
                <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => onGo('labels')}>
                    {tr('actions.labels')}
                </MyButton>
                <MyButton type="button" buttonType="secondary" scale="medium" className={TOUCH} onClick={() => onGo('counts')}>
                    {tr('actions.counts')}
                </MyButton>
            </div>
        </div>
    );
}

function Figure({ label, value, testId }: { label: string; value: string; testId?: string }) {
    return (
        <div className="flex flex-col gap-1 rounded-md border border-border p-3" data-testid={testId}>
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="text-subtitle font-medium">{value}</dd>
        </div>
    );
}

/** The first few names, and an ellipsis when there are more. */
function named(names: string[], total: number): string {
    const shown = names.slice(0, NAMED).join(', ');
    return total > NAMED ? `${shown}, …` : shown;
}

function blockerText(
    blocker: OpeningBlocker,
    data: OpeningReadiness,
    tr: TFunction,
    n: (value: number) => string
): string {
    switch (blocker) {
        case 'COSTS_MISSING':
            return tr('blockers.COSTS_MISSING', { items: n(data.items.without_cost) });
        case 'SAMPLE_TOO_SMALL':
            return tr('blockers.SAMPLE_TOO_SMALL', {
                compared: n(data.recount?.compared ?? 0),
                needed: n(data.recount?.sample_needed ?? 0),
            });
        case 'AGREEMENT_BELOW_98':
            return tr('blockers.AGREEMENT_BELOW_98', { percent: n(data.recount?.percent ?? 0) });
        default:
            return tr(`blockers.${blocker}`);
    }
}
