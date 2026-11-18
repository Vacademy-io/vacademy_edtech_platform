import { useTranslation } from 'react-i18next';
import { Minus, Plus, Ruler, Tag, Trash, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { type CartLine, isMeasured, isPieceLine, lineGross, pickText } from '../-shared/pos-cart';
import type { QuoteLine } from '../-shared/pos-types';
import { rupees, stockHint, useMarkText, usePosLang } from './pos-ui';

const stepButton =
    'flex size-12 shrink-0 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 hover:border-primary-500 disabled:opacity-40';

/** The lines of the bill: quantity stepper, piece chips, length, line discount, remove. */
export function PosCartLines({
    lines,
    quoteLines,
    onQuantity,
    onLength,
    onRemovePiece,
    onRemoveLine,
    onDiscount,
}: {
    lines: CartLine[];
    quoteLines: Map<string, QuoteLine>;
    onQuantity: (line: CartLine, quantity: number) => void;
    onLength: (line: CartLine) => void;
    onRemovePiece: (line: CartLine, pieceId: string) => void;
    onRemoveLine: (line: CartLine) => void;
    onDiscount: (line: CartLine) => void;
}) {
    const { t } = useTranslation('commerce');
    const lang = usePosLang();
    const markTextOf = useMarkText();

    if (lines.length === 0) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-subtitle text-foreground">{t('pos.sell.emptyTitle')}</p>
                <p className="text-body text-muted-foreground">{t('pos.sell.emptyHint')}</p>
            </div>
        );
    }

    return (
        <ul aria-label={t('pos.sell.lines')} className="flex flex-col gap-2">
            {lines.map((line) => {
                const quoted = quoteLines.get(line.lineRef);
                const variant = pickText(line.variantLabel, lang);
                const hint = stockHint(t, line.onHand, line.qtyScale, line.unit);
                const markText = line.mark ? markTextOf(line.mark) : null;
                return (
                    <li
                        key={line.lineRef}
                        data-testid={`pos-line-${line.lineRef}`}
                        className={cn(
                            'flex flex-col gap-2 rounded-lg border bg-card p-3',
                            line.mark ? 'border-danger-200' : 'border-border'
                        )}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-col">
                                <span className="text-subtitle font-medium text-foreground">
                                    {pickText(line.names, lang) || line.sku}
                                    {variant ? ` · ${variant}` : ''}
                                </span>
                                <span className="text-caption text-muted-foreground">
                                    {[line.sku, `${rupees(line.unitPrice)} ${t('pos.sell.each')}`, hint].filter(Boolean).join(' · ')}
                                </span>
                            </div>
                            <div className="flex shrink-0 flex-col items-end">
                                <span className="tabular-nums text-subtitle font-medium text-foreground" data-testid={`pos-line-total-${line.lineRef}`}>
                                    {rupees(quoted ? quoted.net : lineGross(line) - line.lineDiscount)}
                                </span>
                                {line.lineDiscount > 0 && (
                                    <span className="text-caption text-success-600">
                                        {t('pos.sell.lineDiscountShown', { amount: rupees(line.lineDiscount) })}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {isPieceLine(line) ? (
                                line.pieceCodes.map((code, index) => (
                                    <span
                                        key={code}
                                        className="flex min-h-12 items-center gap-1 rounded-md border border-neutral-300 bg-neutral-50 ps-3 text-body text-foreground"
                                    >
                                        {code}
                                        <button
                                            type="button"
                                            aria-label={t('pos.sell.removePiece', { code })}
                                            onClick={() => onRemovePiece(line, line.pieceIds[index] ?? '')}
                                            className="flex size-12 items-center justify-center text-neutral-500 hover:text-danger-600"
                                        >
                                            <X size={18} />
                                        </button>
                                    </span>
                                ))
                            ) : isMeasured(line) ? (
                                <button
                                    type="button"
                                    onClick={() => onLength(line)}
                                    className="flex min-h-12 items-center gap-2 rounded-md border border-neutral-300 px-3 text-body text-foreground hover:border-primary-500"
                                >
                                    <Ruler size={18} />
                                    {formatQuantity(line.quantity, line.qtyScale, line.unit, t)}
                                </button>
                            ) : (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        className={stepButton}
                                        aria-label={t('pos.sell.less')}
                                        disabled={line.quantity <= line.qtyStep}
                                        onClick={() => onQuantity(line, line.quantity - line.qtyStep)}
                                    >
                                        <Minus size={18} />
                                    </button>
                                    <span
                                        data-testid={`pos-qty-${line.lineRef}`}
                                        className="min-w-12 text-center tabular-nums text-subtitle text-foreground"
                                    >
                                        {formatQuantity(line.quantity, line.qtyScale, line.unit, t)}
                                    </span>
                                    <button
                                        type="button"
                                        className={stepButton}
                                        aria-label={t('pos.sell.more')}
                                        onClick={() => onQuantity(line, line.quantity + line.qtyStep)}
                                    >
                                        <Plus size={18} />
                                    </button>
                                </div>
                            )}
                            <span className="flex-1" />
                            <button
                                type="button"
                                onClick={() => onDiscount(line)}
                                className="flex min-h-12 items-center gap-1.5 rounded-md px-3 text-body text-primary-500 hover:bg-primary-50"
                            >
                                <Tag size={18} />
                                {t('pos.sell.discount')}
                            </button>
                            <button
                                type="button"
                                aria-label={t('pos.sell.removeLine')}
                                onClick={() => onRemoveLine(line)}
                                className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-danger-50 hover:text-danger-600"
                            >
                                <Trash size={20} />
                            </button>
                        </div>
                        {markText && (
                            <p role="alert" className="text-body text-danger-600">
                                {markText}
                            </p>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
