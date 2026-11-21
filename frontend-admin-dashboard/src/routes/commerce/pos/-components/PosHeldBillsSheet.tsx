import { useTranslation } from 'react-i18next';
import { Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/formatters';
import { cartGross, pickText } from '../-shared/pos-cart';
import type { HeldBill } from '../-shared/pos-held-bills';
import { rupees, usePosLang } from './pos-ui';

/** Bills held on this device for this counter; recall one onto the screen or drop it. */
export function PosHeldBillsSheet({
    open,
    onOpenChange,
    bills,
    onRecall,
    onDrop,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bills: HeldBill[];
    onRecall: (bill: HeldBill) => void;
    onDrop: (bill: HeldBill) => void;
}) {
    const { t } = useTranslation('commerce');
    const lang = usePosLang();
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="flex w-full flex-col gap-4 sm:max-w-md">
                <SheetHeader>
                    <SheetTitle>{t('pos.sell.held')}</SheetTitle>
                    <SheetDescription>{t('pos.held.description')}</SheetDescription>
                </SheetHeader>
                {bills.length === 0 && <p className="text-body text-muted-foreground">{t('pos.held.empty')}</p>}
                <ul className="flex flex-col gap-2 overflow-y-auto">
                    {[...bills].reverse().map((bill) => {
                        const first = bill.cart.lines[0];
                        return (
                            <li key={bill.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate text-body font-medium text-foreground">
                                            {first ? pickText(first.names, lang) || first.sku : '—'}
                                            {bill.cart.lines.length > 1
                                                ? ` ${t('pos.held.more', { count: bill.cart.lines.length - 1 })}`
                                                : ''}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {[formatDateTime(bill.held_at), bill.cart.customer.phone || null]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </div>
                                    <span className="tabular-nums text-body text-foreground">{rupees(cartGross(bill.cart))}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="large"
                                        className="h-12 flex-1"
                                        onClick={() => onRecall(bill)}
                                    >
                                        {t('pos.held.recall')}
                                    </MyButton>
                                    <button
                                        type="button"
                                        aria-label={t('pos.held.drop')}
                                        onClick={() => onDrop(bill)}
                                        className="flex size-12 items-center justify-center rounded-md text-neutral-500 hover:bg-danger-50 hover:text-danger-600"
                                    >
                                        <Trash size={20} />
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </SheetContent>
        </Sheet>
    );
}
