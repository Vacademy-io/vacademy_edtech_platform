import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { ORDER_ERROR_CODES } from '@/routes/commerce/orders/-shared/order-errors';
import type { BulkResult } from '@/routes/commerce/orders/-shared/order-types';

const KNOWN = new Set<string>(ORDER_ERROR_CODES);

/**
 * What a bulk action did, order by order. Failures show the mapped sentence
 * and the server's own (it names the order or the line). "Untick the done
 * ones" leaves only the failed orders ticked, ready for another try.
 */
export function BulkResultsDialog({
    results,
    numberOf,
    onClose,
    onUntickDone,
}: {
    results: BulkResult[] | null;
    numberOf: (orderId: string) => string;
    onClose: () => void;
    onUntickDone: (doneIds: string[]) => void;
}) {
    const { t } = useTranslation('commerce');
    const list = results ?? [];
    const done = list.filter((result) => result.ok);
    const failed = list.filter((result) => !result.ok);
    return (
        <MyDialog
            heading={t('orders.bulk.results.title')}
            open={results !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            dialogWidth="max-w-2xl"
            footer={
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('orders.bulk.results.close')}
                    </MyButton>
                    {done.length > 0 && failed.length > 0 && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                onUntickDone(done.map((result) => result.order_id));
                                onClose();
                            }}
                        >
                            {t('orders.bulk.results.untickDone')}
                        </MyButton>
                    )}
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-foreground" role="status">
                    {t('orders.bulk.results.summary', { ok: done.length, failed: failed.length })}
                </p>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {[...failed, ...done].map((result) => (
                        <li key={result.order_id} className="flex items-start gap-3 p-3">
                            {result.ok ? (
                                <CheckCircle
                                    size={18}
                                    weight="fill"
                                    className="mt-0.5 shrink-0 text-success-600"
                                    aria-label={t('orders.bulk.results.done')}
                                />
                            ) : (
                                <XCircle
                                    size={18}
                                    weight="fill"
                                    className="mt-0.5 shrink-0 text-danger-600"
                                    aria-label={t('orders.bulk.results.notDone')}
                                />
                            )}
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-body font-medium text-foreground">
                                    {numberOf(result.order_id)}
                                </span>
                                {!result.ok && (
                                    <span className="text-caption text-danger-600">
                                        {result.code && KNOWN.has(result.code)
                                            ? t(`orders.errors.${result.code}`, { amount: '', minutes: 1 })
                                            : t('orders.errors.generic')}
                                    </span>
                                )}
                                {!result.ok && result.message && (
                                    <span className="text-caption text-muted-foreground">{result.message}</span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </MyDialog>
    );
}
